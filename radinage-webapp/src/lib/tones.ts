import type { BudgetType } from "@/lib/types";

export interface Tone {
	/** Mantine colour key; shade 5 for fills, shade 8 for text. */
	color: string;
	fill: string;
	text: string;
}

function tone(color: string): Tone {
	return {
		color,
		fill: `var(--mantine-color-${color}-5)`,
		text: `var(--mantine-color-${color}-8)`,
	};
}

export const budgetTypeTones: Record<BudgetType, Tone> = {
	income: tone("leaf"),
	expense: tone("tangerine"),
	savings: tone("gold"),
};

export const neutralTone: Tone = {
	color: "forest",
	fill: "var(--mantine-color-forest-7)",
	text: "var(--mantine-color-text)",
};

/** Text colour for a signed balance: green above zero, orange below. */
export function balanceTextColor(amount: number): string {
	if (amount > 0) return budgetTypeTones.income.text;
	if (amount < 0) return budgetTypeTones.expense.text;
	return "var(--mantine-color-dimmed)";
}
