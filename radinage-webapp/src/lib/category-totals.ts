import type { CategoryResponse, CategoryTotal } from "@/lib/types";

/** Which flow of the category totals a breakdown is about. */
export type CategorySide = "income" | "expense";

export function isCategorySide(value: string): value is CategorySide {
	return value === "income" || value === "expense";
}

/** What one category, or the operations without one, earned or spent over a range. */
export interface CategoryRow {
	key: string;
	/** Undefined for the amounts without a category. */
	category: CategoryResponse | undefined;
	/** Positive amount earned or spent. */
	amount: number;
}

/** One slice of a pie: a row, or the rows folded past the largest ones. */
export interface CategorySlice extends CategoryRow {
	/** Number of rows folded into this slice; 0 for a single row. */
	others: number;
}

/** Past this many slices a pie stops reading at a glance. */
export const MAX_PIE_SLICES = 6;

/** The categories with something on that side over the range, largest first. */
export function categoryRows(
	totals: CategoryTotal[],
	categories: CategoryResponse[],
	side: CategorySide,
): CategoryRow[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	return totals
		.map((total) => ({
			key: total.categoryId ?? "__none",
			category: total.categoryId ? byId.get(total.categoryId) : undefined,
			amount: Math.abs(Number(total[side])),
		}))
		.filter((row) => row.amount > 0)
		.sort((a, b) => b.amount - a.amount);
}

/**
 * The rows as pie slices: all of them when they fit, otherwise the largest ones
 * and a last slice summing the rest.
 */
export function categorySlices(
	rows: CategoryRow[],
	maxSlices = MAX_PIE_SLICES,
): CategorySlice[] {
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
			amount: folded.reduce((sum, row) => sum + row.amount, 0),
			others: folded.length,
		},
	];
}
