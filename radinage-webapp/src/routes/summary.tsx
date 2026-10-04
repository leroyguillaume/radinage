import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Group,
	Loader,
	Paper,
	Progress,
	SimpleGrid,
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
import { type CSSProperties, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { getBudgetedAmountForMonth } from "@/lib/budget-utils";
import { formatAmount, formatSignedAmount } from "@/lib/format";
import { useBudgets, useSummary } from "@/lib/hooks";
import { balanceTextColor, budgetTypeTones, type Tone } from "@/lib/tones";
import type { BudgetResponse, MonthlySummary } from "@/lib/types";
import { headingFont, palette } from "@/theme";

interface ForecastSearch {
	year: number;
}

export const Route = createFileRoute("/summary")({
	component: ForecastPage,
	validateSearch: (search: Record<string, unknown>): ForecastSearch => ({
		year: Number(search.year) || new Date().getFullYear(),
	}),
});

const shortNumber = new Intl.NumberFormat("fr-FR", {
	maximumFractionDigits: 0,
});

function formatShortSigned(amount: number): string {
	const rounded = Math.round(amount);
	return rounded > 0
		? `+${shortNumber.format(rounded)}`
		: shortNumber.format(rounded);
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
	summaryMonths: MonthlySummary[],
	budgets: BudgetResponse[],
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

function monthName(
	year: number,
	month: number,
	locale: string,
	style: "long" | "short",
): string {
	return new Date(year, month - 1).toLocaleDateString(locale, {
		month: style,
	});
}

function stripes(dark: string, light: string): string {
	return `repeating-linear-gradient(135deg, var(--mantine-color-${dark}) 0 4px, var(--mantine-color-${light}) 4px 8px)`;
}

const cardTitleProps = {
	component: "h2",
	m: 0,
	fz: 15,
	fw: 600,
} as const;

interface YearStepperProps {
	year: number;
	onChange: (delta: number) => void;
}

function YearStepper({ year, onChange }: YearStepperProps) {
	const { t } = useTranslation();
	return (
		<Group
			gap={4}
			p={4}
			wrap="nowrap"
			bg={palette.surface}
			bd={`1px solid ${palette.border}`}
			style={{ borderRadius: 999 }}
		>
			<ActionIcon
				size={44}
				radius="xl"
				variant="subtle"
				aria-label={t("forecast.previousYear")}
				onClick={() => onChange(-1)}
			>
				<IconChevronLeft size={20} />
			</ActionIcon>
			<Text
				className="tabular-nums"
				ff={headingFont}
				fw={700}
				fz={20}
				miw={64}
				ta="center"
			>
				{year}
			</Text>
			<ActionIcon
				size={44}
				radius="xl"
				variant="subtle"
				aria-label={t("forecast.nextYear")}
				onClick={() => onChange(1)}
			>
				<IconChevronRight size={20} />
			</ActionIcon>
		</Group>
	);
}

interface HeroCardProps {
	title: ReactNode;
	titleAside?: ReactNode;
	children: ReactNode;
	variant?: "filled" | "default";
}

function HeroCard({
	title,
	titleAside,
	children,
	variant = "default",
}: HeroCardProps) {
	const titleId = useId();
	const filled = variant === "filled";
	return (
		<Paper
			component="section"
			aria-labelledby={titleId}
			bg={filled ? "forest.7" : undefined}
			c={filled ? "forest.0" : undefined}
			withBorder={!filled}
		>
			<Stack gap={14} h="100%">
				<Group justify="space-between" align="center" gap="xs">
					<Text
						{...cardTitleProps}
						id={titleId}
						c={filled ? "forest.1" : "dimmed"}
					>
						{title}
					</Text>
					{titleAside}
				</Group>
				{children}
			</Stack>
		</Paper>
	);
}

function BigAmount({ value, color }: { value: string; color?: string }) {
	return (
		<Text
			className="tabular-nums"
			ff={headingFont}
			fz={{ base: 44, sm: 52 }}
			fw={800}
			lh={1}
			lts="-0.03em"
			c={color}
		>
			{value}
		</Text>
	);
}

interface TotalRowProps {
	label: string;
	amount: number;
	ratio: number;
	tone: Tone;
}

function TotalRow({ label, amount, ratio, tone }: TotalRowProps) {
	const width = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
	return (
		<Stack gap={6}>
			<Group justify="space-between" align="baseline" wrap="nowrap" gap="xs">
				<Group gap={8} wrap="nowrap">
					<Box w={10} h={10} bg={tone.fill} style={{ borderRadius: 3 }} />
					<Text fw={600}>{label}</Text>
				</Group>
				<Text className="tabular-nums" fw={700} c={tone.text}>
					{formatAmount(amount)}
				</Text>
			</Group>
			<Box
				aria-hidden
				h={6}
				bg={palette.track}
				style={{ borderRadius: 999, overflow: "hidden" }}
			>
				<Box
					h="100%"
					w={`${width}%`}
					bg={tone.fill}
					style={{ borderRadius: 999 }}
				/>
			</Box>
		</Stack>
	);
}

function LegendItem({
	swatch,
	label,
}: {
	swatch: CSSProperties;
	label: string;
}) {
	return (
		<Group gap={6} wrap="nowrap">
			<Box w={12} h={12} style={{ borderRadius: 3, ...swatch }} />
			<Text size="sm" c="dimmed">
				{label}
			</Text>
		</Group>
	);
}

const CHART_HEIGHT = 170;
const MIN_BAR_HEIGHT = 4;

interface BalanceChartProps {
	forecast: MonthForecast[];
	currentMonth: number | null;
	locale: string;
}

function BalanceChart({ forecast, currentMonth, locale }: BalanceChartProps) {
	const { t } = useTranslation();
	const maxPositive = Math.max(0, ...forecast.map((m) => m.balance));
	const maxNegative = Math.max(0, ...forecast.map((m) => -m.balance));
	const range = maxPositive + maxNegative;
	const unit = range > 0 ? CHART_HEIGHT / range : 0;
	const upArea = range > 0 ? Math.max(maxPositive * unit, MIN_BAR_HEIGHT) : 0;
	const downArea =
		maxNegative > 0 ? Math.max(maxNegative * unit, MIN_BAR_HEIGHT) : 0;
	const hasForecast = forecast.some((m) => !m.isActual);

	function barHeight(amount: number): number {
		return amount === 0 ? 0 : Math.max(Math.abs(amount) * unit, MIN_BAR_HEIGHT);
	}

	return (
		<Paper component="section">
			<Stack gap="lg">
				<Group justify="space-between" align="center" gap="sm">
					<Title order={2} fz={22} fw={700}>
						{t("forecast.monthlyChart")}
					</Title>
					<Group gap="md">
						<LegendItem
							swatch={{ background: "var(--mantine-color-leaf-5)" }}
							label={t("forecast.surplus")}
						/>
						<LegendItem
							swatch={{ background: "var(--mantine-color-tangerine-5)" }}
							label={t("forecast.deficit")}
						/>
						{hasForecast && (
							<LegendItem
								swatch={{
									background: stripes("leaf-3", "leaf-1"),
									border: "1px solid var(--mantine-color-leaf-3)",
								}}
								label={t("forecast.projected")}
							/>
						)}
					</Group>
				</Group>
				<Box style={{ overflowX: "auto" }}>
					<Box
						miw={640}
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(12, minmax(48px, 1fr))",
							gap: 8,
						}}
					>
						{forecast.map((m) => {
							const isCurrent = m.month === currentMonth;
							const up = m.balance > 0 ? barHeight(m.balance) : 0;
							const down = m.balance < 0 ? barHeight(m.balance) : 0;
							const upBg = !m.isActual
								? stripes("leaf-3", "leaf-1")
								: isCurrent
									? "var(--mantine-color-forest-7)"
									: "var(--mantine-color-leaf-5)";
							const downBg = !m.isActual
								? stripes("tangerine-3", "tangerine-1")
								: "var(--mantine-color-tangerine-5)";
							return (
								<Stack key={m.month} gap={0} align="center">
									<Text
										className="tabular-nums"
										h={22}
										fz={12}
										fw={700}
										c={balanceTextColor(m.balance)}
									>
										{formatShortSigned(m.balance)}
									</Text>
									<Box
										aria-hidden
										h={upArea}
										w="100%"
										display="flex"
										style={{ alignItems: "flex-end", justifyContent: "center" }}
									>
										<Box
											w="70%"
											maw={44}
											h={up}
											style={{
												background: upBg,
												borderRadius: "8px 8px 2px 2px",
											}}
										/>
									</Box>
									<Box aria-hidden h={2} w="100%" bg={palette.border} />
									<Box
										aria-hidden
										h={downArea}
										w="100%"
										display="flex"
										style={{
											alignItems: "flex-start",
											justifyContent: "center",
										}}
									>
										<Box
											w="70%"
											maw={44}
											h={down}
											style={{
												background: downBg,
												borderRadius: "2px 2px 8px 8px",
											}}
										/>
									</Box>
									<Text
										mt={6}
										fz={13}
										fw={isCurrent ? 800 : 500}
										c={isCurrent ? undefined : "dimmed"}
										tt="capitalize"
									>
										{monthName(m.year, m.month, locale, "short")}
									</Text>
								</Stack>
							);
						})}
					</Box>
				</Box>
			</Stack>
		</Paper>
	);
}

