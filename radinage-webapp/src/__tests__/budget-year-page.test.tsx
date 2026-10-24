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
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { formatAmount } from "@/lib/format";
import type { BudgetResponse, BudgetSummaryEntry } from "@/lib/types";
import { theme } from "@/theme";

vi.mock("@/lib/api", () => ({
	ApiError: class ApiError extends Error {},
	apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

/** `formatAmount` with the whitespace Testing Library normalises text to. */
const amount = (value: number) => formatAmount(value).replace(/\s/g, " ");

const groceries: BudgetResponse = {
	id: "b1",
	label: "Courses",
	budgetType: "expense",
	kind: {
		type: "recurring",
		recurrence: "monthly",
		closedPeriods: [
			{
				start: { year: 2024, month: 1 },
				end: { year: 2024, month: 12 },
				amount: "-400.00",
			},
		],
		currentPeriod: {
			start: { year: 2025, month: 1 },
			end: null,
			amount: "-450.00",
		},
	},
	rules: [],
	categoryId: null,
	accountId: null,
	createdAt: "2024-01-01T00:00:00Z",
};

const actuals = [432, 468, 441, 497, 455, 420, 512, 538, 446, 318];

const summary: BudgetSummaryEntry = {
	budgetId: "b1",
	months: Array.from({ length: 12 }, (_, i) => ({
		year: 2026,
		month: i + 1,
		expected: "-450.00",
		actual: String(-(actuals[i] ?? 0)),
	})),
};

function setup(budgets: BudgetResponse[]) {
	apiFetchMock.mockImplementation((path: string) => {
		if (path.startsWith("/budgets")) return Promise.resolve(budgets);
		if (path.startsWith("/summary/budgets")) {
			return Promise.resolve({ budgets: [summary] });
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

async function renderPage(initialEntry: string) {
	const { Route } = await import("@/routes/budgets_.$budgetId");
	const rootRoute = createRootRoute({ component: Outlet });
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/budgets/$budgetId",
		component: Route.options.component,
		validateSearch: Route.options.validateSearch,
	});
	rootRoute.addChildren([pageRoute]);
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	});
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<MantineProvider theme={theme} env="test">
				<RouterProvider router={router} />
			</MantineProvider>
		</QueryClientProvider>,
	);
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 24));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("BudgetYearPage", () => {
	it("sums the year so far against what was expected", async () => {
		setup([groceries]);
		await renderPage("/budgets/b1?year=2026");

		expect(
			await screen.findByRole("heading", { name: "Courses" }),
		).toBeInTheDocument();
		const real = within(
			screen.getByRole("region", { name: "Dépensé en 2026" }),
		);
		expect(real.getByText(amount(4527))).toBeInTheDocument();
		expect(real.getByText(`+${amount(27)}`)).toBeInTheDocument();
		expect(
			apiFetchMock.mock.calls.some(
				([path]) =>
					path ===
					"/summary/budgets?fromYear=2026&fromMonth=1&toYear=2026&toMonth=12",
			),
		).toBe(true);
	});

	it("gives the month stats and the year-end projection", async () => {
		setup([groceries]);
		await renderPage("/budgets/b1?year=2026");

		const months = within(
			await screen.findByRole("region", { name: "Mois par mois" }),
		);
		expect(months.getByText("Pic · août")).toBeInTheDocument();
		expect(months.getByText(amount(538))).toBeInTheDocument();
		expect(months.getByText("5 / 9")).toBeInTheDocument();

		const cumulative = within(
			screen.getByRole("region", { name: "Cumul sur l'année" }),
		);
		expect(
			cumulative.getByText(
				`À ce rythme, ≈ ${amount(5558)} fin décembre : ${amount(158)} au-dessus du budget annuel.`,
			),
		).toBeInTheDocument();
	});

	it("lists the budget's periods, the current one first", async () => {
		setup([groceries]);
		await renderPage("/budgets/b1?year=2026");

		const periods = within(
			await screen.findByRole("region", { name: "Périodes" }),
		);
		expect(periods.getByText("Depuis janvier 2025")).toBeInTheDocument();
		expect(
			periods.getByText("janvier 2024 → décembre 2024"),
		).toBeInTheDocument();
		expect(periods.getByText(`${amount(400)} / mois`)).toBeInTheDocument();
	});

	it("links back to the budgets of the same year", async () => {
		setup([groceries]);
		await renderPage("/budgets/b1?year=2026");

		expect(
			await screen.findByRole("link", { name: "Retour aux budgets" }),
		).toHaveAttribute("href", "/budgets?period=year&year=2026");
	});

	it("says when the budget does not exist", async () => {
		setup([]);
		await renderPage("/budgets/unknown");

		expect(
			await screen.findByText("Ce budget n'existe pas."),
		).toBeInTheDocument();
	});
});
