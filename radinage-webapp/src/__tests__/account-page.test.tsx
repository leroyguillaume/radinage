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
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type {
	AccountResponse,
	BalancePoint,
	BalanceReading,
	BudgetResponse,
} from "@/lib/types";
import { theme } from "@/theme";

vi.mock("@/lib/api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
	apiFetch: vi.fn(),
}));

const { apiFetch, ApiError } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

/** Text as Testing Library normalises it, narrow no-break spaces included. */
const normalised = (text: string) => text.replace(/\s/g, " ");

const today = dayjs().format("YYYY-MM-DD");
const lastRead = dayjs().subtract(20, "day").format("YYYY-MM-DD");
const movedOn = dayjs().subtract(10, "day").format("YYYY-MM-DD");

const pea: AccountResponse = {
	id: "pea",
	name: "PEA",
	kind: "savings",
	imported: false,
	receivesOperations: false,
	balance: { id: "r3", amount: "8742.30", date: lastRead },
	currentBalance: "8942.30",
	createdAt: "2026-01-01T10:00:00Z",
};

const monthly: BudgetResponse = {
	id: "b1",
	label: "PEA mensuel",
	budgetType: "savings",
	kind: { type: "occasional", month: 1, year: 2026, amount: "-200" },
	rules: [],
	categoryId: null,
	accountId: "pea",
	createdAt: "2026-01-01T10:00:00Z",
};

const readings: BalanceReading[] = [
	{ id: "r3", amount: "8742.30", date: lastRead, estimated: "9555.10" },
	{ id: "r2", amount: "8955.10", date: "2026-06-30", estimated: "8840.00" },
	{ id: "r1", amount: "8240.00", date: "2026-03-31", estimated: null },
];

const history: BalancePoint[] = [
	{ date: "2026-03-31", balance: "8240.00", read: true, estimated: null },
	{ date: "2026-06-30", balance: "8955.10", read: true, estimated: "8840.00" },
	{ date: lastRead, balance: "8742.30", read: true, estimated: "9555.10" },
	{ date: movedOn, balance: "8942.30", read: false, estimated: null },
	{ date: today, balance: "8942.30", read: false, estimated: null },
];

function mockApi(
	onWrite: (path: string, init: RequestInit) => Promise<unknown> = () =>
		Promise.resolve({ id: "new", amount: "0", date: today }),
) {
	apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
		if (init?.method) return onWrite(path, init);
		if (path === "/accounts") return Promise.resolve([pea]);
		if (path.startsWith("/budgets")) return Promise.resolve([monthly]);
		if (path === "/accounts/pea/balances") return Promise.resolve(readings);
		if (path.startsWith("/accounts/pea/balance-history")) {
			return Promise.resolve(history);
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

function writes() {
	return apiFetchMock.mock.calls
		.filter(([, init]) => init?.method)
		.map(([path, init]) => ({
			path,
			method: init?.method,
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
		}));
}

async function renderPage(accountId = "pea") {
	const { Route } = await import("@/routes/accounts.$accountId");
	const rootRoute = createRootRoute({ component: Outlet });
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/accounts/$accountId",
		component: Route.options.component,
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([pageRoute, settingsRoute]),
		history: createMemoryHistory({
			initialEntries: [`/accounts/${accountId}`],
		}),
	});
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("account page", () => {
	it("shows the estimated balance and how each balance read differed from its estimate", async () => {
		mockApi();
		await renderPage();

		expect(
			await screen.findByText(
				/Le solde est estimé avec les versements de PEA mensuel/,
			),
		).toBeInTheDocument();
		// In the header, and on today's line of the history.
		expect(
			screen.getAllByText(
				(_, el) =>
					el?.tagName === "P" &&
					normalised(el.textContent ?? "") === "≈ 8 942,30 €",
			),
		).toHaveLength(2);
		const history = (await screen.findByText("Historique des soldes")).closest(
			"div",
		);
		if (!(history instanceof HTMLElement)) throw new Error("no history");
		expect(within(history).getByText("Aujourd'hui")).toBeInTheDocument();
		expect(
			within(history).getByText(normalised("-812,80 €")),
		).toBeInTheDocument();
		expect(
			within(history).getByText(normalised("+115,10 €")),
		).toBeInTheDocument();
		expect(within(history).getByText("Premier relevé")).toBeInTheDocument();
		expect(
			within(history).getByText(normalised("Estimation : 9 555,10 €")),
		).toBeInTheDocument();
	});

	it("records a new balance against today's estimate", async () => {
		mockApi();
		await renderPage();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Relever un solde" }),
		);
		const dialog = await screen.findByRole("dialog");
		await user.type(within(dialog).getByLabelText("Solde"), "8830");

		expect(
			await within(dialog).findByText(normalised("8 942,30 €")),
		).toBeInTheDocument();
		expect(
			within(dialog).getByText(normalised("-112,30 €")),
		).toBeInTheDocument();
		expect(
			within(dialog).getByText(/Ce solde remplace l'estimation/),
		).toBeInTheDocument();
		await user.click(
			within(dialog).getByRole("button", { name: "Enregistrer" }),
		);

		await waitFor(() => {
			expect(writes()).toEqual([
				{
					path: "/accounts/pea/balances",
					method: "POST",
					body: { amount: "8830.00", date: today },
				},
			]);
		});
	});

	it("explains that a balance is already recorded on that date", async () => {
		mockApi(() => Promise.reject(new ApiError(409, "Conflict")));
		await renderPage();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Relever un solde" }),
		);
		const dialog = await screen.findByRole("dialog");
		await user.type(within(dialog).getByLabelText("Solde"), "10");
		await user.click(
			within(dialog).getByRole("button", { name: "Enregistrer" }),
		);

		expect(
			await within(dialog).findByText("Un solde est déjà relevé à cette date."),
		).toBeInTheDocument();
	});

	it("corrects a balance in place and deletes one after confirming", async () => {
		mockApi((_path, init) =>
			Promise.resolve(
				init.method === "PUT"
					? { id: "r2", amount: "8960.00", date: "2026-06-30" }
					: undefined,
			),
		);
		await renderPage();
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", {
				name: "Corriger le solde du 30/06/2026",
			}),
		);
		const dialog = await screen.findByRole("dialog");
		const amount = within(dialog).getByLabelText("Solde");
		await user.clear(amount);
		await user.type(amount, "8960");
		await user.click(
			within(dialog).getByRole("button", { name: "Enregistrer" }),
		);
		await waitFor(() => expect(writes()).toHaveLength(1));

		await user.click(
			screen.getByRole("button", { name: "Supprimer le solde du 31/03/2026" }),
		);
		await user.click(screen.getByRole("button", { name: "Supprimer" }));

		await waitFor(() => {
			expect(writes()).toEqual([
				{
					path: "/accounts/pea/balances/r2",
					method: "PUT",
					body: { amount: "8960.00", date: "2026-06-30" },
				},
				{
					path: "/accounts/pea/balances/r1",
					method: "DELETE",
					body: undefined,
				},
			]);
		});
	});

	it("says when the account does not exist", async () => {
		mockApi();
		await renderPage("nope");

		expect(
			await screen.findByText("Ce compte n'existe pas."),
		).toBeInTheDocument();
	});
});
