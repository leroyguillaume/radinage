import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplitOperationModal } from "@/components/SplitOperationModal";
import { i18n } from "@/i18n";
import type {
	BudgetResponse,
	CategoryResponse,
	OperationResponse,
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
	budgetType: BudgetResponse["budgetType"],
): BudgetResponse {
	return {
		id,
		label,
		budgetType,
		kind: { type: "occasional", month: 4, year: 2026, amount: "-100.00" },
		rules: [],
		categoryId: null,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

const budgets = [
	makeBudget("b1", "Courses", "expense"),
	makeBudget("b2", "Loisirs", "expense"),
	makeBudget("b3", "Salaire", "income"),
];

function makeOperation(
	overrides: Partial<OperationResponse> = {},
): OperationResponse {
	return {
		id: "op1",
		amount: "-100.00",
		date: "2026-04-05",
		effectiveDate: null,
		label: "RETRAIT DAB",
		budgetLink: { type: "unlinked" },
		ignored: false,
		categoryId: null,
		effectiveCategoryId: null,
		splits: [],
		...overrides,
	};
}

function renderModal(
	operation: OperationResponse,
	categories: CategoryResponse[] = [],
) {
	const onClose = vi.fn();
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<SplitOperationModal
					operation={operation}
					budgets={budgets}
					categories={categories}
					onClose={onClose}
				/>
			</MantineProvider>
		</QueryClientProvider>,
	);
	return { onClose, user: userEvent.setup() };
}

const amountInput = (n: number) =>
	screen.getByRole("textbox", { name: `Montant (Part ${n})` });
const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });
const remainder = () => screen.getByRole("status");

