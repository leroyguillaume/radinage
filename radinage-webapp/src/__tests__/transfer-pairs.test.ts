import { describe, expect, it } from "vitest";
import { operationEntries } from "@/lib/operation-parts";
import { pairTransfers } from "@/lib/transfer-pairs";
import type { AccountResponse, OperationResponse } from "@/lib/types";

function account(id: string, receivesOperations: boolean): AccountResponse {
	return {
		id,
		name: id,
		kind: receivesOperations ? "checking" : "savings",
		imported: receivesOperations,
		receivesOperations,
		balance: null,
		currentBalance: null,
		transferredInto: false,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

const accounts = [
	account("perso", true),
	account("joint", true),
	account("livret", false),
];

function transfer(
	id: string,
	accountId: string,
	amount: string,
	date: string,
	other: string,
	operationId: string | null,
): OperationResponse {
	return {
		id,
		accountId,
		amount,
		date,
		effectiveDate: null,
		label: id,
		budgetLink: { type: "unlinked" },
		ignored: false,
		ignoreRuleId: null,
		categoryId: null,
		effectiveCategoryId: null,
		transfer: { accountId: other, ruleId: null, operationId },
		splits: [],
	};
}

function pairsOf(...ops: OperationResponse[]) {
	return pairTransfers(ops.flatMap(operationEntries), accounts);
}

describe("pairTransfers", () => {
	it("puts both linked sides in one pair, from the debit to the credit", () => {
		const [pair, ...rest] = pairsOf(
			transfer("in", "joint", "800.00", "2026-04-04", "perso", "out"),
			transfer("out", "perso", "-800.00", "2026-04-03", "joint", "in"),
		);

		expect(rest).toEqual([]);
		expect(pair).toMatchObject({
			fromAccountId: "perso",
			toAccountId: "joint",
			amount: 800,
			date: "2026-04-04",
			status: "linked",
		});
		expect(pair?.debit?.operation.id).toBe("out");
		expect(pair?.credit?.operation.id).toBe("in");
	});

	it("keeps a linked side alone when the other one is in another month", () => {
		const [pair] = pairsOf(
			transfer("out", "perso", "-500.00", "2026-04-01", "joint", "march"),
		);

		expect(pair).toMatchObject({ status: "linked", credit: null });
	});

	it("flags a side whose other account receives operations but has no match", () => {
		const [debitOnly, creditOnly] = pairsOf(
			transfer("out", "perso", "-250.00", "2026-04-12", "joint", null),
			transfer("in", "perso", "120.00", "2026-04-21", "joint", null),
		);

		expect(debitOnly).toMatchObject({ status: "missing", credit: null });
		expect(creditOnly).toMatchObject({
			status: "missing",
			debit: null,
			fromAccountId: "joint",
			toAccountId: "perso",
		});
	});

	it("expects no other side on an account not receiving operations", () => {
		const [pair] = pairsOf(
			transfer("out", "perso", "-300.00", "2026-04-05", "livret", null),
		);

		expect(pair).toMatchObject({ status: "oneSided", toAccountId: "livret" });
	});

	it("leaves out the entries which are not transfers", () => {
		const op = transfer("cb", "perso", "-20.00", "2026-04-05", "joint", null);

		expect(pairsOf({ ...op, transfer: null })).toEqual([]);
	});
});