const thStyle = {
	padding: "12px 16px",
	fontSize: 13,
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.04em",
	color: "var(--mantine-color-dimmed)",
	whiteSpace: "nowrap",
} as const;

const tdStyle = {
	padding: "12px 16px",
	whiteSpace: "nowrap",
} as const;

interface MonthlyTableProps {
	forecast: MonthForecast[];
	currentMonth: number | null;
	locale: string;
}

function MonthlyTable({ forecast, currentMonth, locale }: MonthlyTableProps) {
	const { t } = useTranslation();
	const { income, expense, savings } = budgetTypeTones;
	return (
		<Paper component="section" p={0} style={{ overflow: "hidden" }}>
			<Box
				px="lg"
				py={20}
				style={{ borderBottom: `1px solid ${palette.divider}` }}
			>
				<Title order={2} fz={22} fw={700}>
					{t("forecast.monthlyDetail")}
				</Title>
			</Box>
			<Table.ScrollContainer minWidth={760} type="native">
				<Table
					className="tabular-nums"
					fz={15}
					verticalSpacing={0}
					horizontalSpacing={0}
					borderColor={palette.divider}
					styles={{ th: thStyle, td: tdStyle }}
				>
					<Table.Thead bg={palette.surfaceMuted}>
						<Table.Tr>
							<Table.Th scope="col">{t("forecast.month")}</Table.Th>
							<Table.Th scope="col" ta="right">
								{t("forecast.income")}
							</Table.Th>
							<Table.Th scope="col" ta="right">
								{t("forecast.expenses")}
							</Table.Th>
							<Table.Th scope="col" ta="right">
								{t("forecast.savings")}
							</Table.Th>
							<Table.Th scope="col" ta="right">
								{t("forecast.balance")}
							</Table.Th>
							<Table.Th scope="col" ta="right">
								{t("forecast.cumulative")}
							</Table.Th>
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{forecast.map((m) => {
							const isCurrent = m.month === currentMonth;
							return (
								<Table.Tr
									key={m.month}
									bg={isCurrent ? "leaf.1" : undefined}
									aria-current={isCurrent ? "date" : undefined}
								>
									<Table.Td>
										<Group gap={8} wrap="nowrap">
											<Text fw={600} tt="capitalize" inherit>
												{monthName(m.year, m.month, locale, "long")}
											</Text>
											{isCurrent && (
												<Badge variant="filled" color="forest" tt="none">
													{t("forecast.current")}
												</Badge>
											)}
											{!m.isActual && (
												<Badge
													variant="filled"
													bg={palette.track}
													c="dimmed"
													tt="none"
													fw={600}
												>
													{t("forecast.projected")}
												</Badge>
											)}
										</Group>
									</Table.Td>
									<Table.Td ta="right" c={income.text}>
										{formatAmount(m.income)}
									</Table.Td>
									<Table.Td ta="right" c={expense.text}>
										{formatAmount(m.expenses)}
									</Table.Td>
									<Table.Td ta="right" c={savings.text}>
										{formatAmount(m.savings)}
									</Table.Td>
									<Table.Td ta="right" fw={600} c={balanceTextColor(m.balance)}>
										{formatSignedAmount(m.balance)}
									</Table.Td>
									<Table.Td
										ta="right"
										fw={700}
										c={balanceTextColor(m.cumulative)}
									>
										{formatSignedAmount(m.cumulative)}
									</Table.Td>
								</Table.Tr>
							);
						})}
					</Table.Tbody>
				</Table>
			</Table.ScrollContainer>
		</Paper>
	);
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
	// Past years count December as "actual" too, but only this year has a
	// month that is genuinely in progress.
	const inProgressMonth = selectedYear === thisYear ? currentMonth : null;

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

	function shareOfIncome(amount: number): number {
		return totalIncome > 0 ? Math.abs(amount) / totalIncome : 0;
	}

	function navigateYear(delta: number) {
		navigate({
			to: "/summary",
			search: { year: selectedYear + delta },
		});
	}

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
					title={t("forecast.title")}
					subtitle={t("forecast.subtitle")}
					actions={<YearStepper year={selectedYear} onChange={navigateYear} />}
				/>

				{isLoading && (
					<Group justify="center" py="xl">
						<Loader />
					</Group>
				)}

				{isError && (
					<Alert
						icon={<IconAlertCircle size={16} />}
						color="tangerine"
						title={t("common.error")}
					>
						{t("forecast.fetchError")}
					</Alert>
				)}

				{!isLoading && !isError && (
					<>
						<SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
							<HeroCard
								variant="filled"
								title={t("forecast.dailyBudget")}
								titleAside={
									<Badge
										variant="filled"
										color="gold.5"
										c="gold.9"
										tt="none"
										fw={700}
									>
										{t("forecast.remainingDays", { count: remainingDays })}
									</Badge>
								}
							>
								<BigAmount value={formatAmount(dailyBudget)} />
								<Stack gap={6} mt="auto">
									<Text size="sm" c="forest.1">
										{t("forecast.yearProgress", {
											percent: Math.round(yearProgress),
										})}
									</Text>
									<Progress
										value={yearProgress}
										color="gold.5"
										size={8}
										styles={{
											root: {
												backgroundColor: "var(--mantine-color-forest-8)",
											},
										}}
									/>
								</Stack>
							</HeroCard>

							<HeroCard title={t("forecast.endOfYearBalance")}>
								<BigAmount
									value={formatSignedAmount(endOfYearBalance)}
									color={balanceTextColor(endOfYearBalance)}
								/>
								<Text size="sm" c="dimmed">
									{t("forecast.endOfYearHint")}
								</Text>
							</HeroCard>

							<HeroCard
								title={t("forecast.totalsTitle", { year: selectedYear })}
							>
								<TotalRow
									label={t("forecast.totalIncome")}
									amount={totalIncome}
									ratio={totalIncome > 0 ? 1 : 0}
									tone={budgetTypeTones.income}
								/>
								<TotalRow
									label={t("forecast.totalExpenses")}
									amount={totalExpenses}
									ratio={shareOfIncome(totalExpenses)}
									tone={budgetTypeTones.expense}
								/>
								<TotalRow
									label={t("forecast.totalSavings")}
									amount={totalSavings}
									ratio={shareOfIncome(totalSavings)}
									tone={budgetTypeTones.savings}
								/>
							</HeroCard>
						</SimpleGrid>

						<BalanceChart
							forecast={forecast}
							currentMonth={inProgressMonth}
							locale={i18n.language}
						/>

						<MonthlyTable
							forecast={forecast}
							currentMonth={inProgressMonth}
							locale={i18n.language}
						/>
					</>
				)}
			</Stack>
		</div>
	);
}
