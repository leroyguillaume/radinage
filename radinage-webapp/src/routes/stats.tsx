import { AreaChart, BarChart, PieChart } from "@mantine/charts";
import {
	Alert,
	Box,
	Center,
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
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CATEGORY_MARK_SIZE, CategoryDot } from "@/components/CategoryBadge";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import {
	type CategoryRow,
	type CategorySide,
	type CategorySlice,
	categoryRows,
	categorySlices,
} from "@/lib/category-totals";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import { useCategories, useCategorySummary, useSummary } from "@/lib/hooks";
import { balanceTextColor, budgetTypeTones, categoryFill } from "@/lib/tones";
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

// Neutral fills for the slices that are no category of the user's, apart from the
// shade 6 the categories use.
const UNCATEGORIZED_FILL = "var(--mantine-color-gray-3)";
const OTHERS_FILL = "var(--mantine-color-gray-5)";

function NoCategoryDot({ fill }: { fill?: string }) {
	return (
		<Center
			w={CATEGORY_MARK_SIZE}
			h={CATEGORY_MARK_SIZE}
			style={{ flexShrink: 0 }}
			aria-hidden
		>
			<Box
				w={CATEGORY_MARK_SIZE / 2}
				h={CATEGORY_MARK_SIZE / 2}
				bg={fill}
				style={{
					borderRadius: "50%",
					border: fill ? undefined : "1px solid var(--mantine-color-dimmed)",
				}}
			/>
		</Center>
	);
}

function CategoryPie({ rows, label }: { rows: CategoryRow[]; label: string }) {
	const { t } = useTranslation();
	const slices = categorySlices(rows);
	const fill = (slice: CategorySlice) =>
		slice.category
			? categoryFill(slice.category.color)
			: slice.others > 0
				? OTHERS_FILL
				: UNCATEGORIZED_FILL;
	const name = (slice: CategorySlice) =>
		slice.category?.name ??
		(slice.others > 0
			? t("stats.otherCategories", { count: slice.others })
			: t("stats.uncategorized"));
	const others = slices.find((slice) => slice.others > 0);

	return (
		<Stack gap="xs" align="center">
			<PieChart
				size={200}
				data={slices.map((slice) => ({
					key: slice.key,
					name: name(slice),
					value: slice.amount,
					color: fill(slice),
				}))}
				strokeWidth={2}
				strokeColor="var(--mantine-color-body)"
				withTooltip
				tooltipDataSource="segment"
				valueFormatter={(value) => formatAmount(value)}
				aria-label={label}
			/>
			{others && (
				<Group gap={6} wrap="nowrap">
					<NoCategoryDot fill={OTHERS_FILL} />
					<Text size="sm" c="dimmed">
						{name(others)}
					</Text>
				</Group>
			)}
		</Stack>
	);
}

const categoryBreakdownKeys = {
	income: { title: "stats.incomeByCategory", empty: "stats.noIncome" },
	expense: { title: "stats.expensesByCategory", empty: "stats.noExpenses" },
} as const;

/** What each category earned or spent over the range, largest first, with its share. */
function CategoryBreakdown({
	side,
	totals,
	categories,
}: {
	side: CategorySide;
	totals: CategoryTotal[];
	categories: CategoryResponse[];
}) {
	const { t } = useTranslation();
	const titleId = useId();
	const keys = categoryBreakdownKeys[side];
	const title = t(keys.title);
	const rows = categoryRows(totals, categories, side);
	const total = rows.reduce((sum, row) => sum + row.amount, 0);
	const max = rows[0]?.amount ?? 0;

	return (
		<Paper component="section" aria-labelledby={titleId}>
			<Stack gap="md">
				<Stack gap={4}>
					<Text id={titleId} component="h2" ff={headingFont} fz={22} fw={700}>
						{title}
					</Text>
					<Text size="sm" c="dimmed">
						{t("stats.byCategoryHint")}
					</Text>
				</Stack>
				{rows.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t(keys.empty)}
					</Text>
				) : (
					<div className="grid gap-6 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start">
						<CategoryPie rows={rows} label={title} />
						<Box component="ul" m={0} p={0} className="list-none">
							{rows.map((row) => {
								const name = row.category?.name ?? t("stats.uncategorized");
								const share = Math.round((row.amount / total) * 100);
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
													<CategoryDot category={row.category} />
												) : (
													<NoCategoryDot fill={UNCATEGORIZED_FILL} />
												)}
												<Text size="sm" fw={600} truncate>
													{name}
												</Text>
											</Group>
											<Text size="sm" className="tabular-nums" c="dimmed">
												<Text
													span
													fw={700}
													c="var(--mantine-color-text)"
													inherit
												>
													{formatAmount(row.amount)}
												</Text>
												{` · ${share} %`}
											</Text>
										</Group>
										<Progress
											mt={6}
											value={(row.amount / max) * 100}
											color={budgetTypeTones[side].fill}
											bg={palette.track}
											size="sm"
											aria-label={`${name} : ${formatAmount(row.amount)}`}
										/>
									</Box>
								);
							})}
						</Box>
					</div>
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
	const yAxisProps = { tickFormatter: formatCompactAmount };

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
											yAxisProps={yAxisProps}
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
											yAxisProps={yAxisProps}
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
							<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
								{(["income", "expense"] as const).map((side) => (
									<CategoryBreakdown
										key={side}
										side={side}
										totals={categorySummaryQuery.data.categories}
										categories={categoriesQuery.data}
									/>
								))}
							</SimpleGrid>
						) : null}
					</>
				)}
			</Stack>
		</div>
	);
}
