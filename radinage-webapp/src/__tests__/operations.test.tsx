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
import { render, screen, waitFor } from "@testing-library/react";
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
		},
		{
			id: "op2",
			amount: "-30.00",
			date: "2026-04-10",
			effectiveDate: null,
			label: "Restaurant",
			budgetLink: { type: "manual", budgetId: "b1" },
		},
		{
			id: "op3",
			amount: "-100.00",
			date: "2026-04-15",
			effectiveDate: null,
			label: "Electricity",
			budgetLink: { type: "unlinked" },
		},
		{
			id: "op4",
			amount: "2000.00",
			date: "2026-04-01",
			effectiveDate: null,
			label: "Salary",
			budgetLink: { type: "auto", budgetId: "b2" },
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
			<MantineProvider theme={theme}>
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

		const foodText = await screen.findByText("Food");
		const foodRow = foodText.closest("tr");
		if (foodRow) await user.click(foodRow);

		await waitFor(() => {
			expect(screen.getByText("Groceries")).toBeInTheDocument();
			expect(screen.getByText("Restaurant")).toBeInTheDocument();
		});
	});

	it("displays section headers for budget types", async () => {
		await renderOperationsPage();

		// Should have section headers
		expect(await screen.findByText("Revenu")).toBeInTheDocument();
		expect(screen.getByText("Dépense")).toBeInTheDocument();

		// Income section comes first (section order: income, expense, savings, monthly)
		// First non-empty row should be the income section header
		const rows = document.querySelectorAll("tbody tr");
		const sectionRow = Array.from(rows).find(
			(r) => (r.textContent ?? "").trim().length > 0,
		);
		expect(sectionRow?.textContent).toContain("Revenu");
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
		const foodText = await screen.findByText("Food");
		const foodRow = foodText.closest("tr");
		if (foodRow) await user.click(foodRow);

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
		const foodText = await screen.findByText("Food");
		const foodRow = foodText.closest("tr");
		if (foodRow) await user.click(foodRow);

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
		const foodText = await screen.findByText("Food");
		const foodRow = foodText.closest("tr");
		if (foodRow) await user.click(foodRow);

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
		const user = userEvent.setup();

		// Expand the monthly budget group (has unlinked operations)
		const monthlyText = await screen.findByText("Opérations quotidiennes");
		const monthlyRow = monthlyText.closest("tr");
		if (monthlyRow) await user.click(monthlyRow);

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

		// Expand the monthly budget group
		const monthlyText = await screen.findByText("Opérations quotidiennes");
		const monthlyRow = monthlyText.closest("tr");
		if (monthlyRow) await user.click(monthlyRow);

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

		// Expand the monthly budget group
		const monthlyText = await screen.findByText("Opérations quotidiennes");
		const monthlyRow = monthlyText.closest("tr");
		if (monthlyRow) await user.click(monthlyRow);

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

		const allRows = document.querySelectorAll("tbody tr");

		// Food: real = -80, budgeted = -200 → diff = (-80) - (-200) = +120
		const foodRow = Array.from(allRows).find((r) =>
			r.textContent?.includes("Food"),
		);
		const foodDiffCell = foodRow?.querySelectorAll("td")[4];
		expect(foodDiffCell?.textContent).toContain("120");

		// Income: real = 2000, budgeted = 2500 → diff = 2000 - 2500 = -500
		const incomeRow = Array.from(allRows).find((r) =>
			r.textContent?.includes("Income"),
		);
		const incomeDiffCell = incomeRow?.querySelectorAll("td")[4];
		expect(incomeDiffCell?.textContent).toContain("500");
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

		// Rent row should show 0 real amount and the budgeted amount
		const table = screen.getByText("Rent").closest("table");
		const rows = table?.querySelectorAll("tbody tr") ?? [];
		const rentRow = Array.from(rows).find((r) =>
			r.textContent?.includes("Rent"),
		);
		// Real amount = 0
		const realCell = rentRow?.querySelectorAll("td")[2];
		expect(realCell?.textContent).toContain("0");
		// Budgeted amount = -900
		const budgetedCell = rentRow?.querySelectorAll("td")[3];
		expect(budgetedCell?.textContent).toContain("900");
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
				},
				{
					id: "op5",
					amount: "-20.00",
					date: "2026-04-06",
					effectiveDate: null,
					label: "Bus ticket",
					budgetLink: { type: "manual", budgetId: "b4" },
				},
				{
					id: "op4",
					amount: "2000.00",
					date: "2026-04-01",
					effectiveDate: null,
					label: "Salary",
					budgetLink: { type: "auto", budgetId: "b2" },
				},
				{
					id: "op6",
					amount: "500.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Freelance gig",
					budgetLink: { type: "auto", budgetId: "b5" },
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

		// There are two tables (income and expense). Each has its own "Budget" column header.
		const tables = document.querySelectorAll("table");
		expect(tables.length).toBe(2);

		// Record initial order for income table (second section = expense, first = income per SECTION_ORDER)
		// SECTION_ORDER = income, expense, savings, monthly
		const incomeTable = tables[0];
		const expenseTable = tables[1];

		// Get budget group rows in each table (skip the section header row)
		function getBudgetLabels(table: Element): string[] {
			const rows = table.querySelectorAll("tbody tr");
			const labels: string[] = [];
			for (const row of rows) {
				const firstCell = row.querySelector("td");
				const text = firstCell?.textContent?.trim() ?? "";
				// Section header rows have uppercase text, budget rows have normal text
				if (
					text &&
					!["Revenu", "Dépense", "Épargne", "Opérations quotidiennes"].includes(
						text,
					)
				) {
					labels.push(text);
				}
			}
			return labels;
		}

		// Default order is alphabetical (asc by budget label)
		const incomeLabelsInitial = getBudgetLabels(incomeTable);
		expect(incomeLabelsInitial).toEqual(["Freelance", "Salaire"]);

		const expenseLabelsInitial = getBudgetLabels(expenseTable);
		expect(expenseLabelsInitial).toEqual(["Alimentation", "Transport"]);

		// Click "Budget" sort header in the expense table to toggle to desc
		// Default is budget/asc, so one click toggles to budget/desc
		const expenseBudgetHeader = expenseTable.querySelector("th");
		if (expenseBudgetHeader) await user.click(expenseBudgetHeader);

		await waitFor(() => {
			const expenseLabelsAfter = getBudgetLabels(expenseTable);
			expect(expenseLabelsAfter).toEqual(["Transport", "Alimentation"]);
		});

		// Income table should NOT have changed
		const incomeLabelsAfter = getBudgetLabels(incomeTable);
		expect(incomeLabelsAfter).toEqual(["Freelance", "Salaire"]);
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
				},
				{
					id: "op2",
					amount: "-30.00",
					date: "2026-04-10",
					effectiveDate: null,
					label: "Restaurant",
					budgetLink: { type: "manual" as const, budgetId: "b1" },
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
		const user = userEvent.setup();

		const rentText = await screen.findByText("Rent");
		const rentRow = rentText.closest("tr");

		// Row should not have pointer cursor (not expandable)
		expect(rentRow?.style.cursor).toBe("default");

		// No chevron icon in the Rent row
		const chevrons = rentRow?.querySelectorAll("svg");
		const chevronIcons = Array.from(chevrons ?? []).filter(
			(svg) =>
				svg.classList.contains("tabler-icon-chevron-down") ||
				svg.classList.contains("tabler-icon-chevron-up"),
		);
		expect(chevronIcons.length).toBe(0);

		// Clicking the row should not expand anything
		if (rentRow) await user.click(rentRow);

		// The table should still have the same number of rows (no sub-rows appeared)
		const table = rentText.closest("table");
		const rowsBefore = table?.querySelectorAll("tbody tr").length ?? 0;
		if (rentRow) await user.click(rentRow);
		const rowsAfter = table?.querySelectorAll("tbody tr").length ?? 0;
		expect(rowsAfter).toBe(rowsBefore);
	});
});
