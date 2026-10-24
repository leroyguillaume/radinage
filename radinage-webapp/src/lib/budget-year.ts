import type {
	BudgetResponse,
	BudgetSummaryMonth,
	BudgetType,
} from "@/lib/types";

export type BudgetMonthState =
	| "within"
	| "over"
	| "short"
	| "current"
	| "future"
	| "none";

/** Amounts are magnitudes: expense budgets and their operations are both negative. */
export interface BudgetYearMonth {
	year: number;
	month: number;
	/** Null when the budget expects nothing that month. */
	expected: number | null;
	actual: number;
	state: BudgetMonthState;
}

/** Whether the gap to what was expected favours the user. */
export type DeltaTone = "good" | "bad" | "even";

export interface BudgetYear {
	months: BudgetYearMonth[];
	/** Expected over the whole year. */
	planned: number;
	/** Received or spent so far. */
	real: number;
	/** Expected up to the end of the current month; the whole year once it is over. */
	expectedToDate: number;
	/** `real − expectedToDate`. */
	delta: number;
	tone: DeltaTone;
	/** Year-end estimate at the pace so far; null when the pace says nothing. */
	projection: number | null;
	/** Still expected after what is already received this month, up to December. */
	remaining: number;
}

type MonthPosition = "past" | "current" | "future";

function positionOf(year: number, month: number, today: Date): MonthPosition {
	const ordinal = year * 12 + month;
	const todayOrdinal = today.getFullYear() * 12 + today.getMonth() + 1;
	if (ordinal < todayOrdinal) return "past";
	return ordinal === todayOrdinal ? "current" : "future";
}

/** Spending more, or receiving and saving less, than expected is bad. */
export function deltaTone(type: BudgetType, delta: number): DeltaTone {
	if (Math.abs(delta) < 0.005) return "even";
	const tooMuch = delta > 0;
	return tooMuch === (type === "expense") ? "bad" : "good";
}

function monthState(
	type: BudgetType,
	expected: number | null,
	actual: number,
	position: MonthPosition,
): BudgetMonthState {
	if (expected === null && actual === 0) return "none";
	if (position === "future") return expected === null ? "none" : "future";
	if (position === "current") return "current";
	return deltaTone(type, actual - (expected ?? 0)) === "bad"
		? type === "expense"
			? "over"
			: "short"
		: "within";
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

/** Recurrences regular enough for their pace so far to predict the year end. */
function hasSteadyPace(budget: BudgetResponse): boolean {
	return (
		budget.kind.type === "recurring" &&
		(budget.kind.recurrence === "monthly" ||
			budget.kind.recurrence === "weekly")
	);
}

/** Months elapsed and left in the months the budget expects something, the current one split by day. */
function activeMonths(months: BudgetYearMonth[], today: Date) {
	let elapsed = 0;
	let left = 0;
	for (const m of months) {
		if (m.expected === null) continue;
		const position = positionOf(m.year, m.month, today);
		if (position === "past") elapsed += 1;
		else if (position === "future") left += 1;
		else {
			const done = today.getDate() / daysInMonth(m.year, m.month);
			elapsed += done;
			left += 1 - done;
		}
	}
	return { elapsed, left };
}

function remainingOf(month: BudgetYearMonth, position: MonthPosition): number {
	if (month.expected === null || position === "past") return 0;
	if (position === "future") return month.expected;
	return Math.max(month.expected - month.actual, 0);
}

export function toBudgetYear(
	budget: BudgetResponse,
	summary: BudgetSummaryMonth[],
	today: Date,
): BudgetYear {
	let planned = 0;
	let real = 0;
	let expectedToDate = 0;
	let remaining = 0;
	const months = summary.map((m): BudgetYearMonth => {
		const expected = m.expected === null ? null : Math.abs(Number(m.expected));
		const actual = Math.abs(Number(m.actual));
		const position = positionOf(m.year, m.month, today);
		const month: BudgetYearMonth = {
			year: m.year,
			month: m.month,
			expected,
			actual,
			state: monthState(budget.budgetType, expected, actual, position),
		};
		planned += expected ?? 0;
		real += actual;
		if (position !== "future") expectedToDate += expected ?? 0;
		remaining += remainingOf(month, position);
		return month;
	});

	const delta = real - expectedToDate;
	const pace = activeMonths(months, today);
	const projection =
		hasSteadyPace(budget) && pace.elapsed > 0 && pace.left > 0
			? real + (real / pace.elapsed) * pace.left
			: null;

	return {
		months,
		planned,
		real,
		expectedToDate,
		delta,
		tone: deltaTone(budget.budgetType, delta),
		projection,
		remaining,
	};
}

export interface BudgetYearStats {
	/** Per month the budget expected something in, so far. */
	average: number;
	/** The month with the most received or spent, null before anything was. */
	peak: BudgetYearMonth | null;
	/** Complete months that went the wrong way. */
	missed: number;
	/** Complete months the budget expected something in. */
	due: number;
}

export function budgetYearStats(
	budgetYear: BudgetYear,
	today: Date,
): BudgetYearStats {
	const { elapsed } = activeMonths(budgetYear.months, today);
	let peak: BudgetYearMonth | null = null;
	let missed = 0;
	let due = 0;
	for (const m of budgetYear.months) {
		if (m.actual > 0 && (peak === null || m.actual > peak.actual)) peak = m;
		if (m.state === "over" || m.state === "short") missed += 1;
		if (positionOf(m.year, m.month, today) === "past" && m.expected !== null) {
			due += 1;
		}
	}
	return {
		average: elapsed > 0 ? budgetYear.real / elapsed : 0,
		peak,
		missed,
		due,
	};
}

export interface TypeYearTotals {
	planned: number;
	real: number;
	expectedToDate: number;
	delta: number;
	tone: DeltaTone;
	remaining: number;
	/** Every month of the year, summed over the type's budgets. */
	months: BudgetYearMonth[];
}

export interface BudgetWithYear {
	budget: BudgetResponse;
	year: BudgetYear;
}

/** Totals of the budgets of `type`, month by month over `year`. */
export function typeYearTotals(
	entries: BudgetWithYear[],
	type: BudgetType,
	year: number,
	today: Date,
): TypeYearTotals {
	const ofType = entries.filter((e) => e.budget.budgetType === type);
	const months = Array.from({ length: 12 }, (_, i): BudgetYearMonth => {
		const month = i + 1;
		let expected: number | null = null;
		let actual = 0;
		for (const { year: budgetYear } of ofType) {
			const m = budgetYear.months.find((x) => x.month === month);
			if (!m) continue;
			if (m.expected !== null) expected = (expected ?? 0) + m.expected;
			actual += m.actual;
		}
		return {
			year,
			month,
			expected,
			actual,
			state: monthState(type, expected, actual, positionOf(year, month, today)),
		};
	});
	const sum = (pick: (y: BudgetYear) => number) =>
		ofType.reduce((total, e) => total + pick(e.year), 0);
	const real = sum((y) => y.real);
	const expectedToDate = sum((y) => y.expectedToDate);
	const delta = real - expectedToDate;
	return {
		planned: sum((y) => y.planned),
		real,
		expectedToDate,
		delta,
		tone: deltaTone(type, delta),
		remaining: sum((y) => y.remaining),
		months,
	};
}
