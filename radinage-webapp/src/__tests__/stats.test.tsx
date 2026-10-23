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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type { CategoryResponse, CategorySummaryResponse } from "@/lib/types";
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

// Mock chart components to avoid Recharts SVG rendering in jsdom
vi.mock("@mantine/charts", () => ({
	BarChart: () => <div data-testid="bar-chart" />,
	AreaChart: () => <div data-testid="area-chart" />,
	PieChart: ({ data }: { data: { name: string; value: number }[] }) => (
		<ul data-testid="pie-chart">
			{data.map((cell) => (
				<li key={cell.name}>{`${cell.name}=${cell.value}`}</li>
			))}
		</ul>
	),
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

function setupMocks(
	response = mockSummaryResponse,
	categories: CategoryResponse[] = [],
	categorySummary: CategorySummaryResponse = { categories: [] },
) {
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
		if (path === "/categories") {
			return Promise.resolve(categories);
		}
		if (path.startsWith("/summary/categories")) {
			return Promise.resolve(categorySummary);
		}
		if (path.startsWith("/summary")) {
			return Promise.resolve(response);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

async function renderStatsPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const { Route } = await import("@/routes/stats");

	const rootRoute = createRootRoute({ component: Outlet });
	const statsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/stats",
		component: Route.options.component,
		validateSearch: Route.options.validateSearch,
	});
	rootRoute.addChildren([statsRoute]);

	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/stats"] }),
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

function pieCells(section: HTMLElement) {
	return within(within(section).getByTestId("pie-chart"))
		.getAllByRole("listitem")
		.map((cell) => cell.textContent);
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	setupMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("StatsPage", () => {
	it("renders the page title and period pickers", async () => {
		await renderStatsPage();

		expect(await screen.findByText("Statistiques")).toBeInTheDocument();
		expect(screen.getByText("De")).toBeInTheDocument();
		expect(screen.getByText("À")).toBeInTheDocument();
	});

	it("displays summary cards with correct totals", async () => {
		await renderStatsPage();

		// Wait for data to load
		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		// Income total: 2000 + 2200 + 2500 = 6700
		expect(screen.getByText("Revenus")).toBeInTheDocument();

		// Expenses total: (-100 + -500) + (-150 + -600) + (-200 + -700) = -2250
		expect(screen.getByText("Dépenses")).toBeInTheDocument();

		// Savings total: -300 + -400 + -350 = -1050
		expect(screen.getByText("Épargne")).toBeInTheDocument();

		// Balance: income + expenses + savings = 6700 + (-2250) + (-1050) = 3400
		expect(screen.getByText("Balance")).toBeInTheDocument();
	});

	it("computes correct balance amounts", async () => {
		await renderStatsPage();

		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		// Income: 2000 + 2200 + 2500 = 6700
		// Expenses: (-100-500) + (-150-600) + (-200-700) = -2250
		// Savings: -300 + -400 + -350 = -1050
		// Balance: 6700 + (-2250) + (-1050) = 3400
		const pageText = document.body.textContent ?? "";
		expect(pageText).toContain("6\u202f700");
		expect(pageText).toContain("2\u202f250");
		expect(pageText).toContain("1\u202f050");
		expect(pageText).toContain("3\u202f400");
	});

	it("renders bar charts", async () => {
		await renderStatsPage();

		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		expect(
			screen.getByText("Revenus, dépenses et épargne"),
		).toBeInTheDocument();

		const barCharts = screen.getAllByTestId("bar-chart");
		expect(barCharts).toHaveLength(1);
	});

	it("renders the balance evolution with the cumulative total", async () => {
		await renderStatsPage();

		expect(
			await screen.findByText("Évolution de la balance"),
		).toBeInTheDocument();
		expect(screen.getByTestId("area-chart")).toBeInTheDocument();

		const pageText = (document.body.textContent ?? "").replace(/\s/g, "");
		expect(pageText).toMatch(/Cumulsurlapériode:3400,00/);
	});

	it("shows error alert on API failure", async () => {
		apiFetchMock.mockReset();
		apiFetchMock.mockRejectedValue(new Error("Network error"));

		await renderStatsPage();

		await waitFor(() => {
			expect(
				screen.getByText("Impossible de charger les statistiques"),
			).toBeInTheDocument();
		});
	});

	it("displays all four summary card labels", async () => {
		await renderStatsPage();

		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		expect(screen.getByText("Balance")).toBeInTheDocument();
		expect(screen.getByText("Revenus")).toBeInTheDocument();
		expect(screen.getByText("Dépenses")).toBeInTheDocument();
		expect(screen.getByText("Épargne")).toBeInTheDocument();
	});

	it("attributes positive unbudgeted to income and negative to expenses", async () => {
		// Only unlinked operations, no budgets. Month 1 is net-positive
		// (income-like), month 2 is net-negative (expense-like).
		setupMocks({
			months: [
				{
					year: 2026,
					month: 1,
					unbudgeted: "1500.00",
					budgeted: { expense: "0.00", income: "0.00", savings: "0.00" },
				},
				{
					year: 2026,
					month: 2,
					unbudgeted: "-400.00",
					budgeted: { expense: "0.00", income: "0.00", savings: "0.00" },
				},
			],
		});

		await renderStatsPage();

		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		const tileAmount = (label: string) =>
			(
				screen.getByText(label).closest(".mantine-Paper-root")?.textContent ??
				""
			)
				.replace(/\s/g, "")
				.match(/-?\d+,\d{2}€$/)?.[0];
		// Without the fix the page would show +1100 as expenses and no income.
		expect(tileAmount("Revenus")).toBe("1500,00€");
		expect(tileAmount("Dépenses")).toBe("-400,00€");
		// Balance = 1500 - 400 + 0 = 1100 (not 1100 on the expense side).
		expect(tileAmount("Balance")).toBe("1100,00€");
	});

	it("handles empty summary response", async () => {
		setupMocks({ months: [] });

		await renderStatsPage();

		await waitFor(() => {
			expect(screen.getByText("Revenus")).toBeInTheDocument();
		});

		// All totals should be 0,00 € — there are 4 summary cards
		const zeroAmounts = screen.getAllByText(/^0,00\s*€$/);
		expect(zeroAmounts.length).toBe(4);

		// No charts should be rendered (empty data)
		expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
	});

	it("ranks the expenses by category with their share", async () => {
		setupMocks(
			mockSummaryResponse,
			[
				{
					id: "c1",
					name: "Courses",
					color: "#12b886",
					icon: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
			{
				categories: [
					{ categoryId: null, income: "0", expense: "-100.00" },
					{ categoryId: "c1", income: "20.00", expense: "-300.00" },
					{ categoryId: "c2", income: "500.00", expense: "0" },
				],
			},
		);
		await renderStatsPage();

		const expenses = await screen.findByRole("region", {
			name: "Dépenses par catégorie",
		});
		const rows = within(expenses).getAllByRole("progressbar");
		expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
			expect.stringMatching(/^Courses : 300,00/),
			expect.stringMatching(/^Sans catégorie : 100,00/),
		]);
		expect(within(expenses).getByText(/· 75 %/)).toBeInTheDocument();
		expect(pieCells(expenses)).toEqual(["Courses=300", "Sans catégorie=100"]);
	});

	it("ranks the income by category with their share", async () => {
		setupMocks(
			mockSummaryResponse,
			[
				{
					id: "c1",
					name: "Salaire",
					color: "#12b886",
					icon: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
				{
					id: "c2",
					name: "Courses",
					color: "#fd7e14",
					icon: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
			{
				categories: [
					{ categoryId: "c1", income: "900.00", expense: "0" },
					{ categoryId: "c2", income: "100.00", expense: "-300.00" },
				],
			},
		);
		await renderStatsPage();

		const income = await screen.findByRole("region", {
			name: "Revenus par catégorie",
		});
		const rows = within(income).getAllByRole("progressbar");
		expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
			expect.stringMatching(/^Salaire : 900,00/),
			expect.stringMatching(/^Courses : 100,00/),
		]);
		expect(within(income).getByText(/· 90 %/)).toBeInTheDocument();
		expect(pieCells(income)).toEqual(["Salaire=900", "Courses=100"]);
	});

	it("says when there is no income over the period", async () => {
		setupMocks(
			mockSummaryResponse,
			[
				{
					id: "c1",
					name: "Courses",
					color: "#12b886",
					icon: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
			{ categories: [{ categoryId: "c1", income: "0", expense: "-30.00" }] },
		);
		await renderStatsPage();

		const income = await screen.findByRole("region", {
			name: "Revenus par catégorie",
		});
		expect(
			within(income).getByText("Aucun revenu sur la période."),
		).toBeInTheDocument();
		expect(within(income).queryByTestId("pie-chart")).not.toBeInTheDocument();
	});

	it("folds the smallest categories into one pie slice", async () => {
		const categories = Array.from({ length: 7 }, (_, i) => ({
			id: `c${i}`,
			name: `Cat ${i}`,
			color: "#12b886",
			icon: null,
			createdAt: "2026-01-01T00:00:00Z",
		}));
		setupMocks(mockSummaryResponse, categories, {
			categories: categories.map((c, i) => ({
				categoryId: c.id,
				income: "0",
				expense: `-${(7 - i) * 10}.00`,
			})),
		});
		await renderStatsPage();

		const expenses = await screen.findByRole("region", {
			name: "Dépenses par catégorie",
		});
		expect(pieCells(expenses)).toEqual([
			"Cat 0=70",
			"Cat 1=60",
			"Cat 2=50",
			"Cat 3=40",
			"Cat 4=30",
			"Autres (2 catégories)=30",
		]);
		// The list below the pie still details every category.
		expect(within(expenses).getAllByRole("progressbar")).toHaveLength(7);
	});

	it("leaves the category breakdown out without categories", async () => {
		await renderStatsPage();

		expect(await screen.findByText("Statistiques")).toBeInTheDocument();
		await waitFor(() =>
			expect(apiFetchMock).toHaveBeenCalledWith("/categories"),
		);
		expect(
			screen.queryByText("Dépenses par catégorie"),
		).not.toBeInTheDocument();
		expect(screen.queryByText("Revenus par catégorie")).not.toBeInTheDocument();
	});
});
