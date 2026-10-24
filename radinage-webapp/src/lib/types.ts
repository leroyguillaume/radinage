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
	/** Account the operation was recorded or imported on. */
	accountId: string;
	amount: string;
	date: string;
	effectiveDate: string | null;
	label: string;
	budgetLink: BudgetLink;
	/** Ignored operations are left out of every total, summary and forecast. */
	ignored: boolean;
	/** Ignore rule that ignored the operation; null when ignored by hand or not ignored. */
	ignoreRuleId: string | null;
	/** Category the user put the operation in; always null when split. */
	categoryId: string | null;
	/** Own category, else the linked budget's; always null when split. */
	effectiveCategoryId: string | null;
	/** Parts of a split operation, in order; empty when the operation is whole. */
	splits: OperationSplitResponse[];
}

/** Aggregates over every operation matching a search, not only the returned page. */
export interface OperationSearchTotals {
	/** Sum of the positive amounts. */
	income: string;
	/** Sum of the negative amounts; zero or negative. */
	expense: string;
	/** Earliest accounting date (YYYY-MM-DD), null when nothing matches. */
	firstDate: string | null;
	lastDate: string | null;
}

export interface OperationSearchResponse
	extends PaginatedResponse<OperationResponse> {
	totals: OperationSearchTotals;
}

export interface OperationSplitResponse {
	id: string;
	/** Signed decimal, same sign as the parent operation's amount. */
	amount: string;
	/** Date the part counts on (YYYY-MM-DD); null to follow its operation. */
	effectiveDate: string | null;
	budgetId: string | null;
	categoryId: string | null;
	/** Own category, else the part's budget's. */
	effectiveCategoryId: string | null;
}

export type OperationSplitRequest = Omit<
	OperationSplitResponse,
	"id" | "effectiveCategoryId"
>;

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

export interface CategoryTotal {
	/** Null for the amounts without a category. */
	categoryId: string | null;
	income: string;
	/** Zero or negative. */
	expense: string;
}

export interface CategorySummaryResponse {
	/** Most spent first. */
	categories: CategoryTotal[];
}

/** Signed like operations. */
export interface BudgetSummaryMonth {
	year: number;
	month: number;
	/** Null when the budget expects nothing that month. */
	expected: string | null;
	actual: string;
}

export interface BudgetSummaryEntry {
	budgetId: string;
	months: BudgetSummaryMonth[];
}

export interface BudgetSummaryResponse {
	budgets: BudgetSummaryEntry[];
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
	/** Default category of the operations linked to the budget. */
	categoryId: string | null;
	/** Savings account a savings budget's money goes to; always null on other budgets. */
	accountId: string | null;
	createdAt: string;
}

export interface ApplyBudgetResponse {
	updated: number;
	skipped: number;
}

/** Ignores the operations whose label, and amount when given, it matches. */
export interface IgnoreRuleResponse {
	id: string;
	labelPattern: LabelPattern;
	/** Positive amount matched whatever the operation's sign; null matches any. */
	amount: string | null;
	createdAt: string;
}

export type IgnoreRuleRequest = Pick<
	IgnoreRuleResponse,
	"labelPattern" | "amount"
>;

