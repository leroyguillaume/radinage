import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectMantineOption } from "@/__tests__/mantine";
import {
	assignColumn,
	type ColumnRoles,
	ImportProfileForm,
} from "@/components/ImportProfileForm";
import { i18n } from "@/i18n";
import type { AccountResponse, ImportProfileResponse } from "@/lib/types";
import { theme } from "@/theme";

vi.mock("@/lib/api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.name = "ApiError";
			this.status = status;
		}
	},
	apiFetch: vi.fn(),
}));

const { ApiError, apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

const existing: ImportProfileResponse = {
	id: "p1",
	name: "Crédit Agricole",
	accountId: "account-1",
	labelCol: 1,
	labelFallbackCol: null,
	amountCol: 3,
	dateCol: 0,
	dateFormat: "%d/%m/%Y",
	skipLines: 1,
	csvDelimiter: "comma",
	lastUsedAt: null,
	createdAt: "2026-01-01T10:00:00Z",
};

const previewRows = [
	["Date", "Libellé", "Réf.", "Montant"],
	["02/10/2026", "CB MONOPRIX", "48211", "-42,18"],
	["03/10/2026", "VIR SALAIRE", "48212", "2 450,00"],
];

const account: AccountResponse = {
	id: "account-1",
	name: "Compte perso",
	kind: "checking",
	imported: true,
	receivesOperations: true,
	balance: null,
	currentBalance: null,
	transferredInto: false,
	createdAt: "2026-01-01T10:00:00Z",
};

const savings: AccountResponse = {
	...account,
	id: "account-2",
	name: "Livret A",
	kind: "savings",
	imported: false,
	receivesOperations: false,
};

function renderForm(
	profile: ImportProfileResponse | null = null,
	accounts: AccountResponse[] = [savings, account],
) {
	const onSaved = vi.fn();
	const onDeleted = vi.fn();
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	queryClient.setQueryData(["accounts"], accounts);

	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<ImportProfileForm
					profile={profile}
					onSaved={onSaved}
					onCancel={vi.fn()}
					onDeleted={onDeleted}
				/>
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { onSaved, onDeleted };
}

function savedBody() {
	const call = apiFetchMock.mock.calls.find(
		([path, options]) =>
			path.startsWith("/import-profiles") && options?.method !== "DELETE",
	);
	const body = call?.[1]?.body;
	if (typeof body !== "string") throw new Error("no save call");
	return { path: call?.[0], method: call?.[1]?.method, body: JSON.parse(body) };
}

async function assignRole(column: string, role: string) {
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: `Colonne ${column}` }));
	await user.click(await screen.findByRole("menuitem", { name: role }));
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
});

afterEach(() => {
	vi.restoreAllMocks();
	apiFetchMock.mockReset();
});

describe("assignColumn", () => {
	const roles: ColumnRoles = {
		label: 1,
		labelFallback: 2,
		amount: 3,
		date: 0,
	};

	it("swaps roles when the column already had one", () => {
		expect(assignColumn(roles, 3, "label")).toEqual({
			label: 3,
			labelFallback: 2,
			amount: 1,
			date: 0,
		});
	});

	it("moves a role to a column that had none", () => {
		expect(assignColumn(roles, 4, "amount")).toEqual({
			label: 1,
			labelFallback: 2,
			amount: 4,
			date: 0,
		});
	});

	it("clears the role of an ignored column", () => {
		expect(assignColumn(roles, 2, null)).toEqual({
			label: 1,
			labelFallback: null,
			amount: 3,
			date: 0,
		});
	});
});

