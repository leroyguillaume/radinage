import { type MantineBreakpoint, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
	type OperationFilters,
	operationSearchQuery,
} from "@/lib/operation-search";
import { canPair, pairingWindow } from "@/lib/transfers";
import type {
	AccountBalance,
	AccountRequest,
	AccountResponse,
	ApplyBudgetResponse,
	ApplyCategoryResponse,
	ApplyIgnoreRuleResponse,
	ApplyTransferRuleResponse,
	BalanceEntry,
	BalancePoint,
	BalanceReading,
	BudgetResponse,
	BudgetSummaryResponse,
	CategoryRequest,
	CategoryResponse,
	CategorySummaryResponse,
	CreateUserResponse,
	CsvDelimiter,
	ExportDataResponse,
	ForecastMonthBreakdown,
	ForecastResponse,
	IgnoreRuleRequest,
	IgnoreRuleResponse,
	ImportDataResponse,
	ImportPreviewResponse,
	ImportProfileRequest,
	ImportProfileResponse,
	ImportResult,
	MonthlyOperationsResponse,
	OperationResponse,
	OperationSearchResponse,
	OperationSplitRequest,
	OperationsUpdatedResponse,
	ResetPasswordResponse,
	SetTransferRequest,
	SummaryResponse,
	TransferRuleRequest,
	TransferRuleResponse,
	YearMonth,
} from "@/lib/types";

export function useMonthlyOperations(
	year: number,
	month: number,
	includeIgnored = false,
) {
	return useQuery({
		queryKey: ["monthly-operations", year, month, includeIgnored],
		queryFn: () =>
			apiFetch<MonthlyOperationsResponse>(
				`/operations/monthly/${year}/${month}${includeIgnored ? "?includeIgnored=true" : ""}`,
			),
		// Toggling `includeIgnored` keeps the month on screen instead of a loader.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === year && previousQuery.queryKey[2] === month
				? previous
				: undefined,
	});
}

export const SEARCH_PAGE_SIZE = 50;

/** Operations of every date matching `filters`, a page at a time. */
export function useOperationSearch(filters: OperationFilters) {
	return useInfiniteQuery({
		queryKey: ["operation-search", filters],
		queryFn: ({ pageParam }) =>
			apiFetch<OperationSearchResponse>(
				`/operations?${operationSearchQuery(filters, pageParam, SEARCH_PAGE_SIZE)}`,
			),
		initialPageParam: 1,
		getNextPageParam: (last) =>
			last.page < last.maxPage ? last.page + 1 : undefined,
		// Refining a search keeps the previous results on screen instead of a loader.
		placeholderData: keepPreviousData,
	});
}

export function useSummary(
	fromYear: number,
	fromMonth: number,
	toYear: number,
	toMonth: number,
) {
	return useQuery({
		queryKey: ["summary", fromYear, fromMonth, toYear, toMonth],
		queryFn: () =>
			apiFetch<SummaryResponse>(
				`/summary?fromYear=${fromYear}&fromMonth=${fromMonth}&toYear=${toYear}&toMonth=${toMonth}`,
			),
	});
}

export function useCategorySummary(
	fromYear: number,
	fromMonth: number,
	toYear: number,
	toMonth: number,
) {
	return useQuery({
		queryKey: ["category-summary", fromYear, fromMonth, toYear, toMonth],
		queryFn: () =>
			apiFetch<CategorySummaryResponse>(
				`/summary/categories?fromYear=${fromYear}&fromMonth=${fromMonth}&toYear=${toYear}&toMonth=${toMonth}`,
			),
	});
}

/** Under `["budgets"]`, so editing a budget refreshes what it expects. */
const budgetSummaryKey = ["budgets", "summary"];

/** Every budget, month by month over `year`. */
export function useBudgetSummary(year: number, enabled = true) {
	return useQuery({
		queryKey: [...budgetSummaryKey, year],
		enabled,
		queryFn: () =>
			apiFetch<BudgetSummaryResponse>(
				`/summary/budgets?fromYear=${year}&fromMonth=1&toYear=${year}&toMonth=12`,
			),
	});
}

export function useForecast(
	fromYear: number,
	fromMonth: number,
	months: number,
) {
	return useQuery({
		queryKey: ["forecast", fromYear, fromMonth, months],
		queryFn: () =>
			apiFetch<ForecastResponse>(
				`/forecast?fromYear=${fromYear}&fromMonth=${fromMonth}&months=${months}`,
			),
	});
}

