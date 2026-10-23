import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Group,
	Loader,
	Paper,
	Progress,
	SegmentedControl,
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
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ForecastMonthDrawer } from "@/components/ForecastMonthDrawer";
import { PageHeader } from "@/components/PageHeader";
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

const forecastModes = ["year", "rolling"] as const;
type ForecastMode = (typeof forecastModes)[number];

function isForecastMode(value: string): value is ForecastMode {
	return (forecastModes as readonly string[]).includes(value);
}

const ROLLING_MONTHS = 12;

/**
 * `mode` is only written for the rolling view, so a bare `?year=` link is the
 * calendar-year view. `year` is kept in rolling mode to switch back to it.
 */
interface ForecastSearch {
	year: number;
	mode?: "rolling";
}

export const Route = createFileRoute("/summary")({
	component: ForecastPage,
	validateSearch: (search: Record<string, unknown>): ForecastSearch => {
		const year = Number(search.year) || new Date().getFullYear();
		return search.mode === "rolling" ? { year, mode: "rolling" } : { year };
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
				fz={{ base: 17, sm: 20 }}
				miw={{ base: 48, sm: 64 }}
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

interface ModeSwitchProps {
	mode: ForecastMode;
	year: number;
	/** Short labels, stretched to share a phone-width row with the stepper. */
	compact?: boolean;
	onChange: (mode: ForecastMode) => void;
}

function ModeSwitch({
	mode,
	year,
	compact = false,
	onChange,
}: ModeSwitchProps) {
	const { t } = useTranslation();
	return (
		<SegmentedControl
			radius="xl"
			size="md"
			flex={compact ? 1 : undefined}
			aria-label={t("forecast.mode")}
			value={mode}
			onChange={(value) => {
				if (isForecastMode(value)) onChange(value);
			}}
			data={[
				{
					value: "year",
					label: compact
						? t("forecast.modeYearShort")
						: t("forecast.modeYear", { year }),
				},
				{
					value: "rolling",
					label: t(
						compact ? "forecast.modeRollingShort" : "forecast.modeRolling",
					),
				},
			]}
			styles={{
				label: {
					minHeight: 44,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				},
			}}
		/>
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
	showYear: boolean;
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
	showYear,
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
									{showYear && (
										<Text className="tabular-nums" fz={11} c="dimmed">
											{m.year}
										</Text>
									)}
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
	showYear,
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
												{showYear
													? formatMonthYear(m, locale)
													: monthName(m.year, m.month, locale, "long")}
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
	showYear,
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
					{t("forecast.balance")}
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
										{showYear && ` · ${m.year}`}
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
								<Text
									className="tabular-nums"
									fz={15}
									fw={700}
									c={balanceTextColor(m.balance)}
									style={{ whiteSpace: "nowrap" }}
								>
									{formatSignedAmount(m.balance)}
								</Text>
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

interface MobileHeroProps {
	title: string;
	headline: number;
	forecast: MonthForecast[];
	dailyBudget: number | null;
	daysLeft: number;
	income: number;
	expenses: number;
	savings: number;
}

function MobileHero({
	title,
	headline,
	forecast,
	dailyBudget,
	daysLeft,
	income,
	expenses,
	savings,
}: MobileHeroProps) {
	const { t } = useTranslation();
	const titleId = useId();
	const strip = [
		{
			label: t("forecast.totalIncome"),
			amount: income,
			tone: budgetTypeTones.income,
		},
		{
			label: t("forecast.totalExpenses"),
			amount: expenses,
			tone: budgetTypeTones.expense,
		},
		{
			label: t("forecast.totalSavings"),
			amount: savings,
			tone: budgetTypeTones.savings,
		},
	];
	return (
		<Paper component="section" aria-labelledby={titleId} p="md">
			<Stack gap={12}>
				<div>
					<Text {...cardTitleProps} id={titleId} fz={13} c="dimmed">
						{title}
					</Text>
					<BigAmount
						value={formatSignedAmount(headline)}
						color={balanceTextColor(headline)}
						fz={36}
					/>
				</div>
				<CumulativeSparkline forecast={forecast} />
				<Group justify="space-between" align="center" gap="xs" wrap="nowrap">
					<Text size="sm" fw={600} c="dimmed">
						{t("forecast.dailyBudget")}
					</Text>
					<Group gap={8} wrap="nowrap">
						<Text
							className="tabular-nums"
							fw={700}
							c={
								dailyBudget !== null && dailyBudget < 0
									? budgetTypeTones.expense.text
									: undefined
							}
						>
							{dailyBudget === null ? "—" : formatAmount(dailyBudget)}
						</Text>
						<RemainingDaysBadge count={daysLeft} />
					</Group>
				</Group>
				<SimpleGrid
					cols={3}
					spacing={8}
					pt={12}
					style={{ borderTop: `1px solid ${palette.divider}` }}
				>
					{strip.map(({ label, amount, tone }) => (
						<div key={label}>
							<Text fz={12} fw={600} c="dimmed">
								{label}
							</Text>
							<Text className="tabular-nums" fz={14} fw={700} c={tone.text}>
								{formatAmount(amount)}
							</Text>
						</div>
					))}
				</SimpleGrid>
			</Stack>
		</Paper>
	);
}

function ForecastPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const search = Route.useSearch();
	const selectedYear = search.year;
	const mode: ForecastMode = search.mode ?? "year";
	const rolling = mode === "rolling";
	const today = new Date();
	const forecastQuery = useForecast(
		rolling ? today.getFullYear() : selectedYear,
		rolling ? today.getMonth() + 1 : 1,
		rolling ? ROLLING_MONTHS : 12,
	);
	const { isLoading, isError } = forecastQuery;
	const [selectedMonth, setSelectedMonth] = useState<YearMonth | null>(null);
	const isMobile = useBelowBreakpoint("sm");

	const forecast = (forecastQuery.data?.months ?? []).map(toMonthForecast);
	const totals = forecastQuery.data?.totals;
	const endBalance = Number(forecastQuery.data?.endBalance ?? 0);
	const rawStartingBalance = forecastQuery.data?.startingBalance ?? null;
	const firstMonth = forecast[0];
	const lastMonth = forecast[forecast.length - 1];

	const daysLeft = forecastQuery.data?.daysLeft ?? 0;
	const rawDailyBudget = forecastQuery.data?.dailyBudget ?? null;
	const dailyBudget = rawDailyBudget === null ? null : Number(rawDailyBudget);
	const firstNegativeMonth = forecastQuery.data?.firstNegativeMonth ?? null;
	const horizonDays = forecast.reduce((sum, m) => sum + daysInMonth(m), 0);

	const totalIncome = Number(totals?.income ?? 0);
	const totalExpenses = Number(totals?.expenses ?? 0);
	const totalSavings = Number(totals?.savings ?? 0);
	const unbudgetedRate = Number(forecastQuery.data?.unbudgetedRate ?? 0);
	const forecastsUnbudgeted = forecast.some((m) => m.unbudgetedForecast !== 0);

	const surplus = totalIncome + totalExpenses;

	const showYear =
		firstMonth !== undefined &&
		lastMonth !== undefined &&
		firstMonth.year !== lastMonth.year;
	const horizonEnd = lastMonth
		? longDate(new Date(lastMonth.year, lastMonth.month, 0), i18n.language)
		: "";

	const savedLine = (
		<AmountLine
			label={t("forecast.savedBy", { date: horizonEnd })}
			amount={formatAmount(-totalSavings)}
			dot={budgetTypeTones.savings.fill}
			color={budgetTypeTones.savings.text}
		/>
	);

	const headlineTitle =
		rawStartingBalance !== null
			? t("forecast.projectedBalance", { date: horizonEnd })
			: rolling
				? t("forecast.rollingSurplusTitle", { count: forecast.length })
				: t("forecast.surplusTitle", { year: selectedYear });
	const headline = rawStartingBalance !== null ? endBalance : surplus;

	const periodProgress =
		horizonDays > 0 ? ((horizonDays - daysLeft) / horizonDays) * 100 : 0;

	function shareOfIncome(amount: number): number {
		return totalIncome > 0 ? Math.abs(amount) / totalIncome : 0;
	}

	function navigateYear(delta: number) {
		navigate({
			to: "/summary",
			search: { year: selectedYear + delta },
		});
	}

	function switchMode(next: ForecastMode) {
		navigate({
			to: "/summary",
			search:
				next === "rolling"
					? { year: selectedYear, mode: "rolling" }
					: { year: selectedYear },
		});
	}

	const periodControls = (
		<>
			<ModeSwitch
				mode={mode}
				year={selectedYear}
				compact={isMobile}
				onChange={switchMode}
			/>
			{!rolling && <YearStepper year={selectedYear} onChange={navigateYear} />}
		</>
	);

	const viewProps: ForecastViewProps = {
		forecast,
		locale: i18n.language,
		firstNegativeMonth,
		showYear,
		onSelectMonth: setSelectedMonth,
	};

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
					actions={isMobile ? undefined : periodControls}
				/>
				{isMobile && (
					<Group gap="xs" wrap="nowrap">
						{periodControls}
					</Group>
				)}

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
								<MobileHero
									title={headlineTitle}
									headline={headline}
									forecast={forecast}
									dailyBudget={dailyBudget}
									daysLeft={daysLeft}
									income={totalIncome}
									expenses={totalExpenses}
									savings={totalSavings}
								/>
								<MonthList {...viewProps} />
							</>
						) : (
							<>
								<SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
									<HeroCard
										variant="filled"
										title={t("forecast.dailyBudget")}
										titleAside={<RemainingDaysBadge count={daysLeft} />}
									>
										<BigAmount
											value={
												dailyBudget === null ? "—" : formatAmount(dailyBudget)
											}
											color={
												dailyBudget !== null && dailyBudget < 0
													? "tangerine.3"
													: undefined
											}
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
												{t(
													rolling
														? "forecast.periodProgress"
														: "forecast.yearProgress",
													{ percent: Math.round(periodProgress) },
												)}
											</Text>
											<Progress
												value={periodProgress}
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

									{rawStartingBalance !== null ? (
										<HeroCard title={headlineTitle}>
											<BigAmount
												value={formatSignedAmount(headline)}
												color={balanceTextColor(headline)}
											/>
											<Text size="sm" c="dimmed">
												{t("forecast.projectedBalanceHint")}
											</Text>
											<Stack gap="xs" mt="auto">
												{savedLine}
												{firstMonth && (
													<Text size="xs" c="dimmed">
														{t("forecast.startingBalance", {
															date: longDate(
																new Date(
																	firstMonth.year,
																	firstMonth.month - 1,
																	1,
																),
																i18n.language,
															),
															amount: formatAmount(rawStartingBalance),
														})}
													</Text>
												)}
											</Stack>
										</HeroCard>
									) : (
										<HeroCard title={headlineTitle}>
											<BigAmount
												value={formatSignedAmount(headline)}
												color={balanceTextColor(headline)}
											/>
											<Text size="sm" c="dimmed">
												{t("forecast.surplusHint")}
											</Text>
											<Stack gap="xs" mt="auto">
												{savedLine}
												<AmountLine
													label={t("forecast.surplusLeftOnAccount")}
													amount={formatSignedAmount(endBalance)}
													dot={neutralTone.fill}
													color={balanceTextColor(endBalance)}
												/>
											</Stack>
										</HeroCard>
									)}

									<HeroCard
										title={
											rolling
												? t("forecast.rollingTotalsTitle", {
														count: forecast.length,
													})
												: t("forecast.totalsTitle", { year: selectedYear })
										}
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
										{forecastsUnbudgeted && (
											<Text size="sm" c="dimmed" mt="auto">
												{t("forecast.unbudgetedRate", {
													amount: formatAmount(-unbudgetedRate),
												})}
											</Text>
										)}
									</HeroCard>
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
