import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
	ApplyBudgetResponse,
	BudgetResponse,
	CreateUserResponse,
	ExportDataResponse,
	ImportDataResponse,
	MonthlyOperationsResponse,
	OperationResponse,
	ResetPasswordResponse,
	SummaryResponse,
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

export function useChangePassword() {
	return useMutation({
		mutationFn: (body: { currentPassword: string; newPassword: string }) =>
			apiFetch<void>("/users/me/password", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
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
