import { describe, expect, it } from "vitest";
import { formatAmount, formatSignedAmount } from "@/lib/format";
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
