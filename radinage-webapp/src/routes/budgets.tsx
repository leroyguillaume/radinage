import {
	Alert,
	Badge,
	Button,
	Group,
	Loader,
	Paper,
	Progress,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconEdit,
	IconFilter,
	IconPlayerPlay,
	IconPlus,
	IconSearch,
	IconTrash,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchorLink } from "@/components/AnchorLink";
import { BudgetModal } from "@/components/BudgetModal";
import { BudgetYearOverview } from "@/components/BudgetYearOverview";
import {
	BudgetMonthLegend,
	BudgetYearProgress,
} from "@/components/BudgetYearProgress";
import { CardAction } from "@/components/CardAction";
import { ConfirmModal } from "@/components/ConfirmModal";
import { PageHeader } from "@/components/PageHeader";
import { YearStepper } from "@/components/YearStepper";
import {
	type BudgetProgress,
	computeBudgetProgress,
	sumOperationsByBudget,
} from "@/lib/budget-progress";
import { type BudgetYear, toBudgetYear } from "@/lib/budget-year";
import { formatAmount } from "@/lib/format";
import {
	useApplyBudget,
	useBudgetSummary,
	useBudgets,
	useDeleteBudget,
	useMonthlyOperations,
} from "@/lib/hooks";
import { budgetTypeTones } from "@/lib/tones";
import type {
	ApplyBudgetResponse,
	BudgetResponse,
	BudgetType,
} from "@/lib/types";
import { headingFont, palette } from "@/theme";

type BudgetPeriod = "month" | "year";

interface BudgetsSearch {
	period?: BudgetPeriod;
	year?: number;
}

export const Route = createFileRoute("/budgets")({
	component: BudgetsPage,
	validateSearch: (search: Record<string, unknown>): BudgetsSearch => {
		const year = Number(search.year);
		return {
			...(search.period === "year" ? { period: "year" } : {}),
			...(Number.isInteger(year) && year > 0 ? { year } : {}),
		};
	},
});

type BudgetSortKey = "label" | "type" | "amount";
type BudgetTypeFilter = "all" | BudgetType;

const sortKeys: BudgetSortKey[] = ["label", "type", "amount"];
const typeFilters: BudgetTypeFilter[] = ["all", "expense", "income", "savings"];

function isSortKey(value: string): value is BudgetSortKey {
	return sortKeys.some((k) => k === value);
}

function isTypeFilter(value: string): value is BudgetTypeFilter {
	return typeFilters.some((f) => f === value);
}

function getCurrentAmount(budget: BudgetResponse): number {
	if (budget.kind.type === "occasional") return Number(budget.kind.amount);
	return Number(budget.kind.currentPeriod.amount);
}

