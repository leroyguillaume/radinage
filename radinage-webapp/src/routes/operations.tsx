import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	Progress,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import {
	IconAlertCircle,
	IconAlertTriangle,
	IconArrowRight,
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconEyeOff,
	IconListCheck,
	IconSortAscending,
	IconSortDescending,
	IconTag,
	IconUpload,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge, CategorySelect } from "@/components/CategoryBadge";
import { ImportModal } from "@/components/ImportModal";
import { useOperationActions } from "@/components/OperationActions";
import { OperationRow } from "@/components/OperationRow";
import { OperationSelectionBar } from "@/components/OperationSelectionBar";
import type { OperationHandlers } from "@/components/OperationSheet";
import { StatTile } from "@/components/StatTile";
import {
	getBudgetedAmountForMonth,
	getUnbudgetedForecastForMonth,
} from "@/lib/budget-utils";
import { formatAmount, formatIsoDate, formatSignedAmount } from "@/lib/format";
import {
	useBudgets,
	useCategories,
	useForecast,
	useMonthlyOperations,
} from "@/lib/hooks";
import { entriesInMonth, type OperationEntry } from "@/lib/operation-parts";
import {
	balanceTextColor,
	budgetTypeTones,
	neutralTone,
	type Tone,
} from "@/lib/tones";
import { pairTransfers, type TransferPair } from "@/lib/transfer-pairs";
import { transferFlow, transferTone } from "@/lib/transfers";
import type {
	AccountResponse,
	BudgetResponse,
	BudgetType,
	ImportResult,
	OperationResponse,
} from "@/lib/types";
import { headingFont, palette } from "@/theme";

interface OperationsSearch {
	year: number;
	month: number;
}

export const Route = createFileRoute("/operations")({
	component: MonthlyOperationsPage,
	validateSearch: (search: Record<string, unknown>): OperationsSearch => {
		const now = new Date();
		return {
			year: Number(search.year) || now.getFullYear(),
			month: Number(search.month) || now.getMonth() + 1,
		};
	},
});

/** Budgets by type, then the operations outside any budget: daily ones, and transfers. */
type SectionType = BudgetType | "monthly" | "transfers";

interface BudgetGroup {
	budgetId: string | null;
	budget: BudgetResponse | null;
	budgetLabel: string;
	budgetType: SectionType;
	realAmount: number;
	budgetedAmount: number | null;
	entries: OperationEntry[];
}

type BudgetSection = {
	type: SectionType;
	groups: BudgetGroup[];
	totalReal: number;
	totalBudgeted: number | null;
};

const SECTION_ORDER: SectionType[] = [
	"income",
	"expense",
	"savings",
	"monthly",
	"transfers",
];

const dailyTone: Tone = {
	color: "forest",
	fill: "var(--mantine-color-forest-3)",
	text: "var(--mantine-color-text)",
};

function sectionTone(type: SectionType): Tone {
	if (type === "monthly") return dailyTone;
	if (type === "transfers") return transferTone("internal");
	return budgetTypeTones[type];
}

/**
 * Expenses, savings and the daily forecast are stored as negative amounts;
 * flipping them lets every progress bar and status read "spent vs. planned"
 * with positive numbers.
 */
function normalize(type: SectionType, amount: number): number {
	if (amount === 0 || type === "income" || type === "transfers") return amount;
	return -amount;
}

function buildSections(groups: BudgetGroup[]): BudgetSection[] {
	const byType = new Map<SectionType, BudgetGroup[]>();
	for (const g of groups) {
		const existing = byType.get(g.budgetType);
		if (existing) {
			existing.push(g);
		} else {
			byType.set(g.budgetType, [g]);
		}
	}

	return SECTION_ORDER.filter((type) => byType.has(type)).map((type) => {
		const sectionGroups = byType.get(type) ?? [];
		const totalReal = sectionGroups.reduce((s, g) => s + g.realAmount, 0);
		const allBudgeted = sectionGroups.map((g) => g.budgetedAmount);
		const totalBudgeted = allBudgeted.some((b) => b !== null)
			? allBudgeted.reduce<number>((s, b) => s + (b ?? 0), 0)
			: null;
		return { type, groups: sectionGroups, totalReal, totalBudgeted };
	});
}

