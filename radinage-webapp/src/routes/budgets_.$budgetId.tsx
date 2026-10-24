import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconChevronLeft,
	IconEdit,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchorLink } from "@/components/AnchorLink";
import { BudgetModal } from "@/components/BudgetModal";
import { BudgetMonthBars } from "@/components/BudgetMonthBars";
import { deltaColor, monthName } from "@/components/BudgetYearProgress";
import { YearStepper } from "@/components/YearStepper";
import {
	type BudgetYear,
	budgetYearStats,
	toBudgetYear,
} from "@/lib/budget-year";
import {
	formatAmount,
	formatMonthYear,
	formatSignedAmount,
} from "@/lib/format";
import { useBudgetSummary, useBudgets } from "@/lib/hooks";
import { budgetTypeTones } from "@/lib/tones";
import type { BudgetResponse } from "@/lib/types";
import { headingFont, palette } from "@/theme";

interface BudgetYearSearch {
	year?: number;
}

export const Route = createFileRoute("/budgets_/$budgetId")({
	component: BudgetYearPage,
	validateSearch: (search: Record<string, unknown>): BudgetYearSearch => {
		const year = Number(search.year);
		return Number.isInteger(year) && year > 0 ? { year } : {};
	},
});

function BudgetYearPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { budgetId } = Route.useParams();
	const [today] = useState(() => new Date());
	const year = Route.useSearch().year ?? today.getFullYear();
	const [editing, setEditing] = useState(false);

	const budgetsQuery = useBudgets();
	const summaryQuery = useBudgetSummary(year);
	const budget = budgetsQuery.data?.find((b) => b.id === budgetId);
	const months = summaryQuery.data?.budgets.find(
		(b) => b.budgetId === budgetId,
	)?.months;
	const budgetYear = useMemo(
		() => (budget && months ? toBudgetYear(budget, months, today) : null),
		[budget, months, today],
	);

	if (budgetsQuery.isLoading || summaryQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	if (budgetsQuery.isError || summaryQuery.isError || !budget || !budgetYear) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{budget || budgetsQuery.isError || summaryQuery.isError
						? t("budgets.fetchError")
						: t("budgets.detail.notFound")}
				</Alert>
			</div>
		);
	}

	return (
		<div className="h-full overflow-auto">
			<BudgetModal
				opened={editing}
				onClose={() => setEditing(false)}
				budget={budget}
			/>
			<Stack
				maw={880}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<Group justify="space-between" wrap="nowrap">
					<AnchorLink
						to="/budgets"
						search={{ period: "year", year }}
						aria-label={t("budgets.detail.back")}
						c="inherit"
						w={44}
						h={44}
						display="flex"
						style={{ alignItems: "center", justifyContent: "center" }}
					>
						<IconChevronLeft size={24} />
					</AnchorLink>
					<Group gap="xs" wrap="nowrap">
						<YearStepper
							year={year}
							onChange={(delta) =>
								navigate({
									to: "/budgets/$budgetId",
									params: { budgetId },
									search: { year: year + delta },
								})
							}
						/>
						<Tooltip label={t("common.edit")}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								radius="md"
								aria-label={t("common.edit")}
								onClick={() => setEditing(true)}
							>
								<IconEdit size={20} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>

				<BudgetHeading budget={budget} />
				<RealCard budget={budget} budgetYear={budgetYear} year={year} />
				<MonthsCard budget={budget} budgetYear={budgetYear} today={today} />
				{budgetYear.planned > 0 && (
					<CumulativeCard
						budget={budget}
						budgetYear={budgetYear}
						today={today}
					/>
				)}
				{budget.kind.type === "recurring" && <PeriodsCard budget={budget} />}
			</Stack>
		</div>
	);
}

function BudgetHeading({ budget }: { budget: BudgetResponse }) {
	const { t } = useTranslation();
	const tone = budgetTypeTones[budget.budgetType];
	const kind =
		budget.kind.type === "occasional"
			? `${t("budgets.kinds.occasional")} — ${budget.kind.month}/${budget.kind.year}`
			: t(`budgets.recurrences.${budget.kind.recurrence}`);
	return (
		<Stack gap="xs">
			<Group gap={6}>
				<Badge color={tone.color} size="md">
					{t(`budgets.types.${budget.budgetType}`)}
				</Badge>
				<Badge color="gray" size="md">
					{kind}
				</Badge>
			</Group>
			<Title order={1} fz={{ base: 30, sm: 40 }} lts="-0.02em" lh={1.1}>
				{budget.label}
			</Title>
		</Stack>
	);
}

interface CardProps {
	budget: BudgetResponse;
	budgetYear: BudgetYear;
}

