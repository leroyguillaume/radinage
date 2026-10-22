import { describe, expect, it } from "vitest";
import {
	type CategoryRow,
	categoryRows,
	categorySlices,
} from "@/lib/category-totals";
import type { CategoryResponse } from "@/lib/types";

function category(id: string): CategoryResponse {
	return {
		id,
		name: id,
		color: "teal",
		icon: null,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

function row(key: string, amount: number): CategoryRow {
	return { key, category: category(key), amount };
}

const totals = [
	{ categoryId: null, income: "0", expense: "-10.00" },
	{ categoryId: "food", income: "5.00", expense: "-30.00" },
	{ categoryId: "salary", income: "2000.00", expense: "0" },
];

describe("categoryRows", () => {
	it("keeps what was spent, most first, without a category included", () => {
		const rows = categoryRows(
			totals,
			[category("food"), category("salary")],
			"expense",
		);

		expect(rows.map((r) => [r.key, r.category?.id, r.amount])).toEqual([
			["food", "food", 30],
			["__none", undefined, 10],
		]);
	});

	it("keeps what was earned, most first", () => {
		const rows = categoryRows(
			totals,
			[category("food"), category("salary")],
			"income",
		);

		expect(rows.map((r) => [r.key, r.amount])).toEqual([
			["salary", 2000],
			["food", 5],
		]);
	});
});

describe("categorySlices", () => {
	it("gives each row a slice when they fit", () => {
		const rows = [row("a", 3), row("b", 2), row("c", 1)];

		expect(categorySlices(rows, 3)).toEqual(
			rows.map((r) => ({ ...r, others: 0 })),
		);
	});

	it("folds the smallest rows into one last slice", () => {
		const rows = [row("a", 50), row("b", 20), row("c", 5), row("d", 3)];

		const slices = categorySlices(rows, 3);

		expect(slices.map((s) => [s.key, s.amount, s.others])).toEqual([
			["a", 50, 0],
			["b", 20, 0],
			["__others", 8, 2],
		]);
		expect(slices[2]?.category).toBeUndefined();
	});
});