function SummaryStats({
	sections,
	accounts,
}: {
	sections: BudgetSection[];
	accounts: AccountResponse[];
}) {
	const { t } = useTranslation();

	const byType = new Map<string, BudgetSection>();
	for (const s of sections) byType.set(s.type, s);

	// Operations not linked to a budget land in the "monthly" section — split
	// them by sign so expenses/income stats still reflect real activity when
	// budgets are missing or not yet wired up.
	const monthlySection = byType.get("monthly");
	let monthlyIncome = 0;
	let monthlyExpense = 0;
	for (const group of monthlySection?.groups ?? []) {
		for (const entry of group.entries) {
			if (entry.amount >= 0) monthlyIncome += entry.amount;
			else monthlyExpense += entry.amount;
		}
	}

	// Money put on or taken back from savings accounts counts as net savings; the other
	// transfers are neither income nor expenses, but still move the balance.
	let transferredSavings = 0;
	let internal = 0;
	let unknown = 0;
	for (const group of byType.get("transfers")?.groups ?? []) {
		for (const entry of group.entries) {
			const flow = transferFlow(entry.operation, accounts);
			if (flow === "internal") {
				internal += entry.amount;
			} else if (flow === null) {
				unknown += entry.amount;
			} else {
				transferredSavings += entry.amount;
			}
		}
	}

	const incomeReal = (byType.get("income")?.totalReal ?? 0) + monthlyIncome;
	const expenseReal = (byType.get("expense")?.totalReal ?? 0) + monthlyExpense;
	const savingsReal =
		(byType.get("savings")?.totalReal ?? 0) + transferredSavings;
	const balance = incomeReal + expenseReal + savingsReal + internal + unknown;
	const hasInternal = byType
		.get("transfers")
		?.groups.some((g) =>
			g.entries.some((e) => transferFlow(e.operation, accounts) === "internal"),
		);

	const typedTiles: { type: BudgetType; label: string; value: number }[] = [
		{ type: "income", label: t("operations.stats.income"), value: incomeReal },
		{
			type: "expense",
			label: t("operations.stats.expenses"),
			value: expenseReal,
		},
		{
			type: "savings",
			label: t("operations.stats.savings"),
			value: savingsReal,
		},
	];

	return (
		<SimpleGrid cols={{ base: 2, sm: hasInternal ? 5 : 4 }} spacing="sm">
			{typedTiles.map((tile) => (
				<StatTile
					key={tile.type}
					label={tile.label}
					value={formatAmount(tile.value)}
					dotColor={budgetTypeTones[tile.type].fill}
					valueColor={budgetTypeTones[tile.type].text}
				/>
			))}
			{hasInternal && (
				<StatTile
					label={t("transfers.internalStat")}
					value={formatSignedAmount(internal)}
					dotColor={transferTone("internal").fill}
					valueColor={transferTone("internal").text}
				/>
			)}
			<StatTile
				label={t("operations.stats.balance")}
				value={formatSignedAmount(balance)}
				dotColor={neutralTone.fill}
				valueColor={balanceTextColor(balance)}
			/>
		</SimpleGrid>
	);
}

const SORT_COLUMNS = [
	"budget",
	"realAmount",
	"budgetedAmount",
	"difference",
] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];
type SortDirection = "asc" | "desc";

interface SortState {
	column: SortColumn;
	direction: SortDirection;
}

function sortGroups(groups: BudgetGroup[], sort: SortState): BudgetGroup[] {
	const sorted = [...groups];
	const dir = sort.direction === "asc" ? 1 : -1;

	sorted.sort((a, b) => {
		// Monthly budget (unlinked) always last
		if (a.budgetId === null) return 1;
		if (b.budgetId === null) return -1;

		const diff = (() => {
			switch (sort.column) {
				case "budget":
					return a.budgetLabel.localeCompare(b.budgetLabel);
				case "realAmount":
					return a.realAmount - b.realAmount;
				case "budgetedAmount":
					return (a.budgetedAmount ?? 0) - (b.budgetedAmount ?? 0);
				case "difference": {
					const da =
						a.budgetedAmount !== null ? a.realAmount - a.budgetedAmount : 0;
					const db =
						b.budgetedAmount !== null ? b.realAmount - b.budgetedAmount : 0;
					return da - db;
				}
			}
		})();
		return dir * diff;
	});

	return sorted;
}

/** All entries (null), the uncategorized ones, or those of one category. */
type CategoryFilter =
	| null
	| { kind: "none" }
	| { kind: "category"; id: string };

const NO_CATEGORY_OPTION = "__none";

function matchesCategory(entry: OperationEntry, filter: CategoryFilter) {
	if (filter === null) return true;
	return filter.kind === "none"
		? entry.categoryId === null
		: entry.categoryId === filter.id;
}

