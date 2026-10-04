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
