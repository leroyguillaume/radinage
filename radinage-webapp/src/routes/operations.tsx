import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Group,
	Loader,
	Menu,
	Paper,
	Popover,
	Progress,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	TextInput,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import {
	IconAlertCircle,
	IconCalendar,
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconEye,
	IconEyeOff,
	IconLink,
	IconLinkOff,
	IconPlus,
	IconScissors,
	IconSortAscending,
	IconSortDescending,
	IconTag,
	IconUpload,
	IconX,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge, CategorySelect } from "@/components/CategoryBadge";
import { ImportModal } from "@/components/ImportModal";
import { useOperationActions } from "@/components/OperationActions";
import {
	EffectiveDatePicker,
	type OperationHandlers,
} from "@/components/OperationSheet";
import { StatTile } from "@/components/StatTile";
import {
	budgetFitsAmount,
	getBudgetedAmountForMonth,
	getUnbudgetedForecastForMonth,
} from "@/lib/budget-utils";
import { formatAmount, formatIsoDate, formatSignedAmount } from "@/lib/format";
import {
	useBelowBreakpoint,
	useBudgets,
	useCategories,
	useForecast,
	useMonthlyOperations,
} from "@/lib/hooks";
import {
	isSplit,
	type OperationEntry,
	operationEntries,
} from "@/lib/operation-parts";
import {
	balanceTextColor,
	budgetTypeTones,
	neutralTone,
	type Tone,
} from "@/lib/tones";
import type {
	BudgetResponse,
	BudgetType,
	CategoryResponse,
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

function accountingDate(op: OperationResponse): string {
	return op.effectiveDate ?? op.date;
}

function formatDate(iso: string, locale: string): string {
	return formatIsoDate(iso, locale, { day: "2-digit", month: "2-digit" });
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
								locale={i18n.language}
								handlers={handlers}
							/>
						))}
					</>
				)}

				{showIgnored && (
					<IgnoredOperationsCard
						operations={ignoredOperations}
						loading={operationsQuery.isPlaceholderData}
						locale={i18n.language}
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
	locale,
	handlers,
}: {
	section: BudgetSection;
	locale: string;
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
						locale={locale}
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
	locale,
	handlers,
}: {
	group: BudgetGroup;
	tone: Tone;
	locale: string;
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
				<OperationList
					entries={group.entries}
					locale={locale}
					handlers={handlers}
				/>
			)}
		</Box>
	);
}

const DESKTOP_ACTION_SIZE = 36;
const TOUCH_ACTION_SIZE = 44;

/** Fixed columns so amounts and actions line up whatever each row holds. */
const OPERATION_ROW_CLASS =
	"grid grid-cols-[56px_minmax(0,1fr)_120px_auto] items-center gap-x-4 py-2";
const OPERATION_ACTIONS_CLASS =
	"grid grid-cols-[180px_36px_88px_36px_36px_36px] items-center gap-x-0.5";

function OperationList({
	entries,
	locale,
	handlers,
}: {
	entries: OperationEntry[];
	locale: string;
	handlers: OperationHandlers;
}) {
	const isDesktop = !useBelowBreakpoint("sm");
	const Row = isDesktop ? OperationRow : TappableOperationRow;
	return (
		<Box
			component="ul"
			m={0}
			bg={palette.surfaceMuted}
			className="list-none px-4 pt-1 pb-3 sm:pr-5 sm:pl-14"
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			{entries.map((entry) => (
				<Row
					key={entry.key}
					entry={entry}
					locale={locale}
					handlers={handlers}
				/>
			))}
		</Box>
	);
}

interface OperationRowProps {
	entry: OperationEntry;
	locale: string;
	handlers: OperationHandlers;
}

/** Badges telling how an entry was linked and which part of its operation it is. */
function LinkBadges({ entry }: { entry: OperationEntry }) {
	const { t } = useTranslation();
	const { operation: op, part } = entry;
	return (
		<>
			{op.budgetLink.type === "auto" && (
				<Badge size="sm" color="leaf" c="leaf.9" tt="none" flex="none">
					{t("operations.auto")}
				</Badge>
			)}
			{part && (
				<Tooltip label={t("operations.split.splitInto", { count: part.count })}>
					<Badge size="sm" color="forest" c="forest.8" tt="none" flex="none">
						{t("operations.split.partBadge", part)}
					</Badge>
				</Tooltip>
			)}
		</>
	);
}