function groupOperationsByBudget(
	operations: OperationResponse[],
	budgets: BudgetResponse[],
	forecast: number | null,
	year: number,
	month: number,
	categoryFilter: CategoryFilter = null,
): BudgetGroup[] {
	const budgetMap = new Map<string, BudgetResponse>();
	for (const b of budgets) {
		budgetMap.set(b.id, b);
	}

	const groups = new Map<string | null, OperationEntry[]>();
	const transfers: OperationEntry[] = [];

	const entries = operations
		.flatMap((op) => entriesInMonth(op, year, month))
		.filter((entry) => matchesCategory(entry, categoryFilter))
		.sort((a, b) => b.date.localeCompare(a.date));
	for (const entry of entries) {
		if (entry.budgetId === null && entry.operation.transfer !== null) {
			transfers.push(entry);
			continue;
		}
		const existing = groups.get(entry.budgetId);
		if (existing) {
			existing.push(entry);
		} else {
			groups.set(entry.budgetId, [entry]);
		}
	}

	const result: BudgetGroup[] = [];

	for (const [budgetId, entries] of groups) {
		const realAmount = entries.reduce((sum, e) => sum + e.amount, 0);

		if (budgetId === null) {
			result.push({
				budgetId: null,
				budget: null,
				budgetLabel: "operations.unbudgeted",
				budgetType: "monthly",
				realAmount,
				budgetedAmount: forecast,
				entries,
			});
		} else {
			const budget = budgetMap.get(budgetId);
			const budgetedAmount = budget
				? (getBudgetedAmountForMonth(budget, year, month) ?? 0)
				: 0;
			result.push({
				budgetId,
				budget: budget ?? null,
				budgetLabel: budget?.label ?? "?",
				budgetType: budget?.budgetType ?? "expense",
				realAmount,
				budgetedAmount,
				entries,
			});
		}
	}

	// Add empty groups for budgets with a budgeted amount this month but no linked operations,
	// unless only some categories are shown: those budgets are then off topic.
	for (const budget of categoryFilter === null ? budgets : []) {
		if (groups.has(budget.id)) continue;
		const budgetedAmount = getBudgetedAmountForMonth(budget, year, month);
		if (budgetedAmount !== null) {
			result.push({
				budgetId: budget.id,
				budget,
				budgetLabel: budget.label,
				budgetType: budget.budgetType,
				realAmount: 0,
				budgetedAmount,
				entries: [],
			});
		}
	}

	result.sort((a, b) => {
		if (a.budgetId === null) return 1;
		if (b.budgetId === null) return -1;
		return a.budgetLabel.localeCompare(b.budgetLabel);
	});

	if (transfers.length > 0) {
		result.push({
			budgetId: null,
			budget: null,
			budgetLabel: "transfers.section",
			budgetType: "transfers",
			realAmount: transfers.reduce((sum, e) => sum + e.amount, 0),
			budgetedAmount: null,
			entries: transfers,
		});
	}

	return result;
}

