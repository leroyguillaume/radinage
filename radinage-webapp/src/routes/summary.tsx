import {
	ActionIcon,
	Alert,
	Grid,
	Group,
	Loader,
	Progress,
	Stack,
	Table,
	Text,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getBudgetedAmountForMonth } from "@/lib/budget-utils";
import { useBudgets, useSummary } from "@/lib/hooks";

interface ForecastSearch {
	year: number;
}

export const Route = createFileRoute("/summary")({
	component: ForecastPage,
	validateSearch: (search: Record<string, unknown>): ForecastSearch => ({
		year: Number(search.year) || new Date().getFullYear(),
	}),
});

function formatAmount(amount: number): string {
	return new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
}

function amountColor(amount: number): string {
	if (amount > 0) return "green";
	if (amount < 0) return "red";
	return "white";
}

interface MonthForecast {
	year: number;
	month: number;
	income: number;
	expenses: number;
	savings: number;
	balance: number;
	cumulative: number;
	isActual: boolean;
}

function computeForecast(
	summaryMonths: Array<{
		year: number;
		month: number;
		unbudgeted: string;
		budgeted: { expense: string; income: string; savings: string };
	}>,
	budgets: Array<{
		id: string;
		label: string;
		budgetType: "expense" | "income" | "savings";
		kind: import("@/lib/types").BudgetKind;
		rules: import("@/lib/types").Rule[];
		createdAt: string;
	}>,
	currentYear: number,
	currentMonth: number,
): MonthForecast[] {
	const result: MonthForecast[] = [];
	let cumulative = 0;

	for (let month = 1; month <= 12; month++) {
		const isActual = month <= currentMonth;

		if (isActual) {
			const actual = summaryMonths.find(
				(m) => m.year === currentYear && m.month === month,
			);
			if (actual) {
				// `unbudgeted` is a net sum (income + expenses on unlinked ops).
				// Without a per-operation breakdown we attribute its positive part
				// to income and its negative part to expenses, so the forecast
				// stays meaningful when the user has no budgets.
				const unbudgeted = Number(actual.unbudgeted);
				const income = Number(actual.budgeted.income) + Math.max(0, unbudgeted);
				const expenses =
					Number(actual.budgeted.expense) + Math.min(0, unbudgeted);
				const savings = Number(actual.budgeted.savings);
				const balance = income + expenses + savings;
				cumulative += balance;
				result.push({
					year: currentYear,
					month,
					income,
					expenses,
					savings,
					balance,
					cumulative,
					isActual: true,
				});
			} else {
				result.push({
					year: currentYear,
					month,
					income: 0,
					expenses: 0,
					savings: 0,
					balance: 0,
					cumulative,
					isActual: true,
				});
			}
		} else {
			let income = 0;
			let expenses = 0;
			let savings = 0;

			for (const budget of budgets) {
				const amount = getBudgetedAmountForMonth(budget, currentYear, month);
				if (amount === null) continue;

				switch (budget.budgetType) {
					case "income":
						income += amount;
						break;
					case "expense":
						expenses += amount;
						break;
					case "savings":
						savings += amount;
						break;
				}
			}

			const balance = income + expenses + savings;
			cumulative += balance;
			result.push({
				year: currentYear,
				month,
				income,
				expenses,
				savings,
				balance,
				cumulative,
				isActual: false,
			});
		}
	}

	return result;
}

