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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type {
	ForecastMonthStatus,
	ForecastResponse,
	YearMonth,
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

interface MonthFlows {
	income: number;
	expenses: number;
	savings: number;
	committed?: number;
	unbudgetedForecast?: number;
}

function money(amount: number): string {
	return amount.toFixed(2);
}

function statusOf(year: number, month: number): ForecastMonthStatus {
	const now = new Date();
	const current = now.getFullYear() * 12 + now.getMonth() + 1;
	const target = year * 12 + month;
	if (target < current) return "past";
	return target === current ? "current" : "future";
}

type ForecastExtras = Partial<
	Pick<
		ForecastResponse,
		"unbudgetedRate" | "daysLeft" | "dailyBudget" | "startingBalance"
	>
>;

/** A forecast of `count` months from `from`, statuses relative to today like the server's. */
function makeForecastFrom(
	from: YearMonth,
	count: number,
	flowsOf: (month: number) => MonthFlows,
	extras: ForecastExtras = {},
): ForecastResponse {
	const startingBalance = extras.startingBalance ?? null;
	let cumulative = Number(startingBalance ?? 0);
	let firstNegativeMonth: ForecastResponse["firstNegativeMonth"] = null;
	const totals = { income: 0, expenses: 0, savings: 0 };
	const months = Array.from({ length: count }, (_, i) => {
		const index = from.year * 12 + from.month - 1 + i;
		const year = Math.floor(index / 12);
		const month = (index % 12) + 1;
		const {
			income,
			expenses,
			savings,
			committed = 0,
			unbudgetedForecast = 0,
		} = flowsOf(month);
		const balance = income + expenses + savings;
		cumulative += balance;
		if (cumulative < 0 && firstNegativeMonth === null) {
			firstNegativeMonth = { year, month };
		}
		totals.income += income;
		totals.expenses += expenses;
		totals.savings += savings;
		return {
			year,
			month,
			status: statusOf(year, month),
			income: money(income),
			expenses: money(expenses),
			savings: money(savings),
			balance: money(balance),
			committed: money(committed),
			unbudgetedForecast: money(unbudgetedForecast),
			cumulative: money(cumulative),
		};
	});
	return {
		months,
		totals: {
			income: money(totals.income),
			expenses: money(totals.expenses),
			savings: money(totals.savings),
			balance: money(totals.income + totals.expenses + totals.savings),
		},
		startingBalance,
		endBalance: money(cumulative),
		unbudgetedRate: "0.0000",
		daysLeft: 100,
		dailyBudget: "12.34",
		firstNegativeMonth,
		...extras,
	};
}

function makeForecast(
	year: number,
	flowsOf: (month: number) => MonthFlows,
	extras: ForecastExtras = {},
): ForecastResponse {
	return makeForecastFrom({ year, month: 1 }, 12, flowsOf, extras);
}

const typicalMonth = (): MonthFlows => ({
	income: 2500,
	expenses: -900,
	savings: -300,
});

function setupMocks(
	forecastOf: (year: number, month: number, count: number) => ForecastResponse,
) {
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
		const match =
			/^\/forecast\?fromYear=(\d+)&fromMonth=(\d+)&months=(\d+)$/.exec(path);
		if (match) {
			return Promise.resolve(
				forecastOf(Number(match[1]), Number(match[2]), Number(match[3])),
			);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

const typicalForecast = (year: number, month: number, count: number) =>
	makeForecastFrom({ year, month }, count, typicalMonth);

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
			<MantineProvider theme={theme} env="test">
				<RouterProvider router={router} />
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { queryClient, router };
}

beforeEach(() => {
	i18n.changeLanguage("fr");
	setupMocks(typicalForecast);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function compact(element: HTMLElement): string {
	return (element.textContent ?? "").replace(/\s/g, "");
}

describe("SummaryPage period mode", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 9, 15));
	});

	it("keeps old ?year= links on the calendar year", async () => {
		await renderSummaryPage("?year=2025");

		expect(
			await screen.findByRole("radio", { name: "Année 2025" }),
		).toBeChecked();
		expect(
			screen.getByRole("radio", { name: "12 prochains mois" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("button", { name: "Année suivante" }),
		).toBeInTheDocument();
		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/forecast?fromYear=2025&fromMonth=1&months=12",
			);
		});
		const rows = within(await screen.findByRole("table")).getAllByRole("row");
		expect(rows[1]?.textContent).toMatch(/janvier/i);
		expect(rows[1]?.textContent).not.toMatch(/2025/);
	});

	it("switches to the next 12 months and back through the URL", async () => {
		const user = userEvent.setup();
		const { router } = await renderSummaryPage("?year=2025");
		await screen.findByRole("table");

		await user.click(screen.getByRole("radio", { name: "12 prochains mois" }));

		await waitFor(() => {
			expect(router.state.location.search).toEqual({
				year: 2025,
				mode: "rolling",
			});
		});
		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/forecast?fromYear=2026&fromMonth=10&months=12",
			);
		});
		expect(
			screen.queryByRole("button", { name: "Année suivante" }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("radio", { name: "Année 2025" }));

		await waitFor(() => {
			expect(router.state.location.search).toEqual({ year: 2025 });
		});
		expect(
			await screen.findByRole("button", { name: "Année suivante" }),
		).toBeInTheDocument();
	});

	it("labels months with their year across January", async () => {
		await renderSummaryPage("?mode=rolling");

		const table = await screen.findByRole("table");
		const rows = within(table).getAllByRole("row");
		expect(rows).toHaveLength(13);
		expect(rows[1]?.textContent).toMatch(/octobre 2026/i);
		expect(rows[4]?.textContent).toMatch(/janvier 2027/i);
		expect(rows[12]?.textContent).toMatch(/septembre 2027/i);

		const chart = screen.getByRole("heading", {
			name: "Balance mois par mois",
		});
		const section = chart.closest("section") as HTMLElement;
		expect(within(section).getAllByText("2026")).toHaveLength(3);
		expect(within(section).getAllByText("2027")).toHaveLength(9);
	});

	it("titles the cards after the rolling period", async () => {
		await renderSummaryPage("?mode=rolling");

		const card = await screen.findByRole("region", {
			name: "Balance au 30 septembre 2027",
		});
		expect(compact(card)).toMatch(/àlafindelapériode/);
		expect(
			screen.getByRole("region", { name: "Totaux sur 12 mois" }),
		).toBeInTheDocument();
		expect(screen.getByText(/Progression de la période/)).toBeInTheDocument();
		expect(screen.queryByText("Balance fin d'année")).not.toBeInTheDocument();
	});

	it("shows the projected balance at the end of the rolling period", async () => {
		setupMocks((year, month, count) =>
			makeForecastFrom({ year, month }, count, typicalMonth, {
				startingBalance: "1000.00",
			}),
		);

		await renderSummaryPage("?mode=rolling");

		const card = await screen.findByRole("region", {
			name: "Solde prévu au 30 septembre 2027",
		});
		expect(compact(card)).toMatch(/Soldeau1octobre2026:1000,00/);
	});

	it("titles the rolling period in English too", async () => {
		await i18n.changeLanguage("en");

		await renderSummaryPage("?mode=rolling");

		expect(
			await screen.findByRole("region", {
				name: "Balance on September 30, 2027",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("region", { name: "12-month totals" }),
		).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "Next 12 months" })).toBeChecked();
	});
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

	it("marks forecast months with a pill and the current month as in progress", async () => {
		const year = new Date().getFullYear();
		const currentMonth = new Date().getMonth() + 1;
		await renderSummaryPage(`?year=${year}`);

		await waitFor(() => {
			expect(screen.getByText("Budget / jour")).toBeInTheDocument();
		});

		const table = screen.getByRole("table");
		expect(within(table).queryAllByText("Prévision")).toHaveLength(
			12 - currentMonth,
		);
		expect(within(table).getAllByText("En cours")).toHaveLength(1);
		expect(within(table).queryByText(/\(prév\.\)/)).not.toBeInTheDocument();
	});

	it("renders the month-by-month balance chart with its legend", async () => {
		await renderSummaryPage(`?year=${new Date().getFullYear()}`);

		const chart = await screen.findByRole("heading", {
			name: "Balance mois par mois",
		});
		const section = chart.closest("section");
		expect(section).not.toBeNull();
		const scope = within(section as HTMLElement);
		expect(scope.getByText("Excédent")).toBeInTheDocument();
		expect(scope.getByText("Déficit")).toBeInTheDocument();
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

	it("requests the forecast of January to December of the selected year", async () => {
		await renderSummaryPage("?year=2025");

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/forecast?fromYear=2025&fromMonth=1&months=12",
			);
		});
	});

	it("navigates year with arrow buttons", async () => {
		const user = userEvent.setup();
		await renderSummaryPage("?year=2026");

		await waitFor(() => {
			expect(screen.getByText("2026")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Année suivante" }));
		await waitFor(() => {
			expect(screen.getByText("2027")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Année précédente" }));
		await user.click(screen.getByRole("button", { name: "Année précédente" }));
		await waitFor(() => {
			expect(screen.getByText("2025")).toBeInTheDocument();
		});
	});

	it("shows remaining days count", async () => {
		await renderSummaryPage();

		await waitFor(() => {
			expect(screen.getByText(/\d+ jours? restants?/)).toBeInTheDocument();
		});
	});

	it("shows the server's monthly flows, totals and end-of-year balance", async () => {
		setupMocks((year) =>
			makeForecast(year, (month) =>
				month === 1
					? { income: 1234, expenses: -567, savings: 0 }
					: { income: 0, expenses: 0, savings: 0 },
			),
		);

		await renderSummaryPage("?year=2025");

		const card = await screen.findByRole("region", {
			name: "Balance fin d'année",
		});
		expect((card.textContent ?? "").replace(/\s/g, "")).toMatch(/\+667,00/);
		const totals = screen.getByRole("region", { name: /Totaux/ });
		const totalsText = (totals.textContent ?? "").replace(/\s/g, "");
		expect(totalsText).toMatch(/1234,00/);
		expect(totalsText).toMatch(/-567,00/);
		const january = within(screen.getByRole("table")).getAllByRole("row")[1];
		expect(january).toBeDefined();
		const januaryText = (january?.textContent ?? "").replace(/\s/g, "");
		expect(januaryText).toMatch(/1234,00/);
		expect(januaryText).toMatch(/-567,00/);
	});

	it("shows the projected balance at the end of the horizon from the recorded balance", async () => {
		setupMocks((year) =>
			makeForecast(
				year,
				(month) =>
					month === 1
						? { income: 1234, expenses: -567, savings: 0 }
						: { income: 0, expenses: 0, savings: 0 },
				{ startingBalance: "1000.00" },
			),
		);

		await renderSummaryPage("?year=2025");

		const card = await screen.findByRole("region", {
			name: "Solde prévu au 31 décembre 2025",
		});
		const text = (card.textContent ?? "").replace(/\s/g, "");
		expect(text).toMatch(/\+1667,00/);
		expect(text).toMatch(/Soldeau1janvier2025:1000,00/);
		expect(screen.queryByText("Balance fin d'année")).not.toBeInTheDocument();
	});

	it("shows the projected balance title in English too", async () => {
		await i18n.changeLanguage("en");
		setupMocks((year) =>
			makeForecast(year, typicalMonth, { startingBalance: "-50.00" }),
		);

		await renderSummaryPage("?year=2025");

		expect(
			await screen.findByRole("region", {
				name: "Projected balance on December 31, 2025",
			}),
		).toBeInTheDocument();
	});

	it("shows what the budgets still expect in the current month's row", async () => {
		const year = new Date().getFullYear();
		const currentMonth = new Date().getMonth() + 1;
		setupMocks((y) =>
			makeForecast(y, (month) =>
				month === currentMonth
					? { income: 2500, expenses: -900, savings: 0, committed: -220 }
					: { income: 0, expenses: 0, savings: 0 },
			),
		);

		await renderSummaryPage(`?year=${year}`);

		const table = await screen.findByRole("table");
		const notes = within(table).getAllByText(/dont .* à venir/);
		expect(notes).toHaveLength(1);
		expect((notes[0]?.textContent ?? "").replace(/\s/g, "")).toMatch(
			/dont-220,00€àvenir/,
		);
		const currentRow = within(table)
			.getAllByRole("row")
			.find((row) => row.getAttribute("aria-current") === "date");
		expect(currentRow).toBeDefined();
		expect(currentRow?.contains(notes[0] ?? null)).toBe(true);
	});

	it("shows no still-to-come note when nothing is committed", async () => {
		await renderSummaryPage(`?year=${new Date().getFullYear()}`);

		const table = await screen.findByRole("table");
		expect(within(table).queryByText(/à venir/)).not.toBeInTheDocument();
	});

	it("shows the unbudgeted spending forecast in the table and the totals", async () => {
		const year = new Date().getFullYear() + 1;
		setupMocks((y) =>
			makeForecast(
				y,
				(month) => ({
					income: 2500,
					expenses: -1200,
					savings: 0,
					unbudgetedForecast: month === 2 ? -280 : -300,
				}),
				{ unbudgetedRate: "-10.0000" },
			),
		);

		await renderSummaryPage(`?year=${year}`);

		const table = await screen.findByRole("table");
		const notes = within(table).getAllByText(/hors budget estimés/);
		expect(notes).toHaveLength(12);
		expect((notes[1]?.textContent ?? "").replace(/\s/g, "")).toMatch(
			/dont-280,00€horsbudgetestimés/,
		);
		const totals = screen.getByRole("region", { name: /Totaux/ });
		expect((totals.textContent ?? "").replace(/\s/g, "")).toMatch(
			/estiméesà10,00€parjour/,
		);
	});

	it("says nothing about unbudgeted spending for a past year", async () => {
		setupMocks((y) =>
			makeForecast(y, typicalMonth, { unbudgetedRate: "-10.0000" }),
		);

		await renderSummaryPage("?year=2025");

		const table = await screen.findByRole("table");
		expect(within(table).queryByText(/hors budget/)).not.toBeInTheDocument();
		const totals = screen.getByRole("region", { name: /Totaux/ });
		expect(totals.textContent ?? "").not.toMatch(/par jour/);
	});

	it("shows the server's daily budget and days left with what they mean", async () => {
		setupMocks((year) =>
			makeForecast(year, typicalMonth, { daysLeft: 42, dailyBudget: "35.16" }),
		);

		await renderSummaryPage();

		const card = await screen.findByRole("region", { name: "Budget / jour" });
		const text = (card.textContent ?? "").replace(/\s/g, "");
		expect(text).toMatch(/35,16/);
		expect(within(card).getByText("42 jours restants")).toBeInTheDocument();
		expect(
			within(card).getByText(
				/hors budgets sans finir la période dans le rouge/,
			),
		).toBeInTheDocument();
	});

	it("shows a negative daily budget as such and explains it", async () => {
		setupMocks((year) =>
			makeForecast(year, typicalMonth, { dailyBudget: "-9.50" }),
		);

		await renderSummaryPage();

		const card = await screen.findByRole("region", { name: "Budget / jour" });
		expect((card.textContent ?? "").replace(/\s/g, "")).toMatch(/-9,50/);
		expect(
			within(card).getByText(/tes budgets seuls finissent déjà/),
		).toBeInTheDocument();
	});

	it("shows no daily budget once the period is over", async () => {
		setupMocks((year) =>
			makeForecast(year, typicalMonth, { daysLeft: 0, dailyBudget: null }),
		);

		await renderSummaryPage("?year=2025");

		const card = await screen.findByRole("region", { name: "Budget / jour" });
		expect(within(card).getByText("—")).toBeInTheDocument();
		expect(within(card).getByText(/Période terminée/)).toBeInTheDocument();
		expect(within(card).getByText("0 jour restant")).toBeInTheDocument();
	});

	it("warns about the first month in the red and highlights it", async () => {
		setupMocks((year) =>
			makeForecast(year, (month) =>
				month < 3
					? { income: 100, expenses: 0, savings: 0 }
					: { income: 0, expenses: -250, savings: 0 },
			),
		);

		await renderSummaryPage("?year=2027");

		expect(
			await screen.findByText("Solde négatif à partir de mars 2027"),
		).toBeInTheDocument();

		const table = screen.getByRole("table");
		const marked = within(table)
			.getAllByRole("row")
			.filter((row) => within(row).queryByText("Passage dans le rouge"));
		expect(marked).toHaveLength(1);
		expect(marked[0]?.textContent).toMatch(/mars/i);

		const chart = screen.getByRole("heading", {
			name: "Balance mois par mois",
		});
		const section = chart.closest("section") as HTMLElement;
		const markers = within(section).getAllByRole("img", {
			name: "Passage dans le rouge",
		});
		expect(markers).toHaveLength(1);
		expect(markers[0]?.parentElement?.textContent).toMatch(/mars/i);
	});

	it("shows no red warning when the balance stays positive", async () => {
		await renderSummaryPage();

		await screen.findByRole("table");
		expect(screen.queryByText(/Solde négatif/)).not.toBeInTheDocument();
		expect(screen.queryByText("Passage dans le rouge")).not.toBeInTheDocument();
	});

	it("displays full year as actual for past years", async () => {
		await renderSummaryPage("?year=2025");

		const table = await screen.findByRole("table");
		expect(within(table).queryAllByText("Prévision")).toHaveLength(0);
		expect(within(table).queryByText("En cours")).not.toBeInTheDocument();
	});
});
