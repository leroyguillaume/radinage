export const OPERATION_DIRECTIONS = ["expense", "income"] as const;
export type OperationDirection = (typeof OPERATION_DIRECTIONS)[number];

/** Choices besides the default, which leaves the ignored operations out. */
export const IGNORED_FILTERS = ["only", "included"] as const;
export type IgnoredFilter = (typeof IGNORED_FILTERS)[number];

export const OPERATION_SORTS = ["date", "amount", "label"] as const;
export type OperationSort = (typeof OPERATION_SORTS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Criteria of a search across every operation; an absent key does not filter. */
export interface OperationFilters {
	label?: string;
	categoryIds?: string[];
	/** Also keeps the operations without a category, on top of `categoryIds`. */
	uncategorized?: boolean;
	budgetIds?: string[];
	direction?: OperationDirection;
	/** Inclusive bounds on the absolute amount, as API decimals ("12.50"). */
	amountMin?: string;
	amountMax?: string;
	/** YYYY-MM-DD bounds on the accounting date. */
	dateFrom?: string;
	dateTo?: string;
	/** The ignored operations alone, or along with the others; left out when absent. */
	ignored?: IgnoredFilter;
	sort?: OperationSort;
	order?: SortOrder;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

// The router JSON-parses search values, so "12.5" or a numeric label arrive as numbers.
function asString(value: unknown): string | undefined {
	if (typeof value === "number") return String(value);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function asMatching(value: unknown, pattern: RegExp): string | undefined {
	const str = asString(value);
	return str !== undefined && pattern.test(str) ? str : undefined;
}

function asOneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | undefined {
	return allowed.find((option) => option === value);
}

function asIdList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids = value.filter(
		(id): id is string => typeof id === "string" && id !== "",
	);
	return ids.length > 0 ? ids : undefined;
}

function asFlag(value: unknown): true | undefined {
	return value === true || value === "true" ? true : undefined;
}

function isEmpty(value: unknown): boolean {
	return (
		value === undefined ||
		value === false ||
		value === "" ||
		(Array.isArray(value) && value.length === 0)
	);
}

/** Drops the keys that do not filter, so they stay out of the URL. */
function compact(filters: OperationFilters): OperationFilters {
	return Object.fromEntries(
		Object.entries(filters).filter(([, value]) => !isEmpty(value)),
	);
}

/** `filters` with `patch` applied; a key set to undefined, "" or [] is removed. */
export function mergeFilters(
	filters: OperationFilters,
	patch: OperationFilters,
): OperationFilters {
	return compact({ ...filters, ...patch });
}

export function parseOperationFilters(
	search: Record<string, unknown>,
): OperationFilters {
	return compact({
		label: asString(search.label),
		categoryIds: asIdList(search.categoryIds),
		uncategorized: asFlag(search.uncategorized),
		budgetIds: asIdList(search.budgetIds),
		direction: asOneOf(search.direction, OPERATION_DIRECTIONS),
		amountMin: asMatching(search.amountMin, DECIMAL_PATTERN),
		amountMax: asMatching(search.amountMax, DECIMAL_PATTERN),
		dateFrom: asMatching(search.dateFrom, DATE_PATTERN),
		dateTo: asMatching(search.dateTo, DATE_PATTERN),
		ignored: asOneOf(search.ignored, IGNORED_FILTERS),
		sort: asOneOf(search.sort, OPERATION_SORTS),
		order: asOneOf(search.order, SORT_ORDERS),
	});
}

/** Query string of `GET /operations` for one page of the search. */
export function operationSearchQuery(
	filters: OperationFilters,
	page: number,
	pageSize: number,
): string {
	const params = new URLSearchParams();
	const label = filters.label?.trim();
	if (label) params.set("label", label);
	for (const id of filters.categoryIds ?? []) params.append("categoryId", id);
	if (filters.uncategorized) params.set("uncategorized", "true");
	for (const id of filters.budgetIds ?? []) params.append("budgetId", id);
	if (filters.direction) params.set("direction", filters.direction);
	if (filters.amountMin) params.set("amountMin", filters.amountMin);
	if (filters.amountMax) params.set("amountMax", filters.amountMax);
	if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
	if (filters.dateTo) params.set("dateTo", filters.dateTo);
	if (filters.ignored) params.set("ignored", filters.ignored);
	if (filters.sort) params.set("sort", filters.sort);
	if (filters.order) params.set("order", filters.order);
	params.set("page", String(page));
	params.set("pageSize", String(pageSize));
	return params.toString();
}

/** Filters set besides the label and the sort, each counting once. */
export function activeFilterCount(filters: OperationFilters): number {
	return [
		(filters.categoryIds?.length ?? 0) + (filters.uncategorized ? 1 : 0),
		filters.budgetIds?.length ?? 0,
		filters.direction ? 1 : 0,
		filters.amountMin || filters.amountMax ? 1 : 0,
		filters.dateFrom || filters.dateTo ? 1 : 0,
		filters.ignored ? 1 : 0,
	].reduce((sum, n) => sum + n, 0);
}

/** Default direction when switching to `sort`: A to Z, newest or largest first. */
export function defaultOrder(sort: OperationSort): SortOrder {
	return sort === "label" ? "asc" : "desc";
}
