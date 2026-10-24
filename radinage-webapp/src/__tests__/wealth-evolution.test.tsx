import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WealthEvolution } from "@/components/WealthEvolution";
import { i18n } from "@/i18n";
import type {
	AccountResponse,
	BalancePoint,
	BudgetResponse,
} from "@/lib/types";
import { theme } from "@/theme";

vi.mock("@/lib/api", () => ({
	ApiError: class ApiError extends Error {},
	apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

const normalised = (text: string) => text.replace(/\s/g, " ");

const account = (
	id: string,
	name: string,
	kind: AccountResponse["kind"],
): AccountResponse => ({
	id,
	name,
	kind,
	imported: kind === "checking",
	receivesOperations: kind === "checking",
	balance: { id: `b-${id}`, amount: "0", date: "2026-01-01" },
	currentBalance: "0",
	transferredInto: false,
	createdAt: "2026-01-01T10:00:00Z",
});

const joint = account("joint", "Compte joint", "checking");
const livret = account("livret", "Livret A", "savings");
const never: AccountResponse = {
	...account("never", "Jamais relevé", "savings"),
	balance: null,
	currentBalance: null,
	transferredInto: false,
};

const toLivret: BudgetResponse = {
	id: "b1",
	label: "Épargne Livret A",
	budgetType: "savings",
	kind: { type: "occasional", month: 1, year: 2026, amount: "-300" },
	rules: [],
	categoryId: null,
	accountId: "livret",
	createdAt: "2026-01-01T10:00:00Z",
};

const thisMonth = dayjs().startOf("month");
const lastMonth = thisMonth.subtract(1, "month");
const day = (month: dayjs.Dayjs, d: number) =>
	month.date(d).format("YYYY-MM-DD");

const histories: Record<string, BalancePoint[]> = {
	joint: [
		{
			date: day(lastMonth, 1),
			balance: "1820.00",
			read: true,
			estimated: null,
		},
		{
			date: day(thisMonth, 1),
			balance: "2314.56",
			read: false,
			estimated: null,
		},
	],
	livret: [
		{
			date: day(lastMonth, 5),
			balance: "12582.35",
			read: true,
			estimated: null,
		},
		{
			date: day(thisMonth, 1),
			balance: "12882.35",
			read: false,
			estimated: null,
		},
	],
};

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
	apiFetchMock.mockImplementation((path: string) => {
		if (path === "/accounts") return Promise.resolve([joint, livret, never]);
		if (path.startsWith("/budgets")) return Promise.resolve([toLivret]);
		const id = path.match(/^\/accounts\/([^/]+)\/balance-history/)?.[1];
		if (id !== undefined) return Promise.resolve(histories[id] ?? []);
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function renderChart() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<WealthEvolution
					fromYear={lastMonth.year()}
					fromMonth={lastMonth.month() + 1}
					toYear={thisMonth.year()}
					toMonth={thisMonth.month() + 1}
				/>
			</MantineProvider>
		</QueryClientProvider>,
	);
}

describe("WealthEvolution", () => {
	it("sums the accounts with a balance, savings ones estimated", async () => {
		renderChart();

		expect(
			await screen.findByText(normalised("≈ 15 196,91 €")),
		).toBeInTheDocument();
		expect(
			screen.getByText(new RegExp(normalised("\\+794,56 € depuis"))),
		).toBeInTheDocument();
		const table = screen.getByRole("table");
		expect(within(table).getByText("Livret A")).toBeInTheDocument();
		expect(
			within(table).getByText(normalised("12 882,35 €")),
		).toBeInTheDocument();
		expect(screen.queryByText("Jamais relevé")).not.toBeInTheDocument();
		expect(
			screen.getByText(/sans les intérêts ni les variations boursières/),
		).toBeInTheDocument();
	});

	it("leaves out the accounts unticked", async () => {
		renderChart();
		const user = userEvent.setup();

		await user.click(await screen.findByRole("checkbox", { name: "Livret A" }));

		expect(
			await screen.findByText(normalised("2 314,56 €"), { selector: "p" }),
		).toBeInTheDocument();
		expect(
			within(screen.getByRole("table")).queryByText("Livret A"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(/sans les intérêts ni les variations boursières/),
		).not.toBeInTheDocument();
	});
});
