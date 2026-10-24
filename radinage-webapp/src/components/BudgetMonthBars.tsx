import { Box, Group, Stack, Text, Tooltip } from "@mantine/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { monthName, useMonthTooltip } from "@/components/BudgetYearProgress";
import type { BudgetMonthState, BudgetYearMonth } from "@/lib/budget-year";
import { palette } from "@/theme";

const CHART_HEIGHT = 150;

const barStyles: Record<BudgetMonthState, CSSProperties> = {
	within: { background: "var(--mantine-color-leaf-5)" },
	over: { background: "var(--mantine-color-tangerine-6)" },
	short: { background: "var(--mantine-color-gold-5)" },
	current: {
		background: "var(--mantine-color-forest-1)",
		border: "2px solid var(--mantine-color-forest-7)",
	},
	future: { border: "1.5px dashed var(--mantine-color-forest-3)" },
	none: {},
};

interface BudgetMonthBarsProps {
	months: BudgetYearMonth[];
	/** Accessible description of the whole chart. */
	label: string;
	/** Legend entry for the bars within budget. */
	withinLabel: string;
	/** Legend entry for the bars off budget. */
	offLabel: string;
	/** Bar colour of the months off budget: over for expenses, short otherwise. */
	offState: "over" | "short";
}

/** Bars of what each month received or spent, with a mark at what it expected. */
export function BudgetMonthBars({
	months,
	label,
	withinLabel,
	offLabel,
	offState,
}: BudgetMonthBarsProps) {
	const { t, i18n } = useTranslation();
	const tooltip = useMonthTooltip();
	const max = Math.max(
		1,
		...months.map((m) => Math.max(m.actual, m.expected ?? 0)),
	);
	const height = (amount: number) => Math.round((amount / max) * CHART_HEIGHT);

	return (
		<Stack gap="sm">
			<Box
				role="img"
				aria-label={label}
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
					gap: 5,
				}}
			>
				{months.map((m) => {
					const shown = m.state === "future" ? (m.expected ?? 0) : m.actual;
					return (
						<Tooltip
							key={m.month}
							label={tooltip(m)}
							events={{ hover: true, focus: false, touch: true }}
						>
							<Stack gap={4} align="stretch">
								<Box pos="relative" h={CHART_HEIGHT}>
									<Box
										pos="absolute"
										left={0}
										right={0}
										bottom={0}
										h={shown > 0 ? Math.max(height(shown), 3) : 0}
										style={{
											...barStyles[m.state],
											boxSizing: "border-box",
											borderRadius: "6px 6px 3px 3px",
										}}
									/>
									{m.expected !== null && m.state !== "future" && (
										<Box
											pos="absolute"
											left={-2}
											right={-2}
											h={2}
											bottom={height(m.expected)}
											bg={palette.text}
										/>
									)}
								</Box>
								<Text fz={11} fw={600} c="dimmed" ta="center" tt="uppercase">
									{monthName(m, i18n.language, "narrow")}
								</Text>
							</Stack>
						</Tooltip>
					);
				})}
			</Box>
			<Group gap="md" wrap="wrap">
				<LegendSwatch style={barStyles.within} label={withinLabel} />
				<LegendSwatch style={barStyles[offState]} label={offLabel} />
				<Group gap={6} wrap="nowrap">
					<Box w={14} h={2} bg={palette.text} />
					<Text size="xs" c="dimmed">
						{t("budgets.overview.plannedOfMonth")}
					</Text>
				</Group>
			</Group>
		</Stack>
	);
}

function LegendSwatch({
	style,
	label,
}: {
	style: CSSProperties;
	label: string;
}) {
	return (
		<Group gap={6} wrap="nowrap">
			<Box w={12} h={12} style={{ ...style, borderRadius: 4 }} />
			<Text size="xs" c="dimmed">
				{label}
			</Text>
		</Group>
	);
}
