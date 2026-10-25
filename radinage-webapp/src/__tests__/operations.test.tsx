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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type {
	AccountResponse,
	CategoryResponse,
	CategorySummaryResponse,
	ForecastResponse,
	IgnoreRuleResponse,
	ImportProfileResponse,
	MonthlyOperationsResponse,
	OperationResponse,
} from "@/lib/types";
import { useLastSearchStore } from "@/stores/last-search";
import { theme } from "@/theme";
import { selectMantineOption } from "./mantine";
import { resetViewport, setViewportWidth } from "./viewport";

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

const mockMonthlyResponse: MonthlyOperationsResponse = {
	operations: [
		{
			id: "op1",
			accountId: "account-1",
			amount: "-50.00",
			date: "2026-04-05",
			effectiveDate: null,
			label: "Groceries",
			budgetLink: { type: "manual", budgetId: "b1" },
			ignored: false,
			ignoreRuleId: null,
			transfer: null,
			categoryId: null,
			effectiveCategoryId: null,
			splits: [],
		},
		{
			id: "op2",
			accountId: "account-1",
			amount: "-30.00",
			date: "2026-04-10",
			effectiveDate: null,
			label: "Restaurant",
			budgetLink: { type: "manual", budgetId: "b1" },
			ignored: false,
			ignoreRuleId: null,
			transfer: null,
			categoryId: null,
			effectiveCategoryId: null,
			splits: [],
		},
		{
			id: "op3",
			accountId: "account-1",
			amount: "-100.00",
			date: "2026-04-15",
			effectiveDate: null,
			label: "Electricity",
			budgetLink: { type: "unlinked" },
			ignored: false,
			ignoreRuleId: null,
			transfer: null,
			categoryId: null,
			effectiveCategoryId: null,
			splits: [],
		},
		{
			id: "op4",
			accountId: "account-1",
			amount: "2000.00",
			date: "2026-04-01",
			effectiveDate: null,
			label: "Salary",
			budgetLink: { type: "auto", budgetId: "b2" },
			ignored: false,
			ignoreRuleId: null,
			transfer: null,
			categoryId: null,
			effectiveCategoryId: null,
			splits: [],
		},
	],
};

const mockBudgetsResponse = [
	{
		id: "b1",
		label: "Food",
		budgetType: "expense",
		kind: {
			type: "recurring",
			recurrence: "monthly",
			closedPeriods: [],
			currentPeriod: {
				start: { year: 2026, month: 1 },
				end: null,
				amount: "-200.00",
			},
		},
		rules: [],
		categoryId: null,
		createdAt: "2026-01-01T00:00:00Z",
	},
	{
		id: "b2",
		label: "Income",
		budgetType: "income",
		kind: {
			type: "recurring",
			recurrence: "monthly",
			closedPeriods: [],
			currentPeriod: {
				start: { year: 2026, month: 1 },
				end: null,
				amount: "2500.00",
			},
		},
		rules: [],
		categoryId: null,
		createdAt: "2026-01-01T00:00:00Z",
	},
];

// −10/day: April's 30 days make a −300 forecast for the daily operations.
const forecastResponse: ForecastResponse = {
	months: [
		{
			year: 2026,
			month: 4,
			status: "current",
			income: "2000.00",
			expenses: "-480.00",
			savings: "0",
			withdrawals: "0",
			transfers: "0",
			balance: "1520.00",
			committed: "0",
			unbudgetedForecast: "-100.00",
			cumulative: "1520.00",
		},
	],
	totals: {
		income: "2000.00",
		expenses: "-480.00",
		savings: "0",
		withdrawals: "0",
		transfers: "0",
		balance: "1520.00",
	},
	startingBalance: null,
	endBalance: "1520.00",
	unbudgetedRate: "-10.0000",
	daysLeft: 11,
	dailyBudget: "147.27",
	firstNegativeMonth: null,
};