/** A whole-row button opening the operation sheet, for a phone. */
function TappableOperationRow({ entry, locale, handlers }: OperationRowProps) {
	const { t } = useTranslation();
	const { operation: op, amount } = entry;
	const category = entry.categoryId
		? handlers.categories.find((c) => c.id === entry.categoryId)
		: undefined;
	const date = accountingDate(op);

	return (
		<Box
			component="li"
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			<UnstyledButton
				onClick={() => handlers.onOpen(op)}
				className="grid min-h-[44px] w-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-x-3 py-3 text-left"
			>
				<Stack gap={0} align="center" className="tabular-nums">
					<Text fw={700} lh={1.2}>
						{formatIsoDate(date, locale, { day: "2-digit" })}
					</Text>
					<Text size="xs" c="dimmed" lh={1.2}>
						{formatIsoDate(date, locale, { month: "short" })}
					</Text>
				</Stack>
				<Stack gap={6} miw={0}>
					<Text
						fw={600}
						lh={1.3}
						className="line-clamp-2 [overflow-wrap:anywhere]"
					>
						{op.label}
					</Text>
					<Group gap={6} wrap="wrap">
						{category ? (
							<CategoryBadge
								category={category}
								inherited={entry.categoryFromBudget}
							/>
						) : (
							<Badge size="sm" color="tangerine" c="tangerine.8" tt="none">
								{t("operations.sheet.unclassified")}
							</Badge>
						)}
						<LinkBadges entry={entry} />
						{op.effectiveDate && (
							<Badge size="sm" color="gold" c="gold.8" tt="none">
								{t("operations.sheet.bankDateBadge", {
									date: formatDate(op.date, locale),
								})}
							</Badge>
						)}
					</Group>
				</Stack>
				<Text
					fw={700}
					className="tabular-nums"
					c={amount > 0 ? budgetTypeTones.income.text : undefined}
					style={{ whiteSpace: "nowrap" }}
				>
					{formatSignedAmount(amount)}
				</Text>
			</UnstyledButton>
		</Box>
	);
}

function OperationAction({
	label,
	icon,
	size,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	size: number;
	onClick: () => void;
}) {
	return (
		<Tooltip label={label}>
			<ActionIcon
				variant="subtle"
				color="gray"
				c="dimmed"
				size={size}
				radius="md"
				onClick={onClick}
				aria-label={label}
			>
				{icon}
			</ActionIcon>
		</Tooltip>
	);
}

function LinkBudgetMenu({
	budgets,
	height,
	onSelect,
}: {
	budgets: BudgetResponse[];
	height: number;
	onSelect: (budgetId: string) => void;
}) {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");

	const filtered = search
		? budgets.filter((b) =>
				b.label.toLowerCase().includes(search.toLowerCase()),
			)
		: budgets;

	return (
		<Menu position="bottom-end" withinPortal onClose={() => setSearch("")}>
			<Menu.Target>
				<Button
					variant="default"
					size="xs"
					h={height}
					radius="md"
					c="forest.8"
					fullWidth
					leftSection={<IconLink size={16} />}
					aria-label={t("operations.linkBudget")}
				>
					{t("operations.link")}
				</Button>
			</Menu.Target>
			<Menu.Dropdown>
				<TextInput
					placeholder={t("common.search")}
					size="xs"
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					onClick={(e: React.MouseEvent) => e.stopPropagation()}
					onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
					mb="xs"
				/>
				{filtered.length === 0 ? (
					<Menu.Item disabled>{t("common.noResults")}</Menu.Item>
				) : (
					filtered.map((b) => (
						<Menu.Item key={b.id} onClick={() => onSelect(b.id)}>
							{b.label}
						</Menu.Item>
					))
				)}
			</Menu.Dropdown>
		</Menu>
	);
}

