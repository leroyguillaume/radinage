import { PieChart } from "@mantine/charts";
import {
	Box,
	Center,
	Group,
	Paper,
	Progress,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchorLink } from "@/components/AnchorLink";
import { CATEGORY_MARK_SIZE, CategoryDot } from "@/components/CategoryBadge";
import {
	type CategoryRow,
	type CategorySide,
	type CategorySlice,
	categoryRows,
	categorySlices,
	isCategorySide,
} from "@/lib/category-totals";
import { formatAmount } from "@/lib/format";
import { budgetTypeTones } from "@/lib/tones";
import type { CategoryResponse, CategoryTotal } from "@/lib/types";
import { headingFont, palette } from "@/theme";

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

function CategoryLabel({ row }: { row: CategoryRow }) {
	const { t } = useTranslation();
	return (
		<Group gap={8} wrap="nowrap" miw={0}>
			{row.category ? (
				<CategoryDot category={row.category} />
			) : (
				<NoCategoryDot fill={UNCATEGORIZED_FILL} />
			)}
			<Text size="sm" fw={600} truncate>
				{row.category?.name ?? t("stats.uncategorized")}
			</Text>
		</Group>
	);
}

function CategoryPie({
	rows,
	label,
	size = 200,
	withOthers = true,
}: {
	rows: CategoryRow[];
	label: string;
	size?: number;
	/** Names the folded slice under the pie. */
	withOthers?: boolean;
}) {
	const { t } = useTranslation();
	const slices = categorySlices(rows);
	const fill = (slice: CategorySlice) =>
		slice.category
			? slice.category.color
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
				size={size}
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
			{withOthers && others && (
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
	income: {
		label: "stats.income",
		title: "stats.incomeByCategory",
		empty: "stats.noIncome",
	},
	expense: {
		label: "stats.expenses",
		title: "stats.expensesByCategory",
		empty: "stats.noExpenses",
	},
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
											<CategoryLabel row={row} />
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

/** The income and expense breakdowns side by side; nothing until the user has categories. */
export function CategoryBreakdowns({
	totals,
	categories,
}: {
	totals: CategoryTotal[] | undefined;
	categories: CategoryResponse[] | undefined;
}) {
	if (!totals || !categories?.length) return null;
	return (
		<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
			{(["income", "expense"] as const).map((side) => (
				<CategoryBreakdown
					key={side}
					side={side}
					totals={totals}
					categories={categories}
				/>
			))}
		</SimpleGrid>
	);
}

/** Past this many rows the overview hands over to the statistics page. */
const OVERVIEW_ROWS = 4;

/**
 * One month's breakdown at a glance, one side at a time: the pie, the largest
 * categories and a link to the full breakdown. Nothing until the user has categories.
 */
export function CategoryOverview({
	totals,
	categories,
	year,
	month,
}: {
	totals: CategoryTotal[] | undefined;
	categories: CategoryResponse[] | undefined;
	year: number;
	month: number;
}) {
	const { t } = useTranslation();
	const titleId = useId();
	const [side, setSide] = useState<CategorySide>("expense");
	if (!totals || !categories?.length) return null;

	const keys = categoryBreakdownKeys[side];
	const rows = categoryRows(totals, categories, side);
	const total = rows.reduce((sum, row) => sum + row.amount, 0);

	return (
		<Paper component="section" aria-labelledby={titleId}>
			<Stack gap="md">
				<Group justify="space-between" align="baseline" wrap="nowrap">
					<Text
						id={titleId}
						component="h2"
						ff={headingFont}
						fz={{ base: 19, sm: 22 }}
						fw={700}
					>
						{t("operations.byCategory")}
					</Text>
					<Text
						fw={700}
						className="tabular-nums"
						c={budgetTypeTones[side].text}
					>
						{formatAmount(total)}
					</Text>
				</Group>
				<SegmentedControl
					fullWidth
					value={side}
					onChange={(value) => {
						if (isCategorySide(value)) setSide(value);
					}}
					data={(["expense", "income"] as const).map((s) => ({
						value: s,
						label: t(categoryBreakdownKeys[s].label),
					}))}
					styles={{
						label: { minHeight: 36, display: "grid", alignContent: "center" },
					}}
				/>
				{rows.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t(keys.empty)}
					</Text>
				) : (
					<Group gap="lg" wrap="nowrap">
						<CategoryPie
							rows={rows}
							label={t(keys.title)}
							size={112}
							withOthers={false}
						/>
						<Box
							component="ul"
							m={0}
							p={0}
							maw={420}
							className="flex min-w-0 flex-1 list-none flex-col gap-2"
						>
							{rows.slice(0, OVERVIEW_ROWS).map((row) => (
								<Group
									component="li"
									key={row.key}
									justify="space-between"
									wrap="nowrap"
									gap="sm"
								>
									<CategoryLabel row={row} />
									<Text size="sm" className="tabular-nums" c="dimmed">
										{`${Math.round((row.amount / total) * 100)} %`}
									</Text>
								</Group>
							))}
						</Box>
					</Group>
				)}
				{rows.length > OVERVIEW_ROWS && (
					<AnchorLink
						to="/stats"
						search={{
							fromYear: year,
							fromMonth: month,
							toYear: year,
							toMonth: month,
						}}
						size="sm"
						fw={600}
						mih={44}
						className="grid place-content-center"
					>
						{t("operations.allCategories", { count: rows.length })}
					</AnchorLink>
				)}
			</Stack>
		</Paper>
	);
}