function BudgetsPage() {
	const { t, i18n } = useTranslation();
	const [now] = useState(() => new Date());
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const navigate = useNavigate();
	const search = Route.useSearch();
	const yearMode = search.period === "year";
	const selectedYear = search.year ?? year;

	const budgetsQuery = useBudgets();
	const operationsQuery = useMonthlyOperations(year, month);
	const summaryQuery = useBudgetSummary(selectedYear, yearMode);
	const deleteBudget = useDeleteBudget();
	const applyBudget = useApplyBudget();

	const [modalOpened, setModalOpened] = useState(false);
	const [editingBudget, setEditingBudget] = useState<BudgetResponse | null>(
		null,
	);
	const [applyResults, setApplyResults] = useState<
		Record<string, ApplyBudgetResponse>
	>({});
	const [applyConfirm, setApplyConfirm] = useState<BudgetResponse | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<BudgetResponse | null>(
		null,
	);
	const [sortKey, setSortKey] = useState<BudgetSortKey>("label");
	const [typeFilter, setTypeFilter] = useState<BudgetTypeFilter>("all");
	const [query, setQuery] = useState("");

	function handleEdit(budget: BudgetResponse) {
		setEditingBudget(budget);
		setModalOpened(true);
	}

	function handleCreate() {
		setEditingBudget(null);
		setModalOpened(true);
	}

	async function handleDeleteConfirmed() {
		if (!deleteConfirm) return;
		await deleteBudget.mutateAsync(deleteConfirm.id);
		setDeleteConfirm(null);
	}

	async function handleApplyConfirmed(force: boolean) {
		if (!applyConfirm) return;
		const result = await applyBudget.mutateAsync({
			id: applyConfirm.id,
			force,
		});
		setApplyResults((prev) => ({ ...prev, [applyConfirm.id]: result }));
		setApplyConfirm(null);
	}

	const linkedTotals = useMemo(
		() =>
			operationsQuery.data
				? sumOperationsByBudget(operationsQuery.data.operations, year, month)
				: null,
		[operationsQuery.data, year, month],
	);

	const budgets = useMemo(() => {
		const needle = query.toLowerCase();
		const filtered = (budgetsQuery.data ?? []).filter(
			(b) =>
				(typeFilter === "all" || b.budgetType === typeFilter) &&
				b.label.toLowerCase().includes(needle),
		);

		return filtered.sort((a, b) => {
			switch (sortKey) {
				case "type":
					return a.budgetType.localeCompare(b.budgetType);
				case "amount":
					return getCurrentAmount(a) - getCurrentAmount(b);
				default:
					return a.label.localeCompare(b.label);
			}
		});
	}, [budgetsQuery.data, sortKey, typeFilter, query]);

	const yearEntries = useMemo(() => {
		if (!yearMode || !summaryQuery.data) return null;
		const months = new Map(
			summaryQuery.data.budgets.map((b) => [b.budgetId, b.months]),
		);
		return (budgetsQuery.data ?? []).map((budget) => ({
			budget,
			year: toBudgetYear(budget, months.get(budget.id) ?? [], now),
		}));
	}, [yearMode, summaryQuery.data, budgetsQuery.data, now]);

	const budgetYears = useMemo(
		() => new Map(yearEntries?.map((e) => [e.budget.id, e.year])),
		[yearEntries],
	);

	function showPeriod(next: BudgetsSearch) {
		navigate({ to: "/budgets", search: next });
	}

	if (budgetsQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	if (budgetsQuery.isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{t("budgets.fetchError")}
				</Alert>
			</div>
		);
	}

	const monthLabel = now.toLocaleDateString(i18n.language, {
		month: "long",
		year: "numeric",
	});

	return (
		<div className="h-full overflow-auto">
			<BudgetModal
				opened={modalOpened}
				onClose={() => setModalOpened(false)}
				budget={editingBudget}
			/>

			<ConfirmModal
				opened={applyConfirm !== null}
				onClose={() => setApplyConfirm(null)}
				title={t("budgets.applyRulesTitle")}
				message={t("budgets.applyForcePrompt")}
			>
				<Button variant="default" onClick={() => setApplyConfirm(null)}>
					{t("common.cancel")}
				</Button>
				<Button
					variant="outline"
					onClick={() => handleApplyConfirmed(false)}
					loading={applyBudget.isPending}
				>
					{t("budgets.applySkipManual")}
				</Button>
				<Button
					onClick={() => handleApplyConfirmed(true)}
					loading={applyBudget.isPending}
				>
					{t("budgets.applyForceManual")}
				</Button>
			</ConfirmModal>

			<ConfirmModal
				opened={deleteConfirm !== null}
				onClose={() => setDeleteConfirm(null)}
				title={t("budgets.deleteConfirm")}
				message={t("budgets.deleteConfirmMessage", {
					label: deleteConfirm?.label ?? "",
				})}
			>
				<Button variant="default" onClick={() => setDeleteConfirm(null)}>
					{t("common.cancel")}
				</Button>
				<Button
					color="tangerine.8"
					leftSection={<IconTrash size={18} />}
					onClick={handleDeleteConfirmed}
					loading={deleteBudget.isPending}
				>
					{t("common.delete")}
				</Button>
			</ConfirmModal>

			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<PageHeader
					title={t("budgets.title")}
					subtitle={
						yearMode
							? yearSubtitle(t, selectedYear, now, i18n.language)
							: t("budgets.subtitle", { month: monthLabel })
					}
					actions={
						<Button leftSection={<IconPlus size={20} />} onClick={handleCreate}>
							{t("budgets.create")}
						</Button>
					}
				/>

				<Group gap="sm" wrap="nowrap" align="center">
					<SegmentedControl
						radius="xl"
						size="md"
						flex={1}
						maw={320}
						aria-label={t("budgets.periodLabel")}
						value={yearMode ? "year" : "month"}
						onChange={(v) =>
							showPeriod(
								v === "year" ? { period: "year", year: selectedYear } : {},
							)
						}
						data={[
							{ value: "month", label: t("budgets.periods.month") },
							{ value: "year", label: t("budgets.periods.year") },
						]}
					/>
					{yearMode && (
						<YearStepper
							year={selectedYear}
							onChange={(delta) =>
								showPeriod({ period: "year", year: selectedYear + delta })
							}
						/>
					)}
				</Group>

				{yearEntries && (
					<BudgetYearOverview
						entries={yearEntries}
						year={selectedYear}
						today={now}
					/>
				)}

				<Group gap="sm" wrap="wrap" align="center">
					<TextInput
						placeholder={t("common.search")}
						aria-label={t("common.search")}
						leftSection={<IconSearch size={20} />}
						value={query}
						onChange={(e) => setQuery(e.currentTarget.value)}
						style={{ flex: "1 1 280px" }}
					/>
					<SegmentedControl
						radius="xl"
						size="md"
						aria-label={t("budgets.filterByType")}
						value={typeFilter}
						onChange={(v) => {
							if (isTypeFilter(v)) setTypeFilter(v);
						}}
						data={typeFilters.map((f) => ({
							value: f,
							label: t(`budgets.filters.${f}`),
						}))}
					/>
					<SegmentedControl
						radius="xl"
						size="md"
						aria-label={t("budgets.sortBy")}
						value={sortKey}
						onChange={(v) => {
							if (isSortKey(v)) setSortKey(v);
						}}
						data={[
							{ value: "label", label: t("budgets.fields.label") },
							{ value: "type", label: t("budgets.fields.budgetType") },
							{ value: "amount", label: t("budgets.fields.amount") },
						]}
					/>
				</Group>

				{budgets.length === 0 ? (
					<Text c="dimmed" ta="center" mt="xl">
						{t("common.noResults")}
					</Text>
				) : (
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
						{budgets.map((budget) => (
							<BudgetCard
								key={budget.id}
								budget={budget}
								progress={
									linkedTotals
										? computeBudgetProgress(
												budget,
												linkedTotals.get(budget.id) ?? 0,
												year,
												month,
											)
										: null
								}
								onEdit={() => handleEdit(budget)}
								onDelete={() => setDeleteConfirm(budget)}
								onApply={() => setApplyConfirm(budget)}
								applyResult={applyResults[budget.id] ?? null}
								budgetYear={budgetYears.get(budget.id) ?? null}
								detailYear={selectedYear}
							/>
						))}
					</SimpleGrid>
				)}
				{yearEntries && budgets.length > 0 && <BudgetMonthLegend />}
			</Stack>
		</div>
	);
}

