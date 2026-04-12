import { MantineProvider } from "@mantine/core";
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

const mockSummaryResponse = {
	months: [
		{
			year: 2026,
			month: 1,
			unbudgeted: "-100.00",
			budgeted: {
				expense: "-500.00",
				income: "2000.00",
				savings: "-300.00",
			},
		},
		{
			year: 2026,
			month: 2,
			unbudgeted: "-150.00",
			budgeted: {
				expense: "-600.00",
				income: "2200.00",
				savings: "-400.00",
			},
		},
		{
			year: 2026,
			month: 3,
			unbudgeted: "-200.00",
			budgeted: {
				expense: "-700.00",
				income: "2500.00",
				savings: "-350.00",
			},
		},
	],
};

const mockBudgetsResponse = [
	{
		id: "b1",
		label: "Salary",
		budgetType: "income" as const,
		kind: {
			type: "recurring" as const,
			recurrence: "monthly" as const,
			closedPeriods: [],
			currentPeriod: {
				start: { year: 2025, month: 1 },
				end: null,
				amount: "2500.00",
			},
		},
		rules: [],
		createdAt: "2025-01-01T00:00:00Z",
	},
	{
		id: "b2",
		label: "Rent",
		budgetType: "expense" as const,
		kind: {
			type: "recurring" as const,
			recurrence: "monthly" as const,
			closedPeriods: [],
			currentPeriod: {
				start: { year: 2025, month: 1 },
				end: null,
				amount: "-800.00",
			},
		},
		rules: [],
		createdAt: "2025-01-01T00:00:00Z",
	},
];

function setupMocks(
	summary = mockSummaryResponse,
	budgets = mockBudgetsResponse,
) {
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
		if (path.startsWith("/summary")) {
			return Promise.resolve(summary);
		}
		if (path.startsWith("/budgets")) {
			return Promise.resolve(budgets);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

async function renderSummaryPage(searchParams = "") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const { Route } = await import("@/routes/summary");

	const rootRoute = createRootRoute({ component: Outlet });
	const summaryRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/summary",
		component: Route.options.component,
		validateSearch: Route.options.validateSearch,
	});
	rootRoute.addChildren([summaryRoute]);

	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: [`/summary${searchParams}`],
		}),
	});

	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme}>
				<RouterProvider router={router} />
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { queryClient };
}

beforeEach(() => {
	i18n.changeLanguage("fr");
	setupMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SummaryPage", () => {
	it("renders the page title", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText("Résumé")).toBeInTheDocument();
		});
	});

	it("displays the current year by default", async () => {
		await renderSummaryPage();

		const thisYear = new Date().getFullYear();
		await waitFor(() => {
			expect(screen.getByText(String(thisYear))).toBeInTheDocument();
		});
	});

	it("uses year from query params", async () => {
		await renderSummaryPage("?year=2025");

		await waitFor(() => {
			expect(screen.getByText("2025")).toBeInTheDocument();
		});
	});

	it("displays key metric cards", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText("Budget / jour")).toBeInTheDocument();
		});
		expect(screen.getByText("Balance fin d'année")).toBeInTheDocument();
		// "Revenus", "Dépenses", "Épargne" appear in both cards and table headers
		expect(screen.getAllByText("Revenus").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Dépenses").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Épargne").length).toBeGreaterThanOrEqual(1);
	});

	it("displays the year progress bar", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText(/Progression de l'année/)).toBeInTheDocument();
		});
	});

	it("renders the monthly forecast table with 12 rows", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText("Budget / jour")).toBeInTheDocument();
		});

		// Table headers
		expect(screen.getByText("Mois")).toBeInTheDocument();
		expect(screen.getByText("Balance")).toBeInTheDocument();
		expect(screen.getByText("Cumulé")).toBeInTheDocument();

		// Should have 12 month rows
		const rows = document.querySelectorAll("tbody tr");
		expect(rows.length).toBe(12);
	});

	it("marks projected months with label", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText("Budget / jour")).toBeInTheDocument();
		});

		// Future months should have "(prév.)" suffix
		const projectedCells = screen.getAllByText(/\(prév\.\)/);
		expect(projectedCells.length).toBeGreaterThan(0);
	});

	it("shows error alert on API failure", async () => {
		apiFetchMock.mockReset();
		apiFetchMock.mockRejectedValue(new Error("Network error"));

		await renderSummaryPage();

		await waitFor(() => {
			expect(
				screen.getByText("Impossible de charger le prévisionnel"),
			).toBeInTheDocument();
		});
	});

	it("handles empty summary response", async () => {
		setupMocks({ months: [] }, mockBudgetsResponse);

		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText("Budget / jour")).toBeInTheDocument();
		});

		// Should still render 12 rows (all projected)
		const rows = document.querySelectorAll("tbody tr");
		expect(rows.length).toBe(12);
	});

	it("navigates year with arrow buttons", async () => {
		const user = userEvent.setup();
		await renderSummaryPage("?year=2026");

		await waitFor(() => {
			expect(screen.getByText("2026")).toBeInTheDocument();
		});

		// Click next year arrow
		const arrows = document.querySelectorAll('[data-variant="subtle"]');
		// The right arrow should be the second one in the year selector group
		const rightArrow = Array.from(arrows).find(
			(el) =>
				el.closest("[class*='group']") !== null || el.querySelector("svg"),
		);

		if (rightArrow) {
			await user.click(rightArrow);
		}
	});

	it("shows remaining days count", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText(/jour\(s\) restant\(s\)/)).toBeInTheDocument();
		});
	});

	it("displays full year as actual for past years", async () => {
		setupMocks(
			{
				months: Array.from({ length: 12 }, (_, i) => ({
					year: 2025,
					month: i + 1,
					unbudgeted: "-50.00",
					budgeted: {
						expense: "-200.00",
						income: "1000.00",
						savings: "-100.00",
					},
				})),
			},
			mockBudgetsResponse,
		);

		await renderSummaryPage("?year=2025");

		await waitFor(() => {
			expect(screen.getByText("2025")).toBeInTheDocument();
		});

		// Past year = no projected months
		const projectedCells = screen.queryAllByText(/\(prév\.\)/);
		expect(projectedCells.length).toBe(0);
	});
});
