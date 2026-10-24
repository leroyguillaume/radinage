import { Box, Group, Stack, Text, Tooltip } from "@mantine/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type {
	BudgetMonthState,
	BudgetYear,
	BudgetYearMonth,
	DeltaTone,
} from "@/lib/budget-year";
import { formatAmount, formatSignedAmount } from "@/lib/format";
import { budgetTypeTones } from "@/lib/tones";
import type { BudgetType } from "@/lib/types";
import { palette } from "@/theme";

export const monthStateStyles: Record<BudgetMonthState, CSSProperties> = {
	within: {
		background: "var(--mantine-color-leaf-2)",
		color: "var(--mantine-color-leaf-9)",
	},
	over: {
		background: "var(--mantine-color-tangerine-2)",
		color: "var(--mantine-color-tangerine-9)",
	},
	short: {
		background: "var(--mantine-color-gold-2)",
		color: "var(--mantine-color-gold-9)",
	},
	current: {
		background: palette.surface,
		color: "var(--mantine-color-forest-7)",
		border: "2px solid var(--mantine-color-forest-7)",
	},
	future: {
		background: palette.surface,
		color: "var(--mantine-color-dimmed)",
		border: `1px dashed var(--mantine-color-forest-2)`,
	},
	none: {
		background: palette.background,
		color: "var(--mantine-color-dimmed)",
	},
};

/** Green when the gap favours the user, the budget's warning tone otherwise. */
export function deltaColor(type: BudgetType, tone: DeltaTone): string {
	if (tone === "even") return "var(--mantine-color-dimmed)";
	if (tone === "good") return budgetTypeTones.income.text;
	return type === "expense"
		? budgetTypeTones.expense.text
		: budgetTypeTones.savings.text;
}

export function monthName(
	{ year, month }: { year: number; month: number },
	locale: string,
	format: "long" | "short" | "narrow",
): string {
	return new Date(year, month - 1).toLocaleDateString(locale, {
		month: format,
	});
}

export function useMonthTooltip() {
	const { t, i18n } = useTranslation();
	return (m: BudgetYearMonth) => {
		const month = monthName(m, i18n.language, "long");
		const actual = formatAmount(m.actual);
		return m.expected === null
			? t("budgets.yearProgress.monthTooltipNone", { month, actual })
			: t("budgets.yearProgress.monthTooltip", {
					month,
					actual,
					expected: formatAmount(m.expected),
				});
	};
}

function MonthStrip({ months }: { months: BudgetYearMonth[] }) {
	const { t, i18n } = useTranslation();
	const tooltip = useMonthTooltip();
	return (
		<Box
			component="ol"
			aria-label={t("budgets.yearProgress.months")}
			m={0}
			p={0}
			style={{
				listStyle: "none",
				display: "grid",
				gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
				gap: 3,
			}}
		>
			{months.map((m) => (
				<Tooltip
					key={m.month}
					label={tooltip(m)}
					events={{ hover: true, focus: false, touch: true }}
				>
					<Box
						component="li"
						h={28}
						fz={11}
						fw={700}
						tt="uppercase"
						display="flex"
						style={{
							...monthStateStyles[m.state],
							boxSizing: "border-box",
							borderRadius: 7,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<span aria-hidden>{monthName(m, i18n.language, "narrow")}</span>
						<span className="sr-only">
							{`${tooltip(m)} — ${t(`budgets.yearProgress.states.${m.state}`)}`}
						</span>
					</Box>
				</Tooltip>
			))}
		</Box>
	);
}

const legendStates: BudgetMonthState[] = ["within", "over", "short", "current"];

export function BudgetMonthLegend() {
	const { t } = useTranslation();
	return (
		<Group gap="md" wrap="wrap">
			{legendStates.map((state) => (
				<Group key={state} gap={6} wrap="nowrap">
					<Box
						w={12}
						h={12}
						style={{
							...monthStateStyles[state],
							boxSizing: "border-box",
							borderRadius: 4,
						}}
					/>
					<Text size="xs" c="dimmed">
						{t(`budgets.yearProgress.states.${state}`)}
					</Text>
				</Group>
			))}
			<Group gap={6} wrap="nowrap">
				<Box w={3} h={14} bg={palette.text} style={{ borderRadius: 2 }} />
				<Text size="xs" c="dimmed">
					{t("budgets.yearProgress.expectedMark")}
				</Text>
			</Group>
		</Group>
	);
}

function percentOf(amount: number, total: number): number {
	return total > 0 ? Math.min(100, (amount / total) * 100) : 0;
}

interface YearBarProps {
	real: number;
	planned: number;
	expectedToDate: number;
	/** CSS colour of the filled part. */
	fill: string;
}

/** What was received or spent out of the year, with a mark at what was expected so far. */
export function YearBar({ real, planned, expectedToDate, fill }: YearBarProps) {
	return (
		<Box
			aria-hidden
			pos="relative"
			h={10}
			bg={palette.track}
			style={{ borderRadius: 999 }}
		>
			<Box
				pos="absolute"
				top={0}
				bottom={0}
				left={0}
				w={`${percentOf(real, planned)}%`}
				bg={fill}
				style={{ borderRadius: 999 }}
			/>
			{expectedToDate > 0 && expectedToDate < planned && (
				<Box
					pos="absolute"
					top={-4}
					bottom={-4}
					w={3}
					bg={palette.text}
					left={`calc(${percentOf(expectedToDate, planned)}% - 1.5px)`}
					style={{ borderRadius: 2 }}
				/>
			)}
		</Box>
	);
}

interface BudgetYearProgressProps {
	budgetType: BudgetType;
	year: BudgetYear;
}

export function BudgetYearProgress({
	budgetType,
	year,
}: BudgetYearProgressProps) {
	const { t } = useTranslation();
	const tone = budgetTypeTones[budgetType];
	const over = budgetType === "expense" && year.real > year.planned;

	return (
		<Stack gap="sm">
			<Stack gap={6}>
				<Group
					justify="space-between"
					gap="xs"
					wrap="nowrap"
					className="tabular-nums"
				>
					<Text size="sm" c="dimmed">
						{year.planned === 0
							? t("budgets.yearProgress.noDue")
							: t("budgets.yearProgress.amounts", {
									real: formatAmount(year.real),
									expected: formatAmount(year.expectedToDate),
								})}
					</Text>
					{year.tone !== "even" && (
						<Text
							size="sm"
							fw={700}
							c={deltaColor(budgetType, year.tone)}
							style={{ whiteSpace: "nowrap" }}
						>
							{formatSignedAmount(year.delta)}
						</Text>
					)}
				</Group>
				<YearBar
					real={year.real}
					planned={year.planned}
					expectedToDate={year.expectedToDate}
					fill={over ? "var(--mantine-color-tangerine-6)" : tone.fill}
				/>
				{year.projection !== null && (
					<Text size="sm" c="dimmed" className="tabular-nums">
						{t("budgets.yearProgress.projection", {
							amount: formatAmount(Math.round(year.projection)),
							gap: formatSignedAmount(
								Math.round(year.projection - year.planned),
							),
						})}
					</Text>
				)}
			</Stack>
			<MonthStrip months={year.months} />
		</Stack>
	);
}