function lastCall() {
	const call = apiFetchMock.mock.calls.at(-1);
	if (!call) throw new Error("apiFetch was not called");
	const [path, options] = call;
	return {
		path,
		method: options?.method,
		body: typeof options?.body === "string" ? JSON.parse(options.body) : null,
	};
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
	apiFetchMock.mockResolvedValue(makeOperation());
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("SplitOperationModal", () => {
	it("shows the operation and the whole amount left to allocate", () => {
		renderModal(makeOperation());

		expect(screen.getByText("Diviser l'opération")).toBeInTheDocument();
		expect(screen.getByText("RETRAIT DAB")).toBeInTheDocument();
		expect(screen.getByText("5 avril 2026")).toBeInTheDocument();
		expect(screen.getByText(/-100,00\s€/)).toBeInTheDocument();
		expect(remainder()).toHaveTextContent(/Reste à répartir : 100,00\s€/);
		expect(amountInput(1)).toBeInTheDocument();
		expect(amountInput(2)).toBeInTheDocument();
		expect(saveButton()).toBeDisabled();
	});

	it("updates the remainder live and enables save once balanced", async () => {
		const { user } = renderModal(makeOperation());

		await user.type(amountInput(1), "30");
		expect(remainder()).toHaveTextContent(/70,00\s€/);
		expect(saveButton()).toBeDisabled();

		await user.type(amountInput(2), "80");
		expect(remainder()).toHaveTextContent(/-10,00\s€/);
		expect(saveButton()).toBeDisabled();

		await user.clear(amountInput(2));
		await user.type(amountInput(2), "70");
		expect(remainder()).toHaveTextContent(/Reste à répartir : 0,00\s€/);
		expect(saveButton()).toBeEnabled();
	});

	it("handles decimal amounts in cents without float errors", async () => {
		const { user } = renderModal(makeOperation({ amount: "-0.30" }));

		await user.type(amountInput(1), "0,1");
		await user.type(amountInput(2), "0.2");

		expect(remainder()).toHaveTextContent(/0,00\s€/);
		expect(saveButton()).toBeEnabled();
	});

	it("sends the parts with the operation's sign and their budgets", async () => {
		const { user, onClose } = renderModal(makeOperation());

		await user.type(amountInput(1), "30,5");
		await user.type(amountInput(2), "69.50");
		await user.click(screen.getByRole("combobox", { name: "Budget (Part 1)" }));
		await user.click(await screen.findByRole("option", { name: "Loisirs" }));
		await user.click(saveButton());

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(lastCall()).toEqual({
			path: "/operations/op1/splits",
			method: "PUT",
			body: {
				splits: [
					{ amount: "-30.50", budgetId: "b2", categoryId: null },
					{ amount: "-69.50", budgetId: null, categoryId: null },
				],
			},
		});
	});

	it("keeps a positive sign for income operations", async () => {
		const { user } = renderModal(makeOperation({ amount: "250.00" }));

		await user.type(amountInput(1), "200");
		await user.type(amountInput(2), "50");
		await user.click(saveButton());

		await waitFor(() =>
			expect(lastCall().body).toEqual({
				splits: [
					{ amount: "200.00", budgetId: null, categoryId: null },
					{ amount: "50.00", budgetId: null, categoryId: null },
				],
			}),
		);
	});

	it("puts the remainder on the last part", async () => {
		const { user } = renderModal(makeOperation());

		await user.click(screen.getByRole("button", { name: "Ajouter une part" }));
		await user.type(amountInput(1), "30");
		await user.type(amountInput(2), "30");
		await user.click(screen.getByRole("button", { name: "Répartir le reste" }));

		expect(amountInput(3)).toHaveValue("40,00");
		expect(saveButton()).toBeEnabled();

		await user.click(saveButton());
		await waitFor(() =>
			expect(lastCall().body).toEqual({
				splits: [
					{ amount: "-30.00", budgetId: null, categoryId: null },
					{ amount: "-30.00", budgetId: null, categoryId: null },
					{ amount: "-40.00", budgetId: null, categoryId: null },
				],
			}),
		);
	});

	it("keeps at least two parts", async () => {
		const { user } = renderModal(makeOperation());

		expect(
			screen.queryByRole("button", { name: /Retirer la part/ }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Ajouter une part" }));
		await user.click(
			screen.getByRole("button", { name: "Retirer la part (Part 2)" }),
		);

		expect(amountInput(2)).toBeInTheDocument();
		expect(
			screen.queryByRole("textbox", { name: "Montant (Part 3)" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /Retirer la part/ }),
		).not.toBeInTheDocument();
	});

	it("blocks saving when a part is zero", async () => {
		const { user } = renderModal(makeOperation());

		await user.type(amountInput(1), "100");
		await user.type(amountInput(2), "0");

		expect(remainder()).toHaveTextContent(/0,00\s€/);
		expect(saveButton()).toBeDisabled();
	});

	it("pre-fills an already split operation and can undo the split", async () => {
		const { user, onClose } = renderModal(
			makeOperation({
				splits: [
					{
						id: "s1",
						amount: "-30.00",
						budgetId: "b1",
						categoryId: null,
						effectiveCategoryId: null,
					},
					{
						id: "s2",
						amount: "-70.00",
						budgetId: null,
						categoryId: null,
						effectiveCategoryId: null,
					},
				],
			}),
		);

		expect(screen.getByText("Divisée en 2 parts")).toBeInTheDocument();
		expect(amountInput(1)).toHaveValue("30,00");
		expect(amountInput(2)).toHaveValue("70,00");
		expect(
			screen.getByRole("combobox", { name: "Budget (Part 1)" }),
		).toHaveValue("Courses");
		expect(saveButton()).toBeEnabled();

		await user.click(
			screen.getByRole("button", { name: "Annuler la division" }),
		);

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(lastCall()).toEqual({
			path: "/operations/op1/splits",
			method: "DELETE",
			body: null,
		});
	});

	it("offers no undo for an operation that is not split", () => {
		renderModal(makeOperation());

		expect(
			screen.queryByRole("button", { name: "Annuler la division" }),
		).not.toBeInTheDocument();
	});

	it("shows an error when the API rejects the split", async () => {
		apiFetchMock.mockRejectedValue(new Error("400"));
		const { user, onClose } = renderModal(makeOperation());

		await user.type(amountInput(1), "50");
		await user.type(amountInput(2), "50");
		await user.click(saveButton());

		expect(
			await screen.findByText("Impossible d'enregistrer la division"),
		).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	describe("categories", () => {
		const categories: CategoryResponse[] = [
			{
				id: "c1",
				name: "Courses",
				color: "#12b886",
				icon: null,
				rules: [],
				createdAt: "2026-01-01T00:00:00Z",
			},
			{
				id: "c2",
				name: "Sorties",
				color: "#be4bdb",
				icon: null,
				rules: [],
				createdAt: "2026-01-01T00:00:00Z",
			},
		];

		it("sends each part's category, starting from the operation's own", async () => {
			const { user, onClose } = renderModal(
				makeOperation({ categoryId: "c1", effectiveCategoryId: "c1" }),
				categories,
			);

			expect(
				screen.getByRole("combobox", { name: "Catégorie (Part 1)" }),
			).toHaveValue("Courses");
			await user.type(amountInput(1), "40");
			await user.type(amountInput(2), "60");
			await user.click(
				screen.getByRole("combobox", { name: "Catégorie (Part 2)" }),
			);
			await user.click(await screen.findByRole("option", { name: "Sorties" }));
			await user.click(saveButton());

			await waitFor(() => expect(onClose).toHaveBeenCalled());
			expect(lastCall().body).toEqual({
				splits: [
					{ amount: "-40.00", budgetId: null, categoryId: "c1" },
					{ amount: "-60.00", budgetId: null, categoryId: "c2" },
				],
			});
		});

		it("names the budget's category a part without its own falls back on", async () => {
			const original = budgets[0];
			if (!original) throw new Error("no budget");
			budgets[0] = { ...original, categoryId: "c2" };
			try {
				const { user } = renderModal(makeOperation(), categories);
				await user.click(
					screen.getByRole("combobox", { name: "Budget (Part 1)" }),
				);
				await user.click(
					await screen.findByRole("option", { name: "Courses" }),
				);

				expect(
					screen.getByRole("combobox", { name: "Catégorie (Part 1)" }),
				).toHaveAttribute("placeholder", "Catégorie du budget : Sorties");
			} finally {
				budgets[0] = original;
			}
		});

		it("hides the category field while there are no categories", () => {
			renderModal(makeOperation());

			expect(
				screen.queryByRole("combobox", { name: "Catégorie (Part 1)" }),
			).not.toBeInTheDocument();
		});
	});
});
