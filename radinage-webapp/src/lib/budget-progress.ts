import { getBudgetedAmountForMonth } from "@/lib/budget-utils";
import { operationEntries } from "@/lib/operation-parts";
import type { BudgetResponse, OperationResponse } from "@/lib/types";

export type BudgetProgressStatus = "noDue" | "partial" | "reached" | "over";

export interface BudgetProgress {
	real: number;
	planned: number;
	/** Bar fill, clamped to 0–100. */
	percent: number;
	status: BudgetProgressStatus;
}

export function sumOperationsByBudget(
	operations: OperationResponse[],
): Map<string, number> {
	const totals = new Map<string, number>();
	for (const entry of operations.flatMap(operationEntries)) {
		if (entry.budgetId === null) continue;
		totals.set(
			entry.budgetId,
			(totals.get(entry.budgetId) ?? 0) + entry.amount,
		);
	}
	return totals;
}

/**
 * Compares in absolute values: expense budgets and their operations are both
 * negative, and the card shows magnitudes.
 */
export function computeBudgetProgress(
	budget: BudgetResponse,
	linkedTotal: number,
	year: number,
	month: number,
): BudgetProgress {
	const planned = Math.abs(getBudgetedAmountForMonth(budget, year, month) ?? 0);
	const real = Math.abs(linkedTotal);

	if (planned === 0) return { real, planned, percent: 0, status: "noDue" };

	const ratio = real / planned;
	const percent = Math.min(100, Math.round(ratio * 100));
	if (ratio > 1 && budget.budgetType === "expense") {
		return { real, planned, percent, status: "over" };
	}
	if (ratio >= 1) return { real, planned, percent, status: "reached" };
	return { real, planned, percent, status: "partial" };
}
