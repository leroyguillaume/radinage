import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function selectMantineOption(inputName: RegExp, optionLabel: string) {
	const input = screen.getByRole("combobox", { name: inputName });
	// Focus then click to ensure combobox opens
	fireEvent.focus(input);
	fireEvent.click(input);
	const option = await screen.findByRole("option", { name: optionLabel });
	fireEvent.click(option);
	// Wait for the dropdown to close and state to settle
	await waitFor(() => {
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});
}

import { BudgetModal } from "@/components/BudgetModal";
import { i18n } from "@/i18n";
import type { BudgetResponse } from "@/lib/types";
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

function renderModal(budget: BudgetResponse | null = null, onClose = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme}>
				<DatesProvider settings={{ locale: "fr" }}>
					<BudgetModal opened onClose={onClose} budget={budget} />
				</DatesProvider>
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { onClose, queryClient };
}

function makeRecurringBudget(
	recurrence: "weekly" | "monthly" | "quarterly" | "yearly",
): BudgetResponse {
	return {
		id: "b1",
		label: "Loyer",
		budgetType: "expense",
		kind: {
			type: "recurring",
			recurrence,
			closedPeriods: [],
			currentPeriod: {
				start: { year: 2024, month: 1 },
				end: null,
				amount: "-800.00",
			},
		},
		rules: [],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

function makeOccasionalBudget(): BudgetResponse {
	return {
		id: "b2",
		label: "Vacances",
		budgetType: "expense",
		kind: {
			type: "occasional",
			month: 7,
			year: 2024,
			amount: "-2000.00",
		},
		rules: [
			{
				labelPattern: { type: "contains", value: "BOOKING" },
				matchAmount: false,
			},
		],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	// Reset to a default no-op mock for any leftover queries
	apiFetchMock.mockReset();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("BudgetModal", () => {
	it("renders create form with default fields", () => {
		renderModal();

		expect(screen.getByText("Créer un budget")).toBeInTheDocument();
		expect(screen.getByLabelText("Libellé *")).toBeInTheDocument();
		expect(screen.getByText("Type")).toBeInTheDocument();
		expect(screen.getByText("Fréquence")).toBeInTheDocument();
		expect(screen.getByLabelText("Montant *")).toBeInTheDocument();
	});

	it("shows recurrence selector and periods when kind is recurring", () => {
		renderModal();

		expect(screen.getByText("Périodicité")).toBeInTheDocument();
		expect(screen.getByText("Périodes")).toBeInTheDocument();
		expect(screen.getByText("Période courante")).toBeInTheDocument();
	});

	it("hides recurrence and periods when kind is occasional", async () => {
		renderModal();

		await selectMantineOption(/Fréquence/, "Ponctuel");

		await waitFor(() => {
			expect(screen.queryByText("Périodicité")).not.toBeInTheDocument();
			expect(screen.queryByText("Périodes")).not.toBeInTheDocument();
		});
	});

	it("defaults to monthly recurrence", () => {
		renderModal();

		const recurrenceSelect = screen.getByRole("combobox", {
			name: /Périodicité/,
		});
		expect(recurrenceSelect).toHaveValue("Mensuel");
	});

	it("allows changing recurrence to weekly", async () => {
		renderModal();

		await selectMantineOption(/Périodicité/, "Hebdomadaire");

		const recurrenceSelect = screen.getByRole("combobox", {
			name: /Périodicité/,
		});
		expect(recurrenceSelect).toHaveValue("Hebdomadaire");
	});

	it("allows changing recurrence to yearly", async () => {
		renderModal();

		await selectMantineOption(/Périodicité/, "Annuel");

		const recurrenceSelect = screen.getByRole("combobox", {
			name: /Périodicité/,
		});
		expect(recurrenceSelect).toHaveValue("Annuel");
	});

	it("populates form when editing a recurring budget", () => {
		const budget = makeRecurringBudget("quarterly");
		renderModal(budget);

		expect(screen.getByText("Modifier le budget")).toBeInTheDocument();
		expect(screen.getByDisplayValue("Loyer")).toBeInTheDocument();
		// French locale: comma as decimal separator
		expect(screen.getByDisplayValue("-800,00")).toBeInTheDocument();

		const recurrenceSelect = screen.getByRole("combobox", {
			name: /Périodicité/,
		});
		expect(recurrenceSelect).toHaveValue("Trimestriel");
	});

	it("populates form when editing an occasional budget", () => {
		const budget = makeOccasionalBudget();
		renderModal(budget);

		expect(screen.getByDisplayValue("Vacances")).toBeInTheDocument();
		expect(screen.getByDisplayValue("-2000,00")).toBeInTheDocument();
		// Recurrence selector should not be visible
		expect(screen.queryByText("Périodicité")).not.toBeInTheDocument();
	});

	it("submits create payload with default recurrence", async () => {
		apiFetchMock.mockResolvedValueOnce(makeRecurringBudget("monthly"));

		const { onClose } = renderModal();
		const user = userEvent.setup();

		// Fill label and amount
		await user.type(screen.getByLabelText("Libellé *"), "Courses");
		await user.type(screen.getByLabelText("Montant *"), "-100");

		// Submit with default recurrence (monthly)
		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/budgets",
				expect.objectContaining({
					method: "POST",
				}),
			);
		});

		// Verify the payload contains recurrence
		const callBody = JSON.parse(apiFetchMock.mock.calls[0][1]?.body as string);
		expect(callBody.kind.type).toBe("recurring");
		expect(callBody.kind.recurrence).toBe("monthly");
		expect(callBody.kind.closedPeriods).toEqual([]);
		expect(callBody.kind.currentPeriod).toBeDefined();
		expect(callBody.kind.currentPeriod.amount).toBe("-100");

		expect(onClose).toHaveBeenCalled();
	});

	it("submits update payload preserving recurrence", async () => {
		const budget = makeRecurringBudget("quarterly");
		apiFetchMock.mockResolvedValueOnce(makeRecurringBudget("quarterly"));

		const { onClose } = renderModal(budget);

		// Submit without changing recurrence — it should preserve quarterly
		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith(
				"/budgets/b1",
				expect.objectContaining({
					method: "PUT",
				}),
			);
		});

		const callBody = JSON.parse(apiFetchMock.mock.calls[0][1]?.body as string);
		expect(callBody.kind.recurrence).toBe("quarterly");
		expect(onClose).toHaveBeenCalled();
	});

	it("shows error on save failure", async () => {
		apiFetchMock.mockRejectedValueOnce(new Error("Network error"));

		renderModal();
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Libellé *"), "Test");
		await user.type(screen.getByLabelText("Montant *"), "50");
		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(
				screen.getByText("Erreur lors de l'enregistrement"),
			).toBeInTheDocument();
		});
	});

	it("disables save when label or amount is empty", () => {
		renderModal();

		const saveButton = screen.getByRole("button", { name: "Enregistrer" });
		expect(saveButton).toBeDisabled();
	});

	it("renders add rule button and adds a rule", async () => {
		renderModal();
		const user = userEvent.setup();

		const addButton = screen.getByLabelText("Ajouter une règle");
		await user.click(addButton);

		expect(screen.getByText("Critère")).toBeInTheDocument();
		expect(screen.getByText("Valeur")).toBeInTheDocument();
	});

	it("loads rules from existing budget", () => {
		const budget = makeOccasionalBudget();
		renderModal(budget);

		// The rule's pattern value should be present
		expect(screen.getByDisplayValue("BOOKING")).toBeInTheDocument();
	});

	it("displays multiple periods when editing a budget with closed periods", () => {
		const budget: BudgetResponse = {
			id: "b3",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [
					{
						start: { year: 2023, month: 1 },
						end: { year: 2023, month: 12 },
						amount: "-700.00",
					},
				],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [],
			createdAt: "2024-01-01T00:00:00Z",
		};
		renderModal(budget);

		// Should show 2 periods
		expect(screen.getByText("Période 1")).toBeInTheDocument();
		expect(screen.getByText("Période courante")).toBeInTheDocument();
		// Both amounts displayed
		expect(screen.getByDisplayValue("-700,00")).toBeInTheDocument();
		expect(screen.getByDisplayValue("-800,00")).toBeInTheDocument();
	});

	it("adds and removes periods", async () => {
		renderModal();
		const user = userEvent.setup();

		// Initially one period
		expect(screen.getByText("Période courante")).toBeInTheDocument();
		expect(screen.queryByText("Période 1")).not.toBeInTheDocument();

		// Add a period
		const addPeriodButton = screen.getByLabelText("Ajouter une période");
		await user.click(addPeriodButton);

		// Now two periods
		expect(screen.getByText("Période 1")).toBeInTheDocument();
		expect(screen.getByText("Période courante")).toBeInTheDocument();

		// Remove the first period
		const deleteButtons = screen.getAllByLabelText("Supprimer");
		await user.click(deleteButtons[0]);

		// Back to one period
		await waitFor(() => {
			expect(screen.queryByText("Période 1")).not.toBeInTheDocument();
			expect(screen.getByText("Période courante")).toBeInTheDocument();
		});
	});

	it("submits multi-period payload correctly", async () => {
		const budget: BudgetResponse = {
			id: "b3",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [
					{
						start: { year: 2023, month: 1 },
						end: { year: 2023, month: 12 },
						amount: "-700.00",
					},
				],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [],
			createdAt: "2024-01-01T00:00:00Z",
		};
		apiFetchMock.mockResolvedValueOnce(budget);

		renderModal(budget);

		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalled();
		});

		const callBody = JSON.parse(apiFetchMock.mock.calls[0][1]?.body as string);
		expect(callBody.kind.closedPeriods).toHaveLength(1);
		expect(callBody.kind.closedPeriods[0].amount).toBe("-700.00");
		expect(callBody.kind.closedPeriods[0].start).toEqual({
			year: 2023,
			month: 1,
		});
		expect(callBody.kind.closedPeriods[0].end).toEqual({
			year: 2023,
			month: 12,
		});
		expect(callBody.kind.currentPeriod.amount).toBe("-800.00");
		expect(callBody.kind.currentPeriod.end).toBeNull();
	});

	it("formats amount with French comma on blur", async () => {
		renderModal();
		const user = userEvent.setup();

		const amountInput = screen.getByLabelText("Montant *");
		await user.type(amountInput, "-50,5");
		fireEvent.blur(amountInput);

		// Should be formatted to 2 decimal places with comma
		expect(amountInput).toHaveValue("-50,50");
	});

	it("sends dot-separated amount in payload even when typed with comma", async () => {
		apiFetchMock.mockResolvedValueOnce(makeRecurringBudget("monthly"));

		renderModal();
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Libellé *"), "Test");
		const amountInput = screen.getByLabelText("Montant *");
		await user.type(amountInput, "-99,90");
		fireEvent.blur(amountInput);

		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalled();
		});

		const callBody = JSON.parse(apiFetchMock.mock.calls[0][1]?.body as string);
		// API receives dot-separated value
		expect(callBody.kind.currentPeriod.amount).toBe("-99.90");
	});

	it("shows apply prompt with force options after creating budget with rules", async () => {
		// Return a budget with rules from the create call
		const budgetWithRules: BudgetResponse = {
			id: "b-new",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [
				{
					labelPattern: { type: "contains", value: "LOYER" },
					matchAmount: false,
				},
			],
			createdAt: "2024-01-01T00:00:00Z",
		};
		apiFetchMock.mockResolvedValueOnce(budgetWithRules);

		renderModal();
		const user = userEvent.setup();

		// Fill form
		await user.type(screen.getByLabelText("Libellé *"), "Loyer");
		await user.type(screen.getByLabelText("Montant *"), "-800");

		// Add a rule
		await user.click(screen.getByLabelText("Ajouter une règle"));
		const patternInput = screen.getByLabelText("Valeur");
		await user.type(patternInput, "LOYER");

		// Submit
		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		// Should show apply prompt with force options
		await waitFor(() => {
			expect(
				screen.getByText(
					"Voulez-vous aussi remplacer les opérations déjà liées manuellement à un autre budget ?",
				),
			).toBeInTheDocument();
		});

		expect(
			screen.getByRole("button", { name: "Ignorer les manuelles" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Tout remplacer" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Ignorer" })).toBeInTheDocument();
	});

	it("shows overlap warning and disables save when periods overlap", async () => {
		const budget: BudgetResponse = {
			id: "b3",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [
					{
						start: { year: 2024, month: 1 },
						end: { year: 2024, month: 12 },
						amount: "-700.00",
					},
				],
				currentPeriod: {
					start: { year: 2024, month: 6 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [],
			createdAt: "2024-01-01T00:00:00Z",
		};
		renderModal(budget);

		expect(
			screen.getByText("Les périodes ne doivent pas se chevaucher"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
	});

	it("does not show overlap warning when periods are disjoint", () => {
		const budget: BudgetResponse = {
			id: "b3",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [
					{
						start: { year: 2023, month: 1 },
						end: { year: 2023, month: 12 },
						amount: "-700.00",
					},
				],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [],
			createdAt: "2024-01-01T00:00:00Z",
		};
		renderModal(budget);

		expect(
			screen.queryByText("Les périodes ne doivent pas se chevaucher"),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Enregistrer" }),
		).not.toBeDisabled();
	});

	it("does not show overlap warning with a single period", () => {
		renderModal();

		expect(
			screen.queryByText("Les périodes ne doivent pas se chevaucher"),
		).not.toBeInTheDocument();
	});

	it("shows overlap warning when adding an overlapping period", async () => {
		const budget: BudgetResponse = {
			id: "b3",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [],
			createdAt: "2024-01-01T00:00:00Z",
		};
		renderModal(budget);
		const user = userEvent.setup();

		// No overlap with a single period
		expect(
			screen.queryByText("Les périodes ne doivent pas se chevaucher"),
		).not.toBeInTheDocument();

		// Add a second period — it gets default start = now, end = null
		// Both periods have open end (null), so they overlap
		await user.click(screen.getByLabelText("Ajouter une période"));

		expect(
			screen.getByText("Les périodes ne doivent pas se chevaucher"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
	});

	it("apply skip manual sends force=false from create prompt", async () => {
		const budgetWithRules: BudgetResponse = {
			id: "b-new",
			label: "Loyer",
			budgetType: "expense",
			kind: {
				type: "recurring",
				recurrence: "monthly",
				closedPeriods: [],
				currentPeriod: {
					start: { year: 2024, month: 1 },
					end: null,
					amount: "-800.00",
				},
			},
			rules: [
				{
					labelPattern: { type: "contains", value: "LOYER" },
					matchAmount: false,
				},
			],
			createdAt: "2024-01-01T00:00:00Z",
		};
		// First call: create budget
		apiFetchMock.mockResolvedValueOnce(budgetWithRules);
		// Second call: apply rules
		apiFetchMock.mockResolvedValueOnce({ updated: 2, skipped: 0 });

		renderModal();
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("Libellé *"), "Loyer");
		await user.type(screen.getByLabelText("Montant *"), "-800");
		await user.click(screen.getByLabelText("Ajouter une règle"));
		await user.type(screen.getByLabelText("Valeur"), "LOYER");

		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Ignorer les manuelles" }),
			).toBeInTheDocument();
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Ignorer les manuelles" }),
		);

		await waitFor(() => {
			// The apply call should have force=false
			const applyCall = apiFetchMock.mock.calls.find(
				(c) => typeof c[0] === "string" && c[0].includes("/apply"),
			);
			expect(applyCall).toBeDefined();
			const body = JSON.parse(applyCall?.[1]?.body as string);
			expect(body.force).toBe(false);
		});

		// Should show the result
		await waitFor(() => {
			expect(
				screen.getByText("2 opération(s) liée(s), 0 ignorée(s)"),
			).toBeInTheDocument();
		});
	});
});
