import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import {
	balanceOn,
	historyChart,
	monthEnds,
	periodStart,
	readBalanceInput,
	readingGap,
} from "@/lib/balance-history";
import type { BalancePoint } from "@/lib/types";

const point = (
	date: string,
	balance: string,
	read = false,
	estimated: string | null = null,
): BalancePoint => ({ date, balance, read, estimated });

const history = [
	point("2026-03-31", "8240.00", true),
	point("2026-04-10", "8440.00"),
	point("2026-06-30", "8955.10", true, "8840.00"),
	point("2026-07-10", "9155.10"),
	point("2026-09-30", "8742.30", true, "9555.10"),
	point("2026-10-10", "8942.30"),
	point("2026-10-24", "8942.30"),
];

const time = (date: string) => dayjs(date).valueOf();

describe("periodStart", () => {
	it("goes back three months or a year, or not at all", () => {
		const today = new Date(2026, 9, 24);
		expect(periodStart("3m", today)).toBe("2026-07-24");
		expect(periodStart("1y", today)).toBe("2025-10-24");
		expect(periodStart("all", today)).toBeNull();
	});
});

describe("balanceOn", () => {
	it("takes the last point on or before the day", () => {
		expect(balanceOn(history, "2026-03-30")).toBeNull();
		expect(balanceOn(history, "2026-03-31")).toBe(8240);
		expect(balanceOn(history, "2026-05-31")).toBe(8440);
		expect(balanceOn(history, "2026-12-31")).toBe(8942.3);
	});
});

describe("monthEnds", () => {
	it("ends each month on its last day, the current one today, and stops there", () => {
		expect(monthEnds(2026, 1, 2026, 12, new Date(2026, 2, 15))).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-15",
		]);
		expect(monthEnds(2025, 11, 2026, 1, new Date(2026, 9, 24))).toEqual([
			"2025-11-30",
			"2025-12-31",
			"2026-01-31",
		]);
	});
});

describe("historyChart", () => {
	it("draws the estimate after the last reading apart, and each reading's gap", () => {
		const chart = historyChart(history, true);

		expect(chart.rows.at(3)).toEqual({
			time: time("2026-07-10"),
			known: 9155.1,
			estimate: null,
		});
		expect(chart.rows.at(4)).toEqual({
			time: time("2026-09-30"),
			known: 8742.3,
			estimate: 8742.3,
		});
		expect(chart.rows.at(-1)).toEqual({
			time: time("2026-10-24"),
			known: null,
			estimate: 8942.3,
		});
		expect(chart.readings.map((r) => r.balance)).toEqual([
			8240, 8955.1, 8742.3,
		]);
		expect(chart.gaps).toEqual([
			{ time: time("2026-06-30"), estimated: 8840, balance: 8955.1 },
			{ time: time("2026-09-30"), estimated: 9555.1, balance: 8742.3 },
		]);
	});

	it("keeps a single line when the movements tell the whole story", () => {
		const chart = historyChart(history, false);

		expect(chart.rows.every((r) => r.estimate === null)).toBe(true);
		expect(chart.rows.at(-1)?.known).toBe(8942.3);
	});
});

describe("readingGap", () => {
	it("is the reading minus its estimate, to the cent", () => {
		expect(readingGap("8742.30", "9555.10")).toBe(-812.8);
		expect(readingGap("8955.10", "8840.00")).toBe(115.1);
		expect(readingGap("8240.00", null)).toBeNull();
	});
});

describe("readBalanceInput", () => {
	it("reads a signed amount on a day that is not in the future", () => {
		const today = "2026-10-24";
		expect(readBalanceInput(" ", today, today)).toBeNull();
		expect(readBalanceInput("-12,5", "2026-10-01", today)).toEqual({
			ok: true,
			balance: { amount: "-12.50", date: "2026-10-01" },
		});
		expect(readBalanceInput("douze", today, today)).toEqual({
			ok: false,
			error: "accounts.errorAmount",
		});
		expect(readBalanceInput("12", "2026-10-25", today)).toEqual({
			ok: false,
			error: "accounts.errorDate",
		});
		expect(readBalanceInput("12", null, today)).toEqual({
			ok: false,
			error: "accounts.errorDate",
		});
	});
});