function yearSubtitle(
	t: TFunction,
	year: number,
	today: Date,
	locale: string,
): string {
	if (year < today.getFullYear()) {
		return t("budgets.yearSubtitlePast", { year });
	}
	if (year > today.getFullYear()) {
		return t("budgets.yearSubtitleFuture", { year });
	}
	return t("budgets.yearSubtitle", {
		year,
		date: today.toLocaleDateString(locale, { day: "numeric", month: "long" }),
	});
}

function BudgetCard({
	budget,
	progress,
	onEdit,
	onDelete,
	onApply,
	applyResult,
	budgetYear,
	detailYear,
}: {
	budget: BudgetResponse;
	progress: BudgetProgress | null;
	/** Shown instead of `progress` in the year view. */
	budgetYear: BudgetYear | null;
	detailYear: number;
	onEdit: () => void;
	onDelete: () => void;
	onApply: () => void;
	applyResult: ApplyBudgetResponse | null;
}) {
	const { t } = useTranslation();
	const tone = budgetTypeTones[budget.budgetType];

	const kindLabel =
		budget.kind.type === "occasional"
			? `${t("budgets.kinds.occasional")} — ${budget.kind.month}/${budget.kind.year}`
			: `${t("budgets.kinds.recurring")} — ${t(`budgets.recurrences.${budget.kind.recurrence}`)}`;

	return (
		<Paper component="article" aria-label={budget.label} p="lg">
			<Stack gap="md">
				<Group
					justify="space-between"
					align="flex-start"
					wrap="nowrap"
					gap="xs"
				>
					<Group gap={6} wrap="wrap">
						<Badge color={tone.color} size="md">
							{t(`budgets.types.${budget.budgetType}`)}
						</Badge>
						<Badge color="gray" size="md">
							{kindLabel}
						</Badge>
					</Group>
					<Group gap={0} wrap="nowrap" mt={-8} mr={-8}>
						{budget.rules.length > 0 && (
							<CardAction label={t("budgets.applyRules")} onClick={onApply}>
								<IconPlayerPlay size={18} />
							</CardAction>
						)}
						<CardAction label={t("common.edit")} onClick={onEdit}>
							<IconEdit size={18} />
						</CardAction>
						<CardAction label={t("common.delete")} onClick={onDelete}>
							<IconTrash size={18} />
						</CardAction>
					</Group>
				</Group>

				<Group justify="space-between" align="baseline" wrap="nowrap" gap="sm">
					<Title order={2} fz={22} fw={700} lh={1.2}>
						<AnchorLink
							to="/budgets/$budgetId"
							params={{ budgetId: budget.id }}
							search={{ year: detailYear }}
							c="inherit"
							inherit
							aria-label={t("budgets.detail.open", { label: budget.label })}
						>
							{budget.label}
						</AnchorLink>
					</Title>
					<Text
						ff={headingFont}
						fz={22}
						fw={700}
						className="tabular-nums"
						style={{ whiteSpace: "nowrap" }}
					>
						{formatAmount(
							budgetYear
								? budgetYear.planned
								: Math.abs(getCurrentAmount(budget)),
						)}
						{budgetYear && (
							<Text component="span" fz={13} fw={500} c="dimmed">
								{` ${t("budgets.yearProgress.perYear")}`}
							</Text>
						)}
					</Text>
				</Group>

				{budgetYear ? (
					<BudgetYearProgress
						budgetType={budget.budgetType}
						year={budgetYear}
					/>
				) : (
					progress && (
						<BudgetProgressBar progress={progress} toneColor={tone.color} />
					)
				)}

				<Group gap={6} wrap="nowrap">
					<IconFilter size={18} color="var(--mantine-color-dimmed)" />
					<Text size="sm" c="dimmed">
						{budget.rules.length > 0
							? t("budgets.rulesCount", { count: budget.rules.length })
							: t("budgets.noRules")}
					</Text>
				</Group>

				{applyResult && (
					<Text size="sm" fw={600} c={budgetTypeTones.income.text}>
						{t("budgets.applyResult", {
							updated: applyResult.updated,
							skipped: applyResult.skipped,
						})}
					</Text>
				)}
			</Stack>
		</Paper>
	);
}

