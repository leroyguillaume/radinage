import { BarChart } from "@mantine/charts";
import { Alert, Grid, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSummary } from "@/lib/hooks";

interface StatsSearch {
	fromYear: number;
	fromMonth: number;
	toYear: number;
	toMonth: number;
}

function defaultSearch(): StatsSearch {
	const now = new Date();
	const from = new Date(now);
	from.setMonth(from.getMonth() - 11);
	return {
		fromYear: from.getFullYear(),
		fromMonth: from.getMonth() + 1,
		toYear: now.getFullYear(),
		toMonth: now.getMonth() + 1,
	};
}

export const Route = createFileRoute("/stats")({
	component: StatsPage,
	validateSearch: (search: Record<string, unknown>): StatsSearch => {
		const defaults = defaultSearch();
		return {
			fromYear: Number(search.fromYear) || defaults.fromYear,
			fromMonth: Number(search.fromMonth) || defaults.fromMonth,
			toYear: Number(search.toYear) || defaults.toYear,
			toMonth: Number(search.toMonth) || defaults.toMonth,
		};
	},
});

function formatAmount(amount: number): string {
	return new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
}

function amountColor(amount: number, isSavings = false): string {
	if (isSavings) return "blue";
	if (amount > 0) return "green";
	if (amount < 0) return "red";
	return "white";
}

function StatsPage() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { fromYear, fromMonth, toYear, toMonth } = Route.useSearch();

	const from = new Date(fromYear, fromMonth - 1);
	const to = new Date(toYear, toMonth - 1);

	const summaryQuery = useSummary(fromYear, fromMonth, toYear, toMonth);

	const isLoading = summaryQuery.isLoading;
	const isError = summaryQuery.isError;

	const months = summaryQuery.data?.months ?? [];

	// Compute totals
	let totalExpenses = 0;
	let totalIncome = 0;
	let totalSavings = 0;
	for (const m of months) {
		totalExpenses += Number(m.unbudgeted) + Number(m.budgeted.expense);
		totalIncome += Number(m.budgeted.income);
		totalSavings += Number(m.budgeted.savings);
	}
	const balance = totalIncome + totalExpenses + totalSavings;

	// Chart data
	const chartData = months.map((m) => {
		const expenses = Number(m.unbudgeted) + Number(m.budgeted.expense);
		const income = Number(m.budgeted.income);
		const savings = Number(m.budgeted.savings);
		return {
			month: new Date(m.year, m.month - 1).toLocaleDateString(i18n.language, {
				month: "short",
				year: "2-digit",
			}),
			[t("stats.expenses")]: Math.abs(expenses),
			[t("stats.income")]: income,
			[t("stats.savings")]: Math.abs(savings),
		};
	});

	const summaryCards: {
		label: string;
		value: number;
		isSavings?: boolean;
	}[] = [
		{ label: t("stats.income"), value: totalIncome },
		{ label: t("stats.expenses"), value: totalExpenses },
		{ label: t("stats.savings"), value: totalSavings, isSavings: true },
		{ label: t("stats.balance"), value: balance },
	];

	const chartStyles = {
		legendItemName: { color: "rgba(255,255,255,0.7)" },
	};

	const inputStyles = {
		label: { color: "rgba(255,255,255,0.6)" },
		input: {
			color: "white",
			backgroundColor: "rgba(255,255,255,0.07)",
			borderColor: "rgba(255,255,255,0.2)",
		},
	};

	return (
		<div className="mx-auto flex h-full max-w-5xl flex-col overflow-auto p-3 sm:p-6">
			<Title order={2} c="white" mb="lg">
				{t("stats.title")}
			</Title>

			<Group gap="md" mb="lg" wrap="wrap">
				<MonthPickerInput
					label={t("stats.from")}
					value={from}
					onChange={(d) => {
						if (d) {
							const date = new Date(d);
							navigate({
								to: "/stats",
								search: {
									fromYear: date.getFullYear(),
									fromMonth: date.getMonth() + 1,
									toYear,
									toMonth,
								},
							});
						}
					}}
					locale={i18n.language}
					maxDate={to}
					styles={inputStyles}
				/>
				<MonthPickerInput
					label={t("stats.to")}
					value={to}
					onChange={(d) => {
						if (d) {
							const date = new Date(d);
							navigate({
								to: "/stats",
								search: {
									fromYear,
									fromMonth,
									toYear: date.getFullYear(),
									toMonth: date.getMonth() + 1,
								},
							});
						}
					}}
					locale={i18n.language}
					minDate={from}
					styles={inputStyles}
				/>
			</Group>

			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<Loader color="green" />
				</div>
			)}

			{isError && (
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="red"
					title={t("common.error")}
				>
					{t("stats.fetchError")}
				</Alert>
			)}

			{!isLoading && !isError && (
				<Stack gap="xl">
					<Grid gap="xs">
						{summaryCards.map((card) => (
							<Grid.Col key={card.label} span={{ base: 6, sm: 3 }}>
								<Stack
									gap={2}
									p="sm"
									style={{
										borderRadius: 8,
										backgroundColor: "rgba(255,255,255,0.05)",
									}}
								>
									<Text size="xs" c="dimmed" ta="center">
										{card.label}
									</Text>
									<Text
										size="lg"
										fw={700}
										ta="center"
										c={amountColor(card.value, card.isSavings)}
									>
										{formatAmount(card.value)}
									</Text>
								</Stack>
							</Grid.Col>
						))}
					</Grid>

					{chartData.length > 0 && (
						<Stack gap="xl">
							<Stack gap="xs">
								<Text fw={600} c="white">
									{t("stats.monthlyEvolution")}
								</Text>
								<BarChart
									h={300}
									data={chartData}
									dataKey="month"
									series={[
										{
											name: t("stats.income"),
											color: "green.6",
										},
										{
											name: t("stats.expenses"),
											color: "red.6",
										},
										{
											name: t("stats.savings"),
											color: "blue.6",
										},
									]}
									tickLine="none"
									gridAxis="y"
									gridProps={{ horizontal: true, vertical: false }}
									xAxisProps={{
										interval: 0,
										angle: chartData.length > 12 ? -45 : 0,
										textAnchor: chartData.length > 12 ? "end" : "middle",
										height: chartData.length > 12 ? 60 : 30,
									}}
									withLegend
									valueFormatter={(v) => formatAmount(v)}
									textColor="rgba(255,255,255,0.5)"
									gridColor="rgba(255,255,255,0.08)"
									tooltipAnimationDuration={200}
									barProps={{ radius: [4, 4, 0, 0] }}
									styles={chartStyles}
								/>
							</Stack>
						</Stack>
					)}
				</Stack>
			)}
		</div>
	);
}
