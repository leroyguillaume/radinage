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
import type {
	BudgetResponse,
	BudgetType,
	OperationResponse,
	Recurrence,
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

function makeBudget(
	id: string,
	label: string,
	recurrence: Recurrence,
	amount: string,
	budgetType: BudgetType = "expense",
): BudgetResponse {
	return {
		id,
		label,
		budgetType,
		kind: {
			type: "recurring",
			recurrence,
			closedPeriods: [],
			currentPeriod: { start: { year: 2024, month: 1 }, end: null, amount },
		},
		rules: [
			{
				labelPattern: { type: "contains", value: label.toUpperCase() },
				matchAmount: false,
			},
		],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

function makeOccasionalBudget(id: string, label: string): BudgetResponse {
	return {
		id,
		label,
		budgetType: "expense",
		kind: {
			type: "occasional",
			month: 6,
			year: 2024,
			amount: "-500.00",
		},
		rules: [],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

let apiCalls: Array<{
	path: string;
	options?: { method?: string; body?: string };
}> = [];

function makeLinkedOperation(
	id: string,
	budgetId: string,
	amount: string,
): OperationResponse {
	return {
		id,
		amount,
		date: "2024-01-15",
		effectiveDate: null,
		label: `OP ${id}`,
		budgetLink: { type: "auto", budgetId },
		splits: [],
	};
}

function setupBudgetsMock(
	budgets: BudgetResponse[],
	operations: OperationResponse[] = [],
) {
	apiCalls = [];
	apiFetchMock.mockImplementation((path: string, options?: unknown) => {
		const opts = options as { method?: string; body?: string } | undefined;
		apiCalls.push({ path, options: opts });

		if (path.match(/\/budgets\/[^/]+\/apply$/)) {
			return Promise.resolve({ updated: 3, skipped: 1 });
		}
		if (path.match(/^\/budgets\/[^/]+$/) && opts?.method === "DELETE") {
			return Promise.resolve(undefined);
		}
		if (path.startsWith("/budgets")) {
			return Promise.resolve(budgets);
		}
		if (path.startsWith("/operations/monthly/")) {
			return Promise.resolve({ operations });
		}
		return Promise.reject(new Error(`Unexpected path: ${path}`));
	});
}

async function renderBudgetsPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const { Route } = await import("@/routes/budgets");

	const rootRoute = createRootRoute({ component: Outlet });
	const budgetsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/budgets",
		component: Route.options.component,
	});
	rootRoute.addChildren([budgetsRoute]);

	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({
			initialEntries: ["/budgets"],
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
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("BudgetsPage", () => {
	it("renders budget cards with labels", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Loyer", "monthly", "-800.00"),
			makeBudget("b2", "Salaire", "monthly", "2500.00", "income"),
		]);
		await renderBudgetsPage();

		expect(await screen.findByText("Loyer")).toBeInTheDocument();
		expect(screen.getByText("Salaire")).toBeInTheDocument();
	});

	it("displays recurrence for recurring budgets", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Loyer", "monthly", "-800.00"),
			makeBudget("b2", "Courses", "weekly", "-100.00"),
			makeBudget("b3", "Impôts", "quarterly", "-300.00"),
			makeBudget("b4", "Assurance", "yearly", "-1200.00"),
		]);
		await renderBudgetsPage();

		expect(await screen.findByText("Récurrent — Mensuel")).toBeInTheDocument();
		expect(screen.getByText("Récurrent — Hebdomadaire")).toBeInTheDocument();
		expect(screen.getByText("Récurrent — Trimestriel")).toBeInTheDocument();
		expect(screen.getByText("Récurrent — Annuel")).toBeInTheDocument();
	});

	it("displays occasional budget with month/year", async () => {
		setupBudgetsMock([makeOccasionalBudget("b1", "Vacances")]);
		await renderBudgetsPage();

		expect(await screen.findByText("Ponctuel — 6/2024")).toBeInTheDocument();
	});

	it("shows budget type badges", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Loyer", "monthly", "-800.00", "expense"),
			makeBudget("b2", "Salaire", "monthly", "2500.00", "income"),
			makeBudget("b3", "PEL", "monthly", "-500.00", "savings"),
		]);
		await renderBudgetsPage();

		const card = async (name: string) =>
			within(await screen.findByRole("article", { name }));
		expect((await card("Loyer")).getByText("Dépense")).toBeInTheDocument();
		expect((await card("Salaire")).getByText("Revenu")).toBeInTheDocument();
		expect((await card("PEL")).getByText("Épargne")).toBeInTheDocument();
	});

	it("shows rules count when rules exist", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();

		expect(
			await screen.findByText("1 règle(s) de correspondance"),
		).toBeInTheDocument();
	});

	it("shows empty state when no budgets", async () => {
		setupBudgetsMock([]);
		await renderBudgetsPage();

		expect(await screen.findByText("Aucun résultat")).toBeInTheDocument();
	});

	it("renders create button", async () => {
		setupBudgetsMock([]);
		await renderBudgetsPage();

		expect(
			await screen.findByRole("button", { name: /Nouveau budget/ }),
		).toBeInTheDocument();
	});

	it("opens create modal on button click", async () => {
		setupBudgetsMock([]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		const createButton = await screen.findByRole("button", {
			name: /Nouveau budget/,
		});
		await user.click(createButton);

		await waitFor(() => {
			expect(screen.getByText("Créer un budget")).toBeInTheDocument();
		});
	});

	it("opens edit modal on edit button click", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "quarterly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		const editButton = await screen.findByLabelText("Modifier");
		await user.click(editButton);

		await waitFor(() => {
			expect(screen.getByText("Modifier le budget")).toBeInTheDocument();
			expect(screen.getByDisplayValue("Loyer")).toBeInTheDocument();
		});
	});

	it("formats amounts as EUR currency", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();

		// The formatted amount "-800,00 €" should appear in the page
		await waitFor(() => {
			const amounts = screen.getAllByText(/800,00/);
			expect(amounts.length).toBeGreaterThanOrEqual(1);
		});
	});

	it("shows error state on fetch failure", async () => {
		apiFetchMock.mockRejectedValue(new Error("Network error"));
		await renderBudgetsPage();

		expect(
			await screen.findByText("Impossible de charger les budgets"),
		).toBeInTheDocument();
	});

	it("renders search input and filters budgets", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Loyer", "monthly", "-800.00"),
			makeBudget("b2", "Courses", "weekly", "-100.00"),
			makeBudget("b3", "Salaire", "monthly", "2500.00", "income"),
		]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		// All three should be visible
		expect(await screen.findByText("Loyer")).toBeInTheDocument();
		expect(screen.getByText("Courses")).toBeInTheDocument();
		expect(screen.getByText("Salaire")).toBeInTheDocument();

		// Type in the search input
		const searchInput = screen.getByPlaceholderText("Rechercher");
		await user.type(searchInput, "loy");

		// Only Loyer should remain
		await waitFor(() => {
			expect(screen.getByText("Loyer")).toBeInTheDocument();
			expect(screen.queryByText("Courses")).not.toBeInTheDocument();
			expect(screen.queryByText("Salaire")).not.toBeInTheDocument();
		});
	});

	it("sorts budgets by label by default", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Courses", "weekly", "-100.00"),
			makeBudget("b2", "Loyer", "monthly", "-800.00"),
			makeBudget("b3", "Assurance", "quarterly", "-300.00"),
		]);
		await renderBudgetsPage();

		await waitFor(() => {
			const cards = screen.getAllByText(/Assurance|Courses|Loyer/);
			// Should be alphabetical: Assurance, Courses, Loyer
			expect(cards[0].textContent).toBe("Assurance");
			expect(cards[1].textContent).toBe("Courses");
			expect(cards[2].textContent).toBe("Loyer");
		});
	});

	it("sorts budgets by amount when amount sort is selected", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Courses", "weekly", "-100.00"),
			makeBudget("b2", "Loyer", "monthly", "-800.00"),
			makeBudget("b3", "Assurance", "quarterly", "-300.00"),
		]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		await screen.findByText("Courses");

		// Click "Montant" sort button
		await user.click(screen.getByText("Montant"));

		await waitFor(() => {
			const cards = screen.getAllByText(/Assurance|Courses|Loyer/);
			// Sorted by amount ascending: Loyer(-800), Assurance(-300), Courses(-100)
			expect(cards[0].textContent).toBe("Loyer");
			expect(cards[1].textContent).toBe("Assurance");
			expect(cards[2].textContent).toBe("Courses");
		});
	});

	it("shows apply confirmation modal with force option", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		// Click the apply button (play icon)
		const applyButton = await screen.findByLabelText("Appliquer");
		await user.click(applyButton);

		// Should show the force confirmation modal
		await waitFor(() => {
			expect(
				screen.getByText(
					"Voulez-vous aussi remplacer les opérations déjà liées manuellement à un autre budget ?",
				),
			).toBeInTheDocument();
		});

		// Should have the two action buttons
		expect(
			screen.getByRole("button", { name: "Ignorer les manuelles" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Tout remplacer" }),
		).toBeInTheDocument();
	});

	it("apply with skip manual sends force=false", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		const applyButton = await screen.findByLabelText("Appliquer");
		await user.click(applyButton);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Ignorer les manuelles" }),
			).toBeInTheDocument();
		});

		await user.click(
			screen.getByRole("button", { name: "Ignorer les manuelles" }),
		);

		await waitFor(() => {
			const applyCall = apiCalls.find((c) =>
				c.path.match(/\/budgets\/.*\/apply/),
			);
			expect(applyCall).toBeDefined();
			const body = JSON.parse(applyCall?.options?.body ?? "{}");
			expect(body.force).toBe(false);
		});
	});

	it("apply with force sends force=true", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		const applyButton = await screen.findByLabelText("Appliquer");
		await user.click(applyButton);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Tout remplacer" }),
			).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Tout remplacer" }));

		await waitFor(() => {
			const applyCall = apiCalls.find((c) =>
				c.path.match(/\/budgets\/.*\/apply/),
			);
			expect(applyCall).toBeDefined();
			const body = JSON.parse(applyCall?.options?.body ?? "{}");
			expect(body.force).toBe(true);
		});
	});

	it("shows apply result after applying rules", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		const applyButton = await screen.findByLabelText("Appliquer");
		await user.click(applyButton);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Ignorer les manuelles" }),
			).toBeInTheDocument();
		});

		await user.click(
			screen.getByRole("button", { name: "Ignorer les manuelles" }),
		);

		// Should show the result on the card
		await waitFor(() => {
			expect(
				screen.getByText("3 opération(s) liée(s), 1 ignorée(s)"),
			).toBeInTheDocument();
		});
	});

	it("shows a placeholder when no rule is defined", async () => {
		setupBudgetsMock([makeOccasionalBudget("b1", "Vacances")]);
		await renderBudgetsPage();

		expect(
			await screen.findByText("Aucune règle de correspondance"),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("Appliquer")).not.toBeInTheDocument();
	});

	it("filters budgets by type, combined with the search", async () => {
		setupBudgetsMock([
			makeBudget("b1", "Loyer", "monthly", "-800.00"),
			makeBudget("b2", "Salaire", "monthly", "2500.00", "income"),
			makeBudget("b3", "Livret", "monthly", "-200.00", "savings"),
			makeBudget("b4", "Salaire bonus", "yearly", "1000.00", "income"),
		]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		await screen.findByText("Loyer");
		await user.click(screen.getByText("Revenus"));

		await waitFor(() => {
			expect(screen.queryByText("Loyer")).not.toBeInTheDocument();
			expect(screen.queryByText("Livret")).not.toBeInTheDocument();
		});
		expect(screen.getByText("Salaire")).toBeInTheDocument();
		expect(screen.getByText("Salaire bonus")).toBeInTheDocument();

		await user.type(screen.getByPlaceholderText("Rechercher"), "bonus");
		await waitFor(() => {
			expect(screen.queryByText("Salaire")).not.toBeInTheDocument();
		});
		expect(screen.getByText("Salaire bonus")).toBeInTheDocument();

		await user.click(screen.getByText("Tous"));
		await user.clear(screen.getByPlaceholderText("Rechercher"));
		expect(await screen.findByText("Loyer")).toBeInTheDocument();
		expect(screen.getByText("Livret")).toBeInTheDocument();
	});

	it("asks for confirmation before deleting a budget", async () => {
		setupBudgetsMock([makeBudget("b1", "Loyer", "monthly", "-800.00")]);
		await renderBudgetsPage();
		const user = userEvent.setup();

		await user.click(await screen.findByLabelText("Supprimer"));

		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByText("Supprimer ce budget ?"),
		).toBeInTheDocument();
		expect(apiCalls.some((c) => c.options?.method === "DELETE")).toBe(false);

		await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
		expect(apiCalls.some((c) => c.options?.method === "DELETE")).toBe(false);

		await user.click(screen.getByLabelText("Supprimer"));
		const confirmDialog = await screen.findByRole("dialog");
		await user.click(
			within(confirmDialog).getByRole("button", { name: "Supprimer" }),
		);

		await waitFor(() => {
			const deleteCall = apiCalls.find((c) => c.options?.method === "DELETE");
			expect(deleteCall?.path).toBe("/budgets/b1");
		});
	});

	it("shows current-month progress against the budgeted amount", async () => {
		setupBudgetsMock(
			[
				makeBudget("b1", "Loyer", "monthly", "-800.00"),
				makeBudget("b2", "Courses", "monthly", "-100.00"),
				makeBudget("b3", "Salaire", "monthly", "2500.00", "income"),
				makeOccasionalBudget("b4", "Vacances"),
			],
			[
				makeLinkedOperation("o1", "b1", "-400.00"),
				makeLinkedOperation("o2", "b2", "-80.00"),
				makeLinkedOperation("o3", "b2", "-40.00"),
				makeLinkedOperation("o4", "b3", "2500.00"),
			],
		);
		await renderBudgetsPage();

		const loyer = within(await screen.findByRole("article", { name: "Loyer" }));
		expect(
			await loyer.findByText(/400,00\s€ sur 800,00\s€/),
		).toBeInTheDocument();
		expect(loyer.getByText("50 %")).toBeInTheDocument();

		const courses = within(screen.getByRole("article", { name: "Courses" }));
		expect(courses.getByText(/120,00\s€ sur 100,00\s€/)).toBeInTheDocument();
		expect(courses.getByText("Dépassé")).toBeInTheDocument();

		const salaire = within(screen.getByRole("article", { name: "Salaire" }));
		expect(salaire.getByText("Atteint")).toBeInTheDocument();

		const vacances = within(screen.getByRole("article", { name: "Vacances" }));
		expect(vacances.getByText("Pas d'échéance ce mois-ci")).toBeInTheDocument();
	});

	it("counts each part of a split operation in its own budget", async () => {
		setupBudgetsMock(
			[
				makeBudget("b1", "Courses", "monthly", "-100.00"),
				makeBudget("b2", "Loisirs", "monthly", "-200.00"),
			],
			[
				makeLinkedOperation("o1", "b1", "-20.00"),
				{
					id: "o2",
					amount: "-100.00",
					date: "2024-01-20",
					effectiveDate: null,
					label: "RETRAIT DAB",
					budgetLink: { type: "unlinked" },
					splits: [
						{ id: "s1", amount: "-30.00", budgetId: "b1" },
						{ id: "s2", amount: "-50.00", budgetId: "b2" },
						{ id: "s3", amount: "-20.00", budgetId: null },
					],
				},
			],
		);
		await renderBudgetsPage();

		const courses = within(
			await screen.findByRole("article", { name: "Courses" }),
		);
		expect(
			await courses.findByText(/50,00\s€ sur 100,00\s€/),
		).toBeInTheDocument();

		const loisirs = within(screen.getByRole("article", { name: "Loisirs" }));
		expect(loisirs.getByText(/50,00\s€ sur 200,00\s€/)).toBeInTheDocument();
		expect(loisirs.getByText("25 %")).toBeInTheDocument();
	});
});
