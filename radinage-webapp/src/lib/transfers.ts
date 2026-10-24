import { budgetTypeTones, type Tone } from "@/lib/tones";
import type {
	AccountKind,
	AccountResponse,
	BudgetResponse,
	OperationResponse,
	TransferRuleResponse,
} from "@/lib/types";

/** What puts money on an account: the savings budgets paying into it, and the accounts whose rules transfer to it. */
export interface Feeders {
	budgets: string[];
	accounts: string[];
}

export function feedersOf(
	accountId: string,
	budgets: BudgetResponse[],
	rules: TransferRuleResponse[],
	accounts: AccountResponse[],
): Feeders {
	const sources = new Set(
		rules
			.filter((r) => r.counterpartAccountId === accountId)
			.map((r) => r.accountId),
	);
	return {
		budgets: budgets
			.filter((b) => b.accountId === accountId)
			.map((b) => b.label),
		accounts: accounts.filter((a) => sources.has(a.id)).map((a) => a.name),
	};
}

/** The budgets by name, then the transferring accounts as one entry worded by `fedByTransfers`. */
export function feederNames(
	feeders: Feeders,
	fedByTransfers: (accounts: string) => string,
): string[] {
	return feeders.accounts.length === 0
		? feeders.budgets
		: [...feeders.budgets, fedByTransfers(feeders.accounts.join(", "))];
}

/** How a transfer counts, from the side of the account the operation is on. */
export type TransferFlow = "toSavings" | "fromSavings" | "internal";

export function transferFlowOf(
	kind: AccountKind,
	amount: number,
): TransferFlow {
	if (kind === "checking") return "internal";
	return amount < 0 ? "toSavings" : "fromSavings";
}

/** Null when the operation is not a transfer, or its other account is not among `accounts`. */
export function transferFlow(
	op: OperationResponse,
	accounts: AccountResponse[],
): TransferFlow | null {
	const other = op.transfer
		? accounts.find((a) => a.id === op.transfer?.accountId)
		: undefined;
	return other ? transferFlowOf(other.kind, Number(op.amount)) : null;
}

const internalTone: Tone = {
	color: "gray",
	fill: "var(--mantine-color-gray-5)",
	text: "var(--mantine-color-dimmed)",
};

/** Savings gold for money put aside, orange for money taken back, grey otherwise. */
export function transferTone(flow: TransferFlow): Tone {
	switch (flow) {
		case "toSavings":
			return budgetTypeTones.savings;
		case "fromSavings":
			return budgetTypeTones.expense;
		case "internal":
			return internalTone;
	}
}

/**
 * The budgets a transfer with `account` can count towards: savings budgets sending their
 * money to it, or to no account in particular, when it puts money aside; none otherwise.
 */
export function budgetsForTransfer(
	budgets: BudgetResponse[],
	account: AccountResponse,
	amount: number,
): BudgetResponse[] {
	if (transferFlowOf(account.kind, amount) !== "toSavings") return [];
	return budgets.filter(
		(b) =>
			b.budgetType === "savings" &&
			(b.accountId === null || b.accountId === account.id),
	);
}
