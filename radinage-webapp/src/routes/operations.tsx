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
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconEyeOff,
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
import type { OperationHandlers } from "@/components/OperationSheet";
import { StatTile } from "@/components/StatTile";
import {
	getBudgetedAmountForMonth,
	getUnbudgetedForecastForMonth,
} from "@/lib/budget-utils";
import { formatAmount, formatSignedAmount } from "@/lib/format";
import {
	useBudgets,
	useCategories,
	useForecast,
	useMonthlyOperations,
} from "@/lib/hooks";
import { type OperationEntry, operationEntries } from "@/lib/operation-parts";
import {
	balanceTextColor,
	budgetTypeTones,
	neutralTone,
	type Tone,
} from "@/lib/tones";
import type {
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

type SectionType = BudgetType | "monthly";

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
];

const dailyTone: Tone = {
	color: "forest",
	fill: "var(--mantine-color-forest-3)",
	text: "var(--mantine-color-text)",
};

function sectionTone(type: SectionType): Tone {
	return type === "monthly" ? dailyTone : budgetTypeTones[type];
}

/**
 * Expenses, savings and the daily forecast are stored as negative amounts;
 * flipping them lets every progress bar and status read "spent vs. planned"
 * with positive numbers.
 */
function normalize(type: SectionType, amount: number): number {
	if (amount === 0 || type === "income") return amount;
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

function SummaryStats({ sections }: { sections: BudgetSection[] }) {
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

	const incomeReal = (byType.get("income")?.totalReal ?? 0) + monthlyIncome;
	const expenseReal = (byType.get("expense")?.totalReal ?? 0) + monthlyExpense;
	const savingsReal = byType.get("savings")?.totalReal ?? 0;
	const balance = incomeReal + expenseReal + savingsReal;

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
		<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
			{typedTiles.map((tile) => (
				<StatTile
					key={tile.type}
					label={tile.label}
					value={formatAmount(tile.value)}
					dotColor={budgetTypeTones[tile.type].fill}
					valueColor={budgetTypeTones[tile.type].text}
				/>
			))}
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

	const entries = operations
		.flatMap(operationEntries)
		.filter((entry) => matchesCategory(entry, categoryFilter));
	for (const entry of entries) {
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
	const operationsQuery = useMonthlyOperations(year, month, showIgnored);
	const budgetsQuery = useBudgets();
	const categoriesQuery = useCategories();

	const forecastQuery = useForecast(year, month, 1);

	const isLoading = operationsQuery.isLoading || budgetsQuery.isLoading;
	const isError = operationsQuery.isError || budgetsQuery.isError;

	const currentDate = new Date(year, month - 1);

	function navigateToDate(date: Date) {
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
						<SummaryStats sections={sections} />
						{sections.map((section) => (
							<SectionCard
								key={section.type}
								section={section}
								handlers={handlers}
							/>
						))}
					</>
				)}

				{showIgnored && (
					<IgnoredOperationsCard
						operations={ignoredOperations}
						loading={operationsQuery.isPlaceholderData}
						handlers={handlers}
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

function SectionCard({
	section,
	handlers,
}: {
	section: BudgetSection;
	handlers: OperationHandlers;
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
}: {
	group: BudgetGroup;
	tone: Tone;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	// The daily group starts open: its operations are the ones waiting to be sorted.
	const [opened, setOpened] = useState(group.budgetId === null);

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
			{opened && hasOps && (
				<OperationList entries={group.entries} handlers={handlers} />
			)}
		</Box>
	);
}

function OperationList({
	entries,
	handlers,
}: {
	entries: OperationEntry[];
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	return (
		<Box
			component="ul"
			m={0}
			bg={palette.surfaceMuted}
			className="list-none px-4 pt-1 pb-3 sm:pr-5 sm:pl-14"
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			{entries.map((entry) => {
				const category = entry.categoryId
					? handlers.categories.find((c) => c.id === entry.categoryId)
					: undefined;
				const budget = entry.budgetId
					? handlers.budgets.find((b) => b.id === entry.budgetId)
					: undefined;
				return (
					<OperationRow
						key={entry.key}
						op={entry.operation}
						amount={entry.amount}
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
									<Badge
										size="sm"
										color="forest"
										c="forest.8"
										tt="none"
										flex="none"
									>
										{t("operations.split.partBadge", entry.part)}
									</Badge>
								</Tooltip>
							)
						}
						onOpen={handlers.onOpen}
					/>
				);
			})}
		</Box>
	);
}

function IgnoredOperationsCard({
	operations,
	loading,
	handlers,
}: {
	operations: OperationResponse[];
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
					entries={operations.flatMap(operationEntries)}
					handlers={handlers}
				/>
			)}
		</Paper>
	);
}
