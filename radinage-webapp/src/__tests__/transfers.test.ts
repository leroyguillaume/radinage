import { describe, expect, it } from "vitest";
import {
	budgetsForTransfer,
	feederNames,
	feedersOf,
	transferFlowOf,
} from "@/lib/transfers";
import type {
	AccountResponse,
	BudgetResponse,
	TransferRuleResponse,
} from "@/lib/types";

function account(
	id: string,
	kind: AccountResponse["kind"],
	name = id,
): AccountResponse {
	return {
		id,
		name,
		kind,
		imported: kind === "checking",
		receivesOperations: kind === "checking",
		balance: null,
		currentBalance: null,
		transferredInto: false,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

function budget(
	id: string,
	budgetType: BudgetResponse["budgetType"],
	accountId: string | null,
): BudgetResponse {
	return {
		id,
		label: id,
		budgetType,
		kind: { type: "occasional", month: 1, year: 2026, amount: "-100" },
		rules: [],
		categoryId: null,
		accountId,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

const livret = account("livret", "savings", "Livret A");
const joint = account("joint", "checking", "Compte joint");

describe("transferFlowOf", () => {
	it("follows the other account's kind and the operation's sign", () => {
		expect(transferFlowOf("savings", -300)).toBe("toSavings");
		expect(transferFlowOf("savings", 500)).toBe("fromSavings");
		expect(transferFlowOf("checking", -450)).toBe("internal");
		expect(transferFlowOf("checking", 450)).toBe("internal");
	});
});

describe("budgetsForTransfer", () => {
	const budgets = [
		budget("livret-goal", "savings", "livret"),
		budget("any-savings", "savings", null),
		budget("pel-goal", "savings", "pel"),
		budget("groceries", "expense", null),
	];

	it("offers the savings budgets of the account to money put aside", () => {
		expect(budgetsForTransfer(budgets, livret, -300).map((b) => b.id)).toEqual([
			"livret-goal",
			"any-savings",
		]);
	});

	it("offers nothing to money taken back or moved between checking accounts", () => {
		expect(budgetsForTransfer(budgets, livret, 500)).toEqual([]);
		expect(budgetsForTransfer(budgets, joint, -450)).toEqual([]);
	});
});

describe("feeders", () => {
	it("names the savings budgets, then the accounts transferring by rule", () => {
		const rule: TransferRuleResponse = {
			id: "r1",
			accountId: "bnp",
			counterpartAccountId: "livret",
			labelPattern: { type: "contains", value: "LIVRET" },
			counterpartLabelPattern: null,
			createdAt: "2026-01-01T00:00:00Z",
		};
		const feeders = feedersOf(
			"livret",
			[budget("Objectif", "savings", "livret")],
			[rule, { ...rule, id: "r2" }],
			[account("bnp", "checking", "Courant BNP"), livret],
		);

		expect(feeders).toEqual({
			budgets: ["Objectif"],
			accounts: ["Courant BNP"],
		});
		expect(feederNames(feeders, (names) => `${names} (virements)`)).toEqual([
			"Objectif",
			"Courant BNP (virements)",
		]);
	});
});
