import {
	Alert,
	Badge,
	Box,
	Divider,
	Drawer,
	Group,
	Loader,
	Progress,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
	formatAmount,
	formatMonthYear,
	formatSignedAmount,
} from "@/lib/format";
import { useForecastMonth } from "@/lib/hooks";
import { balanceTextColor, budgetTypeTones } from "@/lib/tones";
import type {
	BudgetType,
	ForecastBudgetLine,
	ForecastMonthBreakdown,
	YearMonth,
} from "@/lib/types";

const budgetTypes: BudgetType[] = ["income", "expense", "savings"];

interface ForecastMonthDrawerProps {
	/** The month to break down; the drawer is closed while null. */
	month: YearMonth | null;
	onClose: () => void;
}

export function ForecastMonthDrawer({
	month,
	onClose,
}: ForecastMonthDrawerProps) {
	const { t, i18n } = useTranslation();
	const isMobile = useMediaQuery("(max-width: 36em)") ?? false;
	const query = useForecastMonth(month);
	return (
		<Drawer
			opened={month !== null}
			onClose={onClose}
			position={isMobile ? "bottom" : "right"}
			size={isMobile ? "85%" : "md"}
			title={
				month && (
					<Text component="span" fw={700} fz={20} tt="capitalize">
						{formatMonthYear(month, i18n.language)}
					</Text>
				)
			}
			closeButtonProps={{ size: 44, "aria-label": t("common.close") }}
		>
			{query.isLoading && (
				<Group justify="center" py="xl">
					<Loader />
				</Group>
			)}
			{query.isError && (
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{t("forecast.breakdown.fetchError")}
				</Alert>
			)}
			{query.data && <Breakdown breakdown={query.data} />}
		</Drawer>
	);
}

function Breakdown({ breakdown }: { breakdown: ForecastMonthBreakdown }) {
	const { t } = useTranslation();
	const { unbudgeted, totals } = breakdown;
	const unbudgetedForecast = Number(unbudgeted.forecast);
	return (
		<Stack gap="lg">
			{breakdown.status !== "past" && (
				<Badge
					variant="light"
					color={breakdown.status === "current" ? "forest" : "gray"}
					tt="none"
				>
					{t(
						breakdown.status === "current"
							? "forecast.current"
							: "forecast.projected",
					)}
				</Badge>
			)}
			{breakdown.budgets.length === 0 && (
				<Text c="dimmed">{t("forecast.breakdown.noBudgets")}</Text>
			)}
			{budgetTypes.map((type) => {
				const lines = breakdown.budgets.filter((b) => b.budgetType === type);
				if (lines.length === 0) return null;
				return (
					<Stack key={type} component="section" gap="sm">
						<Title order={3} fz={15} c={budgetTypeTones[type].text}>
							{t(`budgets.types.${type}`)}
						</Title>
						<Stack component="ul" gap="md" m={0} p={0} style={listStyle}>
							{lines.map((line) => (
								<BudgetLine key={line.budgetId} line={line} />
							))}
						</Stack>
					</Stack>
				);
			})}
			<Stack component="section" gap={4}>
				<Group justify="space-between" wrap="nowrap" align="baseline">
					<Title order={3} fz={15}>
						{t("forecast.breakdown.unbudgeted")}
					</Title>
					<Text className="tabular-nums" fw={700}>
						{formatAmount(unbudgeted.projected)}
					</Text>
				</Group>
				<Text size="sm" c="dimmed" className="tabular-nums">
					{t("forecast.breakdown.actual", {
						amount: formatAmount(unbudgeted.actual),
					})}
					{unbudgetedForecast !== 0 &&
						` · ${t("forecast.breakdown.estimated", {
							amount: formatAmount(unbudgetedForecast),
						})}`}
				</Text>
			</Stack>
			<Divider />
			<Stack component="section" gap={6}>
				<Title order={3} fz={15}>
					{t("forecast.breakdown.monthTotals")}
				</Title>
				<TotalLine
					label={t("forecast.income")}
					value={formatAmount(totals.income)}
					color={budgetTypeTones.income.text}
				/>
				<TotalLine
					label={t("forecast.expenses")}
					value={formatAmount(totals.expenses)}
					color={budgetTypeTones.expense.text}
				/>
				<TotalLine
					label={t("forecast.savings")}
					value={formatAmount(totals.savings)}
					color={budgetTypeTones.savings.text}
				/>
				<TotalLine
					label={t("forecast.balance")}
					value={formatSignedAmount(Number(totals.balance))}
					color={balanceTextColor(Number(totals.balance))}
					strong
				/>
			</Stack>
		</Stack>
	);
}

const listStyle = { listStyle: "none" } as const;

function BudgetLine({ line }: { line: ForecastBudgetLine }) {
	const { t } = useTranslation();
	const tone = budgetTypeTones[line.budgetType];
	const actual = Number(line.actual);
	const remaining = Number(line.remaining);
	const scale = Math.max(
		Math.abs(Number(line.expected ?? 0)),
		Math.abs(Number(line.projected)),
	);
	const percent = (amount: number) =>
		scale > 0 ? (Math.abs(amount) / scale) * 100 : 0;
	const details = [
		line.expected === null
			? t("forecast.breakdown.notExpected")
			: t("forecast.breakdown.expected", {
					amount: formatAmount(line.expected),
				}),
		t("forecast.breakdown.actual", { amount: formatAmount(actual) }),
	];
	if (remaining !== 0) {
		details.push(
			t("forecast.breakdown.remaining", { amount: formatAmount(remaining) }),
		);
	}
	return (
		<Box component="li">
			<Stack gap={6}>
				<Group justify="space-between" wrap="nowrap" align="baseline">
					<Text fw={600} truncate>
						{line.label}
					</Text>
					<Text className="tabular-nums" fw={700} c={tone.text}>
						{formatAmount(line.projected)}
					</Text>
				</Group>
				<Progress.Root aria-hidden size={6}>
					<Progress.Section value={percent(actual)} color={tone.color} />
					<Progress.Section
						value={percent(remaining)}
						color={`${tone.color}.2`}
					/>
				</Progress.Root>
				<Text size="sm" c="dimmed" className="tabular-nums">
					{details.join(" · ")}
				</Text>
			</Stack>
		</Box>
	);
}

interface TotalLineProps {
	label: string;
	value: string;
	color: string;
	strong?: boolean;
}

function TotalLine({ label, value, color, strong = false }: TotalLineProps) {
	return (
		<Group justify="space-between" wrap="nowrap">
			<Text fw={strong ? 700 : 500}>{label}</Text>
			<Text className="tabular-nums" fw={strong ? 800 : 600} c={color}>
				{value}
			</Text>
		</Group>
	);
}
