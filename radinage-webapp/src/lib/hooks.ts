import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type {
	AccountBalance,
	ApplyBudgetResponse,
	BudgetResponse,
	CreateUserResponse,
	ExportDataResponse,
	ForecastMonthBreakdown,
	ForecastResponse,
	ImportDataResponse,
	MonthlyOperationsResponse,
	OperationResponse,
	OperationSplitRequest,
	ResetPasswordResponse,
	SummaryResponse,
	YearMonth,
} from "@/lib/types";

export function useMonthlyOperations(year: number, month: number) {
	return useQuery({
		queryKey: ["monthly-operations", year, month],
		queryFn: () =>
			apiFetch<MonthlyOperationsResponse>(
				`/operations/monthly/${year}/${month}`,
			),
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

export function useApplyBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, force }: { id: string; force: boolean }) =>
			apiFetch<ApplyBudgetResponse>(`/budgets/${id}/apply`, {
				method: "POST",
				body: JSON.stringify({ force }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		},
	});
}

export function useLinkBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ opId, budgetId }: { opId: string; budgetId: string }) =>
			apiFetch<OperationResponse>(`/operations/${opId}/budget`, {
				method: "PUT",
				body: JSON.stringify({ budgetId }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		},
	});
}

export function useUnlinkBudget() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (opId: string) =>
			apiFetch<OperationResponse>(`/operations/${opId}/budget`, {
				method: "DELETE",
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		},
	});
}

export function useUpdateEffectiveDate() {
	const queryClient = useQueryClient();
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
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		},
	});
}

export function useIgnoreOperation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (opId: string) =>
			apiFetch<OperationResponse>(`/operations/${opId}/ignore`, {
				method: "PUT",
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		},
	});
}

function useInvalidateMonthlyData() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
		queryClient.invalidateQueries({ queryKey: ["summary"] });
		queryClient.invalidateQueries({ queryKey: ["forecast"] });
	};
}

export function useSplitOperation() {
	const invalidate = useInvalidateMonthlyData();
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
	const invalidate = useInvalidateMonthlyData();
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
			queryClient.invalidateQueries({ queryKey: ["budgets"] });
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
