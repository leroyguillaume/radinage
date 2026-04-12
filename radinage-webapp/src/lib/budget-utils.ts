import type { BudgetResponse, YearMonth } from "@/lib/types";

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

function ymLte(a: YearMonth, b: YearMonth): boolean {
	return a.year < b.year || (a.year === b.year && a.month <= b.month);
}

function ymToOrdinal(ym: YearMonth): number {
	return ym.year * 12 + ym.month;
}

export function getBudgetedAmountForMonth(
	budget: BudgetResponse,
	year: number,
	month: number,
): number | null {
	if (budget.kind.type === "occasional") {
		if (budget.kind.year === year && budget.kind.month === month) {
			return Number(budget.kind.amount);
		}
		return null;
	}

	const ym: YearMonth = { year, month };
	let rawAmount: number | null = null;
	let periodStart: YearMonth | null = null;

	for (const period of budget.kind.closedPeriods) {
		if (ymLte(period.start, ym) && ymLte(ym, period.end)) {
			rawAmount = Number(period.amount);
			periodStart = period.start;
			break;
		}
	}

	if (rawAmount === null) {
		const current = budget.kind.currentPeriod;
		if (
			ymLte(current.start, ym) &&
			(current.end === null || ymLte(ym, current.end))
		) {
			rawAmount = Number(current.amount);
			periodStart = current.start;
		}
	}

	if (rawAmount === null || periodStart === null) return null;

	const recurrence = budget.kind.recurrence;

	if (recurrence === "weekly") {
		const weeks = Math.round(daysInMonth(year, month) / 7);
		return rawAmount * weeks;
	}

	if (recurrence === "quarterly") {
		const diff = ymToOrdinal(ym) - ymToOrdinal(periodStart);
		if (diff % 3 !== 0) return null;
		return rawAmount;
	}

	if (recurrence === "yearly") {
		const diff = ymToOrdinal(ym) - ymToOrdinal(periodStart);
		if (diff % 12 !== 0) return null;
		return rawAmount;
	}

	// Monthly
	return rawAmount;
}
