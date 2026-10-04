import type { OperationResponse } from "@/lib/types";

/**
 * One amount counted against one budget (or none): a whole operation, or one
 * part of a split operation.
 */
export interface OperationEntry {
	key: string;
	operation: OperationResponse;
	amount: number;
	budgetId: string | null;
	/** 1-based position among the parts, null for a whole operation. */
	part: { index: number; count: number } | null;
}

export function isSplit(op: OperationResponse): boolean {
	return op.splits.length > 0;
}

export function operationEntries(op: OperationResponse): OperationEntry[] {
	if (!isSplit(op)) {
		return [
			{
				key: op.id,
				operation: op,
				amount: Number(op.amount),
				budgetId:
					op.budgetLink.type === "unlinked" ? null : op.budgetLink.budgetId,
				part: null,
			},
		];
	}
	return op.splits.map((split, i) => ({
		key: `${op.id}:${split.id}`,
		operation: op,
		amount: Number(split.amount),
		budgetId: split.budgetId,
		part: { index: i + 1, count: op.splits.length },
	}));
}