/** Budget-by-budget breakdown of one forecast month; idle while `month` is null. */
export function useForecastMonth(month: YearMonth | null) {
	return useQuery({
		queryKey: ["forecast", "month", month?.year, month?.month],
		queryFn: () =>
			month === null
				? Promise.reject(new Error("no month selected"))
				: apiFetch<ForecastMonthBreakdown>(
						`/forecast/${month.year}/${month.month}`,
					),
		enabled: month !== null,
	});
}

export function useBudgets() {
	return useQuery({
		queryKey: ["budgets"],
		queryFn: () => apiFetch<BudgetResponse[]>("/budgets?sort=label&order=asc"),
	});
}

const accountsKey = ["accounts"];

/** A savings budget's linked amounts count towards its account's balance. */
function useInvalidateBudgets() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: ["budgets"] });
		queryClient.invalidateQueries({ queryKey: accountsKey });
	};
}

export function useCreateBudget() {
	const invalidate = useInvalidateBudgets();
	return useMutation({
		mutationFn: (body: unknown) =>
			apiFetch<BudgetResponse>("/budgets", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		onSuccess: invalidate,
	});
}

export function useUpdateBudget() {
	const invalidate = useInvalidateBudgets();
	return useMutation({
		mutationFn: ({ id, body }: { id: string; body: unknown }) =>
			apiFetch<BudgetResponse>(`/budgets/${id}`, {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		onSuccess: invalidate,
	});
}

/** Everything computed from operations, to refetch once one of them changes. */
const operationDataKeys = [
	accountsKey,
	["monthly-operations"],
	["operation-search"],
	["summary"],
	["category-summary"],
	["forecast"],
	budgetSummaryKey,
];

function useInvalidateOperationData() {
	const queryClient = useQueryClient();
	return () => {
		for (const queryKey of operationDataKeys) {
			queryClient.invalidateQueries({ queryKey });
		}
	};
}

export function useApplyBudget() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({ id, force }: { id: string; force: boolean }) =>
			apiFetch<ApplyBudgetResponse>(`/budgets/${id}/apply`, {
				method: "POST",
				body: JSON.stringify({ force }),
			}),
		onSuccess: invalidate,
	});
}

export function useLinkBudget() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({ opId, budgetId }: { opId: string; budgetId: string }) =>
			apiFetch<OperationResponse>(`/operations/${opId}/budget`, {
				method: "PUT",
				body: JSON.stringify({ budgetId }),
			}),
		onSuccess: invalidate,
	});
}

export function useUnlinkBudget() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (opId: string) =>
			apiFetch<OperationResponse>(`/operations/${opId}/budget`, {
				method: "DELETE",
			}),
		onSuccess: invalidate,
	});
}

export function useUpdateEffectiveDate() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({
			op,
			effectiveDate,
		}: {
			op: OperationResponse;
			effectiveDate: string | null;
		}) =>
			apiFetch<OperationResponse>(`/operations/${op.id}`, {
				method: "PUT",
				body: JSON.stringify({
					amount: op.amount,
					date: op.date,
					effectiveDate,
					label: op.label,
				}),
			}),
		onSuccess: invalidate,
	});
}

/** Put an unsplit operation in a category, or clear its own with null. */
export function useSetOperationCategory() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({
			opId,
			categoryId,
		}: {
			opId: string;
			categoryId: string | null;
		}) =>
			apiFetch<OperationResponse>(
				`/operations/${opId}/category`,
				categoryId === null
					? { method: "DELETE" }
					: { method: "PUT", body: JSON.stringify({ categoryId }) },
			),
		onSuccess: invalidate,
	});
}

export function useSetOperationAccount() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({ opId, accountId }: { opId: string; accountId: string }) =>
			apiFetch<OperationResponse>(`/operations/${opId}/account`, {
				method: "PUT",
				body: JSON.stringify({ accountId }),
			}),
		onSuccess: invalidate,
	});
}

export function useSetOperationsAccount() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (body: { operationIds: string[]; accountId: string }) =>
			apiFetch<OperationsUpdatedResponse>("/operations/account", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		onSuccess: invalidate,
	});
}

export function useSetOperationsCategory() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (body: { operationIds: string[]; categoryId: string | null }) =>
			apiFetch<OperationsUpdatedResponse>("/operations/category", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		onSuccess: invalidate,
	});
}

export function useSetOperationIgnored() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({ opId, ignored }: { opId: string; ignored: boolean }) =>
			apiFetch<OperationResponse>(`/operations/${opId}/ignore`, {
				method: ignored ? "PUT" : "DELETE",
			}),
		onSuccess: invalidate,
	});
}