function RealCard({ budget, budgetYear, year }: CardProps & { year: number }) {
	const { t } = useTranslation();
	return (
		<Paper component="section" aria-labelledby="budget-real">
			<Stack gap={6}>
				<Text
					id="budget-real"
					size="sm"
					fw={600}
					c="dimmed"
					tt="uppercase"
					lts="0.04em"
				>
					{t(`budgets.detail.realTitle.${budget.budgetType}`, { year })}
				</Text>
				<Group gap="sm" align="baseline">
					<Text
						ff={headingFont}
						fz={40}
						fw={800}
						lh={1.1}
						className="tabular-nums"
					>
						{formatAmount(budgetYear.real)}
					</Text>
					{budgetYear.tone !== "even" && (
						<Text
							fw={700}
							className="tabular-nums"
							c={deltaColor(budget.budgetType, budgetYear.tone)}
						>
							{formatSignedAmount(budgetYear.delta)}
						</Text>
					)}
				</Group>
				<Text size="sm" c="dimmed" className="tabular-nums">
					{t("budgets.detail.expectedSoFar", {
						expected: formatAmount(budgetYear.expectedToDate),
						planned: formatAmount(budgetYear.planned),
					})}
				</Text>
			</Stack>
		</Paper>
	);
}

function MonthsCard({
	budget,
	budgetYear,
	today,
}: CardProps & { today: Date }) {
	const { t, i18n } = useTranslation();
	const stats = budgetYearStats(budgetYear, today);
	const offState = budget.budgetType === "expense" ? "over" : "short";
	return (
		<Paper component="section" aria-labelledby="budget-months">
			<Stack gap="md">
				<Title id="budget-months" order={2} fz={18} fw={700}>
					{t("budgets.detail.monthsTitle")}
				</Title>
				<BudgetMonthBars
					months={budgetYear.months}
					label={t("budgets.detail.monthsChart", { label: budget.label })}
					withinLabel={t("budgets.yearProgress.states.within")}
					offLabel={t(`budgets.yearProgress.states.${offState}`)}
					offState={offState}
				/>
				<SimpleGrid cols={3} spacing="xs">
					<StatBox label={t("budgets.detail.average")}>
						{formatAmount(Math.round(stats.average))}
					</StatBox>
					{stats.peak && (
						<StatBox
							label={t("budgets.detail.peak", {
								month: monthName(stats.peak, i18n.language, "short"),
							})}
						>
							{formatAmount(stats.peak.actual)}
						</StatBox>
					)}
					{stats.due > 0 && (
						<StatBox label={t("budgets.detail.missed")}>
							{t("budgets.detail.missedValue", {
								missed: stats.missed,
								due: stats.due,
							})}
						</StatBox>
					)}
				</SimpleGrid>
			</Stack>
		</Paper>
	);
}

function StatBox({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack
			gap={2}
			p="sm"
			bg={palette.surfaceMuted}
			style={{ borderRadius: 14 }}
		>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text fw={700} className="tabular-nums">
				{children}
			</Text>
		</Stack>
	);
}

const SVG_WIDTH = 320;
const SVG_HEIGHT = 130;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 120;

