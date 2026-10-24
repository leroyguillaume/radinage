import { describe, expect, it } from "vitest";
import {
	budgetYearStats,
	deltaTone,
	toBudgetYear,
	typeYearTotals,
} from "@/lib/budget-year";
import type {
	BudgetKind,
	BudgetResponse,
	BudgetSummaryMonth,
	BudgetType,
} from "@/lib/types";

const today = new Date(2026, 9, 24);

function makeBudget(
	budgetType: BudgetType,
	kind: BudgetKind = {
		type: "recurring",
		recurrence: "monthly",
		closedPeriods: [],
		currentPeriod: { start: { year: 2024, month: 1 }, end: null, amount: "0" },
	},
): BudgetResponse {
	return {
		id: "b1",
		label: "Budget",
		budgetType,
		kind,
		rules: [],
		categoryId: null,
		accountId: null,
		createdAt: "2024-01-01T00:00:00Z",
	};
}

/** One entry per month of 2026, `actuals` from January on and zero after. */
function summary(
	expected: (month: number) => string | null,
	actuals: number[],
): BudgetSummaryMonth[] {
	return Array.from({ length: 12 }, (_, i) => ({
		year: 2026,
		month: i + 1,
		expected: expected(i + 1),
		actual: String(actuals[i] ?? 0),
	}));
}

const groceries = summary(
	() => "-450",
	[-432, -468, -441, -497, -455, -420, -512, -538, -446, -318],
);

describe("deltaTone", () => {
	it("is bad when spending more or receiving less than expected", () => {
		expect(deltaTone("expense", 27)).toBe("bad");
		expect(deltaTone("expense", -80)).toBe("good");
		expect(deltaTone("income", 600)).toBe("good");
		expect(deltaTone("savings", -300)).toBe("bad");
		expect(deltaTone("income", 0)).toBe("even");
	});
});

describe("toBudgetYear", () => {
	it("compares what was spent with what was expected up to the current month", () => {
		const year = toBudgetYear(makeBudget("expense"), groceries, today);

		expect(year.planned).toBe(5400);
		expect(year.real).toBe(4527);
		expect(year.expectedToDate).toBe(4500);
		expect(year.delta).toBe(27);
		expect(year.tone).toBe("bad");
		expect(year.remaining).toBe(132 + 900);
	});

	it("gives each month a state relative to today", () => {
		const year = toBudgetYear(makeBudget("expense"), groceries, today);

		expect(year.months.map((m) => m.state)).toEqual([
			"within",
			"over",
			"within",
			"over",
			"over",
			"within",
			"over",
			"over",
			"within",
			"current",
			"future",
			"future",
		]);
	});

	it("marks the months an income or savings budget fell short", () => {
		const savings = summary(
			() => "-300",
			[-300, -300, -300, -300, -300, -300, -300, 0, -300, -300],
		);

		const year = toBudgetYear(makeBudget("savings"), savings, today);

		expect(year.months[7]?.state).toBe("short");
		expect(year.months[8]?.state).toBe("within");
		expect(year.delta).toBe(-300);
		expect(year.tone).toBe("bad");
	});

	it("projects the year end at the pace so far, the current month split by day", () => {
		const year = toBudgetYear(makeBudget("expense"), groceries, today);

		const elapsed = 9 + 24 / 31;
		expect(year.projection).toBeCloseTo(
			4527 + (4527 / elapsed) * (12 - elapsed),
		);
	});

	it("does not project an occasional budget", () => {
		const occasional = makeBudget("expense", {
			type: "occasional",
			month: 8,
			year: 2026,
			amount: "-1500",
		});
		const holidays = summary(
			(month) => (month === 8 ? "-1500" : null),
			[0, 0, 0, 0, 0, 0, 0, -1730],
		);

		const year = toBudgetYear(occasional, holidays, today);

		expect(year.projection).toBeNull();
		expect(year.months[0]?.state).toBe("none");
		expect(year.months[7]?.state).toBe("over");
		expect(year.delta).toBe(230);
	});

	it("takes the whole year as due once it is over, with nothing to project", () => {
		const year = toBudgetYear(
			makeBudget("expense"),
			groceries,
			new Date(2027, 1, 1),
		);

		expect(year.expectedToDate).toBe(5400);
		expect(year.projection).toBeNull();
		expect(year.remaining).toBe(0);
		expect(year.months[11]?.state).toBe("within");
	});
});

describe("budgetYearStats", () => {
	it("averages over the months elapsed and counts the months over budget", () => {
		const year = toBudgetYear(makeBudget("expense"), groceries, today);

		const stats = budgetYearStats(year, today);

		expect(stats.average).toBeCloseTo(4527 / (9 + 24 / 31));
		expect(stats.peak?.month).toBe(8);
		expect(stats.missed).toBe(5);
		expect(stats.due).toBe(9);
	});
});

describe("typeYearTotals", () => {
	it("sums the budgets of one type, month by month", () => {
		const rent = toBudgetYear(
			makeBudget("expense"),
			summary(() => "-950", Array(10).fill(-950)),
			today,
		);
		const groceriesYear = toBudgetYear(makeBudget("expense"), groceries, today);
		const salary = toBudgetYear(
			makeBudget("income"),
			summary(() => "2800", Array(10).fill(2800)),
			today,
		);
		const entries = [
			{ budget: makeBudget("expense"), year: rent },
			{ budget: makeBudget("expense"), year: groceriesYear },
			{ budget: makeBudget("income"), year: salary },
		];

		const totals = typeYearTotals(entries, "expense", 2026, today);

		expect(totals.planned).toBe(16800);
		expect(totals.real).toBe(9500 + 4527);
		expect(totals.delta).toBe(27);
		expect(totals.tone).toBe("bad");
		expect(totals.months[1]).toMatchObject({
			expected: 1400,
			actual: 1418,
			state: "over",
		});
		expect(totals.months[11]?.state).toBe("future");
	});
});
