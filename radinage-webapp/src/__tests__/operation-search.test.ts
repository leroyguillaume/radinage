import { describe, expect, it } from "vitest";
import {
	activeFilterCount,
	datePresetRange,
	matchingDatePreset,
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
				accountIds: ["acc", 7],
				direction: "sideways",
				amountMin: 12.5,
				amountMax: "abc",
				dateFrom: "2026-01-01",
				dateTo: "01/02/2026",
				ignored: "only",
				transfers: "excluded",
				uncategorized: "true",
				sort: "amount",
				order: "up",
			}),
		).toEqual({
			label: "loyer",
			categoryIds: ["a"],
			accountIds: ["acc"],
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
				{
					label: " ",
					categoryIds: ["a", "b"],
					budgetIds: ["c"],
					accountIds: ["d", "e"],
				},
				2,
				50,
			),
		);
		expect(params.has("label")).toBe(false);
		expect(params.getAll("categoryId")).toEqual(["a", "b"]);
		expect(params.getAll("budgetId")).toEqual(["c"]);
		expect(params.getAll("accountId")).toEqual(["d", "e"]);
		expect(params.get("page")).toBe("2");
		expect(params.get("pageSize")).toBe("50");
	});

	it("leaves the transfers out unless asked for", () => {
		const transfers = (filters: Parameters<typeof operationSearchQuery>[0]) =>
			new URLSearchParams(operationSearchQuery(filters, 1, 50)).get(
				"transfers",
			);
		expect(transfers({})).toBe("excluded");
		expect(transfers({ transfers: "included" })).toBe("included");
		expect(transfers({ transfers: "only" })).toBe("only");
	});

	it("sends a single date bound on its own", () => {
		const params = new URLSearchParams(
			operationSearchQuery({ dateFrom: "2026-03-01" }, 1, 50),
		);
		expect(params.get("dateFrom")).toBe("2026-03-01");
		expect(params.has("dateTo")).toBe(false);
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
				accountIds: ["c"],
				amountMin: "1",
				amountMax: "2",
			}),
		).toBe(5);
	});

	it("counts the transfer filter and a single date bound", () => {
		expect(activeFilterCount({ transfers: "only", dateTo: "2026-01-31" })).toBe(
			2,
		);
	});
});

describe("datePresetRange", () => {
	const today = new Date(2026, 0, 15);

	it("spans whole calendar months and years", () => {
		expect(datePresetRange("thisMonth", today)).toEqual({
			dateFrom: "2026-01-01",
			dateTo: "2026-01-31",
		});
		expect(datePresetRange("lastMonth", today)).toEqual({
			dateFrom: "2025-12-01",
			dateTo: "2025-12-31",
		});
		expect(datePresetRange("thisYear", today)).toEqual({
			dateFrom: "2026-01-01",
			dateTo: "2026-12-31",
		});
	});

	it("ends the last 12 months today", () => {
		expect(datePresetRange("last12Months", today)).toEqual({
			dateFrom: "2025-01-16",
			dateTo: "2026-01-15",
		});
	});
});

describe("matchingDatePreset", () => {
	const today = new Date(2026, 0, 15);

	it("finds the preset with exactly these bounds", () => {
		expect(
			matchingDatePreset(
				{ dateFrom: "2025-12-01", dateTo: "2025-12-31" },
				today,
			),
		).toBe("lastMonth");
		expect(matchingDatePreset({ dateFrom: "2025-12-01" }, today)).toBe(
			undefined,
		);
	});
});