function MonthlyOperationsPage() {
	const { year, month } = Route.useSearch();
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();

	const [importOpened, setImportOpened] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);
	const [showIgnored, setShowIgnored] = useState(false);
	const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
	const operationsQuery = useMonthlyOperations(year, month, showIgnored);
	const budgetsQuery = useBudgets();
	const categoriesQuery = useCategories();

	const forecastQuery = useForecast(year, month, 1);

	const isLoading = operationsQuery.isLoading || budgetsQuery.isLoading;
	const isError = operationsQuery.isError || budgetsQuery.isError;

	const currentDate = new Date(year, month - 1);

	function navigateToDate(date: Date) {
		setSelectedIds(null);
		navigate({
			to: "/operations",
			search: {
				year: date.getFullYear(),
				month: date.getMonth() + 1,
			},
		});
	}

	const operations = operationsQuery.data?.operations ?? [];
	const categories = categoriesQuery.data ?? [];
	const { handlers, dialogs } = useOperationActions({
		operations,
		budgets: budgetsQuery.data ?? [],
		categories,
	});

	function navigateMonth(delta: number) {
		navigateToDate(new Date(year, month - 1 + delta));
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{t("operations.fetchError")}
				</Alert>
			</div>
		);
	}

	const forecast = forecastQuery.data
		? getUnbudgetedForecastForMonth(
				forecastQuery.data.unbudgetedRate,
				year,
				month,
			)
		: null;

	// A filter whose category has been deleted, or with none left to pick, shows everything.
	const activeFilter =
		categoryFilter?.kind === "category" &&
		!categories.some((c) => c.id === categoryFilter.id)
			? null
			: categories.length > 0
				? categoryFilter
				: null;
	const ignoredOperations = operations.filter((op) => op.ignored);

	const groups = groupOperationsByBudget(
		operations.filter((op) => !op.ignored),
		budgetsQuery.data ?? [],
		forecast,
		year,
		month,
		activeFilter,
	);

	const sections = buildSections(groups);

	// Only the unbudgeted operations on screen can be selected, whatever was picked before.
	const selectable = [
		...new Set(
			groups
				.find((g) => g.budgetType === "monthly")
				?.entries.map((entry) => entry.operation),
		),
	];
	const selected = selectedIds
		? selectable.filter((op) => selectedIds.has(op.id))
		: [];
	const selection: EntrySelection | null = selectedIds && {
		ids: selectedIds,
		onToggle: (op) =>
			setSelectedIds((ids) => {
				const next = new Set(ids);
				if (!next.delete(op.id)) next.add(op.id);
				return next;
			}),
	};

	return (
		<div className="h-full overflow-auto">
			{dialogs}
			<ImportModal
				opened={importOpened}
				onClose={() => setImportOpened(false)}
				onSuccess={(result) => {
					setImportOpened(false);
					setImportResult(result);
				}}
			/>
			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<Group justify="space-between" align="center" gap="md" wrap="wrap">
					<Group gap={8} wrap="nowrap" miw={0}>
						<ActionIcon
							variant="default"
							size={44}
							radius="md"
							onClick={() => navigateMonth(-1)}
							aria-label={t("operations.previousMonth")}
						>
							<IconChevronLeft size={20} />
						</ActionIcon>
						<MonthPickerInput
							value={currentDate}
							onChange={(date) => {
								if (date) navigateToDate(new Date(date));
							}}
							locale={i18n.language}
							variant="unstyled"
							miw={0}
							rightSection={
								<IconChevronDown size={20} color={palette.dimmed} />
							}
							rightSectionPointerEvents="none"
							styles={{
								input: {
									fontFamily: headingFont,
									fontSize: "clamp(1.5rem, 5vw, 2.5rem)",
									fontWeight: 800,
									letterSpacing: "-0.02em",
									height: "auto",
									minHeight: 44,
									lineHeight: 1.15,
									textTransform: "capitalize",
									cursor: "pointer",
								},
							}}
						/>
						<ActionIcon
							variant="default"
							size={44}
							radius="md"
							onClick={() => navigateMonth(1)}
							aria-label={t("operations.nextMonth")}
						>
							<IconChevronRight size={20} />
						</ActionIcon>
					</Group>
					<Group gap="sm" wrap="wrap" miw={0} w={{ base: "100%", sm: "auto" }}>
						{categories.length > 0 && (
							<CategorySelect
								aria-label={t("operations.category.filter")}
								categories={categories}
								extraOptions={[
									{ value: "", label: t("operations.category.all") },
									{
										value: NO_CATEGORY_OPTION,
										label: t("operations.category.none"),
									},
								]}
								value={
									activeFilter === null
										? ""
										: activeFilter.kind === "none"
											? NO_CATEGORY_OPTION
											: activeFilter.id
								}
								onChange={(value) =>
									setCategoryFilter(
										!value
											? null
											: value === NO_CATEGORY_OPTION
												? { kind: "none" }
												: { kind: "category", id: value },
									)
								}
								leftSection={<IconTag size={16} />}
								allowDeselect={false}
								w={{ base: "100%", sm: 220 }}
								styles={{ input: { minHeight: 44 } }}
							/>
						)}
						<Switch
							size="md"
							label={t("operations.showIgnored")}
							checked={showIgnored}
							onChange={(e) => setShowIgnored(e.currentTarget.checked)}
							styles={{ body: { alignItems: "center", minHeight: 44 } }}
						/>
						<Button
							leftSection={<IconUpload size={18} />}
							onClick={() => setImportOpened(true)}
						>
							{t("import.title")}
						</Button>
					</Group>
				</Group>

				{importResult && (
					<Alert
						variant="light"
						color="leaf"
						icon={<IconCheck size={18} />}
						withCloseButton
						closeButtonLabel={t("common.close")}
						onClose={() => setImportResult(null)}
					>
						<Text size="sm" fw={600}>
							{t("import.resultImported", { count: importResult.imported })}
						</Text>
						{importResult.skipped > 0 && (
							<Text size="sm">
								{t("import.resultSkipped", { count: importResult.skipped })}
							</Text>
						)}
						{importResult.errors.length > 0 && (
							<Text size="sm" c={budgetTypeTones.expense.text}>
								{t("import.resultErrors", {
									count: importResult.errors.length,
								})}
							</Text>
						)}
					</Alert>
				)}

				{groups.length === 0 ? (
					<Text c="dimmed" ta="center" mt="xl">
						{t("common.noResults")}
					</Text>
				) : (
					<>
						<SummaryStats sections={sections} accounts={handlers.accounts} />
						{sections.map((section) => (
							<SectionCard
								key={section.type}
								section={section}
								handlers={handlers}
								selection={section.type === "monthly" ? selection : null}
								onSelect={
									section.type === "monthly" && selectedIds === null
										? () => setSelectedIds(new Set())
										: undefined
								}
							/>
						))}
					</>
				)}

				{showIgnored && (
					<IgnoredOperationsCard
						operations={ignoredOperations}
						year={year}
						month={month}
						loading={operationsQuery.isPlaceholderData}
						handlers={handlers}
					/>
				)}

				{selectedIds !== null && (
					<OperationSelectionBar
						selected={selected}
						selectable={selectable.length}
						accounts={handlers.accounts}
						categories={categories}
						onSelectAll={() =>
							setSelectedIds(new Set(selectable.map((op) => op.id)))
						}
						onClear={() => setSelectedIds(new Set())}
						onDone={() => setSelectedIds(null)}
					/>
				)}
			</Stack>
		</div>
	);
}