describe("ImportProfileForm", () => {
	it("offers only the accounts receiving operations, the first one by default", async () => {
		renderForm(null, [
			savings,
			account,
			{ ...account, id: "account-3", name: "Compte joint" },
		]);

		const select = screen.getByRole("combobox", { name: /^Compte/ });
		expect(select).toHaveValue("Compte perso");
		fireEvent.focus(select);
		fireEvent.click(select);
		expect(
			await screen.findByRole("option", { name: "Compte joint" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("option", { name: "Livret A" }),
		).not.toBeInTheDocument();
	});

	it("asks for an account receiving operations before a profile can be saved", async () => {
		renderForm(null, [savings]);
		const user = userEvent.setup();

		expect(
			screen.getByText(/ajoute d'abord, dans les réglages, un compte courant/i),
		).toBeInTheDocument();
		await user.type(screen.getByLabelText(/Nom/), "Ma banque");
		await selectMantineOption("Colonne du libellé", "B");
		await selectMantineOption("Colonne du montant", "D");
		await selectMantineOption("Colonne de la date", "A");
		expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
	});

	it("creates a profile from columns picked by letter", async () => {
		apiFetchMock.mockResolvedValue({ ...existing, id: "new" });
		const { onSaved } = renderForm();
		const user = userEvent.setup();

		const save = screen.getByRole("button", { name: "Enregistrer" });
		expect(save).toBeDisabled();
		expect(
			screen.getByLabelText(/Colonne du libellé/, { selector: "input" }),
		).toBeRequired();
		expect(
			screen.getByLabelText(/Libellé de secours/, { selector: "input" }),
		).not.toBeRequired();

		await user.type(screen.getByLabelText(/Nom/), "  Ma banque ");
		await selectMantineOption("Colonne du libellé", "B");
		await selectMantineOption("Colonne du montant", "D");
		await selectMantineOption("Colonne de la date", "A");
		await selectMantineOption("Format de date", "2026-12-31");
		await user.click(save);

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(savedBody()).toEqual({
			path: "/import-profiles",
			method: "POST",
			body: {
				name: "Ma banque",
				accountId: "account-1",
				labelCol: 1,
				labelFallbackCol: null,
				amountCol: 3,
				dateCol: 0,
				dateFormat: "%Y-%m-%d",
				skipLines: 1,
				csvDelimiter: "comma",
			},
		});
	});

	it("picks columns from a sample file preview", async () => {
		apiFetchMock.mockImplementation(async (path) => {
			if (path === "/operations/import/preview") return { rows: previewRows };
			return { ...existing, id: "new" };
		});
		const { onSaved } = renderForm();
		const user = userEvent.setup();

		await user.type(screen.getByLabelText(/Nom/), "Ma banque");
		const input = document.querySelector("input[type='file']");
		if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
		await user.upload(input, new File(["x"], "sample.csv"));

		expect(await screen.findByText("CB MONOPRIX")).toBeInTheDocument();
		await assignRole("A", "Date");
		await assignRole("B", "Libellé");
		await assignRole("C", "Libellé de secours");
		await assignRole("D", "Montant");
		expect(
			within(screen.getByRole("button", { name: "Colonne D" })).getByText(
				"Montant",
			),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(savedBody().body).toMatchObject({
			labelCol: 1,
			labelFallbackCol: 2,
			amountCol: 3,
			dateCol: 0,
		});
	});

	it("re-reads the sample with the chosen separator", async () => {
		apiFetchMock.mockImplementation(async (path) => {
			if (path === "/operations/import/preview") return { rows: previewRows };
			return { ...existing, id: "new" };
		});
		const { onSaved } = renderForm();
		const user = userEvent.setup();

		await user.type(screen.getByLabelText(/Nom/), "Ma banque");
		const input = document.querySelector("input[type='file']");
		if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
		await user.upload(input, new File(["x"], "sample.csv"));
		await screen.findByText("CB MONOPRIX");
		await selectMantineOption("Séparateur", "Point-virgule ( ; )");

		await screen.findByText("CB MONOPRIX");
		const previews = apiFetchMock.mock.calls
			.filter(([path]) => path === "/operations/import/preview")
			.map(([, options]) => {
				const body = options?.body;
				return body instanceof FormData ? body.get("csvDelimiter") : null;
			});
		expect(previews).toEqual(["comma", "semicolon"]);

		await assignRole("A", "Date");
		await assignRole("B", "Libellé");
		await assignRole("D", "Montant");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(savedBody().body).toMatchObject({ csvDelimiter: "semicolon" });
	});

	it("reports a sample file the server cannot read", async () => {
		apiFetchMock.mockRejectedValue(new ApiError(400, "Bad Request"));
		renderForm();

		const input = document.querySelector("input[type='file']");
		if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
		await userEvent.setup().upload(input, new File(["x"], "sample.xlsx"));

		expect(
			await screen.findByText("Impossible de lire ce fichier"),
		).toBeInTheDocument();
	});

	it("updates an existing profile in place", async () => {
		apiFetchMock.mockResolvedValue(existing);
		const { onSaved } = renderForm(existing);
		const user = userEvent.setup();

		const skip = screen.getByLabelText("Lignes ignorées");
		await user.clear(skip);
		await user.type(skip, "3");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => expect(onSaved).toHaveBeenCalledWith(existing));
		expect(savedBody()).toMatchObject({
			path: "/import-profiles/p1",
			method: "PUT",
			body: { name: "Crédit Agricole", skipLines: 3 },
		});
	});

	it("explains a name conflict", async () => {
		apiFetchMock.mockRejectedValue(new ApiError(409, "Conflict"));
		renderForm(existing);

		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText(/Un profil porte déjà ce nom/),
		).toBeInTheDocument();
	});

	it("deletes only after confirmation", async () => {
		apiFetchMock.mockResolvedValue(undefined);
		const { onDeleted } = renderForm(existing);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Supprimer" }));
		expect(apiFetchMock).not.toHaveBeenCalled();

		await user.click(
			screen.getByRole("button", { name: "Confirmer la suppression" }),
		);

		await waitFor(() => expect(onDeleted).toHaveBeenCalled());
		expect(apiFetchMock).toHaveBeenCalledWith("/import-profiles/p1", {
			method: "DELETE",
		});
	});
});
