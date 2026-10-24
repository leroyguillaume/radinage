import { describe, expect, it } from "vitest";
import { entriesInMonth, operationEntries } from "@/lib/operation-parts";
import type { OperationResponse, OperationSplitResponse } from "@/lib/types";

function makeOperation(
	overrides: Partial<OperationResponse> = {},
): OperationResponse {
	return {
		id: "op1",
		amount: "-100.00",
		date: "2026-03-28",
		effectiveDate: null,
		label: "ASSURANCE",
		budgetLink: { type: "unlinked" },
		ignored: false,
		categoryId: null,
		effectiveCategoryId: null,
		splits: [],
		...overrides,
	};
}

function makePart(
	id: string,
	effectiveDate: string | null,
): OperationSplitResponse {
	return {
		id,
		amount: "-50.00",
		effectiveDate,
		budgetId: null,
		categoryId: null,
		effectiveCategoryId: null,
	};
}

describe("operationEntries", () => {
	it("dates a whole operation on its effective date, else its bank date", () => {
		expect(operationEntries(makeOperation())[0]?.date).toBe("2026-03-28");
		expect(
			operationEntries(makeOperation({ effectiveDate: "2026-04-01" }))[0]?.date,
		).toBe("2026-04-01");
	});

	it("dates a part on its own date, else its operation's", () => {
		const op = makeOperation({
			effectiveDate: "2026-04-01",
			splits: [makePart("s1", null), makePart("s2", "2026-05-01")],
		});

		expect(operationEntries(op).map((e) => e.date)).toEqual([
			"2026-04-01",
			"2026-05-01",
		]);
	});
});

describe("entriesInMonth", () => {
	it("keeps only the parts counting in the month", () => {
		const op = makeOperation({
			splits: [makePart("s1", null), makePart("s2", "2026-04-02")],
		});

		expect(entriesInMonth(op, 2026, 3).map((e) => e.key)).toEqual(["op1:s1"]);
		expect(entriesInMonth(op, 2026, 4).map((e) => e.key)).toEqual(["op1:s2"]);
		expect(entriesInMonth(op, 2026, 5)).toEqual([]);
	});
});
