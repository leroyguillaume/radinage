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

// Mock chart components to avoid Recharts SVG rendering in jsdom
vi.mock("@mantine/charts", () => ({
	BarChart: () => <div data-testid="bar-chart" />,
	AreaChart: () => <div data-testid="area-chart" />,
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

function setupMocks(response = mockSummaryResponse) {
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
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
});