function daysRemainingInYear(year: number): number {
	const now = new Date();
	const thisYear = now.getFullYear();
	if (year < thisYear) return 0;
	if (year > thisYear) {
		const jan1 = new Date(year, 0, 1);
		const dec31 = new Date(year, 11, 31);
		return (
			Math.ceil((dec31.getTime() - jan1.getTime()) / (1000 * 60 * 60 * 24)) + 1
		);
	}
	const endOfYear = new Date(year, 11, 31);
	const diffMs = endOfYear.getTime() - now.getTime();
	return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function monthsElapsedRatio(year: number): number {
	const now = new Date();
	const thisYear = now.getFullYear();
	if (year < thisYear) return 1;
	if (year > thisYear) return 0;
	const startOfYear = new Date(year, 0, 1);
	const endOfYear = new Date(year, 11, 31);
	const total = endOfYear.getTime() - startOfYear.getTime();
	const elapsed = now.getTime() - startOfYear.getTime();
	return Math.min(1, elapsed / total);
}

function ForecastPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { year: selectedYear } = Route.useSearch();
	const now = new Date();
	const thisYear = now.getFullYear();
	const currentMonth =
		selectedYear === thisYear
			? now.getMonth() + 1
			: selectedYear < thisYear
				? 12
				: 0;

	const summaryQuery = useSummary(
		selectedYear,
		1,
		selectedYear,
		currentMonth > 0 ? currentMonth : 1,
	);
	const budgetsQuery = useBudgets();

	const isLoading = summaryQuery.isLoading || budgetsQuery.isLoading;
	const isError = summaryQuery.isError || budgetsQuery.isError;

	const months = currentMonth > 0 ? (summaryQuery.data?.months ?? []) : [];
	const budgets = budgetsQuery.data ?? [];

	const forecast = computeForecast(months, budgets, selectedYear, currentMonth);

	const last = forecast.length > 0 ? forecast[forecast.length - 1] : null;
	const endOfYearBalance = last?.cumulative ?? 0;

	const remainingDays = daysRemainingInYear(selectedYear);
	// A daily budget below zero is meaningless (you can't spend a negative
	// amount per day). When the projected end-of-year balance is negative,
	// there is simply no daily budget left.
	const dailyBudget =
		remainingDays > 0 ? Math.max(0, endOfYearBalance / remainingDays) : 0;

	const totalIncome = forecast.reduce((sum, m) => sum + m.income, 0);
	const totalExpenses = forecast.reduce((sum, m) => sum + m.expenses, 0);
	const totalSavings = forecast.reduce((sum, m) => sum + m.savings, 0);

	const yearProgress = monthsElapsedRatio(selectedYear) * 100;

	function navigateYear(delta: number) {
		navigate({
			to: "/summary",
			search: { year: selectedYear + delta },
		});
	}

	return (
		<div className="mx-auto flex h-full max-w-5xl flex-col overflow-auto p-3 sm:p-6">
			<Group justify="space-between" mb="lg">
				<Title order={2} c="white">
					{t("forecast.title")}
				</Title>
				<Group gap="xs">
					<ActionIcon
						variant="subtle"
						color="white"
						onClick={() => navigateYear(-1)}
					>
						<IconChevronLeft size={20} />
					</ActionIcon>
					<Text c="white" fw={700} size="lg">
						{selectedYear}
					</Text>
					<ActionIcon
						variant="subtle"
						color="white"
						onClick={() => navigateYear(1)}
					>
						<IconChevronRight size={20} />
					</ActionIcon>
				</Group>
			</Group>

			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<Loader color="green" />
				</div>
			)}

			{isError && (
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="red"
					title={t("common.error")}
				>
					{t("forecast.fetchError")}
				</Alert>
			)}

			{!isLoading && !isError && (
				<Stack gap="xl">
					{/* Year progress */}
					<Stack gap={4}>
						<Text size="xs" c="dimmed">
							{t("forecast.yearProgress", {
								percent: Math.round(yearProgress),
							})}
						</Text>
						<Progress value={yearProgress} color="green" size="sm" />
					</Stack>

					{/* Key metrics */}
					<Grid gap="xs" align="stretch">
						<Grid.Col span={{ base: 6 }}>
							<Stack
								gap={2}
								p="sm"
								justify="center"
								style={{
									borderRadius: 8,
									backgroundColor: "rgba(255,255,255,0.05)",
									height: "100%",
								}}
							>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.dailyBudget")}
								</Text>
								<Text
									size="xl"
									fw={700}
									ta="center"
									c={amountColor(dailyBudget)}
								>
									{formatAmount(dailyBudget)}
								</Text>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.remainingDays", {
										count: remainingDays,
									})}
								</Text>
							</Stack>
						</Grid.Col>
						<Grid.Col span={{ base: 6 }}>
							<Stack
								gap={2}
								p="sm"
								justify="center"
								style={{
									borderRadius: 8,
									backgroundColor: "rgba(255,255,255,0.05)",
									height: "100%",
								}}
							>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.endOfYearBalance")}
								</Text>
								<Text
									size="xl"
									fw={700}
									ta="center"
									c={amountColor(endOfYearBalance)}
								>
									{formatAmount(endOfYearBalance)}
								</Text>
							</Stack>
						</Grid.Col>
					</Grid>

					{/* Yearly totals */}
					<Grid gap="xs">
						<Grid.Col span={{ base: 12, xs: 4 }}>
							<Stack
								gap={2}
								p="xs"
								style={{
									borderRadius: 8,
									backgroundColor: "rgba(255,255,255,0.05)",
								}}
							>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.totalIncome")}
								</Text>
								<Text size="sm" fw={700} ta="center" c="green">
									{formatAmount(totalIncome)}
								</Text>
							</Stack>
						</Grid.Col>
						<Grid.Col span={{ base: 12, xs: 4 }}>
							<Stack
								gap={2}
								p="xs"
								style={{
									borderRadius: 8,
									backgroundColor: "rgba(255,255,255,0.05)",
								}}
							>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.totalExpenses")}
								</Text>
								<Text size="sm" fw={700} ta="center" c="red">
									{formatAmount(totalExpenses)}
								</Text>
							</Stack>
						</Grid.Col>
						<Grid.Col span={{ base: 12, xs: 4 }}>
							<Stack
								gap={2}
								p="xs"
								style={{
									borderRadius: 8,
									backgroundColor: "rgba(255,255,255,0.05)",
								}}
							>
								<Text size="xs" c="dimmed" ta="center">
									{t("forecast.totalSavings")}
								</Text>
								<Text size="sm" fw={700} ta="center" c="blue">
									{formatAmount(totalSavings)}
								</Text>
							</Stack>
						</Grid.Col>
					</Grid>

					{/* Monthly forecast table */}
					<div
						style={{
							borderRadius: 8,
							overflowX: "auto",
						}}
					>
						<Table
							highlightOnHover
							styles={{
								table: {
									backgroundColor: "transparent",
								},
								th: {
									color: "rgba(255,255,255,0.6)",
									borderColor: "rgba(255,255,255,0.1)",
									backgroundColor: "rgba(255,255,255,0.05)",
								},
								td: {
									borderColor: "rgba(255,255,255,0.06)",
								},
							}}
						>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>{t("forecast.month")}</Table.Th>
									<Table.Th ta="right">{t("forecast.income")}</Table.Th>
									<Table.Th ta="right">{t("forecast.expenses")}</Table.Th>
									<Table.Th ta="right">{t("forecast.savings")}</Table.Th>
									<Table.Th ta="right">{t("forecast.balance")}</Table.Th>
									<Table.Th ta="right">{t("forecast.cumulative")}</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{forecast.map((m, idx) => {
									const monthLabel = new Date(
										m.year,
										m.month - 1,
									).toLocaleDateString(i18n.language, {
										month: "long",
									});
									const isCurrent = m.month === currentMonth;
									const rowBg = isCurrent
										? "rgba(76, 204, 119, 0.12)"
										: idx % 2 === 1
											? "rgba(255,255,255,0.03)"
											: "transparent";
									return (
										<Table.Tr key={m.month} style={{ backgroundColor: rowBg }}>
											<Table.Td>
												<Text
													size="sm"
													c="white"
													fw={isCurrent ? 700 : 400}
													style={{ textTransform: "capitalize" }}
												>
													{monthLabel}
													{m.isActual ? "" : ` (${t("forecast.projected")})`}
												</Text>
											</Table.Td>
											<Table.Td>
												<Text size="sm" ta="right" c="green">
													{formatAmount(m.income)}
												</Text>
											</Table.Td>
											<Table.Td>
												<Text size="sm" ta="right" c="red">
													{formatAmount(m.expenses)}
												</Text>
											</Table.Td>
											<Table.Td>
												<Text size="sm" ta="right" c="blue">
													{formatAmount(m.savings)}
												</Text>
											</Table.Td>
											<Table.Td>
												<Text size="sm" ta="right" c={amountColor(m.balance)}>
													{formatAmount(m.balance)}
												</Text>
											</Table.Td>
											<Table.Td>
												<Text
													size="sm"
													fw={700}
													ta="right"
													c={amountColor(m.cumulative)}
												>
													{formatAmount(m.cumulative)}
												</Text>
											</Table.Td>
										</Table.Tr>
									);
								})}
							</Table.Tbody>
						</Table>
					</div>
				</Stack>
			)}
		</div>
	);
}