function SortControl({
	sort,
	onChange,
	budgetedLabel,
}: {
	sort: SortState;
	onChange: (sort: SortState) => void;
	budgetedLabel: string;
}) {
	const { t } = useTranslation();
	const labels: Record<SortColumn, string> = {
		budget: t("operations.columns.budget"),
		realAmount: t("operations.columns.realAmount"),
		budgetedAmount: budgetedLabel,
		difference: t("operations.columns.difference"),
	};
	const directionLabel =
		sort.direction === "asc"
			? t("operations.sortAscending")
			: t("operations.sortDescending");

	return (
		<Group gap={6} wrap="nowrap">
			<Select
				aria-label={t("operations.sortBy")}
				data={SORT_COLUMNS.map((column) => ({
					value: column,
					label: labels[column],
				}))}
				value={sort.column}
				onChange={(value) => {
					const column = SORT_COLUMNS.find((c) => c === value);
					if (column && column !== sort.column) {
						onChange({ column, direction: "asc" });
					}
				}}
				allowDeselect={false}
				w={{ base: "100%", sm: 210 }}
				styles={{ input: { minHeight: 44 } }}
				comboboxProps={{ withinPortal: true }}
			/>
			<Tooltip label={directionLabel}>
				<ActionIcon
					variant="default"
					size={44}
					radius="md"
					aria-label={directionLabel}
					onClick={() =>
						onChange({
							column: sort.column,
							direction: sort.direction === "asc" ? "desc" : "asc",
						})
					}
				>
					{sort.direction === "asc" ? (
						<IconSortAscending size={20} />
					) : (
						<IconSortDescending size={20} />
					)}
				</ActionIcon>
			</Tooltip>
		</Group>
	);
}

/** The ids of the selected operations, and how to toggle one of them. */
interface EntrySelection {
	ids: Set<string>;
	onToggle: (op: OperationResponse) => void;
}

function SectionCard({
	section,
	handlers,
	selection,
	onSelect,
}: {
	section: BudgetSection;
	handlers: OperationHandlers;
	/** Turns the unbudgeted operations' rows into checkboxes. */
	selection: EntrySelection | null;
	/** Enters the selection mode, offered when set. */
	onSelect?: () => void;
}) {
	const { t } = useTranslation();
	const titleId = useId();
	const [sort, setSort] = useState<SortState>({
		column: "budget",
		direction: "asc",
	});

	const isMonthly = section.type === "monthly";
	const tone = sectionTone(section.type);
	const title = isMonthly
		? t("operations.dailyOperations")
		: t(
				`operations.stats.${section.type === "expense" ? "expenses" : section.type}`,
			);
	const sortedGroups = sortGroups(section.groups, sort);
	const sortable = section.groups.filter((g) => g.budgetId !== null).length > 1;

	return (
		<Paper
			component="section"
			p={0}
			style={{ overflow: "hidden" }}
			aria-labelledby={titleId}
		>
			<Group
				justify="space-between"
				align="center"
				gap="sm"
				wrap="wrap"
				px={{ base: "md", sm: 20 }}
				py="md"
			>
				<Stack gap={2} miw={0}>
					<Group gap={10} wrap="nowrap">
						<Box
							w={12}
							h={12}
							bg={tone.fill}
							style={{ borderRadius: 4, flexShrink: 0 }}
						/>
						<Title
							id={titleId}
							order={2}
							fz={{ base: 19, sm: 22 }}
							fw={700}
							lh={1.2}
						>
							{title}
						</Title>
					</Group>
					<Text size="sm" c="dimmed" className="tabular-nums">
						<Text span fw={700} fz="md" c="var(--mantine-color-text)">
							{formatAmount(normalize(section.type, section.totalReal))}
						</Text>
						{section.totalBudgeted !== null &&
							` ${t(
								isMonthly ? "operations.ofForecast" : "operations.ofBudgeted",
								{
									amount: formatAmount(
										normalize(section.type, section.totalBudgeted),
									),
								},
							)}`}
					</Text>
				</Stack>
				{onSelect && (
					<Button
						variant="default"
						h={44}
						leftSection={<IconListCheck size={18} />}
						onClick={onSelect}
					>
						{t("selection.start")}
					</Button>
				)}
				{sortable && (
					<SortControl
						sort={sort}
						onChange={setSort}
						budgetedLabel={
							isMonthly
								? t("operations.columns.forecastAmount")
								: t("operations.columns.budgetedAmount")
						}
					/>
				)}
			</Group>
			<Box component="ul" m={0} p={0} style={{ listStyle: "none" }}>
				{sortedGroups.map((group) => (
					<BudgetGroupRow
						key={group.budgetId ?? "__unlinked"}
						group={group}
						tone={tone}
						handlers={handlers}
						selection={group.budgetId === null ? selection : null}
					/>
				))}
			</Box>
		</Paper>
	);
}

