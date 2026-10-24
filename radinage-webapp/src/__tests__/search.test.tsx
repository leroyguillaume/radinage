import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type {
	AccountResponse,
	BudgetResponse,
	CategoryResponse,
	IgnoreRuleResponse,
	OperationResponse,
	OperationSearchResponse,
} from "@/lib/types";
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

const categories: CategoryResponse[] = [
	{
		id: "c-food",
		name: "Courses",
		color: "#fd7e14",
		icon: null,
		rules: [],
		createdAt: "",
	},
	{
		id: "c-home",
		name: "Logement",
		color: "#228be6",
		icon: "home",
		rules: [],
		createdAt: "",
	},
];

const budgets: BudgetResponse[] = [
	{
		id: "b-rent",
		label: "Loyer",
		budgetType: "expense",
		kind: { type: "occasional", month: 1, year: 2026, amount: "-800" },
		rules: [],
		categoryId: "c-home",
		createdAt: "",
	},
];

function operation(overrides: Partial<OperationResponse>): OperationResponse {
	return {
		id: "op",
		accountId: "account-1",
		amount: "-10.00",
		date: "2026-01-15",
		effectiveDate: null,
		label: "Operation",
		budgetLink: { type: "unlinked" },
		ignored: false,
		ignoreRuleId: null,
		categoryId: null,
		effectiveCategoryId: null,
		splits: [],
		...overrides,
	};
}

const rent = operation({
	id: "op-rent",
	accountId: "account-1",
	amount: "-800.00",
	date: "2026-02-01",
	label: "LOYER FEVRIER",
	budgetLink: { type: "manual", budgetId: "b-rent" },
	effectiveCategoryId: "c-home",
});

const groceries = operation({
	id: "op-groceries",
	accountId: "account-1",
	amount: "-54.20",
	date: "2025-12-30",
	effectiveDate: "2025-11-30",
	label: "SUPERMARCHE",
	categoryId: "c-food",
	effectiveCategoryId: "c-food",
});

const salary = operation({
	id: "op-salary",
	accountId: "account-1",
	amount: "2500.00",
	date: "2025-11-28",
	label: "SALAIRE",
});

function page(
	data: OperationResponse[],
	overrides: Partial<OperationSearchResponse> = {},
): OperationSearchResponse {
	return {
		data,
		total: data.length,
		page: 1,
		pageSize: 50,
		maxPage: 1,
		totals: {
			income: "2500.00",
			expense: "-854.20",
			firstDate: "2025-11-28",
			lastDate: "2026-02-01",
		},
		...overrides,
	};
}

function account(
	id: string,
	name: string,
	receivesOperations: boolean,
): AccountResponse {
	return {
		id,
		name,
		kind: receivesOperations ? "checking" : "savings",
		imported: receivesOperations,
		receivesOperations,
		balance: null,
		currentBalance: null,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

const accounts = [
	account("account-1", "Compte perso", true),
	account("account-2", "Compte joint", true),
	account("account-3", "Livret A", false),
];

const refundRule: IgnoreRuleResponse = {
	id: "r1",
	labelPattern: { type: "contains", value: "REMB" },
	amount: null,
	createdAt: "2026-01-01T00:00:00Z",
};

function setupMocks(
	search: (params: URLSearchParams) => OperationSearchResponse = () =>
		page([rent, groceries, salary]),
) {
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
		if (path === "/categories") return Promise.resolve(categories);
		if (path === "/accounts") return Promise.resolve(accounts);
		if (path === "/ignore-rules") return Promise.resolve([refundRule]);
		if (path.startsWith("/budgets")) return Promise.resolve(budgets);
		if (/^\/operations\/[^/?]+\/(category|account)$/.test(path)) {
			return Promise.resolve(salary);
		}
		if (path.startsWith("/operations?")) {
			return Promise.resolve(
				search(new URLSearchParams(path.slice("/operations?".length))),
			);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

function searchCalls(): URLSearchParams[] {
	return apiFetchMock.mock.calls
		.map(([path]) => path)
		.filter((path) => path.startsWith("/operations?"))
		.map((path) => new URLSearchParams(path.slice("/operations?".length)));
}

function lastSearch(): URLSearchParams {
	const last = searchCalls().at(-1);
	if (!last) throw new Error("no search was sent");
	return last;
}

async function renderSearchPage(url = "/search") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { Route } = await import("@/routes/search");

	const rootRoute = createRootRoute({ component: Outlet });
	rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/search",
			component: Route.options.component,
			validateSearch: Route.options.validateSearch,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/operations",
			component: () => <p>operations page</p>,
		}),
	]);
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [url] }),
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
	return { router };
}

