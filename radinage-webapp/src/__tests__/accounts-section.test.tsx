import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsSection } from "@/components/AccountsSection";
import { i18n } from "@/i18n";
import type { AccountResponse, BudgetResponse } from "@/lib/types";
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

const perso: AccountResponse = {
	id: "perso",
	name: "Compte perso",
	kind: "checking",
	imported: true,
	receivesOperations: true,
	balance: { id: "b-perso", amount: "1500.00", date: "2025-02-03" },
	currentBalance: "1655.18",
	createdAt: "2026-01-01T10:00:00Z",
};

const livret: AccountResponse = {
	id: "livret",
	name: "Livret A",
	kind: "savings",
	imported: false,
	receivesOperations: false,
	balance: { id: "b-livret", amount: "9760.00", date: "2026-10-21" },
	currentBalance: "9760.00",
	createdAt: "2026-01-01T10:00:00Z",
};

const pro: AccountResponse = {
	id: "pro",
	name: "Compte pro",
	kind: "checking",
	imported: false,
	receivesOperations: false,
	balance: null,
	currentBalance: null,
	createdAt: "2026-01-01T10:00:00Z",
};

/** The id a write to `path` answers with: the account's or balance's, "new" when created. */
function writtenId(path: string): string {
	return (
		path.match(/\/accounts\/[^/]+\/balances\/([^/]+)$/)?.[1] ??
		path.match(/^\/accounts\/([^/]+)$/)?.[1] ??
		"new"
	);
}

/** Serve `accounts` on GET /accounts, `budgets` on GET /budgets, and answer writes with `onWrite`. */
function mockApi(
	accounts: AccountResponse[],
	onWrite: (path: string, init: RequestInit) => Promise<unknown> = (
		path,
		init,
	) =>
		Promise.resolve(
			typeof init.body === "string"
				? { id: writtenId(path), ...JSON.parse(init.body) }
				: undefined,
		),
	budgets: BudgetResponse[] = [],
) {
	apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
		if (init?.method) return onWrite(path, init);
		if (path === "/accounts") return Promise.resolve(accounts);
		if (path.startsWith("/budgets")) return Promise.resolve(budgets);
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const rootRoute = createRootRoute();
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: AccountsSection,
	});
	const accountRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/accounts/$accountId",
		component: () => <p>account page</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([settingsRoute, accountRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<DatesProvider settings={{ locale: "fr" }}>
					<RouterProvider router={router} />
				</DatesProvider>
			</MantineProvider>
		</QueryClientProvider>,
	);
	return router;
}