interface GroupStatus {
	label: string;
	color: string;
}

function groupStatus(
	type: SectionType,
	real: number,
	budgeted: number,
	t: TFunction,
): GroupStatus {
	if (type === "income" || type === "savings") {
		return real >= budgeted
			? { label: t("operations.status.reached"), color: "leaf" }
			: {
					label: t("operations.status.missing", {
						amount: formatAmount(budgeted - real),
					}),
					color: "gold",
				};
	}
	return real > budgeted
		? {
				label: t("operations.status.overBy", {
					amount: formatAmount(real - budgeted),
				}),
				color: "tangerine",
			}
		: {
				label: t("operations.status.remaining", {
					amount: formatAmount(budgeted - real),
				}),
				color: "leaf",
			};
}

const GROUP_ROW_CLASS =
	"grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left sm:grid-cols-[20px_minmax(0,1.6fr)_minmax(0,2fr)_170px] sm:gap-x-4 sm:px-5";

function groupMeta(group: BudgetGroup, t: TFunction): string {
	const parts: string[] = [];
	const kind = group.budget?.kind;
	if (kind) {
		parts.push(t(`budgets.kinds.${kind.type}`));
		if (kind.type === "recurring") {
			parts.push(t(`budgets.recurrences.${kind.recurrence}`).toLowerCase());
		}
	}
	parts.push(t("operations.operationsCount", { count: group.entries.length }));
	if (group.budgetId === null && group.budgetedAmount !== null) {
		parts.push(t("operations.forecastHint"));
	}
	return parts.join(" · ");
}

function BudgetGroupRow({
	group,
	tone,
	handlers,
	selection,
}: {
	group: BudgetGroup;
	tone: Tone;
	handlers: OperationHandlers;
	selection: EntrySelection | null;
}) {
	const { t } = useTranslation();
	// The daily group starts open: its operations are the ones waiting to be sorted.
	const [openedByUser, setOpened] = useState(group.budgetId === null);
	// Selecting needs the rows on screen.
	const opened = openedByUser || selection !== null;

	const label =
		group.budgetId === null ? t(group.budgetLabel) : group.budgetLabel;
	const hasOps = group.entries.length > 0;
	const real = normalize(group.budgetType, group.realAmount);
	const budgeted =
		group.budgetedAmount !== null
			? normalize(group.budgetType, group.budgetedAmount)
			: null;
	const status =
		budgeted !== null ? groupStatus(group.budgetType, real, budgeted, t) : null;
	const ratio =
		budgeted !== null && budgeted > 0 ? Math.max(0, real / budgeted) : null;
	const isOver =
		group.budgetType !== "income" &&
		group.budgetType !== "savings" &&
		ratio !== null &&
		ratio > 1;

	const cells: ReactNode = (
		<>
			<Box c="dimmed" style={{ display: "flex" }}>
				{hasOps && (
					<IconChevronRight
						size={18}
						style={{
							transform: opened ? "rotate(90deg)" : undefined,
							transition: "transform 150ms ease",
						}}
					/>
				)}
			</Box>
			<Stack gap={2} miw={0}>
				<Text fw={700} truncate>
					{label}
				</Text>
				<Text size="sm" c="dimmed" truncate>
					{groupMeta(group, t)}
				</Text>
			</Stack>
			<Stack
				gap={6}
				className="col-span-2 col-start-2 row-start-2 sm:col-auto sm:row-auto"
			>
				<Group
					justify="space-between"
					gap="xs"
					wrap="nowrap"
					className="tabular-nums"
				>
					<Text size="sm" c="dimmed">
						<Text span fw={700} c="var(--mantine-color-text)" inherit>
							{formatAmount(real)}
						</Text>
						{budgeted !== null && ` / ${formatAmount(budgeted)}`}
					</Text>
					{ratio !== null && (
						<Text size="sm" c="dimmed">
							{`${Math.round(ratio * 100)} %`}
						</Text>
					)}
				</Group>
				{ratio !== null && (
					<Progress
						value={Math.min(100, ratio * 100)}
						color={isOver ? "tangerine.6" : tone.fill}
						bg={palette.track}
						size="md"
						aria-label={label}
					/>
				)}
			</Stack>
			<Box className="justify-self-end">
				{status && (
					<Badge
						size="lg"
						tt="none"
						bg={`${status.color}.1`}
						c={`${status.color}.8`}
						className="tabular-nums"
						styles={{ root: { whiteSpace: "nowrap" } }}
					>
						{status.label}
					</Badge>
				)}
			</Box>
		</>
	);

	return (
		<Box component="li" style={{ borderTop: `1px solid ${palette.divider}` }}>
			{hasOps ? (
				<UnstyledButton
					className={`${GROUP_ROW_CLASS} hover:bg-(--row-hover)`}
					style={{ "--row-hover": palette.surfaceMuted }}
					aria-expanded={opened}
					onClick={() => setOpened((o) => !o)}
				>
					{cells}
				</UnstyledButton>
			) : (
				<Box className={GROUP_ROW_CLASS}>{cells}</Box>
			)}
			{opened &&
				hasOps &&
				(group.budgetType === "transfers" ? (
					<TransferPairList entries={group.entries} handlers={handlers} />
				) : (
					<OperationList
						entries={group.entries}
						handlers={handlers}
						selection={selection}
					/>
				))}
		</Box>
	);
}