/** Makes an operation a transfer with another account, or an ordinary one again with `null`. */
export function useSetOperationTransfer() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({
			opId,
			transfer,
		}: {
			opId: string;
			transfer: SetTransferRequest | null;
		}) =>
			apiFetch<OperationResponse>(`/operations/${opId}/transfer`, {
				method: transfer ? "PUT" : "DELETE",
				body: transfer ? JSON.stringify(transfer) : undefined,
			}),
		onSuccess: invalidate,
	});
}

/** One operation, such as the other side of a transfer, which may be on another account. */
export function useOperation(id: string | null) {
	return useQuery({
		queryKey: ["operation-search", "operation", id],
		queryFn: () => apiFetch<OperationResponse>(`/operations/${id}`),
		enabled: id !== null,
	});
}

/** Operations of `accountId` that could be the other side of the transfer `op`. */
export function useTransferCandidates(
	op: OperationResponse,
	accountId: string,
	enabled: boolean,
) {
	const { from, to } = pairingWindow(op.date);
	const amount = String(-Number(op.amount));
	return useQuery({
		queryKey: ["operation-search", "transfer-candidates", op.id, accountId],
		queryFn: () =>
			apiFetch<OperationSearchResponse>(
				`/operations?accountId=${accountId}&amount=${amount}&dateFrom=${from}&dateTo=${to}&ignored=included&pageSize=10`,
			),
		select: (page) => page.data.filter((c) => canPair(op, c)),
		enabled,
	});
}

/** The latest transfers with an account, ignored ones included, and how many there are. */
export function useAccountTransfers(accountId: string, pageSize: number) {
	return useQuery({
		queryKey: ["operation-search", "transfers", accountId, pageSize],
		queryFn: () =>
			apiFetch<OperationSearchResponse>(
				`/operations?transferAccountId=${accountId}&ignored=included&pageSize=${pageSize}`,
			),
	});
}

export function useSplitOperation() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({
			opId,
			splits,
		}: {
			opId: string;
			splits: OperationSplitRequest[];
		}) =>
			apiFetch<OperationResponse>(`/operations/${opId}/splits`, {
				method: "PUT",
				body: JSON.stringify({ splits }),
			}),
		onSuccess: invalidate,
	});
}

export function useUnsplitOperation() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (opId: string) =>
			apiFetch<OperationResponse>(`/operations/${opId}/splits`, {
				method: "DELETE",
			}),
		onSuccess: invalidate,
	});
}

export function useChangePassword() {
	return useMutation({
		mutationFn: (body: { currentPassword: string; newPassword: string }) =>
			apiFetch<void>("/users/me/password", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
	});
}

/** Accounts, checking ones first, then by name. */
export function useAccounts() {
	return useQuery({
		queryKey: accountsKey,
		queryFn: () => apiFetch<AccountResponse[]>("/accounts"),
	});
}

/** The balances read on an account, most recent first, each with its day's estimate. */
export function useAccountBalances(accountId: string) {
	return useQuery({
		queryKey: [...accountsKey, accountId, "balances"],
		queryFn: () =>
			apiFetch<BalanceReading[]>(`/accounts/${accountId}/balances`),
	});
}

function balanceHistoryQuery(accountId: string, from: string | null) {
	const query = from === null ? "" : `?from=${from}`;
	return {
		queryKey: [...accountsKey, accountId, "balance-history", from],
		queryFn: () =>
			apiFetch<BalancePoint[]>(
				`/accounts/${accountId}/balance-history${query}`,
			),
	};
}

/** An account's balance from `from` (YYYY-MM-DD, or its earliest known day) to today. */
export function useBalanceHistory(accountId: string, from: string | null) {
	return useQuery(balanceHistoryQuery(accountId, from));
}

/** The balance history of each of `accountIds` from `from` to today, in the same order. */
export function useBalanceHistories(accountIds: string[], from: string) {
	return useQueries({
		queries: accountIds.map((id) => balanceHistoryQuery(id, from)),
	});
}

function useInvalidateAccounts() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: accountsKey });
		queryClient.invalidateQueries({ queryKey: ["forecast"] });
		// Deleting an account deletes the transfer rules naming it.
		queryClient.invalidateQueries({ queryKey: transferRulesKey });
	};
}