async function pickOption(inputName: string, optionName: string) {
	const input = screen.getByRole("combobox", { name: inputName });
	fireEvent.focus(input);
	fireEvent.click(input);
	fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	setupMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SearchPage", () => {
	it("lists every operation when nothing is typed", async () => {
		await renderSearchPage();

		expect(await screen.findByText("LOYER FEVRIER")).toBeInTheDocument();
		const params = lastSearch();
		expect(params.has("label")).toBe(false);
		expect(params.get("page")).toBe("1");
	});

	it("searches the label once typing pauses", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		fireEvent.change(screen.getByRole("textbox", { name: "Libellé" }), {
			target: { value: "  loyer " },
		});

		await waitFor(() => expect(lastSearch().get("label")).toBe("loyer"));
	});

	it("sends each picked category, without a label", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		await pickOption("Catégories", "Courses");
		await pickOption("Catégories", "Logement");

		await waitFor(() =>
			expect(lastSearch().getAll("categoryId")).toEqual(["c-food", "c-home"]),
		);
		expect(lastSearch().has("label")).toBe(false);
		expect(lastSearch().has("uncategorized")).toBe(false);
	});

	it("moves an operation to another account from its sheet", async () => {
		await renderSearchPage();
		fireEvent.click(await screen.findByRole("button", { name: /SALAIRE/ }));
		const sheet = within(await screen.findByRole("dialog"));
		expect(sheet.getByRole("combobox", { name: "Compte" })).toHaveValue(
			"Compte perso",
		);

		await pickOption("Compte", "Compte joint");

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/operations/op-salary/account",
				{ method: "PUT", body: JSON.stringify({ accountId: "account-2" }) },
			);
		});
	});

	it("maps the no-category option to uncategorized", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		await pickOption("Catégories", "Sans catégorie");

		await waitFor(() => expect(lastSearch().get("uncategorized")).toBe("true"));
		expect(lastSearch().has("categoryId")).toBe(false);
	});

	it("sends the amount bounds and the direction", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		fireEvent.change(screen.getByRole("textbox", { name: "Montant min" }), {
			target: { value: "10,5" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Montant max" }), {
			target: { value: "900" },
		});
		await waitFor(() => {
			expect(lastSearch().get("amountMin")).toBe("10.50");
			expect(lastSearch().get("amountMax")).toBe("900.00");
		});

		fireEvent.click(screen.getByRole("radio", { name: "Dépenses" }));
		await waitFor(() => expect(lastSearch().get("direction")).toBe("expense"));
	});

	it("searches the non-ignored, ignored or all operations", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");
		expect(lastSearch().has("ignored")).toBe(false);

		fireEvent.click(screen.getByRole("radio", { name: "Ignorées" }));
		await waitFor(() => expect(lastSearch().get("ignored")).toBe("only"));

		fireEvent.click(screen.getByRole("radio", { name: "Toutes" }));
		await waitFor(() => expect(lastSearch().get("ignored")).toBe("included"));

		fireEvent.click(screen.getByRole("radio", { name: "Non ignorées" }));
		await waitFor(() => expect(lastSearch().has("ignored")).toBe(false));
	});

	it("does not send an invalid amount", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		fireEvent.change(screen.getByRole("textbox", { name: "Montant min" }), {
			target: { value: "abc" },
		});

		expect(await screen.findByText("Montant invalide")).toBeInTheDocument();
		expect(searchCalls().some((p) => p.has("amountMin"))).toBe(false);
	});

	it("restores the filters of a shared link", async () => {
		await renderSearchPage(
			'/search?budgetIds=["b-rent"]&ignored=included&sort=amount&order=asc',
		);
		await screen.findByText("LOYER FEVRIER");

		const params = lastSearch();
		expect(params.getAll("budgetId")).toEqual(["b-rent"]);
		expect(params.get("ignored")).toBe("included");
		expect(params.get("sort")).toBe("amount");
		expect(params.get("order")).toBe("asc");
	});

	it("shows the totals of every match", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		const text = (document.body.textContent ?? "").replace(/\s/g, " ");
		expect(screen.getByText("Total des dépenses")).toBeInTheDocument();
		expect(screen.getByText("Total des revenus")).toBeInTheDocument();
		expect(text).toContain("-854,20 €");
		expect(text).toContain("2 500,00 €");
		expect(
			screen.getAllByText("28/11/2025 – 01/02/2026").length,
		).toBeGreaterThan(0);
	});

	it("groups the results by year of their accounting date", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		const year2026 = screen.getByRole("region", { name: "2026" });
		const year2025 = screen.getByRole("region", { name: "2025" });
		expect(within(year2026).getByText("LOYER FEVRIER")).toBeInTheDocument();
		expect(within(year2025).getByText("SUPERMARCHE")).toBeInTheDocument();
		expect(within(year2025).getByText("30/11/2025")).toBeInTheDocument();
		expect(within(year2026).getByText("Loyer")).toBeInTheDocument();
		expect(within(year2025).getByText("Courses")).toBeInTheDocument();
	});

	it("opens an operation's sheet, linking to its accounting month", async () => {
		const { router } = await renderSearchPage();

		fireEvent.click(await screen.findByRole("button", { name: /SUPERMARCHE/ }));

		const sheet = within(await screen.findByRole("dialog"));
		expect(sheet.getByText("SUPERMARCHE")).toBeInTheDocument();
		fireEvent.click(
			sheet.getByRole("link", {
				name: "Voir novembre 2025 dans les opérations",
			}),
		);
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/operations");
		});
		expect(router.state.location.search).toEqual({ year: 2025, month: 11 });
	});

	it("refreshes the results once an operation changes in its sheet", async () => {
		await renderSearchPage();
		fireEvent.click(await screen.findByRole("button", { name: /SALAIRE/ }));
		await screen.findByRole("dialog");
		const searchesBefore = searchCalls().length;

		await pickOption("Catégorie", "Courses");

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/operations/op-salary/category",
				{ method: "PUT", body: JSON.stringify({ categoryId: "c-food" }) },
			);
		});
		await waitFor(() => {
			expect(searchCalls().length).toBeGreaterThan(searchesBefore);
		});
	});

	it("loads the next page on demand", async () => {
		setupMocks((params) =>
			params.get("page") === "2"
				? page([salary], { page: 2, maxPage: 2, total: 3 })
				: page([rent, groceries], { maxPage: 2, total: 3 }),
		);
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");
		expect(screen.queryByText("SALAIRE")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Afficher plus" }));

		expect(await screen.findByText("SALAIRE")).toBeInTheDocument();
		expect(lastSearch().get("page")).toBe("2");
		expect(screen.queryByRole("button", { name: "Afficher plus" })).toBeNull();
	});

	it("dims ignored operations", async () => {
		setupMocks(() =>
			page([operation({ label: "REMBOURSEMENT", ignored: true })]),
		);
		await renderSearchPage("/search?ignored=only");

		expect(await screen.findByText("REMBOURSEMENT")).toHaveStyle({
			textDecoration: "line-through",
		});
		expect(screen.getByText("Ignorée")).toBeInTheDocument();
	});

	it("names the rule that ignored an operation in its sheet", async () => {
		setupMocks(() =>
			page([
				operation({
					label: "REMBOURSEMENT",
					ignored: true,
					ignoreRuleId: "r1",
				}),
			]),
		);
		await renderSearchPage("/search?ignored=only");

		fireEvent.click(
			await screen.findByRole("button", { name: /REMBOURSEMENT/ }),
		);

		const sheet = within(await screen.findByRole("dialog"));
		expect(
			await sheet.findByText(
				/Ignorée automatiquement par la règle Contient « REMB »/,
			),
		).toBeInTheDocument();
		expect(sheet.getByRole("link", { name: "Voir la règle" })).toHaveAttribute(
			"href",
			"/settings",
		);
		expect(
			sheet.queryByRole("button", { name: "Toujours ignorer…" }),
		).not.toBeInTheDocument();
	});

	it("says so when nothing matches", async () => {
		setupMocks(() =>
			page([], {
				totals: { income: "0", expense: "0", firstDate: null, lastDate: null },
			}),
		);
		await renderSearchPage("/search?label=introuvable");

		expect(
			await screen.findByText("Aucune opération ne correspond"),
		).toBeInTheDocument();
		const empty = screen.getByRole("region", {
			name: "Aucune opération ne correspond",
		});
		fireEvent.click(
			within(empty).getByRole("button", { name: "Réinitialiser" }),
		);
		await waitFor(() => expect(lastSearch().has("label")).toBe(false));
	});

	it("shows an error when the search fails", async () => {
		apiFetchMock.mockImplementation((path: string) =>
			path.startsWith("/operations?")
				? Promise.reject(new Error("boom"))
				: Promise.resolve([]),
		);
		await renderSearchPage();

		expect(
			await screen.findByText("Impossible de rechercher les opérations"),
		).toBeInTheDocument();
	});

	it("counts the active filters and lets each be removed", async () => {
		await renderSearchPage('/search?categoryIds=["c-food"]&direction=income');
		await screen.findByText("LOYER FEVRIER");

		expect(
			screen.getByRole("button", { name: /^Filtres\s*2$/ }),
		).toBeInTheDocument();
		const chips = screen.getByRole("list", { name: "Filtres actifs" });
		fireEvent.click(
			within(chips).getByRole("button", {
				name: "Retirer le filtre Revenus",
			}),
		);

		await waitFor(() => expect(lastSearch().has("direction")).toBe(false));
		expect(lastSearch().getAll("categoryId")).toEqual(["c-food"]);
	});

	it("opens the filters in a drawer showing the result count", async () => {
		await renderSearchPage();
		await screen.findByText("LOYER FEVRIER");

		fireEvent.click(screen.getByRole("button", { name: "Filtres" }));

		const drawer = await screen.findByRole("dialog");
		fireEvent.click(
			within(drawer).getByRole("button", { name: "Voir 3 résultat(s)" }),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});