const OPERATION_LIST_CLASS = "list-none px-4 pt-1 pb-3 sm:pr-5 sm:pl-14";

function OperationList({
	entries,
	handlers,
	selection = null,
}: {
	entries: OperationEntry[];
	handlers: OperationHandlers;
	selection?: EntrySelection | null;
}) {
	return (
		<Box
			component="ul"
			m={0}
			bg={palette.surfaceMuted}
			className={OPERATION_LIST_CLASS}
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			{entries.map((entry) => (
				<EntryRow
					key={entry.key}
					entry={entry}
					handlers={handlers}
					selection={selection}
				/>
			))}
		</Box>
	);
}

function EntryRow({
	entry,
	handlers,
	selection,
}: {
	entry: OperationEntry;
	handlers: OperationHandlers;
	selection: EntrySelection | null;
}) {
	const { t } = useTranslation();
	const category = entry.categoryId
		? handlers.categories.find((c) => c.id === entry.categoryId)
		: undefined;
	const budget = entry.budgetId
		? handlers.budgets.find((b) => b.id === entry.budgetId)
		: undefined;
	return (
		<OperationRow
			op={entry.operation}
			amount={entry.amount}
			date={entry.date}
			category={
				category && (
					<CategoryBadge
						category={category}
						inherited={entry.categoryFromBudget}
					/>
				)
			}
			budget={budget?.label ?? ""}
			badge={
				entry.part && (
					<Tooltip
						label={t("operations.split.splitInto", {
							count: entry.part.count,
						})}
					>
						<Badge size="sm" color="forest" c="forest.8" tt="none" flex="none">
							{t("operations.split.partBadge", entry.part)}
						</Badge>
					</Tooltip>
				)
			}
			onOpen={handlers.onOpen}
			selection={
				selection
					? {
							selected: selection.ids.has(entry.operation.id),
							onToggle: selection.onToggle,
						}
					: undefined
			}
		/>
	);
}

