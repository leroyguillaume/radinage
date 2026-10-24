import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectMantineOption } from "@/__tests__/mantine";
import { ImportModal } from "@/components/ImportModal";
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

const { apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

function makeProfile(
	overrides: Partial<ImportProfileResponse> = {},
): ImportProfileResponse {
	return {
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
		lastUsedAt: "2026-10-20T10:00:00Z",
		createdAt: "2026-01-01T10:00:00Z",
		...overrides,
	};
}

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

/** Answer the profile list with `profiles`, the accounts with `account` and every import with `importResult`. */
function mockApi(
	profiles: ImportProfileResponse[],
	importResult: unknown = { imported: 2, skipped: 0, relabeled: 0, errors: [] },
) {
	apiFetchMock.mockImplementation(async (path) => {
		if (path === "/import-profiles") return profiles;
		if (path === "/accounts") return [account];
		if (path === "/operations/import") {
			if (importResult instanceof Error) throw importResult;
			return importResult;
		}
		throw new Error(`unexpected call to ${path}`);
	});
}

function renderModal(onSuccess = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<ImportModal opened onClose={vi.fn()} onSuccess={onSuccess} />
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { onSuccess };
}

async function uploadFile() {
	const file = new File(["a,b"], "releve.csv", { type: "text/csv" });
	const input = document.querySelector("input[type='file']");
	if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
	await userEvent.setup().upload(input, file);
	return file;
}

function importCall() {
	const call = apiFetchMock.mock.calls.find(
		([path]) => path === "/operations/import",
	);
	const body = call?.[1]?.body;
	if (!(body instanceof FormData)) throw new Error("no import call");
	return body;
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
});

afterEach(() => {
	vi.restoreAllMocks();
	apiFetchMock.mockReset();
});

describe("ImportModal", () => {
	it("invites to create a profile when there is none", async () => {
		mockApi([]);
		renderModal();
		const user = userEvent.setup();

		expect(
			await screen.findByText("Créez votre premier profil"),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Créer un profil" }));

		expect(screen.getByText("Nouveau profil")).toBeInTheDocument();
		expect(screen.getByLabelText(/Nom/)).toHaveValue("");
	});

	it("preselects the most recently used profile", async () => {
		mockApi([makeProfile(), makeProfile({ id: "p2", name: "Boursorama" })]);
		renderModal();

		const profile = await screen.findByRole("combobox", { name: "Profil" });
		await waitFor(() =>
			expect(profile).toHaveValue("Crédit Agricole · Compte perso"),
		);
	});

	it("keeps import disabled until a file is chosen", async () => {
		mockApi([makeProfile()]);
		renderModal();

		await screen.findByRole("combobox", { name: "Profil" });
		expect(screen.getByRole("button", { name: "Importer" })).toBeDisabled();
	});

	it("imports with the selected profile's settings", async () => {
		const result = { imported: 2, skipped: 1, relabeled: 0, errors: [] };
		mockApi(
			[
				makeProfile(),
				makeProfile({
					id: "p2",
					name: "Boursorama",
					labelCol: 2,
					labelFallbackCol: 4,
				}),
			],
			result,
		);
		const { onSuccess } = renderModal();

		const profile = await screen.findByRole("combobox", { name: "Profil" });
		await waitFor(() =>
			expect(profile).toHaveValue("Crédit Agricole · Compte perso"),
		);
		await selectMantineOption("Profil", "Boursorama · Compte perso");
		const file = await uploadFile();
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Importer" }));

		await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
		const body = importCall();
		expect(body.get("file")).toEqual(file);
		expect(body.get("profileId")).toBe("p2");
		expect(body.get("accountId")).toBe("account-1");
		expect(body.get("labelCol")).toBe("2");
		expect(body.get("labelFallbackCol")).toBe("4");
		expect(body.get("amountCol")).toBe("3");
		expect(body.get("dateCol")).toBe("0");
		expect(body.get("dateFormat")).toBe("%d/%m/%Y");
		expect(body.get("skipLines")).toBe("1");
	});

	it("shows an error when the import fails", async () => {
		mockApi([makeProfile()], new Error("Network error"));
		renderModal();

		await screen.findByRole("combobox", { name: "Profil" });
		await uploadFile();
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Importer" }));

		expect(
			await screen.findByText("Erreur lors de l'import"),
		).toBeInTheDocument();
	});

	it("opens a blank profile form from the new profile option", async () => {
		mockApi([makeProfile()]);
		renderModal();

		await screen.findByRole("combobox", { name: "Profil" });
		await selectMantineOption("Profil", "＋ Nouveau profil…");

		expect(screen.getByText("Nouveau profil")).toBeInTheDocument();
		expect(screen.getByLabelText(/Nom/)).toHaveValue("");
	});

	it("edits the selected profile and comes back on cancel", async () => {
		mockApi([makeProfile()]);
		renderModal();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Modifier le profil" }),
		);
		expect(screen.getByLabelText(/Nom/)).toHaveValue("Crédit Agricole");

		await user.click(screen.getByRole("button", { name: "Annuler" }));
		expect(screen.getByRole("combobox", { name: "Profil" })).toHaveValue(
			"Crédit Agricole · Compte perso",
		);
	});
});
