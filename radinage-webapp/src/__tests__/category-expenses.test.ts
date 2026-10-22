import { describe, expect, it } from "vitest";
import {
	type CategoryExpenseRow,
	categoryExpenseRows,
	categoryExpenseSlices,
} from "@/lib/category-expenses";
import type { CategoryResponse } from "@/lib/types";

function category(id: string): CategoryResponse {
	return { id, name: id, color: "teal", createdAt: "2026-01-01T00:00:00Z" };
}

function row(key: string, spent: number): CategoryExpenseRow {
	return { key, category: category(key), spent };
}

describe("categoryExpenseRows", () => {
	it("keeps what was spent, most first, without a category included", () => {
		const rows = categoryExpenseRows(
			[
				{ categoryId: null, income: "0", expense: "-10.00" },
				{ categoryId: "food", income: "5.00", expense: "-30.00" },
				{ categoryId: "salary", income: "2000.00", expense: "0" },
			],
			[category("food"), category("salary")],
		);

		expect(rows.map((r) => [r.key, r.category?.id, r.spent])).toEqual([
			["food", "food", 30],
			["__none", undefined, 10],
		]);
	});
});

describe("categoryExpenseSlices", () => {
	it("gives each row a slice when they fit", () => {
		const rows = [row("a", 3), row("b", 2), row("c", 1)];

		expect(categoryExpenseSlices(rows, 3)).toEqual(
			rows.map((r) => ({ ...r, others: 0 })),
		);
	});

	it("folds the smallest rows into one last slice", () => {
		const rows = [row("a", 50), row("b", 20), row("c", 5), row("d", 3)];

		const slices = categoryExpenseSlices(rows, 3);

		expect(slices.map((s) => [s.key, s.spent, s.others])).toEqual([
			["a", 50, 0],
			["b", 20, 0],
			["__others", 8, 2],
		]);
		expect(slices[2]?.category).toBeUndefined();
	});
});
