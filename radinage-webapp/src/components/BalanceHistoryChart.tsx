import { Box, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	CartesianGrid,
	ComposedChart,
	DefaultTooltipContent,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Scatter,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { historyChart } from "@/lib/balance-history";
import { formatAmount, formatCompactAmount } from "@/lib/format";
import { budgetTypeTones } from "@/lib/tones";
import type { BalancePoint } from "@/lib/types";
import { palette } from "@/theme";

const LINE = "var(--mantine-color-forest-7)";
const AXIS = "var(--mantine-color-dimmed)";

interface BalanceHistoryChartProps {
	points: BalancePoint[];
	/** Whether the days after the latest balance read are an estimate. */
	estimatedTail: boolean;
}

function LegendItem({ mark, label }: { mark: ReactNode; label: string }) {
	return (
		<Group gap={6} wrap="nowrap" component="li">
			{mark}
			<Text size="xs" c="dimmed">
				{label}
			</Text>
		</Group>
	);
}

/** An account's balance as steps, its balances read as dots and their gaps to the estimate. */
export function BalanceHistoryChart({
	points,
	estimatedTail,
}: BalanceHistoryChartProps) {
	const { t, i18n } = useTranslation();
	const chart = historyChart(points, estimatedTail);
	const formatDay = (time: number) =>
		new Date(time).toLocaleDateString(i18n.language, {
			day: "numeric",
			month: "short",
		});

	return (
		<Box>
			<Box h={220}>
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart
						data={chart.rows}
						margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
					>
						<CartesianGrid vertical={false} stroke={palette.divider} />
						<XAxis
							dataKey="time"
							type="number"
							scale="time"
							domain={["dataMin", "dataMax"]}
							tickFormatter={formatDay}
							tick={{ fill: AXIS, fontSize: 11 }}
							tickLine={false}
							axisLine={false}
							minTickGap={24}
						/>
						<YAxis
							domain={["auto", "auto"]}
							tickFormatter={formatCompactAmount}
							tick={{ fill: AXIS, fontSize: 11 }}
							tickLine={false}
							axisLine={false}
							width={64}
						/>
						<Tooltip
							labelFormatter={(time) => formatDay(Number(time))}
							formatter={(value) => formatAmount(Number(value))}
							content={({ payload, ...props }) => (
								// A Scatter puts its x value in the tooltip too: the day, already the label.
								<DefaultTooltipContent
									{...props}
									payload={payload.filter((entry) => entry.dataKey !== "time")}
								/>
							)}
						/>
						<Line
							dataKey="known"
							name={t("accounts.detail.legend.balance")}
							type="stepAfter"
							stroke={LINE}
							strokeWidth={2.5}
							dot={false}
							connectNulls={false}
							isAnimationActive={false}
						/>
						{estimatedTail && (
							<Line
								dataKey="estimate"
								name={t("accounts.detail.legend.estimate")}
								type="stepAfter"
								stroke={LINE}
								strokeWidth={2.5}
								strokeDasharray="4 4"
								dot={false}
								connectNulls={false}
								isAnimationActive={false}
							/>
						)}
						{chart.gaps.map((gap) => (
							<ReferenceLine
								key={gap.time}
								segment={[
									{ x: gap.time, y: gap.estimated },
									{ x: gap.time, y: gap.balance },
								]}
								stroke={
									gap.balance > gap.estimated
										? budgetTypeTones.income.fill
										: budgetTypeTones.expense.fill
								}
								strokeWidth={3}
								ifOverflow="extendDomain"
							/>
						))}
						<Scatter
							data={chart.readings}
							dataKey="balance"
							name={t("accounts.detail.legend.read")}
							fill={LINE}
							stroke="#ffffff"
							strokeWidth={2}
							isAnimationActive={false}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			</Box>
			<Group
				component="ul"
				gap="md"
				m={0}
				p={0}
				mt="xs"
				className="list-none"
				wrap="wrap"
			>
				<LegendItem
					mark={
						<svg width="10" height="10" aria-hidden="true">
							<circle cx="5" cy="5" r="4" fill={LINE} />
						</svg>
					}
					label={t("accounts.detail.legend.read")}
				/>
				{estimatedTail && (
					<LegendItem
						mark={
							<svg width="18" height="4" aria-hidden="true">
								<line
									x1="0"
									y1="2"
									x2="18"
									y2="2"
									stroke={LINE}
									strokeWidth="2.5"
									strokeDasharray="4 3"
								/>
							</svg>
						}
						label={t("accounts.detail.legend.estimate")}
					/>
				)}
				{chart.gaps.length > 0 && (
					<LegendItem
						mark={
							<svg width="8" height="12" aria-hidden="true">
								<line
									x1="4"
									y1="0"
									x2="4"
									y2="12"
									stroke={budgetTypeTones.expense.fill}
									strokeWidth="3"
								/>
							</svg>
						}
						label={t("accounts.detail.legend.gap")}
					/>
				)}
			</Group>
		</Box>
	);
}