function CategoryMenu({
	categories,
	entry,
	height,
	onSelect,
}: {
	categories: CategoryResponse[];
	entry: OperationEntry;
	height: number;
	onSelect: (categoryId: string | null) => void;
}) {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const current = categories.find((c) => c.id === entry.categoryId);
	const ownCategory = entry.operation.categoryId;

	const filtered = search
		? categories.filter((c) =>
				c.name.toLowerCase().includes(search.toLowerCase()),
			)
		: categories;

	return (
		<Menu position="bottom-end" withinPortal onClose={() => setSearch("")}>
			<Menu.Target>
				<Tooltip
					label={
						entry.categoryFromBudget
							? t("operations.category.fromBudget")
							: t("operations.category.change")
					}
				>
					<Button
						variant="default"
						size="xs"
						h={height}
						radius="md"
						fullWidth
						justify="flex-start"
						leftSection={current ? undefined : <IconTag size={16} />}
						aria-label={
							current
								? `${t("operations.category.change")} (${current.name})`
								: t("operations.category.change")
						}
					>
						{current ? (
							<CategoryBadge
								category={current}
								inherited={entry.categoryFromBudget}
							/>
						) : (
							t("operations.category.set")
						)}
					</Button>
				</Tooltip>
			</Menu.Target>
			<Menu.Dropdown>
				{categories.length === 0 ? (
					<Menu.Item disabled maw={260} style={{ whiteSpace: "normal" }}>
						{t("operations.category.noneYet")}
					</Menu.Item>
				) : (
					<>
						<TextInput
							placeholder={t("common.search")}
							size="xs"
							value={search}
							onChange={(e) => setSearch(e.currentTarget.value)}
							onClick={(e: React.MouseEvent) => e.stopPropagation()}
							onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
							mb="xs"
						/>
						{filtered.length === 0 ? (
							<Menu.Item disabled>{t("common.noResults")}</Menu.Item>
						) : (
							filtered.map((c) => (
								<Menu.Item key={c.id} onClick={() => onSelect(c.id)}>
									<CategoryBadge category={c} />
								</Menu.Item>
							))
						)}
						{ownCategory !== null && (
							<>
								<Menu.Divider />
								<Menu.Item
									leftSection={<IconX size={14} />}
									onClick={() => onSelect(null)}
								>
									{t("operations.category.clear")}
								</Menu.Item>
							</>
						)}
					</>
				)}
			</Menu.Dropdown>
		</Menu>
	);
}

