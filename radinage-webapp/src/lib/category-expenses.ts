import type { CategoryResponse, CategoryTotal } from "@/lib/types";

/** What one category, or the operations without one, spent over a range. */
export interface CategoryExpenseRow {
	key: string;
	/** Undefined for the amounts without a category. */
	category: CategoryResponse | undefined;
	/** Positive amount spent. */
	spent: number;
}

/** One slice of the expenses pie: a row, or the rows folded past the largest ones. */
export interface CategoryExpenseSlice extends CategoryExpenseRow {
	/** Number of rows folded into this slice; 0 for a single row. */
	others: number;
}

/** Past this many slices a pie stops reading at a glance. */
export const MAX_PIE_SLICES = 6;

/** The categories that spent something over the range, most spent first. */
export function categoryExpenseRows(
	totals: CategoryTotal[],
	categories: CategoryResponse[],
): CategoryExpenseRow[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	return totals
		.map((total) => ({
			key: total.categoryId ?? "__none",
			category: total.categoryId ? byId.get(total.categoryId) : undefined,
			spent: -Number(total.expense),
		}))
		.filter((row) => row.spent > 0)
		.sort((a, b) => b.spent - a.spent);
}

/**
 * The rows as pie slices: all of them when they fit, otherwise the largest ones
 * and a last slice summing the rest.
 */
export function categoryExpenseSlices(
	rows: CategoryExpenseRow[],
	maxSlices = MAX_PIE_SLICES,
): CategoryExpenseSlice[] {
	if (rows.length <= maxSlices) {
		return rows.map((row) => ({ ...row, others: 0 }));
	}
	const kept = rows.slice(0, maxSlices - 1);
	const folded = rows.slice(maxSlices - 1);
	return [
		...kept.map((row) => ({ ...row, others: 0 })),
		{
			key: "__others",
			category: undefined,
			spent: folded.reduce((sum, row) => sum + row.spent, 0),
			others: folded.length,
		},
	];
}
