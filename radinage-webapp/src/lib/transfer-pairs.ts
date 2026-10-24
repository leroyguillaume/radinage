import type { OperationEntry } from "@/lib/operation-parts";
import type { AccountResponse } from "@/lib/types";

/**
 * Whether the other side of a transfer is known: linked to it, expected but not found on
 * an account receiving operations, or never expected since the other account is not one.
 */
export type TransferPairStatus = "linked" | "missing" | "oneSided";

/** One transfer between two accounts, with its sides among the entries shown. */
export interface TransferPair {
	key: string;
	/** The side leaving `fromAccountId`; null when it is not among the entries. */
	debit: OperationEntry | null;
	/** The side landing on `toAccountId`; null when it is not among the entries. */
	credit: OperationEntry | null;
	fromAccountId: string;
	toAccountId: string;
	/** The amount moved, positive. */
	amount: number;
	/** The date of the latest side shown (YYYY-MM-DD). */
	date: string;
	status: TransferPairStatus;
}

/**
 * The transfers among `entries`, each linked side next to its other one when both are shown,
 * in the order of their first side in `entries`. Entries which are not transfers are left out.
 */
export function pairTransfers(
	entries: OperationEntry[],
	accounts: AccountResponse[],
): TransferPair[] {
	const wholeById = new Map(
		entries.filter((e) => e.part === null).map((e) => [e.operation.id, e]),
	);
	const used = new Set<string>();
	const pairs: TransferPair[] = [];

	for (const entry of entries) {
		const transfer = entry.operation.transfer;
		if (transfer === null || used.has(entry.key)) continue;
		used.add(entry.key);

		const found =
			transfer.operationId === null
				? undefined
				: wholeById.get(transfer.operationId);
		const counterpart = found && !used.has(found.key) ? found : null;
		if (counterpart) used.add(counterpart.key);

		const outgoing = entry.amount < 0;
		const other = accounts.find((a) => a.id === transfer.accountId);
		pairs.push({
			key: entry.key,
			debit: outgoing ? entry : counterpart,
			credit: outgoing ? counterpart : entry,
			fromAccountId: outgoing ? entry.operation.accountId : transfer.accountId,
			toAccountId: outgoing ? transfer.accountId : entry.operation.accountId,
			amount: Math.abs(entry.amount),
			date:
				counterpart && counterpart.date > entry.date
					? counterpart.date
					: entry.date,
			status:
				transfer.operationId !== null
					? "linked"
					: other?.receivesOperations
						? "missing"
						: "oneSided",
		});
	}
	return pairs;
}
