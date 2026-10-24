import type { OperationResponse } from "@/lib/types";

/**
 * One amount counted against one budget (or none): a whole operation, or one
 * part of a split operation.
 */
export interface OperationEntry {
	key: string;
	operation: OperationResponse;
	amount: number;
	/** Date the amount counts on (YYYY-MM-DD). */
	date: string;
	budgetId: string | null;
	/** Category the amount counts towards: its own, else its budget's. */
	categoryId: string | null;
	/** Whether `categoryId` comes from the budget rather than the entry itself. */
	categoryFromBudget: boolean;
	/** 1-based position among the parts, null for a whole operation. */
	part: { index: number; count: number } | null;
}

export function isSplit(op: OperationResponse): boolean {
	return op.splits.length > 0;
}

/** The date an operation counts on: its effective date, else its bank date. */
export function accountingDate(op: OperationResponse): string {
	return op.effectiveDate ?? op.date;
}

export function operationEntries(op: OperationResponse): OperationEntry[] {
	if (!isSplit(op)) {
		return [
			{
				key: op.id,
				operation: op,
				amount: Number(op.amount),
				date: accountingDate(op),
				budgetId:
					op.budgetLink.type === "unlinked" ? null : op.budgetLink.budgetId,
				categoryId: op.effectiveCategoryId,
				categoryFromBudget:
					op.categoryId === null && op.effectiveCategoryId !== null,
				part: null,
			},
		];
	}
	return op.splits.map((split, i) => ({
		key: `${op.id}:${split.id}`,
		operation: op,
		amount: Number(split.amount),
		date: split.effectiveDate ?? accountingDate(op),
		budgetId: split.budgetId,
		categoryId: split.effectiveCategoryId,
		categoryFromBudget:
			split.categoryId === null && split.effectiveCategoryId !== null,
		part: { index: i + 1, count: op.splits.length },
	}));
}

/** The entries of `op` counting in the given month, its parts dated elsewhere left out. */
export function entriesInMonth(
	op: OperationResponse,
	year: number,
	month: number,
): OperationEntry[] {
	const prefix = `${year}-${String(month).padStart(2, "0")}-`;
	return operationEntries(op).filter((entry) => entry.date.startsWith(prefix));
}
