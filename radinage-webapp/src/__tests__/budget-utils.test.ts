import { describe, expect, it } from "vitest";
import { getBudgetedAmountForMonth } from "@/lib/budget-utils";
import type { BudgetResponse } from "@/lib/types";

function makeRecurring(
	recurrence: "weekly" | "monthly" | "quarterly" | "yearly",
	amount: string,
	periodStart = { year: 2024, month: 1 },
): BudgetResponse {
	return {
		id: "b1",
		label: "Test",
		budgetType: "expense",
		kind: {
			type: "recurring",
			recurrence,
			closedPeriods: [],
			currentPeriod: { start: periodStart, end: null, amount },
		},
		rules: [],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

function makeOccasional(
	month: number,
	year: number,
	amount: string,
): BudgetResponse {
	return {
		id: "b2",
		label: "Test",
		budgetType: "expense",
		kind: { type: "occasional", month, year, amount },
		rules: [],
		createdAt: "2024-01-01T00:00:00Z",
	};
}

describe("getBudgetedAmountForMonth", () => {
	describe("monthly", () => {
		it("returns the raw amount", () => {
			const budget = makeRecurring("monthly", "-800.00");
			expect(getBudgetedAmountForMonth(budget, 2024, 6)).toBe(-800);
		});

		it("returns null when month is outside period", () => {
			const budget: BudgetResponse = {
				...makeRecurring("monthly", "-800.00"),
				kind: {
					type: "recurring",
					recurrence: "monthly",
					closedPeriods: [],
					currentPeriod: {
						start: { year: 2024, month: 6 },
						end: { year: 2024, month: 12 },
						amount: "-800.00",
					},
				},
			};
			expect(getBudgetedAmountForMonth(budget, 2024, 3)).toBeNull();
		});
	});

	describe("weekly", () => {
		it("multiplies amount by weeks in month (April 30 days → 4 weeks)", () => {
			const budget = makeRecurring("weekly", "-100.00");
			// April 2024: 30 days, round(30/7) = 4
			expect(getBudgetedAmountForMonth(budget, 2024, 4)).toBe(-100 * 4);
		});

		it("multiplies amount by weeks in month (January 31 days → 4 weeks)", () => {
			const budget = makeRecurring("weekly", "-100.00");
			// January 2024: 31 days, round(31/7) = 4
			expect(getBudgetedAmountForMonth(budget, 2024, 1)).toBe(-100 * 4);
		});

		it("multiplies amount by weeks in month (February 29 days → 4 weeks)", () => {
			const budget = makeRecurring("weekly", "-100.00");
			// February 2024 (leap year): 29 days, round(29/7) = 4
			expect(getBudgetedAmountForMonth(budget, 2024, 2)).toBe(-100 * 4);
		});

		it("multiplies amount by weeks in month (February 28 days → 4 weeks)", () => {
			const budget = makeRecurring("weekly", "-100.00");
			// February 2025 (non-leap): 28 days, round(28/7) = 4
			expect(getBudgetedAmountForMonth(budget, 2025, 2)).toBe(-100 * 4);
		});
	});

	describe("quarterly", () => {
		it("returns amount on the period start month", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 1,
			});
			// Jan is the start → diff = 0, 0 % 3 = 0
			expect(getBudgetedAmountForMonth(budget, 2024, 1)).toBe(-300);
		});

		it("returns amount 3 months after period start", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 1,
			});
			// Apr: diff = 3, 3 % 3 = 0
			expect(getBudgetedAmountForMonth(budget, 2024, 4)).toBe(-300);
		});

		it("returns amount 6 months after period start", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 1,
			});
			// Jul: diff = 6, 6 % 3 = 0
			expect(getBudgetedAmountForMonth(budget, 2024, 7)).toBe(-300);
		});

		it("returns null for months not on a quarterly boundary", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 1,
			});
			// Feb: diff = 1, 1 % 3 ≠ 0
			expect(getBudgetedAmountForMonth(budget, 2024, 2)).toBeNull();
			// Mar: diff = 2, 2 % 3 ≠ 0
			expect(getBudgetedAmountForMonth(budget, 2024, 3)).toBeNull();
		});

		it("works with non-January period start", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 3,
			});
			// Mar: diff = 0 → show
			expect(getBudgetedAmountForMonth(budget, 2024, 3)).toBe(-300);
			// Jun: diff = 3 → show
			expect(getBudgetedAmountForMonth(budget, 2024, 6)).toBe(-300);
			// Apr: diff = 1 → hide
			expect(getBudgetedAmountForMonth(budget, 2024, 4)).toBeNull();
		});

		it("works across year boundaries", () => {
			const budget = makeRecurring("quarterly", "-300.00", {
				year: 2024,
				month: 11,
			});
			// Nov 2024: diff = 0 → show
			expect(getBudgetedAmountForMonth(budget, 2024, 11)).toBe(-300);
			// Feb 2025: diff = 3 → show
			expect(getBudgetedAmountForMonth(budget, 2025, 2)).toBe(-300);
			// Jan 2025: diff = 2 → hide
			expect(getBudgetedAmountForMonth(budget, 2025, 1)).toBeNull();
		});
	});

	describe("yearly", () => {
		it("returns amount on the period start month", () => {
			const budget = makeRecurring("yearly", "-1200.00", {
				year: 2024,
				month: 3,
			});
			// Mar 2024: diff = 0, 0 % 12 = 0
			expect(getBudgetedAmountForMonth(budget, 2024, 3)).toBe(-1200);
		});

		it("returns amount 12 months after period start", () => {
			const budget = makeRecurring("yearly", "-1200.00", {
				year: 2024,
				month: 3,
			});
			// Mar 2025: diff = 12, 12 % 12 = 0
			expect(getBudgetedAmountForMonth(budget, 2025, 3)).toBe(-1200);
		});

		it("returns null for months not on a yearly boundary", () => {
			const budget = makeRecurring("yearly", "-1200.00", {
				year: 2024,
				month: 3,
			});
			// Jun 2024: diff = 3, 3 % 12 ≠ 0
			expect(getBudgetedAmountForMonth(budget, 2024, 6)).toBeNull();
			// Jan 2025: diff = 10, 10 % 12 ≠ 0
			expect(getBudgetedAmountForMonth(budget, 2025, 1)).toBeNull();
		});

		it("returns null when month is before period start", () => {
			const budget = makeRecurring("yearly", "-1200.00", {
				year: 2024,
				month: 6,
			});
			expect(getBudgetedAmountForMonth(budget, 2024, 3)).toBeNull();
		});
	});

	describe("occasional", () => {
		it("returns amount for matching month/year", () => {
			const budget = makeOccasional(6, 2024, "-500.00");
			expect(getBudgetedAmountForMonth(budget, 2024, 6)).toBe(-500);
		});

		it("returns null for non-matching month", () => {
			const budget = makeOccasional(6, 2024, "-500.00");
			expect(getBudgetedAmountForMonth(budget, 2024, 7)).toBeNull();
		});
	});

	describe("closed periods", () => {
		it("uses closed period amount when month falls within", () => {
			const budget: BudgetResponse = {
				id: "b1",
				label: "Test",
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
			expect(getBudgetedAmountForMonth(budget, 2023, 6)).toBe(-700);
			expect(getBudgetedAmountForMonth(budget, 2024, 6)).toBe(-800);
		});

		it("uses closed period start for quarterly cycle calculation", () => {
			const budget: BudgetResponse = {
				id: "b1",
				label: "Test",
				budgetType: "expense",
				kind: {
					type: "recurring",
					recurrence: "quarterly",
					closedPeriods: [
						{
							start: { year: 2023, month: 2 },
							end: { year: 2023, month: 12 },
							amount: "-300.00",
						},
					],
					currentPeriod: {
						start: { year: 2024, month: 1 },
						end: null,
						amount: "-400.00",
					},
				},
				rules: [],
				createdAt: "2024-01-01T00:00:00Z",
			};
			// Closed period starts Feb 2023
			// Feb: diff = 0 → show
			expect(getBudgetedAmountForMonth(budget, 2023, 2)).toBe(-300);
			// May: diff = 3 → show
			expect(getBudgetedAmountForMonth(budget, 2023, 5)).toBe(-300);
			// Mar: diff = 1 → hide
			expect(getBudgetedAmountForMonth(budget, 2023, 3)).toBeNull();

			// Current period starts Jan 2024
			// Jan: diff = 0 → show
			expect(getBudgetedAmountForMonth(budget, 2024, 1)).toBe(-400);
			// Apr: diff = 3 → show
			expect(getBudgetedAmountForMonth(budget, 2024, 4)).toBe(-400);
			// Feb: diff = 1 → hide
			expect(getBudgetedAmountForMonth(budget, 2024, 2)).toBeNull();
		});
	});
});