/** A row with every action inline, for a wide screen; its label opens the sheet. */
function OperationRow({ entry, locale, handlers }: OperationRowProps) {
	const { t } = useTranslation();
	const [datePopoverOpened, setDatePopoverOpened] = useState(false);
	const { operation: op, amount, part } = entry;
	const split = isSplit(op);
	const actionSize = DESKTOP_ACTION_SIZE;
	const partCategory = part
		? handlers.categories.find((c) => c.id === entry.categoryId)
		: undefined;

	return (
		<Box
			component="li"
			className={OPERATION_ROW_CLASS}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			<Text size="sm" c="dimmed" className="tabular-nums">
				{formatDate(accountingDate(op), locale)}
			</Text>
			<Group gap={8} wrap="nowrap" miw={0}>
				<UnstyledButton
					onClick={() => handlers.onOpen(op)}
					miw={0}
					mih={actionSize}
					className="hover:underline"
				>
					<Text fw={500} truncate title={op.label}>
						{op.label}
					</Text>
				</UnstyledButton>
				<LinkBadges entry={entry} />
			</Group>
			<Text
				fw={700}
				className="text-right tabular-nums"
				c={amount > 0 ? budgetTypeTones.income.text : undefined}
				style={{ whiteSpace: "nowrap" }}
			>
				{formatSignedAmount(amount)}
			</Text>
			<Box className={OPERATION_ACTIONS_CLASS}>
				{split ? (
					// 14px button padding + 1px border: lines the dot up with the category buttons'.
					<Box pl={15} miw={0}>
						{partCategory && (
							<CategoryBadge
								category={partCategory}
								inherited={entry.categoryFromBudget}
							/>
						)}
					</Box>
				) : (
					<CategoryMenu
						categories={handlers.categories}
						entry={entry}
						height={actionSize}
						onSelect={(categoryId) => handlers.onSetCategory(op.id, categoryId)}
					/>
				)}
				<Popover
					opened={datePopoverOpened}
					onChange={setDatePopoverOpened}
					position="bottom"
					withArrow
				>
					<Popover.Target>
						<Tooltip label={t("operations.editEffectiveDate")}>
							<ActionIcon
								variant={op.effectiveDate ? "light" : "subtle"}
								color={op.effectiveDate ? "gold" : "gray"}
								c={op.effectiveDate ? "gold.8" : "dimmed"}
								size={actionSize}
								radius="md"
								onClick={() => setDatePopoverOpened((o) => !o)}
								aria-label={t("operations.editEffectiveDate")}
							>
								<IconCalendar size={18} />
							</ActionIcon>
						</Tooltip>
					</Popover.Target>
					<Popover.Dropdown>
						<EffectiveDatePicker
							op={op}
							onChange={(date) => {
								handlers.onEditEffectiveDate(op, date);
								setDatePopoverOpened(false);
							}}
						/>
					</Popover.Dropdown>
				</Popover>
				{split ? (
					<>
						<span />
						<span />
					</>
				) : op.budgetLink.type === "unlinked" ? (
					<>
						<LinkBudgetMenu
							budgets={handlers.budgets.filter((b) =>
								budgetFitsAmount(b, amount),
							)}
							height={actionSize}
							onSelect={(budgetId) => handlers.onLink(op.id, budgetId)}
						/>
						<OperationAction
							label={t("operations.createBudget")}
							icon={<IconPlus size={18} />}
							size={actionSize}
							onClick={() => handlers.onCreateBudget(op)}
						/>
					</>
				) : (
					<>
						<OperationAction
							label={t("operations.unlinkBudget")}
							icon={<IconLinkOff size={18} />}
							size={actionSize}
							onClick={() => handlers.onUnlink(op.id)}
						/>
						<span />
					</>
				)}
				<OperationAction
					label={
						split
							? t("operations.split.editAction")
							: t("operations.split.action")
					}
					icon={<IconScissors size={18} />}
					size={actionSize}
					onClick={() => handlers.onSplit(op)}
				/>
				<OperationAction
					label={t("operations.ignoreOperation")}
					icon={<IconEyeOff size={18} />}
					size={actionSize}
					onClick={() => handlers.onSetIgnored(op.id, true)}
				/>
			</Box>
		</Box>
	);
}

function IgnoredOperationsCard({
	operations,
	loading,
	locale,
	handlers,
}: {
	operations: OperationResponse[];
	loading: boolean;
	locale: string;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const titleId = useId();
	const actionSize = useBelowBreakpoint("sm")
		? TOUCH_ACTION_SIZE
		: DESKTOP_ACTION_SIZE;

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
				<Box
					component="ul"
					m={0}
					bg={palette.surfaceMuted}
					className="list-none px-4 pt-1 pb-3 sm:px-5"
					style={{ borderTop: `1px solid ${palette.divider}` }}
				>
					{operations.map((op) => (
						<Box
							component="li"
							key={op.id}
							className="grid grid-cols-[48px_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2 sm:grid-cols-[56px_minmax(0,1fr)_auto_auto] sm:gap-x-4"
							style={{ borderBottom: `1px dashed ${palette.border}` }}
						>
							<Text size="sm" c="dimmed" className="tabular-nums">
								{formatDate(accountingDate(op), locale)}
							</Text>
							<Text
								c="dimmed"
								td="line-through"
								lineClamp={2}
								title={op.label}
								className="[overflow-wrap:anywhere]"
							>
								{op.label}
							</Text>
							<Text
								c="dimmed"
								td="line-through"
								className="tabular-nums"
								style={{ whiteSpace: "nowrap" }}
							>
								{formatSignedAmount(Number(op.amount))}
							</Text>
							<OperationAction
								label={t("operations.unignoreOperation")}
								icon={<IconEye size={18} />}
								size={actionSize}
								onClick={() => handlers.onSetIgnored(op.id, false)}
							/>
						</Box>
					))}
				</Box>
			)}
		</Paper>
	);
}
