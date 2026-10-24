import dayjs from "dayjs";
import { centsToDecimal, parseSignedCents } from "@/lib/format";
import type { AccountBalance, BalancePoint } from "@/lib/types";

const ISO_DATE = "YYYY-MM-DD";

export type HistoryPeriod = "3m" | "1y" | "all";

/** First day of a period ending `today`, null for the whole history. */
export function periodStart(period: HistoryPeriod, today: Date): string | null {
	if (period === "all") return null;
	return dayjs(today)
		.subtract(period === "3m" ? 3 : 12, "month")
		.format(ISO_DATE);
}

/** Balance at the end of `date` from points sorted by date; null before the first one. */
export function balanceOn(points: BalancePoint[], date: string): number | null {
	let balance: number | null = null;
	for (const point of points) {
		if (point.date > date) break;
		balance = Number(point.balance);
	}
	return balance;
}

/** The last day of each month from one month to another, today for the current one. */
export function monthEnds(
	fromYear: number,
	fromMonth: number,
	toYear: number,
	toMonth: number,
	today: Date,
): string[] {
	const now = dayjs(today);
	const last = dayjs(new Date(toYear, toMonth - 1));
	const days: string[] = [];
	for (
		let month = dayjs(new Date(fromYear, fromMonth - 1));
		!month.isAfter(last) && !month.isAfter(now, "month");
		month = month.add(1, "month")
	) {
		const end = month.endOf("month");
		days.push((end.isAfter(now) ? now : end).format(ISO_DATE));
	}
	return days;
}

/** One day of the chart: the balance on the solid line, or on the dashed estimate. */
export interface HistoryRow {
	time: number;
	known: number | null;
	estimate: number | null;
}

/** What a balance read differed from its estimate by, drawn on its day. */
export interface HistoryGap {
	time: number;
	estimated: number;
	balance: number;
}

export interface HistoryChart {
	rows: HistoryRow[];
	readings: { time: number; balance: number }[];
	gaps: HistoryGap[];
}

/**
 * What the balance chart of an account draws from its history. With `estimatedTail`, the
 * days after the last balance read are an estimate, drawn apart from the rest.
 */
export function historyChart(
	points: BalancePoint[],
	estimatedTail: boolean,
): HistoryChart {
	const lastRead = points.findLast((p) => p.read)?.date ?? null;
	const dashedFrom = estimatedTail ? lastRead : null;
	const time = (date: string) => dayjs(date).valueOf();
	return {
		rows: points.map((p) => {
			const balance = Number(p.balance);
			return {
				time: time(p.date),
				known: dashedFrom === null || p.date <= dashedFrom ? balance : null,
				estimate: dashedFrom !== null && p.date >= dashedFrom ? balance : null,
			};
		}),
		readings: points
			.filter((p) => p.read)
			.map((p) => ({ time: time(p.date), balance: Number(p.balance) })),
		gaps: points.flatMap((p) =>
			p.estimated !== null && p.estimated !== p.balance
				? [
						{
							time: time(p.date),
							estimated: Number(p.estimated),
							balance: Number(p.balance),
						},
					]
				: [],
		),
	};
}

/** What a balance read differs from its estimate by; null without an estimate. */
export function readingGap(
	amount: string,
	estimated: string | null,
): number | null {
	if (estimated === null) return null;
	return Math.round((Number(amount) - Number(estimated)) * 100) / 100;
}

/** A balance typed in a form, or why it is refused; null when left blank. */
export type BalanceInput =
	| { ok: true; balance: AccountBalance }
	| { ok: false; error: "accounts.errorAmount" | "accounts.errorDate" };

/** Read a typed balance: a signed amount on a day that is not after `today`. */
export function readBalanceInput(
	amount: string,
	date: string | null,
	today: string,
): BalanceInput | null {
	if (amount.trim() === "") return null;
	const cents = parseSignedCents(amount);
	if (cents === null) return { ok: false, error: "accounts.errorAmount" };
	if (date === null || date > today) {
		return { ok: false, error: "accounts.errorDate" };
	}
	return { ok: true, balance: { amount: centsToDecimal(cents), date } };
}
