import { AreaChart, BarChart } from "@mantine/charts";
import {
	Alert,
	Box,
	Group,
	Loader,
	Paper,
	Progress,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/CategoryBadge";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { formatAmount } from "@/lib/format";
import { useCategories, useCategorySummary, useSummary } from "@/lib/hooks";
import { balanceTextColor, budgetTypeTones } from "@/lib/tones";
import type { CategoryResponse, CategoryTotal } from "@/lib/types";
import { headingFont, palette } from "@/theme";

interface StatsSearch {
	fromYear: number;
	fromMonth: number;
	toYear: number;
	toMonth: number;
}

function defaultSearch(): StatsSearch {
	const now = new Date();
	const from = new Date(now);
	from.setMonth(from.getMonth() - 11);
	return {
		fromYear: from.getFullYear(),
		fromMonth: from.getMonth() + 1,
		toYear: now.getFullYear(),
		toMonth: now.getMonth() + 1,
	};
}

export const Route = createFileRoute("/stats")({
	component: StatsPage,
	validateSearch: (search: Record<string, unknown>): StatsSearch => {
		const defaults = defaultSearch();
		return {
			fromYear: Number(search.fromYear) || defaults.fromYear,
			fromMonth: Number(search.fromMonth) || defaults.fromMonth,
			toYear: Number(search.toYear) || defaults.toYear,
			toMonth: Number(search.toMonth) || defaults.toMonth,
		};
	},
});

const pickerStyles = {
	root: { minWidth: 180 },
	input: { fontWeight: 600 },
};

const axisColor = "var(--mantine-color-dimmed)";

/** What each category spent over the range, most spent first, with its share. */
function CategoryExpenses({
	totals,
	categories,
}: {
	totals: CategoryTotal[];
	categories: CategoryResponse[];
}) {
	const { t } = useTranslation();
	const byId = new Map(categories.map((c) => [c.id, c]));
	const rows = totals
		.map((total) => ({
			key: total.categoryId ?? "__none",
			category: total.categoryId ? byId.get(total.categoryId) : undefined,
			spent: -Number(total.expense),
		}))
		.filter((row) => row.spent > 0)
		.sort((a, b) => b.spent - a.spent);
	const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
	const maxSpent = rows[0]?.spent ?? 0;

	return (
		<Paper>
			<Stack gap="md">
				<Stack gap={4}>
					<Text component="h2" ff={headingFont} fz={22} fw={700}>
						{t("stats.byCategory")}
					</Text>
					<Text size="sm" c="dimmed">
						{t("stats.byCategoryHint")}
					</Text>
				</Stack>
				{rows.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t("stats.noCategoryExpenses")}
					</Text>
				) : (
					<Box component="ul" m={0} p={0} className="list-none">
						{rows.map((row) => {
							const name = row.category?.name ?? t("stats.uncategorized");
							const share = Math.round((row.spent / totalSpent) * 100);
							return (
								<Box
									component="li"
									key={row.key}
									py={8}
									style={{ borderTop: `1px solid ${palette.divider}` }}
								>
									<Group justify="space-between" wrap="nowrap" gap="sm">
										<Group gap={8} wrap="nowrap" miw={0}>
											{row.category ? (
												<CategoryDot color={row.category.color} />
											) : (
												<Box
													w={10}
													h={10}
													style={{
														borderRadius: "50%",
														border: "1px solid var(--mantine-color-dimmed)",
														flexShrink: 0,
													}}
													aria-hidden
												/>
											)}
											<Text size="sm" fw={600} truncate>
												{name}
											</Text>
										</Group>
										<Text size="sm" className="tabular-nums" c="dimmed">
											<Text span fw={700} c="var(--mantine-color-text)" inherit>
												{formatAmount(row.spent)}
											</Text>
											{` · ${share} %`}
										</Text>
									</Group>
									<Progress
										mt={6}
										value={(row.spent / maxSpent) * 100}
										color={budgetTypeTones.expense.fill}
										bg={palette.track}
										size="sm"
										aria-label={`${name} : ${formatAmount(row.spent)}`}
									/>
								</Box>
							);
						})}
					</Box>
				)}
			</Stack>
		</Paper>
	);
}

function StatsPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { fromYear, fromMonth, toYear, toMonth } = Route.useSearch();

	const from = new Date(fromYear, fromMonth - 1);
	const to = new Date(toYear, toMonth - 1);

	const summaryQuery = useSummary(fromYear, fromMonth, toYear, toMonth);
	const categorySummaryQuery = useCategorySummary(
		fromYear,
		fromMonth,
		toYear,
		toMonth,
	);
	const categoriesQuery = useCategories();

	const isLoading = summaryQuery.isLoading;
	const isError = summaryQuery.isError;

	const months = summaryQuery.data?.months ?? [];

	// `unbudgeted` is a net sum (mixed income + expense on unlinked ops);
	// without a per-operation breakdown we attribute its positive part to
	// income and its negative part to expenses.
	const perMonth = months.map((m) => {
		const unbudgeted = Number(m.unbudgeted);
		return {
			label: new Date(m.year, m.month - 1).toLocaleDateString(i18n.language, {
				month: "short",
				year: "2-digit",
			}),
			expenses: Number(m.budgeted.expense) + Math.min(0, unbudgeted),
			income: Number(m.budgeted.income) + Math.max(0, unbudgeted),
			savings: Number(m.budgeted.savings),
		};
	});

	let totalExpenses = 0;
	let totalIncome = 0;
	let totalSavings = 0;
	for (const m of perMonth) {
		totalExpenses += m.expenses;
		totalIncome += m.income;
		totalSavings += m.savings;
	}
	const balance = totalIncome + totalExpenses + totalSavings;

	const barData = perMonth.map((m) => ({
		month: m.label,
		[t("stats.expenses")]: Math.abs(m.expenses),
		[t("stats.income")]: m.income,
		[t("stats.savings")]: Math.abs(m.savings),
	}));

	let running = 0;
	const balanceData = perMonth.map((m) => {
		running += m.income + m.expenses + m.savings;
		return { month: m.label, [t("stats.balance")]: running };
	});

	const tiles = [
		{
			label: t("stats.income"),
			value: totalIncome,
			dotColor: budgetTypeTones.income.fill,
			valueColor: budgetTypeTones.income.text,
		},
		{
			label: t("stats.expenses"),
			value: totalExpenses,
			dotColor: budgetTypeTones.expense.fill,
			valueColor: budgetTypeTones.expense.text,
		},
		{
			label: t("stats.savings"),
			value: totalSavings,
			dotColor: budgetTypeTones.savings.fill,
			valueColor: budgetTypeTones.savings.text,
		},
		{
			label: t("stats.balance"),
			value: balance,
			dotColor: "var(--mantine-color-forest-7)",
			valueColor: balanceTextColor(balance),
		},
	];

	const manyMonths = barData.length > 12;
	const xAxisProps = {
		interval: 0,
		angle: manyMonths ? -45 : 0,
		textAnchor: manyMonths ? ("end" as const) : ("middle" as const),
		height: manyMonths ? 60 : 30,
	};

	const navigateTo = (
		range: Partial<StatsSearch>,
	): ReturnType<typeof navigate> =>
		navigate({
			to: "/stats",
			search: { fromYear, fromMonth, toYear, toMonth, ...range },
		});

	return (
		<div className="h-full overflow-auto">
			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<PageHeader
					title={t("stats.title")}
					actions={
						<>
							<MonthPickerInput
								label={t("stats.from")}
								value={from}
								onChange={(d) => {
									if (d) {
										const date = new Date(d);
										navigateTo({
											fromYear: date.getFullYear(),
											fromMonth: date.getMonth() + 1,
										});
									}
								}}
								locale={i18n.language}
								maxDate={to}
								styles={pickerStyles}
							/>
							<MonthPickerInput
								label={t("stats.to")}
								value={to}
								onChange={(d) => {
									if (d) {
										const date = new Date(d);
										navigateTo({
											toYear: date.getFullYear(),
											toMonth: date.getMonth() + 1,
										});
									}
								}}
								locale={i18n.language}
								minDate={from}
								styles={pickerStyles}
							/>
						</>
					}
				/>

				{isLoading && (
					<div className="flex items-center justify-center py-12">
						<Loader />
					</div>
				)}

				{isError && (
					<Alert
						icon={<IconAlertCircle size={16} />}
						color="tangerine"
						title={t("common.error")}
					>
						{t("stats.fetchError")}
					</Alert>
				)}

				{!isLoading && !isError && (
					<>
						<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
							{tiles.map((tile) => (
								<StatTile
									key={tile.label}
									label={tile.label}
									value={formatAmount(tile.value)}
									dotColor={tile.dotColor}
									valueColor={tile.valueColor}
								/>
							))}
						</SimpleGrid>

						{barData.length > 0 && (
							<>
								<Paper>
									<Stack gap="md">
										<Text component="h2" ff={headingFont} fz={22} fw={700}>
											{t("stats.monthlyEvolution")}
										</Text>
										<BarChart
											h={300}
											data={barData}
											dataKey="month"
											series={[
												{ name: t("stats.income"), color: "forest.7" },
												{ name: t("stats.expenses"), color: "tangerine.5" },
												{ name: t("stats.savings"), color: "gold.5" },
											]}
											tickLine="none"
											gridAxis="y"
											gridProps={{ horizontal: true, vertical: false }}
											xAxisProps={xAxisProps}
											withLegend
											legendProps={{ verticalAlign: "top", height: 40 }}
											valueFormatter={(v) => formatAmount(v)}
											textColor={axisColor}
											tooltipAnimationDuration={200}
											barProps={{ radius: [4, 4, 0, 0] }}
										/>
									</Stack>
								</Paper>

								<Paper>
									<Stack gap="md">
										<Stack gap={4}>
											<Text component="h2" ff={headingFont} fz={22} fw={700}>
												{t("stats.balanceEvolution")}
											</Text>
											<Text size="sm" c="dimmed" className="tabular-nums">
												{t("stats.cumulative")} :{" "}
												<Text
													component="strong"
													inherit
													fw={700}
													fz="md"
													c={balanceTextColor(balance)}
												>
													{formatAmount(balance)}
												</Text>
											</Text>
										</Stack>
										<AreaChart
											h={240}
											data={balanceData}
											dataKey="month"
											series={[{ name: t("stats.balance"), color: "forest.7" }]}
											curveType="monotone"
											tickLine="none"
											gridAxis="y"
											gridProps={{ horizontal: true, vertical: false }}
											xAxisProps={xAxisProps}
											withDots={false}
											fillOpacity={0.18}
											referenceLines={[
												{
													y: 0,
													color: "gray.6",
													strokeDasharray: "4 4",
												},
											]}
											valueFormatter={(v) => formatAmount(v)}
											textColor={axisColor}
											tooltipAnimationDuration={200}
										/>
									</Stack>
								</Paper>
							</>
						)}

						{categorySummaryQuery.data && categoriesQuery.data?.length ? (
							<CategoryExpenses
								totals={categorySummaryQuery.data.categories}
								categories={categoriesQuery.data}
							/>
						) : null}
					</>
				)}
			</Stack>
		</div>
	);
}
