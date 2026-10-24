import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IgnoreRulesSection } from "@/components/IgnoreRulesSection";
import { i18n } from "@/i18n";
import type { IgnoreRuleResponse } from "@/lib/types";
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

const { apiFetch, ApiError } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

const internal: IgnoreRuleResponse = {
	id: "r1",
	labelPattern: { type: "contains", value: "VIR INTERNE" },
	amount: null,
	createdAt: "2026-01-01T00:00:00Z",
};

const refund: IgnoreRuleResponse = {
	id: "r2",
	labelPattern: { type: "startsWith", value: "REMB" },
	amount: "250.0000",
	createdAt: "2026-01-02T00:00:00Z",
};

/** Serve `rules` on GET /ignore-rules and `onWrite` for every other call. */
function mockApi(
	rules: IgnoreRuleResponse[],
	onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(internal),
) {
	apiFetchMock.mockImplementation((path: string, options?: RequestInit) =>
		path === "/ignore-rules" && options?.method === undefined
			? Promise.resolve(rules)
			: onWrite(path),
	);
}

function writes() {
	return apiFetchMock.mock.calls
		.filter(([, options]) => options?.method !== undefined)
		.map(([path, options]) => ({
			path,
			method: options?.method,
			body: typeof options?.body === "string" ? JSON.parse(options.body) : null,
		}));
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<IgnoreRulesSection />
			</MantineProvider>
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("IgnoreRulesSection", () => {
	it("lists the rules with their amount", async () => {
		mockApi([internal, refund]);
		renderSection();

		expect(
			await screen.findByText("Contient « VIR INTERNE »"),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Commence par « REMB » · montant 250,00/),
		).toBeInTheDocument();
	});

	it("says when there is no rule", async () => {
		mockApi([]);
		renderSection();

		expect(
			await screen.findByText("Aucune règle pour l'instant."),
		).toBeInTheDocument();
	});

	it("creates a rule, then applies it to the existing operations", async () => {
		mockApi([], (path) =>
			Promise.resolve(
				path.endsWith("/apply") ? { ignored: 12, alreadyIgnored: 3 } : internal,
			),
		);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une règle/ }),
		);
		await user.type(
			screen.getByRole("textbox", { name: /Valeur/ }),
			"  VIR INTERNE ",
		);
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));
		await user.click(await screen.findByRole("button", { name: "Appliquer" }));

		expect(
			await screen.findByText("12 opération(s) ignorée(s), 3 l'étai(en)t déjà"),
		).toBeInTheDocument();
		expect(writes()).toEqual([
			{
				path: "/ignore-rules",
				method: "POST",
				body: {
					labelPattern: { type: "contains", value: "VIR INTERNE" },
					amount: null,
				},
			},
			{ path: "/ignore-rules/r1/apply", method: "POST", body: null },
		]);
	});

	it("leaves the existing operations alone when applying is put off", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une règle/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Valeur/ }), "VIR");
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));
		await user.click(await screen.findByRole("button", { name: "Plus tard" }));

		expect(
			screen.getByRole("button", { name: /Ajouter une règle/ }),
		).toBeInTheDocument();
		expect(writes().map((w) => w.path)).toEqual(["/ignore-rules"]);
	});

	it("sends the amount without its sign", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une règle/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Valeur/ }), "REMB");
		await user.type(
			screen.getByRole("textbox", { name: /Montant exact/ }),
			"-250,5",
		);
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));

		await waitFor(() =>
			expect(writes()[0]?.body).toEqual({
				labelPattern: { type: "contains", value: "REMB" },
				amount: "250.50",
			}),
		);
	});

	it("refuses an amount that is not a number without calling the API", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une règle/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Valeur/ }), "REMB");
		await user.type(
			screen.getByRole("textbox", { name: /Montant exact/ }),
			"beaucoup",
		);
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));

		expect(
			await screen.findByText(/Le montant doit être un nombre positif/),
		).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("says so when the rule limit is reached", async () => {
		mockApi([], () => Promise.reject(new ApiError(409, "Conflict")));
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une règle/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Valeur/ }), "VIR");
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));

		expect(
			await screen.findByText(/nombre maximal de règles d'ignore/),
		).toBeInTheDocument();
	});

	it("edits a rule without offering to apply it", async () => {
		mockApi([refund], () => Promise.resolve(refund));
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Modifier la règle/ }),
		);
		const amount = screen.getByRole("textbox", { name: /Montant exact/ });
		expect(amount).toHaveValue("250,00");
		await user.clear(amount);
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/ignore-rules/r2",
					method: "PUT",
					body: {
						labelPattern: { type: "startsWith", value: "REMB" },
						amount: null,
					},
				},
			]),
		);
		expect(
			screen.queryByRole("button", { name: "Appliquer" }),
		).not.toBeInTheDocument();
	});

	it("deletes a rule once confirmed", async () => {
		mockApi([internal], () => Promise.resolve(undefined));
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Supprimer la règle/ }),
		);
		expect(screen.getByText(/seront de nouveau comptées/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Supprimer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{ path: "/ignore-rules/r1", method: "DELETE", body: null },
			]),
		);
	});
});
