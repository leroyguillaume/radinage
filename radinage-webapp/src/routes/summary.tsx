import {
	Alert,
	Anchor,
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
	UnstyledButton,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconAlertTriangle,
	IconChevronRight,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForecastMonthDrawer } from "@/components/ForecastMonthDrawer";
import { PageHeader } from "@/components/PageHeader";
import { YearStepper } from "@/components/YearStepper";
import {
	formatAmount,
	formatMonthYear,
	formatSignedAmount,
} from "@/lib/format";
import { useBelowBreakpoint, useForecast } from "@/lib/hooks";
import {
	balanceTextColor,
	budgetTypeTones,
	neutralTone,
	type Tone,
} from "@/lib/tones";
import type {
	ForecastMonth,
	ForecastMonthStatus,
	YearMonth,
} from "@/lib/types";
import { headingFont, palette } from "@/theme";

interface ForecastSearch {
	year: number;
}

export const Route = createFileRoute("/summary")({
	component: ForecastPage,
	validateSearch: (search: Record<string, unknown>): ForecastSearch => {
		return { year: Number(search.year) || new Date().getFullYear() };
	},
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
	status: ForecastMonthStatus;
	income: number;
	expenses: number;
	savings: number;
	balance: number;
	committed: number;
	unbudgetedForecast: number;
	cumulative: number;
}

function toMonthForecast(m: ForecastMonth): MonthForecast {
	return {
		year: m.year,
		month: m.month,
		status: m.status,
		income: Number(m.income),
		expenses: Number(m.expenses),
		savings: Number(m.savings),
		balance: Number(m.balance),
		committed: Number(m.committed),
		unbudgetedForecast: Number(m.unbudgetedForecast),
		cumulative: Number(m.cumulative),
	};
}

function daysInMonth({ year, month }: YearMonth): number {
	return new Date(year, month, 0).getDate();
}

function isSameMonth(a: YearMonth, b: YearMonth | null): boolean {
	return b !== null && a.year === b.year && a.month === b.month;
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

function longDate(date: Date, locale: string): string {
	return date.toLocaleDateString(locale, {
		day: "numeric",
		month: "long",
		year: "numeric",
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

interface BigAmountProps {
	value: string;
	color?: string;
	fz?: number;
}

function BigAmount({ value, color, fz }: BigAmountProps) {
	return (
		<Text
			className="tabular-nums"
			ff={headingFont}
			fz={fz ?? { base: 44, sm: 52 }}
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

interface AmountLineProps {
	label: string;
	amount: string;
	dot: string;
	color: string;
}

function AmountLine({ label, amount, dot, color }: AmountLineProps) {
	return (
		<Group justify="space-between" align="baseline" wrap="nowrap" gap="xs">
			<Group gap={8} wrap="nowrap">
				<Box w={10} h={10} bg={dot} style={{ borderRadius: 3, flex: "none" }} />
				<Text fw={600}>{label}</Text>
			</Group>
			<Text
				className="tabular-nums"
				fw={700}
				c={color}
				style={{ whiteSpace: "nowrap" }}
			>
				{amount}
			</Text>
		</Group>
	);
}

function TotalRow({ label, amount, ratio, tone }: TotalRowProps) {
	const width = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
	return (
		<Stack gap={6}>
			<AmountLine
				label={label}
				amount={formatAmount(amount)}
				dot={tone.fill}
				color={tone.text}
			/>
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

interface ForecastViewProps {
	forecast: MonthForecast[];
	locale: string;
	firstNegativeMonth: YearMonth | null;
	onSelectMonth: (month: YearMonth) => void;
}

function FirstNegativeMarker() {
	const { t } = useTranslation();
	const label = t("forecast.firstNegativeMarker");
	return (
		<Box
			component="span"
			role="img"
			aria-label={label}
			title={label}
			display="inline-flex"
			c="tangerine.8"
		>
			<IconAlertTriangle aria-hidden size={14} />
		</Box>
	);
}

function BalanceChart({
	forecast,
	locale,
	firstNegativeMonth,
	onSelectMonth,
}: ForecastViewProps) {
	const { t } = useTranslation();
	const maxPositive = Math.max(0, ...forecast.map((m) => m.balance));
	const maxNegative = Math.max(0, ...forecast.map((m) => -m.balance));
	const range = maxPositive + maxNegative;
	const unit = range > 0 ? CHART_HEIGHT / range : 0;
	const upArea = range > 0 ? Math.max(maxPositive * unit, MIN_BAR_HEIGHT) : 0;
	const downArea =
		maxNegative > 0 ? Math.max(maxNegative * unit, MIN_BAR_HEIGHT) : 0;
	const hasForecast = forecast.some((m) => m.status === "future");

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
							gridTemplateColumns: `repeat(${forecast.length}, minmax(48px, 1fr))`,
							gap: 8,
						}}
					>
						{forecast.map((m) => {
							const isCurrent = m.status === "current";
							const isProjected = m.status === "future";
							const isFirstNegative = isSameMonth(m, firstNegativeMonth);
							const up = m.balance > 0 ? barHeight(m.balance) : 0;
							const down = m.balance < 0 ? barHeight(m.balance) : 0;
							const upBg = isProjected
								? stripes("leaf-3", "leaf-1")
								: isCurrent
									? "var(--mantine-color-forest-7)"
									: "var(--mantine-color-leaf-5)";
							const downBg = isProjected
								? stripes("tangerine-3", "tangerine-1")
								: "var(--mantine-color-tangerine-5)";
							return (
								<UnstyledButton
									key={`${m.year}-${m.month}`}
									aria-label={t("forecast.breakdown.openMonth", {
										month: formatMonthYear(m, locale),
									})}
									onClick={() => onSelectMonth(m)}
									display="flex"
									bg={isFirstNegative ? "tangerine.0" : undefined}
									style={{
										flexDirection: "column",
										alignItems: "center",
										borderRadius: 8,
										outline: isFirstNegative
											? "2px solid var(--mantine-color-tangerine-5)"
											: undefined,
									}}
								>
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
									<Group mt={6} gap={2} wrap="nowrap">
										<Text
											fz={13}
											fw={isCurrent || isFirstNegative ? 800 : 500}
											c={
												isFirstNegative
													? "tangerine.8"
													: isCurrent
														? undefined
														: "dimmed"
											}
											tt="capitalize"
										>
											{monthName(m.year, m.month, locale, "short")}
										</Text>
										{isFirstNegative && <FirstNegativeMarker />}
									</Group>
								</UnstyledButton>
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

function MonthlyTable({
	forecast,
	locale,
	firstNegativeMonth,
	onSelectMonth,
}: ForecastViewProps) {
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
							const isCurrent = m.status === "current";
							const isFirstNegative = isSameMonth(m, firstNegativeMonth);
							return (
								<Table.Tr
									key={`${m.year}-${m.month}`}
									bg={
										isFirstNegative
											? "tangerine.0"
											: isCurrent
												? "leaf.1"
												: undefined
									}
									aria-current={isCurrent ? "date" : undefined}
									onClick={() => onSelectMonth(m)}
									style={{ cursor: "pointer" }}
								>
									<Table.Td>
										<Group gap={8} wrap="nowrap">
											<UnstyledButton
												aria-label={t("forecast.breakdown.openMonth", {
													month: formatMonthYear(m, locale),
												})}
												onClick={() => onSelectMonth(m)}
												mih={44}
												fw={600}
												tt="capitalize"
												td="underline"
												style={{ textUnderlineOffset: 3 }}
											>
												{monthName(m.year, m.month, locale, "long")}
											</UnstyledButton>
											{isCurrent && (
												<Badge variant="filled" color="forest" tt="none">
													{t("forecast.current")}
												</Badge>
											)}
											{m.status === "future" && (
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
											{isFirstNegative && (
												<Badge variant="filled" color="tangerine.8" tt="none">
													{t("forecast.firstNegativeMarker")}
												</Badge>
											)}
										</Group>
									</Table.Td>
									<Table.Td ta="right" c={income.text}>
										{formatAmount(m.income)}
									</Table.Td>
									<Table.Td ta="right" c={expense.text}>
										{formatAmount(m.expenses)}
										{m.unbudgetedForecast !== 0 && (
											<Text size="xs" fw={400} c="dimmed">
												{t("forecast.unbudgetedForecast", {
													amount: formatAmount(m.unbudgetedForecast),
												})}
											</Text>
										)}
									</Table.Td>
									<Table.Td ta="right" c={savings.text}>
										{formatAmount(m.savings)}
									</Table.Td>
									<Table.Td ta="right" fw={600} c={balanceTextColor(m.balance)}>
										{formatSignedAmount(m.balance)}
										{m.committed !== 0 && (
											<Text size="xs" fw={400} c="dimmed">
												{t("forecast.committed", {
													amount: formatSignedAmount(m.committed),
												})}
											</Text>
										)}
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

const statusLabelKeys: Record<ForecastMonthStatus, string> = {
	past: "forecast.actual",
	current: "forecast.current",
	future: "forecast.projected",
};

function MonthList({
	forecast,
	locale,
	firstNegativeMonth,
	onSelectMonth,
}: ForecastViewProps) {
	const { t } = useTranslation();
	const titleId = useId();
	const { income, expense } = budgetTypeTones;
	const scale = Math.max(
		0,
		...forecast.flatMap((m) => [m.income, -m.expenses]),
	);

	function barWidth(amount: number): string {
		const share = scale > 0 ? Math.min(1, Math.abs(amount) / scale) : 0;
		return `${Math.round(share * 100)}%`;
	}

	return (
		<Paper
			component="section"
			aria-labelledby={titleId}
			p={0}
			style={{ overflow: "hidden" }}
		>
			<Group justify="space-between" align="baseline" px="md" pt={14} pb={6}>
				<Title order={2} id={titleId} fz={18} fw={800}>
					{t("forecast.monthlyDetail")}
				</Title>
				<Text size="xs" fw={600} c="dimmed">
					{t("forecast.balanceAndCumulative")}
				</Text>
			</Group>
			<Box
				component="ul"
				m={0}
				px={8}
				pt={0}
				pb={8}
				style={{ listStyle: "none" }}
			>
				{forecast.map((m) => {
					const isCurrent = m.status === "current";
					const isFirstNegative = isSameMonth(m, firstNegativeMonth);
					return (
						<Box
							component="li"
							key={`${m.year}-${m.month}`}
							style={{ borderTop: `1px solid ${palette.divider}` }}
						>
							<UnstyledButton
								aria-label={t("forecast.breakdown.openMonth", {
									month: formatMonthYear(m, locale),
								})}
								aria-current={isCurrent ? "date" : undefined}
								onClick={() => onSelectMonth(m)}
								w="100%"
								mih={56}
								p={8}
								bg={
									isFirstNegative
										? "tangerine.0"
										: isCurrent
											? "leaf.1"
											: undefined
								}
								style={{
									display: "grid",
									gridTemplateColumns: "72px minmax(0, 1fr) auto 18px",
									columnGap: 10,
									alignItems: "center",
									borderRadius: 12,
									boxShadow: isFirstNegative
										? "inset 0 0 0 1px var(--mantine-color-tangerine-5)"
										: isCurrent
											? "inset 0 0 0 1px var(--mantine-color-leaf-3)"
											: undefined,
								}}
							>
								<div>
									<Group gap={2} wrap="nowrap">
										<Text fz={15} fw={700} tt="capitalize">
											{monthName(m.year, m.month, locale, "short")}
										</Text>
										{isFirstNegative && <FirstNegativeMarker />}
									</Group>
									<Text fz={11} fw={600} c="dimmed">
										{t(statusLabelKeys[m.status])}
									</Text>
								</div>
								<Stack gap={3} aria-hidden>
									<Box
										h={5}
										w={barWidth(m.income)}
										bg={income.fill}
										style={{ borderRadius: 999 }}
									/>
									<Box
										h={5}
										w={barWidth(m.expenses)}
										bg={expense.fill}
										style={{ borderRadius: 999 }}
									/>
								</Stack>
								<Box ta="right" style={{ whiteSpace: "nowrap" }}>
									<Text
										className="tabular-nums"
										fz={15}
										fw={700}
										c={balanceTextColor(m.balance)}
									>
										{formatSignedAmount(m.balance)}
									</Text>
									<Text className="tabular-nums" fz={12} fw={600} c="dimmed">
										{formatSignedAmount(m.cumulative)}
									</Text>
								</Box>
								<IconChevronRight
									aria-hidden
									size={18}
									color="var(--mantine-color-dimmed)"
								/>
							</UnstyledButton>
						</Box>
					);
				})}
			</Box>
		</Paper>
	);
}

const SPARK_WIDTH = 320;
const SPARK_HEIGHT = 64;
const SPARK_PADDING = 6;

function CumulativeSparkline({ forecast }: { forecast: MonthForecast[] }) {
	const { t } = useTranslation();
	if (forecast.length < 2) return null;
	const values = forecast.map((m) => m.cumulative);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const plotHeight = SPARK_HEIGHT - 2 * SPARK_PADDING;
	const points = values.map((value, i) => {
		const x = (i / (values.length - 1)) * SPARK_WIDTH;
		const y = SPARK_PADDING + (1 - (value - min) / span) * plotHeight;
		return `${x.toFixed(1)} ${y.toFixed(1)}`;
	});
	const lastKnown = forecast.findLastIndex((m) => m.status !== "future");
	const known = points.slice(0, lastKnown + 1);
	const projected = points.slice(Math.max(lastKnown, 0));
	const zeroY =
		min < 0 && max > 0 ? SPARK_PADDING + (max / span) * plotHeight : null;
	const lineProps = {
		fill: "none",
		stroke: neutralTone.fill,
		strokeWidth: 2.5,
		strokeLinejoin: "round",
		strokeLinecap: "round",
		vectorEffect: "non-scaling-stroke",
	} as const;
	return (
		<svg
			role="img"
			aria-label={t("forecast.cumulativeTrend")}
			width="100%"
			height={SPARK_HEIGHT}
			viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
			preserveAspectRatio="none"
		>
			{zeroY !== null && (
				<line
					x1={0}
					x2={SPARK_WIDTH}
					y1={zeroY}
					y2={zeroY}
					stroke={palette.border}
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
			)}
			{known.length > 1 && <path d={`M${known.join(" L")}`} {...lineProps} />}
			{projected.length > 1 && (
				<path
					d={`M${projected.join(" L")}`}
					{...lineProps}
					strokeDasharray="4 4"
				/>
			)}
			{lastKnown >= 0 && (
				// A zero-length round-capped stroke: unlike a <circle>, it stays
				// round when preserveAspectRatio="none" stretches the chart.
				<path d={`M${points[lastKnown]} Z`} {...lineProps} strokeWidth={9} />
			)}
		</svg>
	);
}

function RemainingDaysBadge({ count }: { count: number }) {
	const { t } = useTranslation();
	return (
		<Badge variant="filled" color="gold.5" c="gold.9" tt="none" fw={700}>
			{t("forecast.remainingDays", { count })}
		</Badge>
	);
}

interface DailyBudgetCardProps {
	dailyBudget: number | null;
	daysLeft: number;
	yearProgress: number;
	compact: boolean;
}

function DailyBudgetCard({
	dailyBudget,
	daysLeft,
	yearProgress,
	compact,
}: DailyBudgetCardProps) {
	const { t } = useTranslation();
	return (
		<HeroCard
			variant="filled"
			title={t("forecast.dailyBudget")}
			titleAside={<RemainingDaysBadge count={daysLeft} />}
		>
			<BigAmount
				value={dailyBudget === null ? "—" : formatAmount(dailyBudget)}
				color={
					dailyBudget !== null && dailyBudget < 0 ? "tangerine.3" : undefined
				}
				fz={compact ? 36 : undefined}
			/>
			<Text size="sm" c="forest.1">
				{dailyBudget === null
					? t("forecast.dailyBudgetOver")
					: dailyBudget < 0
						? t("forecast.dailyBudgetNegativeHint")
						: t("forecast.dailyBudgetHint")}
			</Text>
			<Stack gap={6} mt="auto">
				<Text size="sm" c="forest.1">
					{t("forecast.yearProgress", { percent: Math.round(yearProgress) })}
				</Text>
				<Progress
					value={yearProgress}
					color="gold.5"
					size={8}
					styles={{
						root: { backgroundColor: "var(--mantine-color-forest-8)" },
					}}
				/>
			</Stack>
		</HeroCard>
	);
}

interface SurplusCardProps {
	year: number;
	income: number;
	expenses: number;
	savings: number;
	unbudgetedRate: number | null;
	compact: boolean;
}

function SurplusCard({
	year,
	income,
	expenses,
	savings,
	unbudgetedRate,
	compact,
}: SurplusCardProps) {
	const { t } = useTranslation();
	const surplus = income + expenses;

	function shareOfIncome(amount: number): number {
		return income > 0 ? Math.abs(amount) / income : 0;
	}

	return (
		<HeroCard title={t("forecast.surplusTitle", { year })}>
			<BigAmount
				value={formatSignedAmount(surplus)}
				color={balanceTextColor(surplus)}
				fz={compact ? 22 : undefined}
			/>
			{compact ? (
				<Text size="xs" c="dimmed">
					{t("forecast.surplusHintShort")}
				</Text>
			) : (
				<>
					<Text size="sm" c="dimmed">
						{t("forecast.surplusHint")}
					</Text>
					<TotalRow
						label={t("forecast.totalIncome")}
						amount={income}
						ratio={income > 0 ? 1 : 0}
						tone={budgetTypeTones.income}
					/>
					<TotalRow
						label={t("forecast.totalExpenses")}
						amount={expenses}
						ratio={shareOfIncome(expenses)}
						tone={budgetTypeTones.expense}
					/>
					<TotalRow
						label={t("forecast.totalSavings")}
						amount={savings}
						ratio={shareOfIncome(savings)}
						tone={budgetTypeTones.savings}
					/>
					{unbudgetedRate !== null && (
						<Text size="sm" c="dimmed" mt="auto">
							{t("forecast.unbudgetedRate", {
								amount: formatAmount(-unbudgetedRate),
							})}
						</Text>
					)}
				</>
			)}
		</HeroCard>
	);
}

interface BalanceCardProps {
	year: number;
	startingBalance: number | null;
	endBalance: number;
	forecast: MonthForecast[];
	compact: boolean;
}

function BalanceCard({
	year,
	startingBalance,
	endBalance,
	forecast,
	compact,
}: BalanceCardProps) {
	const { t, i18n } = useTranslation();
	const title = t("forecast.projectedBalance", {
		date: longDate(new Date(year, 11, 31), i18n.language),
	});
	if (startingBalance === null) {
		return (
			<HeroCard title={title}>
				<BigAmount value="—" color="dimmed" fz={compact ? 22 : undefined} />
				<Text size={compact ? "xs" : "sm"} c="dimmed">
					{t("forecast.noBalanceHint")}{" "}
					<Anchor component={Link} to="/settings" inherit>
						{t("forecast.noBalanceLink")}
					</Anchor>
				</Text>
			</HeroCard>
		);
	}
	const start = t("forecast.startingBalance", {
		date: longDate(new Date(year, 0, 1), i18n.language),
		amount: formatAmount(startingBalance),
	});
	return (
		<HeroCard title={title}>
			<BigAmount
				value={formatSignedAmount(endBalance)}
				color={balanceTextColor(endBalance)}
				fz={compact ? 22 : undefined}
			/>
			{compact ? (
				<Text size="xs" c="dimmed">
					{start}
				</Text>
			) : (
				<>
					<Text size="sm" c="dimmed">
						{t("forecast.projectedBalanceHint")}
					</Text>
					<Stack gap="xs" mt="auto">
						<CumulativeSparkline forecast={forecast} />
						<Text size="xs" c="dimmed">
							{start}
						</Text>
					</Stack>
				</>
			)}
		</HeroCard>
	);
}

function ForecastPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const search = Route.useSearch();
	const selectedYear = search.year;
	const forecastQuery = useForecast(selectedYear, 1, 12);
	const { isLoading, isError } = forecastQuery;
	const [selectedMonth, setSelectedMonth] = useState<YearMonth | null>(null);
	const isMobile = useBelowBreakpoint("sm");

	const forecast = (forecastQuery.data?.months ?? []).map(toMonthForecast);
	const totals = forecastQuery.data?.totals;
	const endBalance = Number(forecastQuery.data?.endBalance ?? 0);
	const rawStartingBalance = forecastQuery.data?.startingBalance ?? null;
	const startingBalance =
		rawStartingBalance === null ? null : Number(rawStartingBalance);

	const daysLeft = forecastQuery.data?.daysLeft ?? 0;
	const rawDailyBudget = forecastQuery.data?.dailyBudget ?? null;
	const dailyBudget = rawDailyBudget === null ? null : Number(rawDailyBudget);
	const firstNegativeMonth = forecastQuery.data?.firstNegativeMonth ?? null;
	const yearDays = forecast.reduce((sum, m) => sum + daysInMonth(m), 0);
	const yearProgress =
		yearDays > 0 ? ((yearDays - daysLeft) / yearDays) * 100 : 0;

	const forecastsUnbudgeted = forecast.some((m) => m.unbudgetedForecast !== 0);
	const unbudgetedRate = forecastsUnbudgeted
		? Number(forecastQuery.data?.unbudgetedRate ?? 0)
		: null;

	function navigateYear(delta: number) {
		navigate({
			to: "/summary",
			search: { year: selectedYear + delta },
		});
	}

	const yearStepper = (
		<YearStepper year={selectedYear} onChange={navigateYear} />
	);

	const viewProps: ForecastViewProps = {
		forecast,
		locale: i18n.language,
		firstNegativeMonth,
		onSelectMonth: setSelectedMonth,
	};

	const dailyBudgetCard = (
		<DailyBudgetCard
			dailyBudget={dailyBudget}
			daysLeft={daysLeft}
			yearProgress={yearProgress}
			compact={isMobile}
		/>
	);
	const surplusCard = (
		<SurplusCard
			year={selectedYear}
			income={Number(totals?.income ?? 0)}
			expenses={Number(totals?.expenses ?? 0)}
			savings={Number(totals?.savings ?? 0)}
			unbudgetedRate={unbudgetedRate}
			compact={isMobile}
		/>
	);
	const balanceCard = (
		<BalanceCard
			year={selectedYear}
			startingBalance={startingBalance}
			endBalance={endBalance}
			forecast={forecast}
			compact={isMobile}
		/>
	);

	return (
		<div className="h-full overflow-auto">
			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap={isMobile ? "sm" : "lg"}
			>
				<PageHeader
					title={t("forecast.title")}
					subtitle={t("forecast.subtitle")}
					subtitleInfoLabel={t("forecast.subtitleInfo")}
					actions={isMobile ? undefined : yearStepper}
				/>
				{isMobile && yearStepper}

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
						{firstNegativeMonth && (
							<Alert
								icon={<IconAlertTriangle size={16} />}
								color="tangerine"
								title={t("forecast.firstNegativeTitle", {
									month: formatMonthYear(firstNegativeMonth, i18n.language),
								})}
							>
								{t("forecast.firstNegativeText")}
							</Alert>
						)}
						{isMobile ? (
							<>
								{dailyBudgetCard}
								<SimpleGrid cols={2} spacing="sm">
									{surplusCard}
									{balanceCard}
								</SimpleGrid>
								<MonthList {...viewProps} />
							</>
						) : (
							<>
								<SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
									{dailyBudgetCard}
									{surplusCard}
									{balanceCard}
								</SimpleGrid>
								<BalanceChart {...viewProps} />
								<MonthlyTable {...viewProps} />
							</>
						)}
					</>
				)}
			</Stack>
			<ForecastMonthDrawer
				month={selectedMonth}
				onClose={() => setSelectedMonth(null)}
			/>
		</div>
	);
}
