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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type { MonthlyOperationsResponse } from "@/lib/types";
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

const mockMonthlyResponse: MonthlyOperationsResponse = {
	operations: [
		{
			id: "op1",
			amount: "-50.00",
			date: "2026-04-05",
			effectiveDate: null,
			label: "Groceries",
			budgetLink: { type: "manual", budgetId: "b1" },
			splits: [],
		},
		{
			id: "op2",
			amount: "-30.00",
			date: "2026-04-10",
			effectiveDate: null,
			label: "Restaurant",
			budgetLink: { type: "manual", budgetId: "b1" },
			splits: [],
		},
		{
			id: "op3",
			amount: "-100.00",
			date: "2026-04-15",
			effectiveDate: null,
			label: "Electricity",
			budgetLink: { type: "unlinked" },
			splits: [],
		},
		{
			id: "op4",
			amount: "2000.00",
			date: "2026-04-01",
			effectiveDate: null,
			label: "Salary",
			budgetLink: { type: "auto", budgetId: "b2" },
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
		createdAt: "2026-01-01T00:00:00Z",
	},
];

let apiCalls: Array<{
	path: string;
	options?: { method?: string; body?: string };
}> = [];

function setupMocks(
	overrides?: Partial<{
		budgets: typeof mockBudgetsResponse;
		operations: typeof mockMonthlyResponse;
	}>,
) {
	const budgets = overrides?.budgets ?? mockBudgetsResponse;
	const operations = overrides?.operations ?? mockMonthlyResponse;

	apiCalls = [];
	apiFetchMock.mockImplementation((path: string, options?: unknown) => {
		const opts = options as { method?: string; body?: string } | undefined;
		apiCalls.push({ path, options: opts });

		if (path.startsWith("/operations/monthly/")) {
			return Promise.resolve(operations);
		}
		if (path.startsWith("/summary")) {
			return Promise.resolve({
				months: [
					{
						year: 2026,
						month: 1,
						unbudgeted: "-300.00",
						budgeted: {
							expense: "-600.00",
							income: "2000.00",
							savings: "-200.00",
						},
					},
					{
						year: 2026,
						month: 2,
						unbudgeted: "-350.00",
						budgeted: {
							expense: "-650.00",
							income: "2000.00",
							savings: "-200.00",
						},
					},
					{
						year: 2026,
						month: 3,
						unbudgeted: "-400.00",
						budgeted: {
							expense: "-700.00",
							income: "2000.00",
							savings: "-200.00",
						},
					},
				],
			});
		}
		// Ignore operation
		const ignoreMatch = path.match(/^\/operations\/([^/]+)\/ignore$/);
		if (ignoreMatch) {
			return Promise.resolve({
				id: ignoreMatch[1],
				amount: "-50.00",
				date: "2026-04-05",
				effectiveDate: null,
				label: "Op",
				budgetLink: { type: "unlinked" },
				splits: [],
			});
		}
		// Link/unlink operations
		const budgetLinkMatch = path.match(/^\/operations\/([^/]+)\/budget$/);
		if (budgetLinkMatch) {
			const opId = budgetLinkMatch[1];
			return Promise.resolve({
				id: opId,
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

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	setupMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("MonthlyOperationsPage", () => {
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

	it("shows unlink button on linked operations", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		// Expand the Food group (has linked operations)
		await user.click(await screen.findByRole("button", { name: /Food/ }));

		await waitFor(() => {
			expect(screen.getByText("Groceries")).toBeInTheDocument();
		});

		// Linked operations should have unlink buttons
		const unlinkButtons = screen.getAllByLabelText("Délier du budget");
		expect(unlinkButtons.length).toBeGreaterThanOrEqual(1);
	});

	it("calls unlink API when unlink button is clicked", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		// Expand Food group
		await user.click(await screen.findByRole("button", { name: /Food/ }));

		await waitFor(() => {
			expect(screen.getByText("Groceries")).toBeInTheDocument();
		});

		const unlinkButton = screen.getAllByLabelText("Délier du budget")[0];
		await user.click(unlinkButton);

		await waitFor(() => {
			const unlinkCall = apiCalls.find(
				(c) =>
					c.path.match(/\/operations\/.*\/budget/) &&
					c.options?.method === "DELETE",
			);
			expect(unlinkCall).toBeDefined();
		});
	});

	it("shows ignore button on operations and calls ignore API", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		// Expand the Food group (has linked operations)
		await user.click(await screen.findByRole("button", { name: /Food/ }));

		await waitFor(() => {
			expect(screen.getByText("Groceries")).toBeInTheDocument();
		});

		// Ignore buttons should be present on every operation row
		const ignoreButtons = screen.getAllByLabelText("Ignorer l'opération");
		expect(ignoreButtons.length).toBeGreaterThanOrEqual(1);

		// Click the ignore button
		await user.click(ignoreButtons[0]);

		await waitFor(() => {
			const ignoreCall = apiCalls.find(
				(c) =>
					c.path.match(/\/operations\/.*\/ignore/) &&
					c.options?.method === "PUT",
			);
			expect(ignoreCall).toBeDefined();
		});
	});

	it("shows link button on unlinked operations", async () => {
		await renderOperationsPage();

		// The daily group is expanded by default
		await screen.findByText("Opérations quotidiennes");

		await waitFor(() => {
			expect(screen.getByText("Electricity")).toBeInTheDocument();
		});

		// Unlinked operations should have link buttons
		const linkButtons = screen.getAllByLabelText("Lier à un budget");
		expect(linkButtons.length).toBeGreaterThanOrEqual(1);
	});

	it("link button opens budget menu and calls link API on selection", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		// The daily group is expanded by default
		await screen.findByText("Opérations quotidiennes");

		await waitFor(() => {
			expect(screen.getByText("Electricity")).toBeInTheDocument();
		});

		// Click the link button — should open Mantine Menu dropdown
		const linkButton = screen.getAllByLabelText("Lier à un budget")[0];
		await user.click(linkButton);

		// The menu dropdown should appear with budget names as menu items
		const foodItem = await screen.findByRole("menuitem", { name: "Food" });
		expect(foodItem).toBeInTheDocument();

		// Click the menu item to link the operation
		await user.click(foodItem);

		await waitFor(() => {
			const linkCall = apiCalls.find(
				(c) =>
					c.path.match(/\/operations\/.*\/budget/) &&
					c.options?.method === "PUT",
			);
			expect(linkCall).toBeDefined();
			const body = JSON.parse(linkCall?.options?.body ?? "{}");
			expect(body.budgetId).toBe("b1");
		});
	});

	it("link menu contains a search input", async () => {
		await renderOperationsPage();
		const user = userEvent.setup();

		// The daily group is expanded by default
		await screen.findByText("Opérations quotidiennes");

		await waitFor(() => {
			expect(screen.getByText("Electricity")).toBeInTheDocument();
		});

		// Open the link menu
		const linkButton = screen.getAllByLabelText("Lier à un budget")[0];
		await user.click(linkButton);

		// Expense budgets and a search input should be visible (operation is negative)
		await waitFor(() => {
			expect(
				screen.getByRole("menuitem", { name: "Food" }),
			).toBeInTheDocument();
			// Income budget should not appear for a negative operation
			expect(
				screen.queryByRole("menuitem", { name: "Income" }),
			).not.toBeInTheDocument();
			expect(screen.getByPlaceholderText("Rechercher")).toBeInTheDocument();
		});
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
				createdAt: "2026-01-01T00:00:00Z",
			},
		];

		const operationsForSort: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					splits: [],
				},
				{
					id: "op5",
					amount: "-20.00",
					date: "2026-04-06",
					effectiveDate: null,
					label: "Bus ticket",
					budgetLink: { type: "manual", budgetId: "b4" },
					splits: [],
				},
				{
					id: "op4",
					amount: "2000.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "auto", budgetId: "b2" },
					splits: [],
				},
				{
					id: "op6",
					amount: "500.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Freelance gig",
					budgetLink: { type: "auto", budgetId: "b5" },
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
			createdAt: "2026-01-01T00:00:00Z",
		}));
		const sortOperations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					splits: [],
				},
				{
					id: "op5",
					amount: "-20.00",
					date: "2026-04-06",
					effectiveDate: null,
					label: "Bus ticket",
					budgetLink: { type: "manual", budgetId: "b4" },
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
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: "2026-04-20",
					label: "Groceries",
					budgetLink: { type: "manual" as const, budgetId: "b1" },
					splits: [],
				},
				{
					id: "op2",
					amount: "-30.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Restaurant",
					budgetLink: { type: "manual" as const, budgetId: "b1" },
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

		// Op1 has effectiveDate 2026-04-20 → should display 20/04
		await waitFor(() => {
			expect(screen.getByText("20/04")).toBeInTheDocument();
		});
		// Op1's original date 05/04 should NOT appear
		expect(screen.queryByText("05/04")).not.toBeInTheDocument();
		// Op2 has no effectiveDate → should display date 10/04
		expect(screen.getByText("10/04")).toBeInTheDocument();
	});

	it("counts unlinked operations in income and expense stats when no budgets exist", async () => {
		const operations: MonthlyOperationsResponse = {
			operations: [
				{
					id: "op1",
					amount: "1500.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "unlinked" },
					splits: [],
				},
				{
					id: "op2",
					amount: "-200.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "unlinked" },
					splits: [],
				},
				{
					id: "op3",
					amount: "-50.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Taxi",
					budgetLink: { type: "unlinked" },
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
					amount: "-260.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
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
					amount: "2500.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "auto", budgetId: "b2" },
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
					amount: "-50.00",
					date: "2026-04-05",
					effectiveDate: null,
					label: "Groceries",
					budgetLink: { type: "manual", budgetId: "b1" },
					splits: [],
				},
				{
					id: "op2",
					amount: "-100.00",
					date: "2026-04-08",
					effectiveDate: null,
					label: "CASH WITHDRAWAL",
					budgetLink: { type: "unlinked" },
					splits: [
						{ id: "s1", amount: "-30.00", budgetId: "b1" },
						{ id: "s2", amount: "-70.00", budgetId: null },
					],
				},
				{
					id: "op3",
					amount: "-20.00",
					date: "2026-04-12",
					effectiveDate: null,
					label: "Taxi",
					budgetLink: { type: "unlinked" },
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

		it("offers to edit the split instead of linking a part", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			await screen.findByText("part 2/2");

			const part = rowOf("part 2/2");
			expect(part.getByLabelText("Modifier la division")).toBeInTheDocument();
			expect(part.queryByLabelText("Lier à un budget")).not.toBeInTheDocument();
			expect(part.queryByLabelText("Créer un budget")).not.toBeInTheDocument();

			const taxi = rowOf("Taxi");
			expect(taxi.getByLabelText("Diviser")).toBeInTheDocument();
			expect(taxi.getByLabelText("Lier à un budget")).toBeInTheDocument();
		});

		it("opens the split modal pre-filled with the parts", async () => {
			setupMocks({ operations });
			await renderOperationsPage();
			const user = userEvent.setup();
			await screen.findByText("part 2/2");

			await user.click(
				rowOf("part 2/2").getByLabelText("Modifier la division"),
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
});
