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
}

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
	budgetType: "expense" | "income" | "savings";
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