/** The transfers of `entries`, one row each, warning about those missing their other side. */
function TransferPairList({
	entries,
	handlers,
}: {
	entries: OperationEntry[];
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const pairs = pairTransfers(entries, handlers.accounts);
	const missing = pairs.filter((p) => p.status === "missing").length;
	return (
		<Box
			bg={palette.surfaceMuted}
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			{missing > 0 && (
				<Alert
					icon={<IconAlertTriangle size={16} />}
					color="tangerine"
					mx={{ base: "md", sm: 20 }}
					mt="sm"
					title={t("transfers.pairs.missingCount", { count: missing })}
				>
					{t("transfers.pairs.missingHint")}
				</Alert>
			)}
			<Box component="ul" m={0} className={OPERATION_LIST_CLASS}>
				{pairs.map((pair) => (
					<TransferPairRow key={pair.key} pair={pair} handlers={handlers} />
				))}
			</Box>
		</Box>
	);
}

function TransferPairRow({
	pair,
	handlers,
}: {
	pair: TransferPair;
	handlers: OperationHandlers;
}) {
	const { t, i18n } = useTranslation();
	const [opened, setOpened] = useState(false);
	const accountName = (id: string) =>
		handlers.accounts.find((a) => a.id === id)?.name ?? "?";
	const from = accountName(pair.fromAccountId);
	const to = accountName(pair.toAccountId);
	const shown = pair.debit ?? pair.credit;
	const flow = shown && transferFlow(shown.operation, handlers.accounts);
	const missingSide =
		pair.status === "missing"
			? pair.debit === null
				? t("transfers.pairs.missingDebit", { account: from })
				: t("transfers.pairs.missingCredit", { account: to })
			: null;

	return (
		<Box
			component="li"
			style={{
				borderBottom: `1px dashed ${palette.border}`,
				boxShadow: missingSide
					? "inset 3px 0 0 var(--mantine-color-tangerine-4)"
					: undefined,
			}}
		>
			<UnstyledButton
				aria-expanded={opened}
				onClick={() => setOpened((o) => !o)}
				className="grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 pl-2 text-left"
			>
				<Group gap={6} wrap="wrap" miw={0}>
					<AccountChip name={from} />
					<IconArrowRight
						size={14}
						color={palette.dimmed}
						aria-label={t("transfers.pairs.to")}
					/>
					<AccountChip name={to} />
				</Group>
				<Text
					fw={700}
					className="tabular-nums"
					c={flow ? transferTone(flow).text : undefined}
					style={{ whiteSpace: "nowrap" }}
				>
					{formatAmount(pair.amount)}
				</Text>
				<Group gap="xs" wrap="wrap" className="col-span-2">
					<Text span size="sm" c="dimmed" className="tabular-nums">
						{formatIsoDate(pair.date, i18n.language)}
					</Text>
					{missingSide ? (
						<Badge
							size="sm"
							color="tangerine"
							c="tangerine.9"
							variant="light"
							tt="none"
							leftSection={<IconAlertTriangle size={12} aria-hidden />}
						>
							{missingSide}
						</Badge>
					) : (
						<Text span size="sm" c="dimmed">
							{pair.status === "linked"
								? t(
										pair.debit && pair.credit
											? "transfers.pairs.linked"
											: "transfers.pairs.linkedElsewhere",
									)
								: t("transfers.pairs.oneSided", {
										account: pair.debit ? to : from,
									})}
						</Text>
					)}
					<IconChevronDown
						size={14}
						color={palette.dimmed}
						aria-hidden
						style={{ transform: opened ? "rotate(180deg)" : undefined }}
					/>
				</Group>
			</UnstyledButton>
			{opened && (
				<Box component="ul" m={0} p={0} className="list-none pb-2 pl-2">
					{[pair.debit, pair.credit].map((entry) =>
						entry ? (
							<EntryRow
								key={entry.key}
								entry={entry}
								handlers={handlers}
								selection={null}
							/>
						) : null,
					)}
				</Box>
			)}
		</Box>
	);
}

function AccountChip({ name }: { name: string }) {
	return (
		<Text
			span
			size="sm"
			fw={600}
			px={8}
			bg={palette.surface}
			truncate
			maw="100%"
			style={{ border: `1px solid ${palette.border}`, borderRadius: 6 }}
		>
			{name}
		</Text>
	);
}

function IgnoredOperationsCard({
	operations,
	year,
	month,
	loading,
	handlers,
}: {
	operations: OperationResponse[];
	year: number;
	month: number;
	loading: boolean;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const titleId = useId();

	return (
		<Paper
			component="section"
			p={0}
			style={{ overflow: "hidden" }}
			aria-labelledby={titleId}
		>
			<Stack gap={2} px={{ base: "md", sm: 20 }} py="md">
				<Group gap={10} wrap="nowrap">
					<IconEyeOff size={16} color={palette.dimmed} />
					<Title id={titleId} order={2} fz={{ base: 19, sm: 22 }} fw={700}>
						{t("operations.ignored.title")}
					</Title>
				</Group>
				<Text size="sm" c="dimmed">
					{t("operations.ignored.hint")}
				</Text>
			</Stack>
			{loading ? (
				<Group justify="center" pb="md">
					<Loader size="sm" />
				</Group>
			) : operations.length === 0 ? (
				<Text size="sm" c="dimmed" px={{ base: "md", sm: 20 }} pb="md">
					{t("operations.ignored.empty")}
				</Text>
			) : (
				<OperationList
					entries={operations.flatMap((op) => entriesInMonth(op, year, month))}
					handlers={handlers}
				/>
			)}
		</Paper>
	);
}