function CumulativeCard({
	budget,
	budgetYear,
	today,
}: CardProps & { today: Date }) {
	const { t, i18n } = useTranslation();
	const tone = budgetTypeTones[budget.budgetType];

	let plannedSum = 0;
	let realSum = 0;
	const todayOrdinal = today.getFullYear() * 12 + today.getMonth() + 1;
	const lastReal = budgetYear.months.findLastIndex(
		(m) => m.year * 12 + m.month <= todayOrdinal,
	);
	const points = budgetYear.months.map((m, i) => {
		plannedSum += m.expected ?? 0;
		realSum += m.actual;
		return {
			month: m,
			planned: plannedSum,
			real: i <= lastReal ? realSum : null,
		};
	});
	const max = Math.max(1, plannedSum, realSum, budgetYear.projection ?? 0);
	const x = (i: number) => 10 + (i * (SVG_WIDTH - 20)) / 11;
	const y = (amount: number) =>
		PLOT_BOTTOM - (amount / max) * (PLOT_BOTTOM - PLOT_TOP);
	const polyline = (values: Array<[number, number]>) =>
		values.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

	const realPoints = points.flatMap(
		(p, i): Array<[number, number]> => (p.real === null ? [] : [[i, p.real]]),
	);
	const lastPoint = realPoints.at(-1);
	const gap =
		budgetYear.projection === null
			? 0
			: Math.round(budgetYear.projection - budgetYear.planned);
	const projectionKey =
		gap > 0
			? "budgets.detail.projectionAbove"
			: gap < 0
				? "budgets.detail.projectionBelow"
				: "budgets.detail.projectionOnTarget";

	return (
		<Paper component="section" aria-labelledby="budget-cumulative">
			<Stack gap="md">
				<Title id="budget-cumulative" order={2} fz={18} fw={700}>
					{t("budgets.detail.cumulativeTitle")}
				</Title>
				<Box
					component="svg"
					viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
					w="100%"
					role="img"
					aria-label={t("budgets.detail.cumulativeChart", {
						label: budget.label,
					})}
				>
					{[PLOT_TOP, (PLOT_TOP + PLOT_BOTTOM) / 2, PLOT_BOTTOM].map(
						(lineY) => (
							<line
								key={lineY}
								x1={0}
								x2={SVG_WIDTH}
								y1={lineY}
								y2={lineY}
								stroke={palette.divider}
							/>
						),
					)}
					<polyline
						points={polyline(points.map((p, i) => [i, p.planned]))}
						fill="none"
						stroke="var(--mantine-color-dimmed)"
						strokeWidth={2}
						strokeDasharray="5 4"
					/>
					{realPoints.length > 0 && (
						<polyline
							points={polyline(realPoints)}
							fill="none"
							stroke={tone.fill}
							strokeWidth={3}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
					)}
					{budgetYear.projection !== null && lastPoint && (
						<polyline
							points={polyline([lastPoint, [11, budgetYear.projection]])}
							fill="none"
							stroke={tone.fill}
							strokeWidth={2.5}
							strokeDasharray="2 5"
							strokeLinecap="round"
						/>
					)}
					{lastPoint && (
						<circle
							cx={x(lastPoint[0])}
							cy={y(lastPoint[1])}
							r={5}
							fill={tone.fill}
							stroke={palette.surface}
							strokeWidth={2}
						/>
					)}
					{points.map((p, i) => (
						<Tooltip
							key={p.month.month}
							label={t("budgets.detail.cumulativeTooltip", {
								month: monthName(p.month, i18n.language, "long"),
								real: formatAmount(p.real ?? 0),
								planned: formatAmount(p.planned),
							})}
							events={{ hover: true, focus: false, touch: true }}
						>
							<rect
								x={x(i) - (SVG_WIDTH - 20) / 22}
								y={0}
								width={(SVG_WIDTH - 20) / 11}
								height={SVG_HEIGHT}
								fill="transparent"
							/>
						</Tooltip>
					))}
				</Box>
				<Group gap="md" wrap="wrap">
					<LineLegend color={tone.fill} label={t("budgets.detail.real")} />
					<LineLegend
						color="var(--mantine-color-dimmed)"
						dashed
						label={t("budgets.detail.planned")}
					/>
					{budgetYear.projection !== null && (
						<LineLegend
							color={tone.fill}
							dotted
							label={t("budgets.detail.projection")}
						/>
					)}
				</Group>
				{budgetYear.projection !== null && (
					<Text size="sm" className="tabular-nums">
						{t(projectionKey, {
							amount: formatAmount(Math.round(budgetYear.projection)),
							gap: formatAmount(Math.abs(gap)),
						})}
					</Text>
				)}
				{budgetYear.remaining > 0 && (
					<Text size="sm" c="dimmed" className="tabular-nums">
						{t("budgets.detail.left", {
							amount: formatAmount(budgetYear.remaining),
						})}
					</Text>
				)}
			</Stack>
		</Paper>
	);
}

function LineLegend({
	color,
	label,
	dashed = false,
	dotted = false,
}: {
	color: string;
	label: string;
	dashed?: boolean;
	dotted?: boolean;
}) {
	return (
		<Group gap={6} wrap="nowrap">
			<Box
				w={16}
				style={{
					borderTop: `3px ${dotted ? "dotted" : dashed ? "dashed" : "solid"} ${color}`,
				}}
			/>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
		</Group>
	);
}

function PeriodsCard({ budget }: { budget: BudgetResponse }) {
	const { t, i18n } = useTranslation();
	if (budget.kind.type !== "recurring") return null;
	const { recurrence, currentPeriod, closedPeriods } = budget.kind;
	const month = (ym: { year: number; month: number }) =>
		formatMonthYear(ym, i18n.language);
	const perRecurrence = (amount: string) =>
		t(`budgets.detail.perRecurrence.${recurrence}`, {
			amount: formatAmount(Math.abs(Number(amount))),
		});
	const rows = [
		{
			key: "current",
			label: currentPeriod.end
				? t("budgets.detail.range", {
						start: month(currentPeriod.start),
						end: month(currentPeriod.end),
					})
				: t("budgets.detail.since", { start: month(currentPeriod.start) }),
			amount: perRecurrence(currentPeriod.amount),
			current: true,
		},
		...[...closedPeriods]
			.sort(
				(a, b) =>
					b.start.year * 12 +
					b.start.month -
					(a.start.year * 12 + a.start.month),
			)
			.map((p) => ({
				key: `${p.start.year}-${p.start.month}`,
				label: t("budgets.detail.range", {
					start: month(p.start),
					end: month(p.end),
				}),
				amount: perRecurrence(p.amount),
				current: false,
			})),
	];
	return (
		<Paper component="section" aria-labelledby="budget-periods">
			<Stack gap="xs">
				<Title id="budget-periods" order={2} fz={18} fw={700}>
					{t("budgets.detail.periodsTitle")}
				</Title>
				{rows.map((row) => (
					<Group
						key={row.key}
						justify="space-between"
						py={8}
						style={{ borderBottom: `1px solid ${palette.divider}` }}
					>
						<Text size="sm" c={row.current ? undefined : "dimmed"}>
							{row.label}
						</Text>
						<Text
							size="sm"
							fw={row.current ? 700 : 400}
							c={row.current ? undefined : "dimmed"}
							className="tabular-nums"
						>
							{row.amount}
						</Text>
					</Group>
				))}
			</Stack>
		</Paper>
	);
}
