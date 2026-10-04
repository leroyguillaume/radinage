export type BudgetType = "expense" | "income" | "savings";

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	pageSize: number;
	maxPage: number;
}

export interface OperationResponse {
	id: string;
	amount: string;
	date: string;
	effectiveDate: string | null;
	label: string;
	budgetLink: BudgetLink;
	/** Parts of a split operation, in order; empty when the operation is whole. */
	splits: OperationSplitResponse[];
}

export interface OperationSplitResponse {
	id: string;
	/** Signed decimal, same sign as the parent operation's amount. */
	amount: string;
	budgetId: string | null;
}

export type OperationSplitRequest = Omit<OperationSplitResponse, "id">;

export type BudgetLink =
	| { type: "unlinked" }
	| { type: "manual"; budgetId: string }
	| { type: "auto"; budgetId: string };

export interface MonthlyOperationsResponse {
	operations: OperationResponse[];
}

export interface BudgetedTotals {
	expense: string;
	income: string;
	savings: string;
}

export interface MonthlySummary {
	year: number;
	month: number;
	unbudgeted: string;
	budgeted: BudgetedTotals;
}

export interface SummaryResponse {
	months: MonthlySummary[];
}

export type ForecastMonthStatus = "past" | "current" | "future";

export interface ForecastFlows {
	income: string;
	expenses: string;
	savings: string;
	balance: string;
}

export interface ForecastMonth extends ForecastFlows {
	year: number;
	month: number;
	status: ForecastMonthStatus;
	/** Part of `balance` the budgets still expect this month; "0" outside the current month. */
	committed: string;
	/** Unbudgeted spending expected at `unbudgetedRate`, included in `expenses`; "0" for past months. */
	unbudgetedForecast: string;
	cumulative: string;
}

export interface ForecastResponse {
	months: ForecastMonth[];
	totals: ForecastFlows;
	/** Account balance at the start of the horizon, from the recorded balance; null when none is recorded. */
	startingBalance: string | null;
	endBalance: string;
	/** Average daily unbudgeted spending of the 3 complete months before the current one; never positive. */
	unbudgetedRate: string;
	/** Days from today to the end of the horizon, both included; 0 once it is over. */
	daysLeft: number;
	/** Per-day room for unbudgeted spending without ending in the red; may be negative, null once the horizon is over. */
	dailyBudget: string | null;
	/** First month whose cumulative is below zero. */
	firstNegativeMonth: YearMonth | null;
}

/** One budget's part in a forecast month; `projected` = `actual` + `remaining`. */
export interface ForecastBudgetLine {
	budgetId: string;
	label: string;
	budgetType: BudgetType;
	/** What the budget expects this month; null when it expects nothing. */
	expected: string | null;
	/** Net of the amounts linked this month; "0" for a future month. */
	actual: string;
	/** Still counted on top of `actual`: "0" for a past month, the whole expected amount for a future one. */
	remaining: string;
	projected: string;
}

export interface ForecastUnbudgetedLine {
	actual: string;
	/** The month's `unbudgetedForecast`. */
	forecast: string;
	projected: string;
}

export interface ForecastMonthBreakdown {
	year: number;
	month: number;
	status: ForecastMonthStatus;
	/** Sorted by type (income, expense, savings), then by decreasing magnitude of `projected`. */
	budgets: ForecastBudgetLine[];
	unbudgeted: ForecastUnbudgetedLine;
	/** The month's figures in `GET /forecast`. */
	totals: ForecastFlows;
}

export interface YearMonth {
	year: number;
	month: number;
}

export interface ClosedPeriod {
	start: YearMonth;
	end: YearMonth;
	amount: string;
}

export interface CurrentPeriod {
	start: YearMonth;
	end: YearMonth | null;
	amount: string;
}

export type Recurrence = "weekly" | "monthly" | "quarterly" | "yearly";

export type BudgetKind =
	| {
			type: "recurring";
			recurrence: Recurrence;
			closedPeriods: ClosedPeriod[];
			currentPeriod: CurrentPeriod;
	  }
	| {
			type: "occasional";
			month: number;
			year: number;
			amount: string;
	  };

export interface Rule {
	labelPattern: LabelPattern;
	matchAmount: boolean;
}

export type LabelPattern =
	| { type: "startsWith"; value: string }
	| { type: "endsWith"; value: string }
	| { type: "contains"; value: string };

export interface BudgetResponse {
	id: string;
	label: string;
	budgetType: BudgetType;
	kind: BudgetKind;
	rules: Rule[];
	createdAt: string;
}

export interface ApplyBudgetResponse {
	updated: number;
	skipped: number;
}

export interface CreateUserResponse {
	id: string;
	username: string;
	role: string;
	invitationLink?: string;
}

export interface ResetPasswordResponse {
	resetLink: string;
}

/** Account balance read on `date`; operations accounted that day are included in `amount`. */
export interface AccountBalance {
	amount: string;
	/** YYYY-MM-DD, today or earlier. */
	date: string;
}

export interface ExportDataResponse {
	version: number;
	exportedAt: string;
	balance?: AccountBalance | null;
	budgets: unknown[];
	operations: unknown[];
}

export interface ImportDataResponse {
	importedBudgets: number;
	skippedBudgets: number;
	importedOperations: number;
	skippedOperations: number;
	importedBalance: boolean;
}
