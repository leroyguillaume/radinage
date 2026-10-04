const currency = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});

export function formatAmount(amount: number | string): string {
	return currency.format(typeof amount === "string" ? Number(amount) : amount);
}

export function formatSignedAmount(amount: number): string {
	return amount > 0 ? `+${currency.format(amount)}` : currency.format(amount);
}

function getDecimalSeparator(locale: string): string {
	return locale.startsWith("fr") ? "," : ".";
}

/** Formats a raw decimal ("12.5") for an amount input in the given locale. */
export function toDisplayAmount(raw: string, locale: string): string {
	if (raw === "" || raw === "-") return raw;
	const sep = getDecimalSeparator(locale);
	const num = Number.parseFloat(raw);
	if (Number.isNaN(num)) return raw;
	return num.toFixed(2).replace(".", sep);
}

export function toRawAmount(display: string, locale: string): string {
	const sep = getDecimalSeparator(locale);
	return display.replace(sep, ".");
}

/** Magnitude in integer cents of a typed amount, or null when not a valid amount. */
export function parseCents(input: string): number | null {
	const match = input.trim().match(/^-?(\d+)(?:[.,](\d{1,2}))?$/);
	if (!match) return null;
	const [, units = "0", decimals = ""] = match;
	return Number(units) * 100 + Number(decimals.padEnd(2, "0"));
}

/** Integer cents of an API decimal string, keeping its sign. */
export function decimalToCents(amount: string): number {
	return Math.round(Number(amount) * 100);
}

/** API decimal string ("-30.05") of a signed integer number of cents. */
export function centsToDecimal(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
