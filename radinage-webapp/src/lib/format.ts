const currency = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
});

const compactCurrency = new Intl.NumberFormat("fr-FR", {
	style: "currency",
	currency: "EUR",
	notation: "compact",
	maximumFractionDigits: 1,
});

export function formatAmount(amount: number | string): string {
	return currency.format(typeof amount === "string" ? Number(amount) : amount);
}

/** Short amount for chart axes: "19,5 k €". */
export function formatCompactAmount(amount: number): string {
	return compactCurrency.format(amount);
}

/** "mars 2026" in `locale`. */
export function formatMonthYear(
	{ year, month }: { year: number; month: number },
	locale: string,
): string {
	return new Date(year, month - 1).toLocaleDateString(locale, {
		month: "long",
		year: "numeric",
	});
}

/** "05/03/2026" in `locale` for an API date ("2026-03-05"), read as a local date. */
export function formatIsoDate(iso: string, locale: string): string {
	const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	}).format(new Date(year, month - 1, day));
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

/** Signed integer cents of a typed amount ("-12,5" → -1250), or null when not a valid amount. */
export function parseSignedCents(input: string): number | null {
	const trimmed = input.trim().replace(/^−/, "-");
	const cents = parseCents(trimmed);
	if (cents === null) return null;
	return trimmed.startsWith("-") ? -cents : cents;
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
