import { describe, expect, it } from "vitest";
import {
	activeFilterCount,
	mergeFilters,
	operationSearchQuery,
	parseOperationFilters,
} from "@/lib/operation-search";

describe("parseOperationFilters", () => {
	it("keeps valid values and drops the rest", () => {
		expect(
			parseOperationFilters({
				label: "  loyer ",
				categoryIds: ["a", 3, ""],
				budgetIds: "b",
				direction: "sideways",
				amountMin: 12.5,
				amountMax: "abc",
				dateFrom: "2026-01-01",
				dateTo: "01/02/2026",
				ignored: "only",
				uncategorized: "true",
				sort: "amount",
				order: "up",
			}),
		).toEqual({
			label: "loyer",
			categoryIds: ["a"],
			amountMin: "12.5",
			dateFrom: "2026-01-01",
			ignored: "only",
			uncategorized: true,
			sort: "amount",
		});
	});

	it("reads a numeric label as text", () => {
		expect(parseOperationFilters({ label: 42 })).toEqual({ label: "42" });
	});
});

describe("mergeFilters", () => {
	it("removes the keys cleared by the patch", () => {
		expect(
			mergeFilters(
				{ label: "x", categoryIds: ["a"], ignored: "only" },
				{ label: undefined, categoryIds: [], ignored: undefined },
			),
		).toEqual({});
	});
});

describe("operationSearchQuery", () => {
	it("repeats the list filters and omits a blank label", () => {
		const params = new URLSearchParams(
			operationSearchQuery(
				{ label: " ", categoryIds: ["a", "b"], budgetIds: ["c"] },
				2,
				50,
			),
		);
		expect(params.has("label")).toBe(false);
		expect(params.getAll("categoryId")).toEqual(["a", "b"]);
		expect(params.getAll("budgetId")).toEqual(["c"]);
		expect(params.get("page")).toBe("2");
		expect(params.get("pageSize")).toBe("50");
	});
});

describe("activeFilterCount", () => {
	it("ignores the label and the sort, and counts an amount range once", () => {
		expect(
			activeFilterCount({
				label: "x",
				sort: "label",
				categoryIds: ["a", "b"],
				uncategorized: true,
				amountMin: "1",
				amountMax: "2",
			}),
		).toBe(4);
	});
});