export function useSaveAccount() {
	const invalidate = useInvalidateAccounts();
	return useMutation({
		mutationFn: ({ id, body }: { id?: string; body: AccountRequest }) =>
			apiFetch<AccountResponse>(
				id === undefined ? "/accounts" : `/accounts/${id}`,
				{
					method: id === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: invalidate,
	});
}

export function useDeleteAccount() {
	const invalidate = useInvalidateAccounts();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/accounts/${id}`, { method: "DELETE" }),
		onSuccess: invalidate,
	});
}

/** Record a balance of an account, or correct the one `balanceId` names. */
export function useSaveAccountBalance() {
	const invalidate = useInvalidateAccounts();
	return useMutation({
		mutationFn: ({
			accountId,
			balanceId,
			body,
		}: {
			accountId: string;
			balanceId?: string;
			body: AccountBalance;
		}) =>
			apiFetch<BalanceEntry>(
				balanceId === undefined
					? `/accounts/${accountId}/balances`
					: `/accounts/${accountId}/balances/${balanceId}`,
				{
					method: balanceId === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: invalidate,
	});
}

export function useDeleteAccountBalance() {
	const invalidate = useInvalidateAccounts();
	return useMutation({
		mutationFn: ({
			accountId,
			balanceId,
		}: {
			accountId: string;
			balanceId: string;
		}) =>
			apiFetch<void>(`/accounts/${accountId}/balances/${balanceId}`, {
				method: "DELETE",
			}),
		onSuccess: invalidate,
	});
}

export function useCreateUser() {
	return useMutation({
		mutationFn: (body: { username: string; password?: string }) =>
			apiFetch<CreateUserResponse>("/users", {
				method: "POST",
				body: JSON.stringify(body),
			}),
	});
}

export function useSearchUsers(query: string) {
	return useQuery({
		queryKey: ["search-users", query],
		queryFn: () =>
			apiFetch<Array<{ id: string; username: string }>>(
				`/users?q=${encodeURIComponent(query)}`,
			),
		enabled: query.length >= 2,
	});
}

export function useDeleteUser() {
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/users/${id}`, { method: "DELETE" }),
	});
}

export function useResetPassword() {
	return useMutation({
		mutationFn: (username: string) =>
			apiFetch<ResetPasswordResponse>("/users/reset-password", {
				method: "POST",
				body: JSON.stringify({ username }),
			}),
	});
}

export function useExportData() {
	return useMutation({
		mutationFn: () => apiFetch<ExportDataResponse>("/data/export"),
	});
}

export function useImportData() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: ExportDataResponse) =>
			apiFetch<ImportDataResponse>("/data/import", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
			queryClient.invalidateQueries({ queryKey: ["operation-search"] });
			queryClient.invalidateQueries({ queryKey: ["budgets"] });
			queryClient.invalidateQueries({ queryKey: categoriesKey });
			queryClient.invalidateQueries({ queryKey: ignoreRulesKey });
			queryClient.invalidateQueries({ queryKey: transferRulesKey });
			queryClient.invalidateQueries({ queryKey: ["summary"] });
			queryClient.invalidateQueries({ queryKey: ["forecast"] });
			queryClient.invalidateQueries({ queryKey: accountsKey });
			queryClient.invalidateQueries({ queryKey: importProfilesKey });
		},
	});
}

