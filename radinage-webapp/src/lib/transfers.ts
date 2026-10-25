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

/** Days between the two sides of a transfer for them to be paired, as the API pairs them. */
export const TRANSFER_PAIRING_DAYS = 5;

/** First and last day (YYYY-MM-DD) the other side of a transfer dated `date` can be on. */
export function pairingWindow(date: string): { from: string; to: string } {
	const shift = (days: number) => {
		const day = new Date(`${date}T00:00:00Z`);
		day.setUTCDate(day.getUTCDate() + days);
		return day.toISOString().slice(0, 10);
	};
	return {
		from: shift(-TRANSFER_PAIRING_DAYS),
		to: shift(TRANSFER_PAIRING_DAYS),
	};
}

/**
 * Whether `candidate` can be the other side of the transfer `op` with its account: of opposite
 * amount, whole, and not a transfer with any other account nor already paired.
 */
export function canPair(
	op: OperationResponse,
	candidate: OperationResponse,
): boolean {
	return (
		Number(candidate.amount) === -Number(op.amount) &&
		candidate.splits.length === 0 &&
		(candidate.transfer === null ||
			(candidate.transfer.accountId === op.accountId &&
				candidate.transfer.operationId === null))
	);
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
 * What savings gained over the period: `savings` is negative and `withdrawals`
 * positive as seen from the current account, so the sum is flipped.
 */
export function netSavings(savings: number, withdrawals: number): number {
	return -(savings + withdrawals);
}

/** Savings gold, orange once more was taken back from savings than was put in. */
export function netSavingsTone(net: number): Tone {
	return net < 0 ? budgetTypeTones.expense : budgetTypeTones.savings;
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