export interface ApplyIgnoreRuleResponse {
	/** Matching operations the rule now ignores. */
	ignored: number;
	/** Matching operations that were already ignored and are left as they are. */
	alreadyIgnored: number;
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

export type AccountKind = "checking" | "savings";

/** Balance read on `date`; operations accounted that day are included in `amount`. */
export interface BalanceEntry {
	id: string;
	amount: string;
	/** YYYY-MM-DD, today or earlier. */
	date: string;
}

export type AccountBalance = Omit<BalanceEntry, "id">;

/** A bank account; only an imported checking account holds operations. */
export interface AccountResponse {
	id: string;
	name: string;
	kind: AccountKind;
	/** Whether its statements are imported; a checking account only. */
	imported: boolean;
	/** Whether operations can be imported on it: an imported checking account. */
	receivesOperations: boolean;
	/** Most recent balance read, null when none. */
	balance: BalanceEntry | null;
	/**
	 * Balance today: `balance`, plus the operations dated after it on an account receiving
	 * them, or what its savings budgets saved after it on a savings account.
	 */
	currentBalance: string | null;
	createdAt: string;
}

export type AccountRequest = Pick<
	AccountResponse,
	"name" | "kind" | "imported"
>;

export interface ExportDataResponse {
	version: number;
	exportedAt: string;
	accounts?: unknown[];
	budgets: unknown[];
	operations: unknown[];
}

export interface ImportDataResponse {
	importedCategories: number;
	skippedCategories: number;
	importedBudgets: number;
	skippedBudgets: number;
	importedIgnoreRules: number;
	skippedIgnoreRules: number;
	importedOperations: number;
	skippedOperations: number;
	importedImportProfiles: number;
	skippedImportProfiles: number;
	importedAccounts: number;
	skippedAccounts: number;
	/** Balances of the accounts created, and the single balance of an older export. */
	importedBalances: number;
}

/** Field separator of a CSV file; spreadsheets ignore it. */
export type CsvDelimiter = "comma" | "semicolon" | "tab" | "pipe";

/** A named bank statement layout; columns are 0-based indexes. */
export interface ImportProfileResponse {
	id: string;
	name: string;
	/** Account the profile imports operations on. */
	accountId: string;
	labelCol: number;
	amountCol: number;
	dateCol: number;
	dateFormat: string;
	skipLines: number;
	csvDelimiter: CsvDelimiter;
	lastUsedAt: string | null;
	createdAt: string;
}

export type ImportProfileRequest = Omit<
	ImportProfileResponse,
	"id" | "lastUsedAt" | "createdAt"
>;

export interface ImportPreviewResponse {
	/** Leading rows of the file, header included; rows may differ in length. */
	rows: string[][];
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: { row: number; reason: string }[];
}

/** A category's colour, as `#rrggbb`. */
export type CategoryColor = string;

/** Icons a category can be shown with, drawn from `categoryIcons`. */
export const CATEGORY_ICONS = [
	"cart",
	"bakery",
	"home",
	"rental",
	"mortgage",
	"apartment",
	"realEstate",
	"furniture",
	"cleaning",
	"laundry",
	"moving",
	"car",
	"motorbike",
	"bike",
	"bus",
	"train",
	"fuel",
	"parking",
	"tolls",
	"plane",
	"restaurant",
	"fastFood",
	"coffee",
	"drinks",
	"health",
	"pharmacy",
	"doctor",
	"dentist",
	"optician",
	"clothes",
	"onlineShopping",
	"gift",
	"phone",
	"internet",
	"computer",
	"tv",
	"electricity",
	"water",
	"heating",
	"education",
	"books",
	"baby",
	"pets",
	"movies",
	"tickets",
	"music",
	"photo",
	"hobbies",
	"games",
	"gambling",
	"sport",
	"fitness",
	"holidays",
	"accommodation",
	"camping",
	"repairs",
	"bills",
	"post",
	"taxes",
	"bank",
	"fees",
	"loan",
	"transfer",
	"refund",
	"savings",
	"investments",
	"crypto",
	"cash",
	"wallet",
	"card",
	"salary",
	"bonus",
	"business",
	"pension",
	"benefits",
	"insurance",
	"beauty",
	"tobacco",
	"garden",
	"charity",
	"subscriptions",
	"family",
	"other",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export interface CategoryResponse {
	id: string;
	name: string;
	color: CategoryColor;
	/** Null shows the colour alone. */
	icon: CategoryIcon | null;
	/** Give the category to the new operations they match that have none of their own. */
	rules: CategoryRule[];
	createdAt: string;
}

export interface CategoryRule {
	labelPattern: LabelPattern;
}

/** Operations a category's rules were applied to. */
export type ApplyCategoryResponse = ApplyBudgetResponse;

/** How many of the operations a single request named changed. */
export interface OperationsUpdatedResponse {
	updated: number;
}

export type CategoryRequest = Omit<CategoryResponse, "id" | "createdAt">;

/** What a category looks like, independently of its name. */
export type CategoryLook = Pick<CategoryResponse, "color" | "icon">;