export function useDeleteBudget() {
	const invalidate = useInvalidateBudgets();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/budgets/${id}`, { method: "DELETE" }),
		onSuccess: invalidate,
	});
}

const importProfilesKey = ["import-profiles"];

/** Import profiles, most recently used first. */
export function useImportProfiles() {
	return useQuery({
		queryKey: importProfilesKey,
		queryFn: () => apiFetch<ImportProfileResponse[]>("/import-profiles"),
	});
}

export function useSaveImportProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id?: string; body: ImportProfileRequest }) =>
			apiFetch<ImportProfileResponse>(
				id === undefined ? "/import-profiles" : `/import-profiles/${id}`,
				{
					method: id === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: importProfilesKey });
		},
	});
}

export function useDeleteImportProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/import-profiles/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: importProfilesKey });
		},
	});
}

export function useImportPreview() {
	return useMutation({
		mutationFn: ({
			file,
			csvDelimiter,
		}: {
			file: File;
			csvDelimiter: CsvDelimiter;
		}) => {
			const body = new FormData();
			body.append("file", file);
			body.append("csvDelimiter", csvDelimiter);
			return apiFetch<ImportPreviewResponse>("/operations/import/preview", {
				method: "POST",
				body,
			});
		},
	});
}

export function useImportOperations() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({
			file,
			profile,
		}: {
			file: File;
			profile: ImportProfileResponse;
		}) => {
			const body = new FormData();
			body.append("file", file);
			body.append("labelCol", String(profile.labelCol));
			body.append("amountCol", String(profile.amountCol));
			body.append("dateCol", String(profile.dateCol));
			body.append("dateFormat", profile.dateFormat);
			body.append("skipLines", String(profile.skipLines));
			body.append("csvDelimiter", profile.csvDelimiter);
			body.append("profileId", profile.id);
			body.append("accountId", profile.accountId);
			return apiFetch<ImportResult>("/operations/import", {
				method: "POST",
				body,
			});
		},
		onSuccess: () => {
			invalidate();
			queryClient.invalidateQueries({ queryKey: importProfilesKey });
		},
	});
}

const categoriesKey = ["categories"];

/** Categories, by name. */
export function useCategories() {
	return useQuery({
		queryKey: categoriesKey,
		queryFn: () => apiFetch<CategoryResponse[]>("/categories"),
	});
}

export function useSaveCategory() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id?: string; body: CategoryRequest }) =>
			apiFetch<CategoryResponse>(
				id === undefined ? "/categories" : `/categories/${id}`,
				{
					method: id === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: categoriesKey });
		},
	});
}

export function useApplyCategory() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: ({ id, force }: { id: string; force: boolean }) =>
			apiFetch<ApplyCategoryResponse>(`/categories/${id}/apply`, {
				method: "POST",
				body: JSON.stringify({ force }),
			}),
		onSuccess: invalidate,
	});
}

export function useDeleteCategory() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/categories/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			// Whatever was in the category, budgets included, is left without one.
			for (const queryKey of [
				categoriesKey,
				["budgets"],
				["monthly-operations"],
				["operation-search"],
				["category-summary"],
			]) {
				queryClient.invalidateQueries({ queryKey });
			}
		},
	});
}

const ignoreRulesKey = ["ignore-rules"];

/** Ignore rules, oldest first: the order they are tried in. */
export function useIgnoreRules() {
	return useQuery({
		queryKey: ignoreRulesKey,
		queryFn: () => apiFetch<IgnoreRuleResponse[]>("/ignore-rules"),
	});
}

export function useSaveIgnoreRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id?: string; body: IgnoreRuleRequest }) =>
			apiFetch<IgnoreRuleResponse>(
				id === undefined ? "/ignore-rules" : `/ignore-rules/${id}`,
				{
					method: id === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ignoreRulesKey });
		},
	});
}

export function useDeleteIgnoreRule() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/ignore-rules/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			// The operations the rule ignored count again.
			queryClient.invalidateQueries({ queryKey: ignoreRulesKey });
			invalidate();
		},
	});
}

export function useApplyIgnoreRule() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<ApplyIgnoreRuleResponse>(`/ignore-rules/${id}/apply`, {
				method: "POST",
			}),
		onSuccess: invalidate,
	});
}

const transferRulesKey = ["transfer-rules"];

export function useTransferRules() {
	return useQuery({
		queryKey: transferRulesKey,
		queryFn: () => apiFetch<TransferRuleResponse[]>("/transfer-rules"),
	});
}

export function useSaveTransferRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id?: string; body: TransferRuleRequest }) =>
			apiFetch<TransferRuleResponse>(
				id === undefined ? "/transfer-rules" : `/transfer-rules/${id}`,
				{
					method: id === undefined ? "POST" : "PUT",
					body: JSON.stringify(body),
				},
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: transferRulesKey });
		},
	});
}

export function useDeleteTransferRule() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/transfer-rules/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			// The transfers the rule made become ordinary operations again.
			queryClient.invalidateQueries({ queryKey: transferRulesKey });
			invalidate();
		},
	});
}

export function useApplyTransferRule() {
	const invalidate = useInvalidateOperationData();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<ApplyTransferRuleResponse>(`/transfer-rules/${id}/apply`, {
				method: "POST",
			}),
		onSuccess: invalidate,
	});
}

/**
 * True below the theme `breakpoint`, matching `hiddenFrom`. Read on the first
 * render so a phone never paints the desktop layout first.
 */
export function useBelowBreakpoint(breakpoint: MantineBreakpoint): boolean {
	const theme = useMantineTheme();
	return useMediaQuery(
		`(max-width: calc(${theme.breakpoints[breakpoint]} - 0.1px))`,
		false,
		{ getInitialValueInEffect: false },
	);
}
