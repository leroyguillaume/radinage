import { AreaChart } from "@mantine/charts";
import {
	Alert,
	Box,
	Chip,
	Group,
	Loader,
	Paper,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { IconAlertCircle, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { balanceOn, monthEnds } from "@/lib/balance-history";
import {
	formatAmount,
	formatCompactAmount,
	formatSignedAmount,
	parseIsoDate,
} from "@/lib/format";
import { useAccounts, useBalanceHistories, useBudgets } from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import type { AccountResponse } from "@/lib/types";
import { headingFont } from "@/theme";

// Checking accounts in greens, savings ones in golds, each shade apart in lightness.
const CHECKING_COLORS = ["forest.7", "leaf.5", "forest.4", "leaf.8"];
const SAVINGS_COLORS = ["gold.5", "gold.7", "gold.3", "gold.9"];

function seriesColors(accounts: AccountResponse[]): Map<string, string> {
	const colors = new Map<string, string>();
	let checking = 0;
	let savings = 0;
	for (const account of accounts) {
		const palette =
			account.kind === "savings" ? SAVINGS_COLORS : CHECKING_COLORS;
		const index = account.kind === "savings" ? savings++ : checking++;
		colors.set(account.id, palette[index % palette.length] ?? "gray.5");
	}
	return colors;
}

interface WealthEvolutionProps {
	fromYear: number;
	fromMonth: number;
	toYear: number;
	toMonth: number;
}

/** The balance of every account with one, stacked month by month over a range. */
export function WealthEvolution({
	fromYear,
	fromMonth,
	toYear,
	toMonth,
}: WealthEvolutionProps) {
	const { t, i18n } = useTranslation();
	const [today] = useState(() => new Date());
	const [hidden, setHidden] = useState<string[]>([]);
	const accounts = (useAccounts().data ?? []).filter((a) => a.balance !== null);
	const budgets = useBudgets().data ?? [];
	const from = `${fromYear}-${String(fromMonth).padStart(2, "0")}-01`;
	const histories = useBalanceHistories(
		accounts.map((a) => a.id),
		from,
	);
	const days = monthEnds(fromYear, fromMonth, toYear, toMonth, today);

	if (accounts.length === 0) {
		return (
			<Paper>
				<Text size="sm" c="dimmed">
					{t("stats.wealth.empty")}
				</Text>
			</Paper>
		);
	}

	const colors = seriesColors(accounts);
	const shown = accounts.filter((a) => !hidden.includes(a.id));
	const balances = new Map(
		accounts.map((account, i) => [
			account.id,
			days.map((day) => balanceOn(histories[i]?.data ?? [], day) ?? 0),
		]),
	);
	const totals = days.map((_, d) =>
		shown.reduce((sum, a) => sum + (balances.get(a.id)?.[d] ?? 0), 0),
	);
	const first = totals.at(0) ?? 0;
	const last = totals.at(-1) ?? 0;
	const data = days.map((day, d) => ({
		month: parseIsoDate(day).toLocaleDateString(i18n.language, {
			month: "short",
			year: "2-digit",
		}),
		...Object.fromEntries(
			shown.map((a) => [a.name, balances.get(a.id)?.[d] ?? 0]),
		),
	}));
	const estimated = shown.some(
		(a) => a.kind === "savings" && budgets.some((b) => b.accountId === a.id),
	);
	const loading = histories.some((h) => h.isLoading);
	const failed = histories.some((h) => h.isError);

	return (
		<Paper>
			<Stack gap="md">
				<Stack gap={2}>
					<Text component="h2" ff={headingFont} fz={22} fw={700}>
						{t("stats.wealth.title")}
					</Text>
					{!loading && days.length > 0 && (
						<>
							<Text
								ff={headingFont}
								fz={28}
								fw={700}
								c={balanceTextColor(last)}
								className="tabular-nums"
							>
								{estimated ? "≈ " : ""}
								{formatAmount(last)}
							</Text>
							<Text
								size="sm"
								fw={600}
								c={balanceTextColor(last - first)}
								className="tabular-nums"
							>
								{t("stats.wealth.since", {
									amount: formatSignedAmount(
										Math.round((last - first) * 100) / 100,
									),
									month: data[0]?.month ?? "",
								})}
							</Text>
						</>
					)}
				</Stack>

				<Chip.Group
					multiple
					value={shown.map((a) => a.id)}
					onChange={(ids) =>
						setHidden(
							accounts.filter((a) => !ids.includes(a.id)).map((a) => a.id),
						)
					}
				>
					<Group gap="xs" role="group" aria-label={t("stats.wealth.accounts")}>
						{accounts.map((a) => (
							<Chip
								key={a.id}
								value={a.id}
								color={colors.get(a.id)}
								variant="light"
							>
								{a.name}
							</Chip>
						))}
					</Group>
				</Chip.Group>

				{failed && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("stats.wealth.fetchError")}
					</Alert>
				)}
				{loading ? (
					<Group justify="center" h={240}>
						<Loader size="sm" />
					</Group>
				) : (
					shown.length > 0 && (
						<AreaChart
							h={240}
							data={data}
							dataKey="month"
							type="stacked"
							series={shown.map((a) => ({
								name: a.name,
								color: colors.get(a.id) ?? "gray.5",
							}))}
							curveType="linear"
							tickLine="none"
							gridAxis="y"
							gridProps={{ horizontal: true, vertical: false }}
							yAxisProps={{ tickFormatter: formatCompactAmount, width: 64 }}
							withDots={false}
							fillOpacity={0.85}
							valueFormatter={(v) => formatAmount(v)}
							textColor="var(--mantine-color-dimmed)"
							tooltipAnimationDuration={200}
						/>
					)
				)}

				{!loading && shown.length > 0 && days.length > 0 && (
					<Box style={{ overflowX: "auto" }}>
						<Table verticalSpacing="xs">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>{t("stats.wealth.account")}</Table.Th>
									<Table.Th ta="right">{t("stats.wealth.start")}</Table.Th>
									<Table.Th ta="right">{t("stats.wealth.end")}</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{shown.map((a) => (
									<Table.Tr key={a.id}>
										<Table.Td fw={600}>{a.name}</Table.Td>
										<Table.Td ta="right" c="dimmed" className="tabular-nums">
											{formatAmount(balances.get(a.id)?.[0] ?? 0)}
										</Table.Td>
										<Table.Td ta="right" fw={700} className="tabular-nums">
											{formatAmount(balances.get(a.id)?.at(-1) ?? 0)}
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Box>
				)}

				{estimated && (
					<Alert
						color="gold"
						variant="light"
						c="gold.9"
						icon={<IconInfoCircle size={16} />}
					>
						{t("stats.wealth.note")}
					</Alert>
				)}
			</Stack>
		</Paper>
	);
}
