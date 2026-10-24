import {
	Box,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { AnchorLink } from "@/components/AnchorLink";
import { BudgetMonthBars } from "@/components/BudgetMonthBars";
import { deltaColor, YearBar } from "@/components/BudgetYearProgress";
import {
	type BudgetWithYear,
	budgetYearStats,
	typeYearTotals,
} from "@/lib/budget-year";
import { formatAmount, formatSignedAmount } from "@/lib/format";
import { budgetTypeTones } from "@/lib/tones";
import type { BudgetType } from "@/lib/types";
import { headingFont, palette } from "@/theme";

const types: BudgetType[] = ["expense", "income", "savings"];

/** Over-budget expense budgets listed, most over first. */
const MAX_OVERS = 5;

interface BudgetYearOverviewProps {
	entries: BudgetWithYear[];
	year: number;
	today: Date;
}

export function BudgetYearOverview({
	entries,
	year,
	today,
}: BudgetYearOverviewProps) {
	const { t } = useTranslation();
	const totals = types
		.map((type) => ({ type, ...typeYearTotals(entries, type, year, today) }))
		.filter((total) => total.planned > 0 || total.real > 0);
	const expenses = totals.find((total) => total.type === "expense");
	const overs = entries
		.filter((e) => e.budget.budgetType === "expense" && e.year.tone === "bad")
		.sort((a, b) => b.year.delta - a.year.delta)
		.slice(0, MAX_OVERS);
	const remaining = totals.filter((total) => total.remaining > 0);

	if (totals.length === 0) return null;

	return (
		<SimpleGrid
			component="section"
			aria-label={t("budgets.overview.title", { year })}
			cols={{ base: 1, md: 2 }}
			spacing="md"
		>
			<Paper component="section" aria-labelledby="overview-types">
				<Stack gap="lg">
					<SectionTitle id="overview-types">
						{t("budgets.overview.byType")}
					</SectionTitle>
					{totals.map((total) => (
						<Stack key={total.type} gap={6}>
							<Group justify="space-between" wrap="nowrap">
								<Group gap={8} wrap="nowrap">
									<Box
										w={10}
										h={10}
										bg={budgetTypeTones[total.type].fill}
										style={{ borderRadius: 99 }}
									/>
									<Text fw={700}>{t(`budgets.filters.${total.type}`)}</Text>
								</Group>
								{total.tone !== "even" && (
									<Text
										size="sm"
										fw={700}
										className="tabular-nums"
										c={deltaColor(total.type, total.tone)}
									>
										{formatSignedAmount(total.delta)}
									</Text>
								)}
							</Group>
							<Group gap={6} align="baseline" className="tabular-nums">
								<Text ff={headingFont} fz={26} fw={800}>
									{formatAmount(total.real)}
								</Text>
								<Text size="sm" c="dimmed">
									{t("budgets.overview.ofYear", {
										amount: formatAmount(total.planned),
									})}
								</Text>
							</Group>
							<YearBar
								real={total.real}
								planned={total.planned}
								expectedToDate={total.expectedToDate}
								fill={budgetTypeTones[total.type].fill}
							/>
							{total.tone !== "even" && (
								<Text size="sm" c="dimmed">
									{t("budgets.overview.deltaNote", {
										gap: formatSignedAmount(total.delta),
									})}
								</Text>
							)}
						</Stack>
					))}
				</Stack>
			</Paper>

			{expenses && (
				<Paper component="section" aria-labelledby="overview-monthly">
					<Stack gap="md">
						<SectionTitle id="overview-monthly">
							{t("budgets.overview.monthlyExpenses")}
						</SectionTitle>
						<BudgetMonthBars
							months={expenses.months}
							label={t("budgets.overview.monthlyChart")}
							withinLabel={t("budgets.overview.underPlan")}
							offLabel={t("budgets.overview.overPlan")}
							offState="over"
						/>
					</Stack>
				</Paper>
			)}

			{expenses && (
				<Paper component="section" aria-labelledby="overview-overs">
					<Stack gap={4}>
						<SectionTitle id="overview-overs">
							{t("budgets.overview.overTitle")}
						</SectionTitle>
						{overs.length === 0 ? (
							<Text size="sm" c="dimmed" mt="xs">
								{t("budgets.overview.overEmpty")}
							</Text>
						) : (
							overs.map(({ budget, year: budgetYear }) => {
								const stats = budgetYearStats(budgetYear, today);
								return (
									<AnchorLink
										key={budget.id}
										to="/budgets/$budgetId"
										params={{ budgetId: budget.id }}
										search={{ year }}
										underline="never"
										c="inherit"
										mih={48}
										py={6}
										display="flex"
										style={{
											justifyContent: "space-between",
											alignItems: "center",
											borderBottom: `1px solid ${palette.divider}`,
										}}
									>
										<Stack gap={0}>
											<Text fw={700}>{budget.label}</Text>
											{stats.due > 0 && (
												<Text size="xs" c="dimmed">
													{t("budgets.overview.overMonths", {
														over: stats.missed,
														due: stats.due,
													})}
												</Text>
											)}
										</Stack>
										<Text
											fw={700}
											className="tabular-nums"
											c={budgetTypeTones.expense.text}
										>
											{formatSignedAmount(budgetYear.delta)}
										</Text>
									</AnchorLink>
								);
							})
						)}
					</Stack>
				</Paper>
			)}

			{remaining.length > 0 && (
				<Paper component="section" aria-labelledby="overview-remaining">
					<Stack gap="md">
						<SectionTitle id="overview-remaining">
							{t("budgets.overview.remainingTitle")}
						</SectionTitle>
						<SimpleGrid cols={remaining.length} spacing="xs">
							{remaining.map((total) => (
								<Stack
									key={total.type}
									gap={2}
									p="sm"
									bg={`${budgetTypeTones[total.type].color}.0`}
									style={{ borderRadius: 14 }}
								>
									<Text size="xs" c={budgetTypeTones[total.type].text}>
										{t(`budgets.overview.remaining.${total.type}`)}
									</Text>
									<Text fw={700} className="tabular-nums">
										{formatAmount(total.remaining)}
									</Text>
								</Stack>
							))}
						</SimpleGrid>
					</Stack>
				</Paper>
			)}
		</SimpleGrid>
	);
}

function SectionTitle({ id, children }: { id: string; children: string }) {
	return (
		<Title id={id} order={2} fz={18} fw={700}>
			{children}
		</Title>
	);
}
