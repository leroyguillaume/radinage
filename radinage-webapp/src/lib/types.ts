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
	/** Ignored operations are left out of every total, summary and forecast. */
	ignored: boolean;
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
	importedCategories: number;
	skippedCategories: number;
	importedBudgets: number;
	skippedBudgets: number;
	importedOperations: number;
	skippedOperations: number;
	importedImportProfiles: number;
	skippedImportProfiles: number;
	importedBalance: boolean;
}

/** A named bank statement layout; columns are 0-based indexes. */
export interface ImportProfileResponse {
	id: string;
	name: string;
	labelCol: number;
	amountCol: number;
	dateCol: number;
	dateFormat: string;
	skipLines: number;
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

/** Keys of the Mantine palette a category can be shown with. */
export const CATEGORY_COLORS = [
	"forest",
	"blue",
	"cyan",
	"teal",
	"lime",
	"yellow",
	"orange",
	"red",
	"pink",
	"grape",
	"violet",
	"indigo",
	"gray",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

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
	createdAt: string;
}

export type CategoryRequest = Omit<CategoryResponse, "id" | "createdAt">;

/** What a category looks like, independently of its name. */
export type CategoryLook = Pick<CategoryResponse, "color" | "icon">;
