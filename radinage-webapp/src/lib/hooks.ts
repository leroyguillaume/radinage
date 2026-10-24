import { type MantineBreakpoint, useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import {
	type OperationFilters,
	operationSearchQuery,
} from "@/lib/operation-search";
import type {
	AccountBalance,
	ApplyBudgetResponse,
	BudgetResponse,
	CategoryRequest,
	CategoryResponse,
	CategorySummaryResponse,
	CreateUserResponse,
	CsvDelimiter,
	ExportDataResponse,
	ForecastMonthBreakdown,
	ForecastResponse,
	ImportDataResponse,
	ImportPreviewResponse,
	ImportProfileRequest,
	ImportProfileResponse,
	ImportResult,
	MonthlyOperationsResponse,
	OperationResponse,
	OperationSearchResponse,
	OperationSplitRequest,
	ResetPasswordResponse,
	SummaryResponse,
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

export function useCreateBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: unknown) =>
			apiFetch<BudgetResponse>("/budgets", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["budgets"] });
		},
	});
}

export function useUpdateBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id: string; body: unknown }) =>
			apiFetch<BudgetResponse>(`/budgets/${id}`, {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["budgets"] });
		},
	});
}

/** Everything computed from operations, to refetch once one of them changes. */
const operationDataKeys = [
	["monthly-operations"],
	["operation-search"],
	["summary"],
	["category-summary"],
	["forecast"],
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

const accountBalanceKey = ["account-balance"];

/** The recorded account balance, null when none is recorded. */
export function useAccountBalance() {
	return useQuery({
		queryKey: accountBalanceKey,
		queryFn: async () => {
			try {
				return await apiFetch<AccountBalance>("/users/me/balance");
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) {
					return null;
				}
				throw err;
			}
		},
	});
}

function useInvalidateAccountBalance() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: accountBalanceKey });
		queryClient.invalidateQueries({ queryKey: ["forecast"] });
	};
}

export function useUpdateAccountBalance() {
	const invalidate = useInvalidateAccountBalance();
	return useMutation({
		mutationFn: (body: AccountBalance) =>
			apiFetch<AccountBalance>("/users/me/balance", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		onSuccess: invalidate,
	});
}

export function useDeleteAccountBalance() {
	const invalidate = useInvalidateAccountBalance();
	return useMutation({
		mutationFn: () => apiFetch<void>("/users/me/balance", { method: "DELETE" }),
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
			queryClient.invalidateQueries({ queryKey: ["summary"] });
			queryClient.invalidateQueries({ queryKey: ["forecast"] });
			queryClient.invalidateQueries({ queryKey: accountBalanceKey });
		},
	});
}

export function useDeleteBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) =>
			apiFetch<void>(`/budgets/${id}`, { method: "DELETE" }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["budgets"] });
		},
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
