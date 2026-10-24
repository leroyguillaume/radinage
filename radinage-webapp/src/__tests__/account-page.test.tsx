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
	OperationSearchResponse,
	TransferRuleResponse,
} from "@/lib/types";
import { theme } from "@/theme";
import { selectMantineOption } from "./mantine";

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
	transferredInto: false,
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

describe("transfers", () => {
	const bnp: AccountResponse = {
		id: "bnp",
		name: "Courant BNP",
		kind: "checking",
		imported: true,
		receivesOperations: true,
		balance: { id: "b0", amount: "1840.10", date: lastRead },
		currentBalance: "1540.10",
		transferredInto: false,
		createdAt: "2026-01-01T10:00:00Z",
	};
	const livret: AccountResponse = {
		id: "livret",
		name: "Livret A",
		kind: "savings",
		imported: false,
		receivesOperations: false,
		balance: { id: "l0", amount: "11520.00", date: lastRead },
		currentBalance: "11820.00",
		transferredInto: true,
		createdAt: "2026-01-01T10:00:00Z",
	};
	const joint: AccountResponse = {
		...bnp,
		id: "joint",
		name: "Compte joint",
		balance: null,
		currentBalance: null,
	};
	const rule: TransferRuleResponse = {
		id: "rule1",
		accountId: "bnp",
		counterpartAccountId: "livret",
		labelPattern: { type: "contains", value: "VIR INTERNE VERS LIVRET A" },
		counterpartLabelPattern: null,
		createdAt: "2026-01-01T10:00:00Z",
	};
	const transfers: OperationSearchResponse = {
		data: [
			{
				id: "t1",
				accountId: "bnp",
				amount: "-300.00",
				date: movedOn,
				effectiveDate: null,
				label: "VIR INTERNE VERS LIVRET A",
				budgetLink: { type: "unlinked" },
				ignored: false,
				ignoreRuleId: null,
				transfer: { accountId: "livret", ruleId: "rule1", operationId: null },
				categoryId: null,
				effectiveCategoryId: null,
				splits: [],
			},
		],
		total: 1,
		page: 1,
		pageSize: 5,
		maxPage: 1,
		totals: {
			income: "0",
			expense: "-300.00",
			firstDate: movedOn,
			lastDate: movedOn,
		},
	};

	function mockTransfers(
		onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(rule),
	) {
		apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
			if (init?.method) return onWrite(path);
			if (path === "/accounts") return Promise.resolve([bnp, livret, joint]);
			if (path.startsWith("/budgets")) return Promise.resolve([]);
			if (path === "/transfer-rules") return Promise.resolve([rule]);
			if (path.startsWith("/operations?transferAccountId=livret")) {
				return Promise.resolve(transfers);
			}
			if (path.startsWith("/operations?transferAccountId=")) {
				return Promise.resolve({ ...transfers, data: [], total: 0 });
			}
			if (path.endsWith("/balances")) return Promise.resolve([]);
			if (path.includes("/balance-history")) return Promise.resolve([]);
			return Promise.reject(new Error(`Unexpected path: ${path}`));
		});
	}

	it("estimates a savings account fed by transfers and lists them", async () => {
		mockTransfers();
		await renderPage("livret");

		expect(
			await screen.findByText(/Alimenté par Courant BNP \(virements\)/),
		).toBeInTheDocument();
		const list = await screen.findByRole("heading", { name: "Virements" });
		const card = within(list.closest(".mantine-Paper-root") as HTMLElement);
		expect(card.getByText("1 virement au total")).toBeInTheDocument();
		expect(card.getByText(/depuis Courant BNP/)).toBeInTheDocument();
		expect(normalised(card.getByText(/300,00/).textContent ?? "")).toBe(
			"+300,00 €",
		);
		const rules = screen.getByRole("heading", { name: "Règles de virement" });
		const rulesCard = within(
			rules.closest(".mantine-Paper-root") as HTMLElement,
		);
		expect(rulesCard.getByText("Courant BNP")).toBeInTheDocument();
		expect(
			rulesCard.getByText("Contient « VIR INTERNE VERS LIVRET A »"),
		).toBeInTheDocument();
		expect(
			rulesCard.queryByRole("button", { name: "Ajouter une règle" }),
		).not.toBeInTheDocument();
	});

	it("manages the rules of an account receiving operations", async () => {
		mockTransfers();
		await renderPage("bnp");
		const user = userEvent.setup();

		expect(
			await screen.findByText("Contient « VIR INTERNE VERS LIVRET A »"),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Ajouter une règle" }));
		await user.type(screen.getByRole("textbox", { name: /Valeur/ }), "PEL");
		await selectMantineOption("Autre compte", "Livret A");
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));

		await waitFor(() =>
			expect(writes()).toContainEqual({
				path: "/transfer-rules",
				method: "POST",
				body: {
					accountId: "bnp",
					counterpartAccountId: "livret",
					labelPattern: { type: "contains", value: "PEL" },
					counterpartLabelPattern: null,
				},
			}),
		);
		expect(
			await screen.findByText(
				/marquer comme virements les opérations existantes/,
			),
		).toBeInTheDocument();
	});

	it("asks how the other side is labelled when both accounts are imported", async () => {
		mockTransfers();
		await renderPage("bnp");
		const user = userEvent.setup();

		await user.click(
			await screen.findByRole("button", { name: "Ajouter une règle" }),
		);
		await selectMantineOption("Autre compte", "Compte joint");
		expect(screen.getByText("Libellé sur Compte joint")).toBeInTheDocument();
		const [own, other] = screen.getAllByRole("textbox", { name: /Valeur/ });
		if (!own || !other) throw new Error("expected a label on each side");
		await user.type(own, "VIR VERS JOINT");
		await user.type(other, "VIR DE M LEROY");
		await user.click(screen.getByRole("button", { name: "Créer la règle" }));

		await waitFor(() =>
			expect(writes()).toContainEqual({
				path: "/transfer-rules",
				method: "POST",
				body: {
					accountId: "bnp",
					counterpartAccountId: "joint",
					labelPattern: { type: "contains", value: "VIR VERS JOINT" },
					counterpartLabelPattern: {
						type: "contains",
						value: "VIR DE M LEROY",
					},
				},
			}),
		);
	});
});
