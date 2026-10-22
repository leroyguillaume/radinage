import { describe, expect, it } from "vitest";
import {
	centsToDecimal,
	decimalToCents,
	formatAmount,
	formatCompactAmount,
	formatIsoDate,
	formatSignedAmount,
	parseCents,
	parseSignedCents,
} from "@/lib/format";
import { balanceTextColor, budgetTypeTones } from "@/lib/tones";

// Intl uses narrow no-break spaces in fr-FR; normalise them for readability.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("formatAmount", () => {
	it("formats numbers as euros", () => {
		expect(plain(formatAmount(1234.5))).toBe("1 234,50 €");
	});

	it("accepts the API's string amounts", () => {
		expect(plain(formatAmount("-42.1"))).toBe("-42,10 €");
	});
});

describe("formatCompactAmount", () => {
	it("abbreviates thousands and millions", () => {
		expect(plain(formatCompactAmount(26000))).toBe("26 k €");
		expect(plain(formatCompactAmount(-6500))).toBe("-6,5 k €");
		expect(plain(formatCompactAmount(1_234_567))).toBe("1,2 M €");
	});

	it("keeps small amounts without decimals", () => {
		expect(plain(formatCompactAmount(650))).toBe("650 €");
		expect(plain(formatCompactAmount(0))).toBe("0 €");
	});
});

describe("formatIsoDate", () => {
	it("keeps the calendar day of an API date, year included", () => {
		expect(formatIsoDate("2024-02-04", "fr-FR")).toBe("04/02/2024");
		expect(formatIsoDate("2026-12-31", "en-GB")).toBe("31/12/2026");
	});
});

describe("formatSignedAmount", () => {
	it("prefixes positive amounts with a plus sign", () => {
		expect(plain(formatSignedAmount(260))).toBe("+260,00 €");
	});

	it("leaves zero and negative amounts unprefixed", () => {
		expect(plain(formatSignedAmount(0))).toBe("0,00 €");
		expect(plain(formatSignedAmount(-130))).toBe("-130,00 €");
	});
});

describe("balanceTextColor", () => {
	it("uses the income tone above zero and the expense tone below", () => {
		expect(balanceTextColor(1)).toBe(budgetTypeTones.income.text);
		expect(balanceTextColor(-1)).toBe(budgetTypeTones.expense.text);
		expect(balanceTextColor(0)).toBe("var(--mantine-color-dimmed)");
	});
});

describe("cents helpers", () => {
	it("parses typed amounts with either decimal separator", () => {
		expect(parseCents("30")).toBe(3000);
		expect(parseCents("30,5")).toBe(3050);
		expect(parseCents(" 0.07 ")).toBe(7);
		expect(parseCents("-12,34")).toBe(1234);
	});

	it("keeps the sign of a typed amount when asked to", () => {
		expect(parseSignedCents("1523,40")).toBe(152340);
		expect(parseSignedCents(" -80.1")).toBe(-8010);
		expect(parseSignedCents("−5")).toBe(-500);
		expect(parseSignedCents("-")).toBeNull();
		expect(parseSignedCents("12,345")).toBeNull();
	});

	it("rejects what is not an amount", () => {
		expect(parseCents("")).toBeNull();
		expect(parseCents("12,345")).toBeNull();
		expect(parseCents("abc")).toBeNull();
	});

	it("round-trips API decimals without float drift", () => {
		expect(decimalToCents("-0.30")).toBe(-30);
		expect(decimalToCents("1234.56")).toBe(123456);
		expect(centsToDecimal(-3005)).toBe("-30.05");
		expect(centsToDecimal(7)).toBe("0.07");
	});
});