function account(id: string, name: string): AccountResponse {
	return {
		id,
		name,
		kind: "checking",
		imported: true,
		receivesOperations: true,
		balance: null,
		currentBalance: null,
		transferredInto: false,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

const accounts = [
	account("account-1", "Compte perso"),
	account("account-2", "Compte joint"),
	{
		...account("account-3", "Livret A"),
		kind: "savings" as const,
		imported: false,
		receivesOperations: false,
	},
];

const importProfile: ImportProfileResponse = {
	id: "p1",
	name: "Banque en ligne",
	accountId: "account-1",
	labelCol: 1,
	labelFallbackCol: 2,
	amountCol: 3,
	dateCol: 0,
	dateFormat: "%d/%m/%Y",
	skipLines: 1,
	csvDelimiter: "semicolon",
	lastUsedAt: null,
	createdAt: "2026-01-01T00:00:00Z",
};

let apiCalls: Array<{
	path: string;
	options?: { method?: string; body?: string };
}> = [];

function setupMocks(
	overrides?: Partial<{
		budgets: typeof mockBudgetsResponse;
		operations: typeof mockMonthlyResponse;
		categories: CategoryResponse[];
		categorySummary: CategorySummaryResponse;
		ignoreRules: IgnoreRuleResponse[];
	}>,
) {
	const budgets = overrides?.budgets ?? mockBudgetsResponse;
	const operations = overrides?.operations ?? mockMonthlyResponse;
	const categories = overrides?.categories ?? [];
	const categorySummary = overrides?.categorySummary ?? { categories: [] };
	const ignoreRules = overrides?.ignoreRules ?? [];

	apiCalls = [];
	apiFetchMock.mockImplementation((path: string, options?: unknown) => {
		const opts = options as { method?: string; body?: string } | undefined;
		apiCalls.push({ path, options: opts });

		if (path.startsWith("/operations/monthly/")) {
			return Promise.resolve(
				path.includes("includeIgnored=true")
					? operations
					: {
							operations: operations.operations.filter((op) => !op.ignored),
						},
			);
		}
		if (path.startsWith("/forecast")) {
			return Promise.resolve(forecastResponse);
		}
		// Ignore operation
		const ignoreMatch = path.match(/^\/operations\/([^/]+)\/ignore$/);
		if (ignoreMatch) {
			return Promise.resolve({
				id: ignoreMatch[1],
				accountId: "account-1",
				amount: "-50.00",
				date: "2026-04-05",
				effectiveDate: null,
				label: "Op",
				budgetLink: { type: "unlinked" },
				ignored: false,
				ignoreRuleId: null,
				transfer: null,
				categoryId: null,
				effectiveCategoryId: null,
				splits: [],
			});
		}
		// Link/unlink operations
		const budgetLinkMatch = path.match(/^\/operations\/([^/]+)\/budget$/);
		if (budgetLinkMatch) {
			const opId = budgetLinkMatch[1];
			return Promise.resolve({
				id: opId,
				accountId: "account-1",
				amount: "-50.00",
				date: "2026-04-05",
				effectiveDate: null,
				label: "Op",
				budgetLink:
					opts?.method === "DELETE"
						? { type: "unlinked" }
						: { type: "manual", budgetId: "b1" },
			});
		}
		if (path.startsWith("/budgets")) {
			return Promise.resolve(budgets);
		}
		if (path === "/categories") {
			return Promise.resolve(categories);
		}
		if (path.startsWith("/summary/categories")) {
			return Promise.resolve(categorySummary);
		}
		if (path === "/ignore-rules") {
			return Promise.resolve(ignoreRules);
		}
		if (path === "/transfer-rules") {
			return Promise.resolve([]);
		}
		const transferMatch = path.match(/^\/operations\/([^/]+)\/transfer$/);
		if (transferMatch) {
			const op = operations.operations.find((o) => o.id === transferMatch[1]);
			return Promise.resolve(op);
		}
		if (path === "/accounts") {
			return Promise.resolve(accounts);
		}
		if (path === "/import-profiles") {
			return Promise.resolve([importProfile]);
		}
		if (path === "/operations/import") {
			return Promise.resolve({
				imported: 1,
				skipped: 3,
				duplicateRows: [2, 3, 4],
				relabeled: 2,
				relabeledRows: [5, 6],
				errors: [],
			});
		}
		if (path === "/operations/account" || path === "/operations/category") {
			return Promise.resolve({ updated: 2 });
		}
		if (/^\/operations\/[^/]+(\/category)?$/.test(path)) {
			return Promise.resolve(operations.operations[0]);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

async function renderOperationsPage(year = "2026", month = "4") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const { Route } = await import("@/routes/operations");

	const rootRoute = createRootRoute({ component: Outlet });
	const operationsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/operations",
		component: Route.options.component,
		validateSearch: Route.options.validateSearch,
	});
	rootRoute.addChildren([operationsRoute]);

	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/operations?year=${year}&month=${month}`],
		}),
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

	return { queryClient };
}

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	setViewportWidth(DESKTOP_WIDTH);
	setupMocks();
});

afterEach(() => {
	resetViewport();
	vi.restoreAllMocks();
});

describe("MonthlyOperationsPage", () => {
	it("remembers the month shown for the menu", async () => {
		await renderOperationsPage("2026", "4");
		await screen.findByText("Opérations quotidiennes");

		expect(useLastSearchStore.getState().searches["/operations"]).toEqual({
			year: 2026,
			month: 4,
		});
	});

	it("renders operations grouped by budget", async () => {
		await renderOperationsPage();

		expect(await screen.findByText("Food")).toBeInTheDocument();
		expect(screen.getByText("Income")).toBeInTheDocument();
	});

	it("shows unlinked operations under monthly budget group", async () => {
		await renderOperationsPage();

		expect(
			await screen.findByText("Opérations quotidiennes"),
		).toBeInTheDocument();
	});

	it("forecasts daily operations from the server's unbudgeted rate", async () => {
		await renderOperationsPage();

		const section = await screen.findByRole("region", {
			name: "Opérations quotidiennes",
		});
		await waitFor(() => {
			expect((section.textContent ?? "").replace(/\s/g, "")).toMatch(
				/sur300,00€prévus/,
			);
		});
		const forecastCalls = apiCalls.filter((c) =>
			c.path.startsWith("/forecast"),
		);
		expect(forecastCalls.map((c) => c.path)).toEqual([
			"/forecast?fromYear=2026&fromMonth=4&months=1",
		]);
		expect(apiCalls.some((c) => c.path.startsWith("/summary?"))).toBe(false);
	});

	it("scales the forecast to the number of days of the month shown", async () => {
		setupMocks({
			operations: {
				operations: mockMonthlyResponse.operations.map((op) => ({
					...op,
					date: op.date.replace("2026-04", "2026-02"),
				})),
			},
		});
		await renderOperationsPage("2026", "2");

		const section = await screen.findByRole("region", {
			name: "Opérations quotidiennes",
		});
		await waitFor(() => {
			expect((section.textContent ?? "").replace(/\s/g, "")).toMatch(
				/sur280,00€prévus/,
			);
		});
	});

	it("shows no daily forecast when the forecast cannot be loaded", async () => {
		const fallback = apiFetchMock.getMockImplementation();
		apiFetchMock.mockImplementation((path: string, options?: RequestInit) =>
			path.startsWith("/forecast")
				? Promise.reject(new Error("boom"))
				: (fallback?.(path, options) ?? Promise.reject(new Error(path))),
		);
		const { queryClient } = await renderOperationsPage();

		const section = await screen.findByRole("region", {
			name: "Opérations quotidiennes",
		});
		await waitFor(() => {
			expect(queryClient.getQueryState(["forecast", 2026, 4, 1])?.status).toBe(
				"error",
			);
		});
		expect(section.textContent ?? "").not.toMatch(/prévus/);
	});

	it("expands a group to show individual operations", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("button", { name: /Food/ }));

		await waitFor(() => {
			expect(screen.getByText("Groceries")).toBeInTheDocument();
			expect(screen.getByText("Restaurant")).toBeInTheDocument();
		});
	});

	it("displays section headers for budget types", async () => {
		await renderOperationsPage();

		await screen.findByText("Food");

		// Section order: income, expense, savings, monthly
		const headings = screen
			.getAllByRole("heading", { level: 2 })
			.map((h) => h.textContent);
		expect(headings).toEqual([
			"Revenus",
			"Dépenses",
			"Opérations quotidiennes",
		]);
	});

	it("renders month navigation arrows", async () => {
		await renderOperationsPage();

		expect(await screen.findByLabelText("Mois précédent")).toBeInTheDocument();
		expect(screen.getByLabelText("Mois suivant")).toBeInTheDocument();
	});

	it("renders import button", async () => {
		await renderOperationsPage();

		expect(
			await screen.findByText("Importer des opérations"),
		).toBeInTheDocument();
	});

	it("reports the blank labels an import filled in", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		await user.click(await screen.findByText("Importer des opérations"));
		await screen.findByRole("combobox", { name: "Profil" });
		const input = document.querySelector("input[type='file']");
		if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
		await user.upload(input, new File(["a;b"], "releve.csv"));
		await user.click(screen.getByRole("button", { name: "Importer" }));

		expect(
			await screen.findByText("2 libellé(s) vide(s) complété(s)"),
		).toBeInTheDocument();
		expect(screen.getByText("3 doublon(s) ignoré(s)")).toBeInTheDocument();
	});

	it("opens the operation sheet from a row, with no inline action", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		const row = await screen.findByRole("button", { name: /Electricity/ });
		expect(screen.queryByLabelText("Ignorer")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Lier à un budget")).not.toBeInTheDocument();

		await user.click(row);
		const sheet = within(await screen.findByRole("dialog"));
		expect(sheet.getByText("Electricity")).toBeInTheDocument();
		expect(sheet.getByRole("combobox", { name: "Budget" })).toBeInTheDocument();
	});

	it("computes difference as realAmount minus budgetedAmount", async () => {
		await renderOperationsPage();

		await waitFor(() => {
			expect(screen.getByText("Food")).toBeInTheDocument();
		});

		// Food: real = -80, budgeted = -200 → 120 left
		const foodRow = screen.getByRole("button", { name: /Food/ });
		expect(within(foodRow).getByText(/^Reste 120,00/)).toBeInTheDocument();

		// Income: real = 2000, budgeted = 2500 → 500 short
		const incomeRow = screen.getByRole("button", { name: /Income/ });
		expect(within(incomeRow).getByText(/^Manque 500,00/)).toBeInTheDocument();
	});

	it("shows budgets with no linked operations", async () => {
		// Add a third budget "Rent" with no operations linked to it
		const budgetsWithExtra = [
			...mockBudgetsResponse,
			{
				id: "b3",
				label: "Rent",
				budgetType: "expense",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "-900.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
		];

		setupMocks({ budgets: budgetsWithExtra });
		await renderOperationsPage();

		// Rent should appear even without linked operations
		expect(await screen.findByText("Rent")).toBeInTheDocument();

		// Rent row shows 0 spent out of 900 budgeted
		const rentRow = screen.getByText("Rent").closest("li");
		const rentText = rentRow?.textContent?.replace(/\s/g, "") ?? "";
		expect(rentText).toContain("0,00€/900,00€");
		expect(rentText).toContain("Reste900,00€");
	});

	it("sorting one table does not affect another table", async () => {
		// We need multiple budgets in the same section to see sort effects,
		// plus at least one budget in another section.
		const budgetsForSort = [
			{
				id: "b1",
				label: "Alimentation",
				budgetType: "expense",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "-200.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
			{
				id: "b4",
				label: "Transport",
				budgetType: "expense",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "-100.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
			{
				id: "b2",
				label: "Salaire",
				budgetType: "income",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "2500.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
			{
				id: "b5",
				label: "Freelance",
				budgetType: "income",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "1000.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
		];

		const operationsForSort: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op5",
					accountId: "account-1",
					amount: "-20.00",
					date: "2026-04-06",
					effectiveDate: null,
					label: "Bus ticket",
					budgetLink: { type: "manual", budgetId: "b4" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op4",
					accountId: "account-1",
					amount: "2000.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "auto", budgetId: "b2" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op6",
					accountId: "account-1",
					amount: "500.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Freelance gig",
					budgetLink: { type: "auto", budgetId: "b5" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({
			budgets: budgetsForSort,
			operations: operationsForSort,
		});
		await renderOperationsPage();
		const user = userEvent.setup();

		await waitFor(() => {
			expect(screen.getByText("Alimentation")).toBeInTheDocument();
		});

		const incomeSection = screen.getByRole("region", { name: "Revenus" });
		const expenseSection = screen.getByRole("region", { name: "Dépenses" });

		function getBudgetLabels(section: HTMLElement): string[] {
			return within(section)
				.getAllByText(/^(Alimentation|Transport|Freelance|Salaire)$/)
				.map((el) => el.textContent ?? "");
		}

		// Default order is alphabetical (asc by budget label)
		expect(getBudgetLabels(incomeSection)).toEqual(["Freelance", "Salaire"]);
		expect(getBudgetLabels(expenseSection)).toEqual([
			"Alimentation",
			"Transport",
		]);

		// Toggle the expense section's direction: budget/asc → budget/desc
		await user.click(
			within(expenseSection).getByRole("button", { name: "Ordre croissant" }),
		);

		await waitFor(() => {
			expect(getBudgetLabels(expenseSection)).toEqual([
				"Transport",
				"Alimentation",
			]);
		});

		// Income section should NOT have changed
		expect(getBudgetLabels(incomeSection)).toEqual(["Freelance", "Salaire"]);
	});

	it("sorts a section by the column picked in the sort control", async () => {
		const sortBudgets = [
			{ id: "b1", label: "Alimentation", amount: "-200.00" },
			{ id: "b4", label: "Transport", amount: "-100.00" },
		].map(({ id, label, amount }) => ({
			id,
			label,
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [],
				currentPeriod: { start: { year: 2026, month: 1 }, end: null, amount },
			},
			rules: [],
			categoryId: null,
			createdAt: "2026-01-01T00:00:00Z",
		}));
		const sortOperations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op5",
					accountId: "account-1",
					amount: "-20.00",
					date: "2026-04-06",
					effectiveDate: null,
					label: "Bus ticket",
					budgetLink: { type: "manual", budgetId: "b4" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({ budgets: sortBudgets, operations: sortOperations });
		await renderOperationsPage();
		const user = userEvent.setup();

		const expenseSection = await screen.findByRole("region", {
			name: "Dépenses",
		});

		// Difference = real - budgeted: Alimentation 150, Transport 80
		await user.click(
			within(expenseSection).getByRole("combobox", { name: "Trier par" }),
		);
		await user.click(await screen.findByRole("option", { name: "Différence" }));

		await waitFor(() => {
			expect(
				within(expenseSection)
					.getAllByText(/^(Alimentation|Transport)$/)
					.map((el) => el.textContent),
			).toEqual(["Transport", "Alimentation"]);
		});
	});

	it("displays effective date instead of date when present", async () => {
		const operations = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: "2026-04-20",
					label: "Groceries",
					budgetLink: { type: "manual" as const, budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op2",
					accountId: "account-1",
					amount: "-30.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Restaurant",
					budgetLink: { type: "manual" as const, budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({ operations });
		await renderOperationsPage();
		const user = userEvent.setup();

		// Expand the Food budget row to see operations
		const foodRow = await screen.findByText("Food");
		await user.click(foodRow);

		await waitFor(() => {
			expect(screen.getByText("20/04/2026")).toBeInTheDocument();
		});
		expect(screen.queryByText("05/04/2026")).not.toBeInTheDocument();
		expect(screen.getByText("10/04/2026")).toBeInTheDocument();
	});

	it("counts unlinked operations in income and expense stats when no budgets exist", async () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "1500.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "unlinked" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op2",
					accountId: "account-1",
					amount: "-200.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "unlinked" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op3",
					accountId: "account-1",
					amount: "-50.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Taxi",
					budgetLink: { type: "unlinked" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({ budgets: [], operations });
		await renderOperationsPage();

		// Sum of unlinked ops must show up under Dépenses/Revenus, not 0.
		const expensesLabel = await screen.findByText("Dépenses");
		const expensesText =
			expensesLabel
				.closest(".mantine-Paper-root")
				?.textContent?.replace(/\s/g, "") ?? "";
		expect(expensesText).toMatch(/-250,00/);
		expect(expensesText).not.toMatch(/Dépenses0,00/);

		const incomeLabel = screen.getByText("Revenus");
		const incomeText =
			incomeLabel
				.closest(".mantine-Paper-root")
				?.textContent?.replace(/\s/g, "") ?? "";
		expect(incomeText).toMatch(/1500,00/);
	});

	it("budget with no operations is not expandable", async () => {
		const budgetsWithExtra = [
			...mockBudgetsResponse,
			{
				id: "b3",
				label: "Rent",
				budgetType: "expense",
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2026, month: 1 },
						end: null,
						amount: "-900.00",
					},
				},
				rules: [],
				categoryId: null,
				createdAt: "2026-01-01T00:00:00Z",
			},
		];

		setupMocks({ budgets: budgetsWithExtra });
		await renderOperationsPage();

		const rentText = await screen.findByText("Rent");
		const rentRow = rentText.closest("li");
		if (!rentRow) throw new Error("Rent row not found");

		// No toggle button: the row cannot be expanded
		expect(within(rentRow).queryByRole("button")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Food/ })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("toggles a group open and closed with aria-expanded", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		const foodRow = await screen.findByRole("button", { name: /Food/ });
		expect(foodRow).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("Groceries")).not.toBeInTheDocument();

		await user.click(foodRow);
		expect(foodRow).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("Groceries")).toBeInTheDocument();

		await user.click(foodRow);
		expect(foodRow).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
	});

	it("flags an expense budget that is over budget", async () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "-260.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({ operations });
		await renderOperationsPage();

		const foodRow = await screen.findByRole("button", { name: /Food/ });
		expect(within(foodRow).getByText(/^Dépassé de 60,00/)).toBeInTheDocument();
		expect(within(foodRow).getByText("130 %")).toBeInTheDocument();
	});

	it("shows reached status when an income budget is met", async () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op4",
					accountId: "account-1",
					amount: "2500.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "auto", budgetId: "b2" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		setupMocks({ operations });
		await renderOperationsPage();

		const incomeRow = await screen.findByRole("button", { name: /Income/ });
		expect(within(incomeRow).getByText("Atteint")).toBeInTheDocument();
	});

	describe("with a split operation", () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					accountId: "account-1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
				{
					id: "op2",
					accountId: "account-1",
					amount: "-100.00",
					date: "2026-04-08",
					effectiveDate: null,
					label: "CASH WITHDRAWAL",
					budgetLink: { type: "unlinked" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [
						{
							id: "s1",
							amount: "-30.00",
							effectiveDate: null,
							budgetId: "b1",
							categoryId: null,
							effectiveCategoryId: null,
						},
						{
							id: "s2",
							amount: "-70.00",
							effectiveDate: null,
							budgetId: null,
							categoryId: null,
							effectiveCategoryId: null,
						},
					],
				},
				{
					id: "op3",
					accountId: "account-1",
					amount: "-20.00",
					date: "2026-04-12",
					effectiveDate: null,
					label: "Taxi",
					budgetLink: { type: "unlinked" },
					ignored: false,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		const rowOf = (text: string) => {
			const row = screen.getByText(text).closest("li");
			if (!(row instanceof HTMLElement)) throw new Error(`no row for ${text}`);
			return within(row);
		};

		it("counts each part in its own budget group", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			const user = userEvent.setup();

			// Food: -50 + the -30 part = -80 of -200
			const foodRow = await screen.findByRole("button", { name: /Food/ });
			expect(within(foodRow).getByText(/^Reste 120,00/)).toBeInTheDocument();
			expect(within(foodRow).getByText(/2 opération\(s\)/)).toBeInTheDocument();

			// The daily group starts open with the -70 part and the taxi ride.
			const dailyPart = rowOf("part 2/2");
			expect(dailyPart.getByText("CASH WITHDRAWAL")).toBeInTheDocument();
			expect(dailyPart.getByText(/-70,00/)).toBeInTheDocument();
			expect(screen.queryByText(/-100,00/)).not.toBeInTheDocument();

			await user.click(foodRow);
			const foodPart = rowOf("part 1/2");
			expect(foodPart.getByText("CASH WITHDRAWAL")).toBeInTheDocument();
			expect(foodPart.getByText(/-30,00/)).toBeInTheDocument();
		});

		it("shows each part on its own date, leaving out those of another month", async () => {
			const [groceries, withdrawal, taxi] = operations.operations;
			if (!groceries || !withdrawal || !taxi) throw new Error("fixture");
			setupMocks({
				operations: {
					operations: [
						groceries,
						{
							...withdrawal,
							amount: "-110.00",
							splits: [
								...withdrawal.splits.map((split) =>
									split.id === "s2"
										? { ...split, effectiveDate: "2026-04-20" }
										: split,
								),
								{
									id: "s3",
									amount: "-10.00",
									effectiveDate: "2026-05-02",
									budgetId: null,
									categoryId: null,
									effectiveCategoryId: null,
								},
							],
						},
						taxi,
					],
				},
			});
			await renderOperationsPage();

			const dailyPart = await screen.findByText("part 2/3");
			const row = dailyPart.closest("li");
			if (!(row instanceof HTMLElement)) throw new Error("no part row");
			expect(within(row).getByText("20/04/2026")).toBeInTheDocument();
			expect(screen.queryByText("part 3/3")).not.toBeInTheDocument();
		});

		it("uses part amounts in the stat tiles", async () => {
			setupMocks({ operations });
			await renderOperationsPage();

			// Food -80 (whole op + part) and daily -90 (part + taxi).
			const [expensesTile] = await screen.findAllByText("Dépenses");
			const expensesText =
				expensesTile
					.closest(".mantine-Paper-root")
					?.textContent?.replace(/\s/g, "") ?? "";
			expect(expensesText).toMatch(/-170,00/);
		});

		it("opens the split modal pre-filled with the parts from a part's sheet", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			const user = userEvent.setup();

			await user.click(
				await screen.findByRole("button", { name: /part 2\/2/ }),
			);
			const sheet = within(await screen.findByRole("dialog"));
			await user.click(
				sheet.getByRole("button", { name: "Modifier la division" }),
			);

			const dialog = within(await screen.findByRole("dialog"));
			expect(dialog.getByText("Diviser l'opération")).toBeInTheDocument();
			expect(
				dialog.getByRole("textbox", { name: "Montant (Part 1)" }),
			).toHaveValue("30,00");
			expect(
				dialog.getByRole("textbox", { name: "Montant (Part 2)" }),
			).toHaveValue("70,00");
		});
	});

	describe("ignored operations", () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				...mockMonthlyResponse.operations,
				{
					id: "op-ignored",
					accountId: "account-1",
					amount: "-999.00",
					date: "2026-04-20",
					effectiveDate: null,
					label: "Internal transfer",
					budgetLink: { type: "unlinked" },
					ignored: true,
					ignoreRuleId: null,
					transfer: null,
					categoryId: null,
					effectiveCategoryId: null,
					splits: [],
				},
			],
		};

		async function showIgnored() {
			const user = userEvent.setup();
			await user.click(
				await screen.findByRole("switch", { name: "Afficher les ignorées" }),
			);
			return user;
		}

		function expensesTileText(): string {
			const [tile] = screen.getAllByText("Dépenses");
			return (
				tile?.closest(".mantine-Paper-root")?.textContent?.replace(/\s/g, "") ??
				""
			);
		}

		it("hides ignored operations until the switch is on", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			await screen.findByText("Electricity");

			expect(screen.queryByText("Internal transfer")).not.toBeInTheDocument();
			expect(screen.queryByText("Opérations ignorées")).not.toBeInTheDocument();
		});

		it("lists ignored operations in their own section, out of the totals", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			await screen.findByText("Electricity");
			const expensesBefore = expensesTileText();

			await showIgnored();

			const section = within(
				await screen.findByRole("region", { name: "Opérations ignorées" }),
			);
			expect(await section.findByText("Internal transfer")).toBeInTheDocument();
			expect(
				apiCalls.some((c) =>
					c.path.startsWith("/operations/monthly/2026/4?includeIgnored=true"),
				),
			).toBe(true);
			expect(expensesTileText()).toBe(expensesBefore);
		});

		it("says so when the month has no ignored operation", async () => {
			await renderOperationsPage();
			await showIgnored();

			expect(
				await screen.findByText("Aucune opération ignorée ce mois-ci"),
			).toBeInTheDocument();
		});

		it("tells the operations a rule ignored from those ignored by hand", async () => {
			const rule: IgnoreRuleResponse = {
				id: "r1",
				labelPattern: { type: "startsWith", value: "VIR" },
				amount: null,
				createdAt: "2026-01-01T00:00:00Z",
			};
			const byRule = {
				...operations.operations[0],
				id: "op-by-rule",
				label: "VIR LIVRET A",
				ignored: true,
				ignoreRuleId: "r1",
				transfer: null,
			} satisfies OperationResponse;
			setupMocks({
				operations: { operations: [...operations.operations, byRule] },
				ignoreRules: [rule],
			});
			await renderOperationsPage();
			await showIgnored();

			const section = within(
				await screen.findByRole("region", { name: "Opérations ignorées" }),
			);
			expect(
				await section.findByText("Ignorée par une règle"),
			).toBeInTheDocument();
			expect(section.getByText("Ignorée")).toBeInTheDocument();
		});

		it("stops ignoring an operation", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			const user = await showIgnored();

			const section = within(
				await screen.findByRole("region", { name: "Opérations ignorées" }),
			);
			await user.click(
				await section.findByRole("button", { name: /Internal transfer/ }),
			);
			const sheet = within(await screen.findByRole("dialog"));
			await user.click(sheet.getByRole("button", { name: "Ne plus ignorer" }));

			await waitFor(() => {
				expect(
					apiCalls.find(
						(c) =>
							c.path === "/operations/op-ignored/ignore" &&
							c.options?.method === "DELETE",
					),
				).toBeDefined();
			});
		});
	});

	describe("categories", () => {
		const categories: CategoryResponse[] = [
			{
				id: "c1",
				name: "Courses",
				color: "#12b886",
				icon: null,
				netTotals: false,
				rules: [],
				createdAt: "2026-01-01T00:00:00Z",
			},
		];
		// op1 takes Courses from its budget; op3 is daily and uncategorized.
		const operations: MonthlyOperationsResponse = {
			operations: mockMonthlyResponse.operations.map((op) =>
				op.id === "op1" ? { ...op, effectiveCategoryId: "c1" } : op,
			),
		};

		it("shows only the operations of the category picked", async () => {
			setupMocks({ operations, categories });
			await renderOperationsPage();
			expect(await screen.findByText("Opérations quotidiennes")).toBeVisible();

			await selectMantineOption("Filtrer par catégorie", "Courses");
			expect(screen.getByText("Food")).toBeInTheDocument();
			expect(screen.queryByText("Income")).not.toBeInTheDocument();
			expect(
				screen.queryByText("Opérations quotidiennes"),
			).not.toBeInTheDocument();

			// Restaurant keeps Food on screen: only Groceries is in Courses.
			await selectMantineOption("Filtrer par catégorie", "Sans catégorie");
			expect(screen.getByText("Opérations quotidiennes")).toBeInTheDocument();
			expect(screen.getByText("Income")).toBeInTheDocument();
			expect(screen.getByText("Food")).toBeInTheDocument();
		});

		it("breaks the month's income and expenses down by category", async () => {
			setupMocks({
				operations,
				categories,
				categorySummary: {
					categories: [
						{ categoryId: "c1", income: "0", expense: "-120.00" },
						{ categoryId: null, income: "3000.00", expense: "-40.00" },
					],
				},
			});
			await renderOperationsPage();

			const expenses = await screen.findByRole("region", {
				name: "Dépenses par catégorie",
			});
			expect(
				within(expenses)
					.getAllByRole("progressbar")
					.map((row) => row.getAttribute("aria-label")),
			).toEqual([
				expect.stringMatching(/^Courses : 120,00/),
				expect.stringMatching(/^Sans catégorie : 40,00/),
			]);
			const income = screen.getByRole("region", {
				name: "Revenus par catégorie",
			});
			expect(within(income).getAllByRole("progressbar")).toHaveLength(1);
			expect(apiCalls.map((c) => c.path)).toContain(
				"/summary/categories?fromYear=2026&fromMonth=4&toYear=2026&toMonth=4",
			);
		});

		it("hides the filter and the breakdown while there are no categories", async () => {
			await renderOperationsPage();

			expect(await screen.findByText("Food")).toBeInTheDocument();
			expect(
				screen.queryByRole("combobox", { name: "Filtrer par catégorie" }),
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole("region", { name: "Dépenses par catégorie" }),
			).not.toBeInTheDocument();
		});
	});

	describe("selecting daily operations", () => {
		const categories: CategoryResponse[] = [
			{
				id: "c1",
				name: "Courses",
				color: "#12b886",
				icon: null,
				netTotals: false,
				rules: [],
				createdAt: "2026-01-01T00:00:00Z",
			},
		];
		const bakery: OperationResponse = {
			...mockMonthlyResponse.operations[2],
			id: "op5",
			label: "Bakery",
			amount: "-8.00",
			date: "2026-04-20",
		};
		const operations: MonthlyOperationsResponse = {
			operations: [...mockMonthlyResponse.operations, bakery],
		};

		it("moves the selected operations to another account at once", async () => {
			setupMocks({ operations, categories });
			await renderOperationsPage();
			const section = within(
				await screen.findByRole("region", { name: "Opérations quotidiennes" }),
			);

			fireEvent.click(section.getByRole("button", { name: "Sélectionner" }));
			fireEvent.click(section.getByRole("checkbox", { name: /Electricity/ }));
			fireEvent.click(section.getByRole("checkbox", { name: /Bakery/ }));
			const bar = within(
				screen.getByRole("region", { name: "Opérations sélectionnées" }),
			);
			expect(bar.getByText("2 sélectionnées")).toBeInTheDocument();
			expect(
				bar.getByRole("checkbox", { name: "Tout désélectionner" }),
			).toBeChecked();

			fireEvent.click(bar.getByRole("button", { name: "Compte" }));
			await screen.findByRole("dialog", {
				name: "Changer le compte de 2 opérations",
			});
			await selectMantineOption("Compte", "Compte joint");
			fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

			await waitFor(() =>
				expect(findApiCall("/operations/account", "PUT")?.options?.body).toBe(
					JSON.stringify({
						operationIds: ["op5", "op3"],
						accountId: "account-2",
					}),
				),
			);
			await waitFor(() =>
				expect(bar.getByText("0 sélectionnée")).toBeInTheDocument(),
			);
		});

		it("selects only the operations outside any budget", async () => {
			setupMocks({ operations, categories });
			await renderOperationsPage();
			await screen.findByText("Opérations quotidiennes");

			expect(
				screen.getAllByRole("button", { name: "Sélectionner" }),
			).toHaveLength(1);
			fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
			fireEvent.click(screen.getByRole("button", { name: /Food/ }));
			expect(
				screen.getByRole("button", { name: /Groceries/ }),
			).toBeInTheDocument();

			fireEvent.click(
				screen.getByRole("checkbox", { name: "Tout sélectionner" }),
			);
			fireEvent.click(screen.getByRole("button", { name: "Catégorie" }));
			await screen.findByRole("dialog", {
				name: "Changer la catégorie de 2 opérations",
			});
			await selectMantineOption("Catégorie", "Courses");
			fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

			await waitFor(() =>
				expect(findApiCall("/operations/category", "PUT")?.options?.body).toBe(
					JSON.stringify({ operationIds: ["op5", "op3"], categoryId: "c1" }),
				),
			);
		});

		it("opens the sheet again once the selection is done", async () => {
			setupMocks({ operations, categories });
			await renderOperationsPage();
			await screen.findByText("Opérations quotidiennes");

			fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
			fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
			fireEvent.click(screen.getByRole("button", { name: /Electricity/ }));

			expect(await screen.findByRole("dialog")).toBeInTheDocument();
			expect(
				screen.queryByRole("region", { name: "Opérations sélectionnées" }),
			).not.toBeInTheDocument();
		});
	});
});

function findApiCall(path: string, method: string) {
	return apiCalls.find((c) => c.path === path && c.options?.method === method);
}

describe("operation sheet", () => {
	const categories: CategoryResponse[] = [
		{
			id: "c1",
			name: "Courses",
			color: "teal",
			icon: null,
			netTotals: false,
			rules: [],
			createdAt: "2026-01-01T00:00:00Z",
		},
	];
	const longLabel =
		"CARTE 19/10/26 TE KAFFIHUS VILLEURBANNE CB*4821 PAIEMENT SANS CONTACT";
	const operations: MonthlyOperationsResponse = {
		operations: mockMonthlyResponse.operations.map((op) =>
			op.id === "op3" ? { ...op, label: longLabel } : op,
		),
	};

	async function openSheet(rowName: RegExp | string) {
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: rowName }));
		const sheet = within(await screen.findByRole("dialog"));
		return { user, sheet };
	}

	it("opens from an operation's row on a wide screen", async () => {
		setupMocks({ operations, categories });
		await renderOperationsPage();

		const { sheet } = await openSheet(/KAFFIHUS/);

		expect(sheet.getByText(longLabel)).toBeInTheDocument();
		expect(sheet.getByRole("combobox", { name: "Budget" })).toBeInTheDocument();
	});

	describe("on a phone", () => {
		beforeEach(() => {
			setViewportWidth(PHONE_WIDTH);
			setupMocks({ operations, categories });
		});

		it("shows each operation as a single button, without inline actions", async () => {
			await renderOperationsPage();

			const row = within(
				await screen.findByRole("button", { name: /KAFFIHUS/ }),
			);
			expect(row.getByText("15/04/2026")).toBeInTheDocument();
			expect(row.getByText("-100,00 €")).toBeInTheDocument();
			expect(screen.queryByLabelText("Ignorer")).not.toBeInTheDocument();
			expect(
				screen.queryByLabelText("Lier à un budget"),
			).not.toBeInTheDocument();
		});

		it("shows the whole label and date in the sheet", async () => {
			await renderOperationsPage();

			const { sheet } = await openSheet(/KAFFIHUS/);

			const label = sheet.getByText(longLabel);
			expect(label).not.toHaveAttribute("data-truncate");
			expect(label).not.toHaveAttribute("data-line-clamp");
			expect(sheet.getByText("Mercredi 15 avril 2026")).toBeInTheDocument();
		});

		it("puts the operation in a category", async () => {
			await renderOperationsPage();
			await openSheet(/KAFFIHUS/);

			await selectMantineOption("Catégorie", "Courses");

			await waitFor(() => {
				expect(
					findApiCall("/operations/op3/category", "PUT")?.options?.body,
				).toBe(JSON.stringify({ categoryId: "c1" }));
			});
		});

		it("links the operation to a budget of its sign", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(sheet.getByRole("combobox", { name: "Budget" }));
			await user.click(await screen.findByRole("option", { name: "Food" }));
			expect(
				screen.queryByRole("option", { name: "Income" }),
			).not.toBeInTheDocument();

			await waitFor(() => {
				expect(
					findApiCall("/operations/op3/budget", "PUT")?.options?.body,
				).toBe(JSON.stringify({ budgetId: "b1" }));
			});
		});

		it("unlinks a linked operation", async () => {
			await renderOperationsPage();
			const user = userEvent.setup();
			await user.click(await screen.findByRole("button", { name: /Food/ }));
			const { sheet } = await openSheet(/Groceries/);

			await user.click(sheet.getByRole("button", { name: "Délier du budget" }));

			await waitFor(() => {
				expect(findApiCall("/operations/op1/budget", "DELETE")).toBeDefined();
			});
		});

		it("counts the operation on another date", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(sheet.getByRole("button", { name: /Compter le/ }));
			await user.click(sheet.getByRole("button", { name: /^20 / }));

			await waitFor(() => {
				const body = findApiCall("/operations/op3", "PUT")?.options?.body;
				expect(JSON.parse(body ?? "{}")).toMatchObject({
					date: "2026-04-15",
					effectiveDate: "2026-04-20",
				});
			});
		});

		it("ignores the operation and closes the sheet", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(sheet.getByRole("button", { name: "Ignorer" }));

			await waitFor(() => {
				expect(findApiCall("/operations/op3/ignore", "PUT")).toBeDefined();
			});
			await waitFor(() => {
				expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
			});
		});

		it("opens the split modal in place of the sheet", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(sheet.getByRole("button", { name: "Diviser" }));

			const dialog = within(await screen.findByRole("dialog"));
			expect(dialog.getByText("Diviser l'opération")).toBeInTheDocument();
		});

		it("creates an ignore rule from the operation", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(
				sheet.getByRole("button", { name: "Toujours ignorer…" }),
			);

			const dialog = within(await screen.findByRole("dialog"));
			expect(
				dialog.getByRole("heading", { name: "Nouvelle règle d'ignore" }),
			).toBeInTheDocument();
			expect(dialog.getByRole("textbox", { name: /Valeur/ })).toHaveValue(
				longLabel,
			);
		});

		it("creates a budget from the operation", async () => {
			await renderOperationsPage();
			const { user, sheet } = await openSheet(/KAFFIHUS/);

			await user.click(sheet.getByRole("button", { name: "Créer un budget" }));

			const dialog = within(await screen.findByRole("dialog"));
			expect(
				dialog.getByRole("heading", { name: "Créer un budget" }),
			).toBeInTheDocument();
		});
	});
});

describe("transfers", () => {
	function op(
		id: string,
		label: string,
		amount: string,
		transfer: OperationResponse["transfer"],
	): OperationResponse {
		return {
			id,
			accountId: "account-1",
			amount,
			date: "2026-04-10",
			effectiveDate: null,
			label,
			budgetLink: { type: "unlinked" },
			ignored: false,
			ignoreRuleId: null,
			transfer,
			categoryId: null,
			effectiveCategoryId: null,
			splits: [],
		};
	}
	const toLivret = { accountId: "account-3", ruleId: null, operationId: null };
	const operations: MonthlyOperationsResponse = {
		operations: [
			op("t1", "VIR INTERNE VERS LIVRET A", "-300.00", toLivret),
			op("t2", "VIR SEPA COMPTE JOINT", "450.00", {
				accountId: "account-2",
				ruleId: null,
				operationId: null,
			}),
			op("o1", "CB CARREFOUR", "-20.00", null),
		],
	};

	async function openTransfer(
		user: ReturnType<typeof userEvent.setup>,
		pair: RegExp,
		label: RegExp,
	) {
		const section = within(
			await screen.findByRole("region", { name: "Virements" }),
		);
		await user.click(await section.findByRole("button", { name: pair }));
		await user.click(section.getByRole("button", { name: label }));
	}

	function statText(label: string): string {
		return (
			screen
				.getByText(label)
				.closest(".mantine-Paper-root")
				?.textContent?.replace(/\s/g, "") ?? ""
		);
	}

	it("keeps transfers apart and counts money put aside as savings", async () => {
		setupMocks({ budgets: [], operations });
		await renderOperationsPage();

		const section = await screen.findByRole("region", { name: "Virements" });
		expect(
			within(section).getByText("Un seul côté : Livret A n'est pas importé"),
		).toBeInTheDocument();
		expect(within(section).queryByText(/VIR INTERNE/)).not.toBeInTheDocument();
		const daily = screen.getByRole("region", {
			name: "Opérations quotidiennes",
		});
		expect(within(daily).queryByText(/VIR INTERNE/)).not.toBeInTheDocument();

		expect(statText("Dépenses")).toMatch(/-20,00/);
		expect(statText("Revenus")).toMatch(/0,00/);
		expect(statText("Épargne")).toMatch(/300,00/);
		expect(statText("Virements internes")).toMatch(/\+450,00/);
	});

	it("deducts money taken back from savings from net savings", async () => {
		setupMocks({
			budgets: [],
			operations: {
				operations: [
					op("t1", "VIR INTERNE VERS LIVRET A", "-300.00", toLivret),
					op("t3", "VIR RECU DE LIVRET A", "1000.00", toLivret),
				],
			},
		});
		await renderOperationsPage();

		await screen.findByRole("region", { name: "Virements" });
		expect(statText("Épargne nette")).toMatch(
			/-700,00.*300,00€versés,1000,00€repris/,
		);
		expect(statText("Revenus")).toMatch(/0,00/);
		expect(statText("Balance")).toMatch(/\+700,00/);
	});

	it("warns about a transfer whose other side was not found", async () => {
		setupMocks({ budgets: [], operations });
		await renderOperationsPage();

		const section = within(
			await screen.findByRole("region", { name: "Virements" }),
		);
		expect(
			section.getByText("1 virement sans contrepartie"),
		).toBeInTheDocument();
		expect(
			section.getByText("Débit introuvable sur Compte joint"),
		).toBeInTheDocument();
	});

	it("shows both linked sides of a transfer in one row", async () => {
		const out = op("p1", "VIR VERS COMPTE JOINT", "-800.00", {
			accountId: "account-2",
			ruleId: null,
			operationId: "p2",
		});
		const back = {
			...op("p2", "VIR RECU PERSO", "800.00", {
				accountId: "account-1",
				ruleId: null,
				operationId: "p1",
			}),
			accountId: "account-2",
		};
		setupMocks({ budgets: [], operations: { operations: [out, back] } });
		await renderOperationsPage();
		const user = userEvent.setup();

		const section = within(
			await screen.findByRole("region", { name: "Virements" }),
		);
		expect(section.queryByText(/sans contrepartie/)).not.toBeInTheDocument();
		const pair = section.getByRole("button", {
			name: /Les deux côtés sont liés/,
		});
		expect(pair).toHaveTextContent(/Compte perso.*Compte joint.*800,00/);

		await user.click(pair);
		expect(
			section.getByRole("button", { name: /VIR VERS COMPTE JOINT/ }),
		).toBeInTheDocument();
		expect(
			section.getByRole("button", { name: /VIR RECU PERSO/ }),
		).toBeInTheDocument();
	});

	it("makes an operation a transfer from its sheet", async () => {
		setupMocks({ budgets: [], operations });
		await renderOperationsPage();
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: /CARREFOUR/ }));
		const sheet = within(await screen.findByRole("dialog"));

		await user.click(sheet.getByText("Virement"));
		await selectMantineOption("Vers le compte", "Livret A");

		await waitFor(() =>
			expect(apiCalls).toContainEqual({
				path: "/operations/o1/transfer",
				options: {
					method: "PUT",
					body: JSON.stringify({ accountId: "account-3" }),
				},
			}),
		);
	});

	it("says how a transfer counts and offers a rule for its label", async () => {
		setupMocks({ budgets: [], operations });
		await renderOperationsPage();
		const user = userEvent.setup();
		await openTransfer(user, /Un seul côté/, /VIR INTERNE VERS LIVRET A/);
		const sheet = within(await screen.findByRole("dialog"));

		expect(
			sheet.getByText(
				/Compté dans l'épargne : 300,00\s€ mis de côté sur Livret A/,
			),
		).toBeInTheDocument();
		expect(
			sheet.queryByRole("combobox", { name: "Catégorie" }),
		).not.toBeInTheDocument();

		await user.click(
			sheet.getByRole("button", { name: "Toujours pour ce libellé" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		expect(
			dialog.getByRole("heading", { name: "Nouvelle règle de virement" }),
		).toBeInTheDocument();
		expect(dialog.getByRole("textbox", { name: /Valeur/ })).toHaveValue(
			"VIR INTERNE VERS LIVRET A",
		);
	});

	it("proposes the likely other side of a transfer to link by hand", async () => {
		setupMocks({ budgets: [], operations });
		const fallback = apiFetchMock.getMockImplementation();
		const refund = op("j1", "REMBOURSEMENT RESTO", "-450.00", null);
		const paired = op("j2", "VIR DEJA LIE", "-450.00", {
			accountId: "account-1",
			ruleId: null,
			operationId: "elsewhere",
		});
		apiFetchMock.mockImplementation((path: string, options?: RequestInit) => {
			if (path.startsWith("/operations?accountId=account-2")) {
				expect(path).toContain("amount=-450");
				expect(path).toContain("dateFrom=2026-04-05&dateTo=2026-04-15");
				return Promise.resolve({
					data: [
						{ ...refund, accountId: "account-2" },
						{ ...paired, accountId: "account-2" },
					],
					total: 2,
					page: 1,
					pageSize: 10,
					maxPage: 1,
					totals: {
						income: "0",
						expense: "-900.00",
						firstDate: null,
						lastDate: null,
					},
				});
			}
			return fallback
				? fallback(path, options)
				: Promise.reject(new Error(path));
		});
		await renderOperationsPage();
		const user = userEvent.setup();
		await openTransfer(user, /Débit introuvable/, /VIR SEPA COMPTE JOINT/);
		const sheet = within(await screen.findByRole("dialog"));

		await user.click(
			await sheet.findByRole("button", { name: "Lier à REMBOURSEMENT RESTO" }),
		);

		expect(
			sheet.queryByRole("button", { name: "Lier à VIR DEJA LIE" }),
		).not.toBeInTheDocument();
		await waitFor(() =>
			expect(apiCalls).toContainEqual({
				path: "/operations/t2/transfer",
				options: {
					method: "PUT",
					body: JSON.stringify({ accountId: "account-2", counterpartId: "j1" }),
				},
			}),
		);
	});
});