function writes() {
	return apiFetchMock.mock.calls
		.filter(([, init]) => init?.method)
		.map(([path, init]) => ({
			path,
			method: init?.method,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
		}));
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("AccountsSection", () => {
	it("groups the accounts and shows how each balance is known", async () => {
		mockApi([perso, pro, livret]);
		renderSection();

		const imported = (await screen.findByText("Courants importés")).closest(
			"div.mantine-Stack-root",
		);
		if (!(imported instanceof HTMLElement)) throw new Error("no group");
		expect(within(imported).getByText("Compte perso")).toBeInTheDocument();
		expect(
			within(imported).getByText("calculé depuis le 03/02/2025"),
		).toBeInTheDocument();
		expect(screen.getByText("Épargne")).toBeInTheDocument();
		expect(screen.getByText("relevé au 21/10/2026")).toBeInTheDocument();
		expect(screen.getByText("Non importés")).toBeInTheDocument();
		expect(screen.getByText("sans solde")).toBeInTheDocument();
	});

	it("shows the savings budgets paying into a savings account", async () => {
		const savingsBudget = (
			id: string,
			label: string,
			accountId: string | null,
		) =>
			({
				id,
				label,
				budgetType: "savings",
				kind: { type: "occasional", month: 1, year: 2026, amount: "-100" },
				rules: [],
				categoryId: null,
				accountId,
				createdAt: "2026-01-01T10:00:00Z",
			}) satisfies BudgetResponse;
		mockApi([perso, livret], undefined, [
			savingsBudget("b1", "Épargne mensuelle", "livret"),
			savingsBudget("b2", "Coup de pouce", "livret"),
			savingsBudget("b3", "Tirelire", null),
		]);
		renderSection();

		expect(
			await screen.findByText("Alimenté par Épargne mensuelle, Coup de pouce"),
		).toBeInTheDocument();
		expect(
			screen.getByText("estimé depuis le relevé du 21/10/2026"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/Les intérêts et les variations boursières n'y sont pas/,
			),
		).toBeInTheDocument();
		expect(screen.getByText(/≈/)).toBeInTheDocument();
	});

	it("says nothing of an estimate without a savings budget", async () => {
		mockApi([livret]);
		renderSection();

		expect(await screen.findByText("relevé au 21/10/2026")).toBeInTheDocument();
		expect(
			screen.queryByText(/Les intérêts et les variations boursières/),
		).not.toBeInTheDocument();
	});

	it("opens an account's page from its name", async () => {
		mockApi([livret]);
		const router = renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("link", { name: "Voir le compte Livret A" }),
		);

		expect(await screen.findByText("account page")).toBeInTheDocument();
		expect(router.state.location.pathname).toBe("/accounts/livret");
	});

	it("explains why a savings account paid into must stay one", async () => {
		mockApi([livret], () => Promise.reject(new ApiError(409, "Conflict")));
		renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Livret A" }),
		);
		await user.click(screen.getByText("Courant"));
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText(
				"Des budgets d'épargne versent sur ce compte : il doit rester un compte épargne.",
			),
		).toBeInTheDocument();
	});

	it("creates an imported checking account with its starting point", async () => {
		mockApi([]);
		renderSection();
		const user = userEvent.setup();

		expect(
			await screen.findByText(/Aucun compte pour l'instant/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Ajouter un compte" }));
		await user.type(screen.getByLabelText(/Nom/), "  Compte joint ");
		await user.type(screen.getByLabelText("Point de départ"), "800");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(writes()).toEqual([
				{
					path: "/accounts",
					method: "POST",
					body: { name: "Compte joint", kind: "checking", imported: true },
				},
				{
					path: "/accounts/new/balances",
					method: "POST",
					body: { amount: "800.00", date: expect.any(String) },
				},
			]);
		});
	});

	it("never marks a savings account as imported", async () => {
		mockApi([]);
		renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Ajouter un compte" }),
		);
		await user.type(screen.getByLabelText(/Nom/), "Livret A");
		await user.click(screen.getByText("Épargne"));
		expect(
			screen.queryByLabelText("J'importe les relevés de ce compte"),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(writes()).toEqual([
				{
					path: "/accounts",
					method: "POST",
					body: { name: "Livret A", kind: "savings", imported: false },
				},
			]);
		});
	});

	it("edits an account without touching its balances", async () => {
		mockApi([perso]);
		renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Compte perso" }),
		);
		expect(screen.queryByLabelText("Point de départ")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(writes()).toEqual([
				{
					path: "/accounts/perso",
					method: "PUT",
					body: { name: "Compte perso", kind: "checking", imported: true },
				},
			]);
		});
	});

	it("rejects an invalid amount without writing anything", async () => {
		mockApi([]);
		renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Ajouter un compte" }),
		);
		await user.type(screen.getByLabelText(/Nom/), "Compte joint");
		await user.type(screen.getByLabelText("Point de départ"), "douze");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(await screen.findByText("Montant invalide")).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("explains why an account holding operations cannot be deleted", async () => {
		mockApi([perso], () => Promise.reject(new ApiError(409, "Conflict")));
		renderSection();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Supprimer Compte perso" }),
		);
		await user.click(screen.getByRole("button", { name: "Supprimer" }));

		expect(
			await screen.findByText(/Ce compte contient des opérations/),
		).toBeInTheDocument();
	});
});