function BudgetProgressBar({
	progress,
	toneColor,
}: {
	progress: BudgetProgress;
	toneColor: string;
}) {
	const { t } = useTranslation();

	const statusLabel: Record<BudgetProgress["status"], string> = {
		noDue: "",
		partial: t("budgets.progress.percent", { percent: progress.percent }),
		reached: t("budgets.progress.reached"),
		over: t("budgets.progress.over"),
	};
	const statusColor: Record<BudgetProgress["status"], string> = {
		noDue: "dimmed",
		partial: "dimmed",
		reached: budgetTypeTones.income.text,
		over: budgetTypeTones.expense.text,
	};

	return (
		<Stack gap={6}>
			<Group justify="space-between" gap="xs" className="tabular-nums">
				<Text size="sm" c="dimmed">
					{progress.status === "noDue"
						? t("budgets.progress.noDue")
						: t("budgets.progress.amounts", {
								real: formatAmount(progress.real),
								planned: formatAmount(progress.planned),
							})}
				</Text>
				{statusLabel[progress.status] && (
					<Text size="sm" fw={700} c={statusColor[progress.status]}>
						{statusLabel[progress.status]}
					</Text>
				)}
			</Group>
			<Progress
				value={progress.percent}
				color={progress.status === "over" ? "tangerine.6" : `${toneColor}.5`}
				size="md"
				bg={palette.track}
				aria-hidden
			/>
		</Stack>
	);
}
