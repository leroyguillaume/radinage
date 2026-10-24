import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Checkbox,
	CloseButton,
	Drawer,
	Group,
	Input,
	Loader,
	MultiSelect,
	Paper,
	Pill,
	SegmentedControl,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import {
	IconAdjustmentsHorizontal,
	IconAlertCircle,
	IconRestore,
	IconSearch,
	IconSearchOff,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge, CategoryDot } from "@/components/CategoryBadge";
import { useOperationActions } from "@/components/OperationActions";
import { accountingDate, OperationRow } from "@/components/OperationRow";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import {
	centsToDecimal,
	formatAmount,
	formatIsoDate,
	parseCents,
} from "@/lib/format";
import { useBudgets, useCategories, useOperationSearch } from "@/lib/hooks";
import { isSplit, operationEntries } from "@/lib/operation-parts";
import {
	activeFilterCount,
	defaultOrder,
	mergeFilters,
	OPERATION_DIRECTIONS,
	OPERATION_SORTS,
	type OperationFilters,
	type OperationSort,
	parseOperationFilters,
} from "@/lib/operation-search";
import { budgetTypeTones } from "@/lib/tones";
import type {
	BudgetResponse,
	CategoryLook,
	CategoryResponse,
	OperationResponse,
	OperationSearchTotals,
} from "@/lib/types";
import { palette } from "@/theme";

export const Route = createFileRoute("/search")({
	component: SearchPage,
	validateSearch: parseOperationFilters,
});

const NO_CATEGORY_OPTION = "__none";
const DEBOUNCE_MS = 300;

type UpdateFilters = (patch: OperationFilters, replace?: boolean) => void;

/**
 * Local state for a text field mirrored in the URL: typing commits after a
 * pause, and a URL change made elsewhere (reset, back button) shows up in it.
 * `toParam` gives the URL value of what was typed, null when it is invalid.
 */
function useDebouncedField(
	urlValue: string | undefined,
	toParam: (typed: string) => string | undefined | null,
	commit: (param: string | undefined) => void,
): [string, (value: string) => void] {
	const [value, setValue] = useState(urlValue ?? "");
	const [debounced] = useDebouncedValue(value, DEBOUNCE_MS);
	const committed = useRef(urlValue);
	const callbacks = useRef({ toParam, commit });
	callbacks.current = { toParam, commit };

	useEffect(() => {
		if (urlValue !== committed.current) {
			committed.current = urlValue;
			setValue(urlValue ?? "");
		}
	}, [urlValue]);

	useEffect(() => {
		const param = callbacks.current.toParam(debounced);
		if (param !== null && param !== committed.current) {
			committed.current = param;
			callbacks.current.commit(param);
		}
	}, [debounced]);

	return [value, setValue];
}

function toLabelParam(typed: string): string | undefined {
	return typed.trim() || undefined;
}

/** API decimal of a typed amount, undefined when blank, null when invalid. */
function toAmountParam(typed: string): string | undefined | null {
	if (typed.trim() === "") return undefined;
	const cents = parseCents(typed);
	return cents === null ? null : centsToDecimal(cents);
}

function AmountInput({
	label,
	urlValue,
	onCommit,
}: {
	label: string;
	urlValue: string | undefined;
	onCommit: (value: string | undefined) => void;
}) {
	const { t } = useTranslation();
	const [value, setValue] = useDebouncedField(
		urlValue,
		toAmountParam,
		onCommit,
	);
	const invalid = toAmountParam(value) === null;
	return (
		<TextInput
			label={label}
			value={value}
			onChange={(e) => setValue(e.currentTarget.value)}
			inputMode="decimal"
			rightSection={<Text c="dimmed">€</Text>}
			error={invalid ? t("search.invalidAmount") : undefined}
			miw={0}
		/>
	);
}

interface FilterControlsProps {
	filters: OperationFilters;
	categories: CategoryResponse[];
	budgets: BudgetResponse[];
	onChange: UpdateFilters;
}

function categorySelection(filters: OperationFilters): string[] {
	return [
		...(filters.uncategorized ? [NO_CATEGORY_OPTION] : []),
		...(filters.categoryIds ?? []),
	];
}

function FilterControls({
	filters,
	categories,
	budgets,
	onChange,
}: FilterControlsProps) {
	const { t, i18n } = useTranslation();
	const categoryById = new Map(categories.map((c) => [c.id, c]));
	const [range, setRange] = useState<[string | null, string | null]>([
		filters.dateFrom ?? null,
		filters.dateTo ?? null,
	]);

	useEffect(() => {
		setRange([filters.dateFrom ?? null, filters.dateTo ?? null]);
	}, [filters.dateFrom, filters.dateTo]);

	return (
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
			<Group gap="sm" grow wrap="nowrap" align="flex-start">
				<AmountInput
					label={t("search.amountMin")}
					urlValue={filters.amountMin}
					onCommit={(amountMin) => onChange({ amountMin })}
				/>
				<AmountInput
					label={t("search.amountMax")}
					urlValue={filters.amountMax}
					onCommit={(amountMax) => onChange({ amountMax })}
				/>
			</Group>
			<Input.Wrapper label={t("search.direction.label")}>
				<SegmentedControl
					fullWidth
					size="md"
					value={filters.direction ?? "all"}
					onChange={(value) =>
						onChange({
							direction: OPERATION_DIRECTIONS.find((d) => d === value),
						})
					}
					data={[
						{ value: "all", label: t("search.direction.all") },
						{ value: "expense", label: t("search.direction.expense") },
						{ value: "income", label: t("search.direction.income") },
					]}
					styles={{ label: { minHeight: 40, alignContent: "center" } }}
				/>
			</Input.Wrapper>
			<MultiSelect
				label={t("search.categories")}
				placeholder={
					categorySelection(filters).length === 0
						? t("search.allCategories")
						: undefined
				}
				value={categorySelection(filters)}
				onChange={(values) =>
					onChange({
						uncategorized: values.includes(NO_CATEGORY_OPTION),
						categoryIds: values.filter((v) => v !== NO_CATEGORY_OPTION),
					})
				}
				data={[
					{ value: NO_CATEGORY_OPTION, label: t("search.noCategory") },
					...categories.map((c) => ({ value: c.id, label: c.name })),
				]}
				renderOption={({ option }) => {
					const category = categoryById.get(option.value);
					return category ? (
						<CategoryBadge category={category} />
					) : (
						<Text size="sm">{option.label}</Text>
					);
				}}
				renderPill={({ option, value, onRemove }) => {
					// Mantine passes no option for a value missing from `data`,
					// such as a category id from a link once it is deleted.
					const id = String(value ?? "");
					const category = categoryById.get(id);
					const label = option?.label ?? id;
					return (
						<Pill
							withRemoveButton
							onRemove={onRemove}
							removeButtonProps={{
								"aria-label": t("search.removeFilter", { name: label }),
							}}
						>
							<Group gap={6} wrap="nowrap" component="span">
								{category && <CategoryDot category={category} size={16} />}
								{label}
							</Group>
						</Pill>
					);
				}}
				searchable
				clearable
				size="md"
				comboboxProps={{ withinPortal: true }}
			/>
			<MultiSelect
				label={t("search.budgets")}
				placeholder={
					(filters.budgetIds?.length ?? 0) === 0
						? t("search.allBudgets")
						: undefined
				}
				value={filters.budgetIds ?? []}
				onChange={(budgetIds) => onChange({ budgetIds })}
				data={budgets.map((b) => ({ value: b.id, label: b.label }))}
				searchable
				clearable
				size="md"
				comboboxProps={{ withinPortal: true }}
			/>
			<DatePickerInput
				type="range"
				label={t("search.dates")}
				placeholder={t("search.allDates")}
				value={range}
				onChange={([from, to]) => {
					setRange([from, to]);
					if ((from === null) === (to === null)) {
						onChange({
							dateFrom: from ?? undefined,
							dateTo: to ?? undefined,
						});
					}
				}}
				locale={i18n.language}
				valueFormat="DD/MM/YYYY"
				clearable
				allowSingleDateInRange
				size="md"
			/>
			<Box className="flex min-h-[44px] items-end sm:pb-2">
				<Checkbox
					size="md"
					label={t("search.includeIgnored")}
					checked={filters.includeIgnored ?? false}
					onChange={(e) =>
						onChange({ includeIgnored: e.currentTarget.checked })
					}
				/>
			</Box>
		</SimpleGrid>
	);
}

interface FilterChip {
	key: string;
	label: string;
	category?: CategoryLook;
	patch: OperationFilters;
}

function useFilterChips(
	filters: OperationFilters,
	categories: CategoryResponse[],
	budgets: BudgetResponse[],
): FilterChip[] {
	const { t, i18n } = useTranslation();
	const chips: FilterChip[] = [];
	if (filters.direction) {
		chips.push({
			key: "direction",
			label: t(`search.direction.${filters.direction}`),
			patch: { direction: undefined },
		});
	}
	if (filters.uncategorized) {
		chips.push({
			key: "uncategorized",
			label: t("search.noCategory"),
			patch: { uncategorized: undefined },
		});
	}
	for (const id of filters.categoryIds ?? []) {
		const category = categories.find((c) => c.id === id);
		chips.push({
			key: `category:${id}`,
			label: category?.name ?? "?",
			...(category ? { category } : {}),
			patch: { categoryIds: filters.categoryIds?.filter((c) => c !== id) },
		});
	}
	for (const id of filters.budgetIds ?? []) {
		chips.push({
			key: `budget:${id}`,
			label: budgets.find((b) => b.id === id)?.label ?? "?",
			patch: { budgetIds: filters.budgetIds?.filter((b) => b !== id) },
		});
	}
	const { amountMin, amountMax } = filters;
	if (amountMin || amountMax) {
		const min = amountMin ? formatAmount(amountMin) : "";
		const max = amountMax ? formatAmount(amountMax) : "";
		chips.push({
			key: "amount",
			label:
				amountMin && amountMax
					? t("search.amountRange", { min, max })
					: amountMin
						? t("search.amountAtLeast", { min })
						: t("search.amountAtMost", { max }),
			patch: { amountMin: undefined, amountMax: undefined },
		});
	}
	if (filters.dateFrom && filters.dateTo) {
		chips.push({
			key: "dates",
			label: `${formatIsoDate(filters.dateFrom, i18n.language)} – ${formatIsoDate(filters.dateTo, i18n.language)}`,
			patch: { dateFrom: undefined, dateTo: undefined },
		});
	}
	if (filters.includeIgnored) {
		chips.push({
			key: "ignored",
			label: t("search.includeIgnored"),
			patch: { includeIgnored: undefined },
		});
	}
	return chips;
}

function FilterChipRow({
	chips,
	onChange,
}: {
	chips: FilterChip[];
	onChange: UpdateFilters;
}) {
	const { t } = useTranslation();
	if (chips.length === 0) return null;
	return (
		<Box
			component="ul"
			aria-label={t("search.activeFilters")}
			hiddenFrom="sm"
			className="-mx-4 flex list-none gap-2 overflow-x-auto px-4 py-1"
		>
			{chips.map((chip) => (
				<Box component="li" key={chip.key} className="shrink-0">
					<Group
						gap={6}
						wrap="nowrap"
						pl="sm"
						bg={palette.surface}
						style={{
							border: `1px solid ${palette.border}`,
							borderRadius: 999,
						}}
					>
						{chip.category && (
							<CategoryDot category={chip.category} size={16} />
						)}
						<Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
							{chip.label}
						</Text>
						<CloseButton
							size={44}
							radius="xl"
							aria-label={t("search.removeFilter", { name: chip.label })}
							onClick={() => onChange(chip.patch)}
						/>
					</Group>
				</Box>
			))}
		</Box>
	);
}

function dateRangeLabel(
	totals: OperationSearchTotals,
	locale: string,
): string | null {
	if (totals.firstDate === null || totals.lastDate === null) return null;
	const first = formatIsoDate(totals.firstDate, locale);
	const last = formatIsoDate(totals.lastDate, locale);
	return first === last ? first : `${first} – ${last}`;
}

function SearchTotals({
	total,
	totals,
}: {
	total: number;
	totals: OperationSearchTotals;
}) {
	const { t, i18n } = useTranslation();
	const range = dateRangeLabel(totals, i18n.language);
	const expense = budgetTypeTones.expense;
	const income = budgetTypeTones.income;
	return (
		<>
			<SimpleGrid cols={3} spacing="sm" visibleFrom="sm">
				<StatTile
					label={t("search.totals.count")}
					value={total}
					dotColor="var(--mantine-color-forest-7)"
					hint={range}
				/>
				<StatTile
					label={t("search.totals.expenses")}
					value={formatAmount(totals.expense)}
					dotColor={expense.fill}
					valueColor={expense.text}
				/>
				<StatTile
					label={t("search.totals.income")}
					value={formatAmount(totals.income)}
					dotColor={income.fill}
					valueColor={income.text}
				/>
			</SimpleGrid>
			<Stack gap={0} hiddenFrom="sm">
				<Text size="sm" fw={600} className="tabular-nums">
					{t("search.resultsCount", { count: total })}
					{" · "}
					<Text span inherit c={expense.text}>
						{formatAmount(totals.expense)}
					</Text>
					{" · "}
					<Text span inherit c={income.text}>
						{formatAmount(totals.income)}
					</Text>
				</Text>
				{range && (
					<Text size="xs" c="dimmed">
						{range}
					</Text>
				)}
			</Stack>
		</>
	);
}

function OperationCategories({
	op,
	categoryById,
}: {
	op: OperationResponse;
	categoryById: Map<string, CategoryResponse>;
}) {
	const { t } = useTranslation();
	const entries = operationEntries(op);
	if (!isSplit(op)) {
		const [entry] = entries;
		const category = entry?.categoryId
			? categoryById.get(entry.categoryId)
			: undefined;
		return category ? (
			<CategoryBadge
				category={category}
				inherited={entry?.categoryFromBudget}
			/>
		) : null;
	}
	const partCategories = [
		...new Set(entries.flatMap((e) => (e.categoryId ? [e.categoryId] : []))),
	].flatMap((id) => {
		const category = categoryById.get(id);
		return category ? [category] : [];
	});
	return (
		<Tooltip
			label={partCategories.map((c) => c.name).join(", ")}
			disabled={partCategories.length === 0}
		>
			<Group gap={6} wrap="nowrap" miw={0}>
				{partCategories.map((c) => (
					<CategoryDot key={c.id} category={c} />
				))}
				<Text size="sm" c="dimmed" truncate>
					{t("operations.split.splitInto", { count: op.splits.length })}
				</Text>
			</Group>
		</Tooltip>
	);
}

function budgetNames(
	op: OperationResponse,
	budgetById: Map<string, BudgetResponse>,
): string {
	const ids = new Set(
		operationEntries(op).flatMap((e) => (e.budgetId ? [e.budgetId] : [])),
	);
	return [...ids].map((id) => budgetById.get(id)?.label ?? "?").join(", ");
}

function ResultRow({
	op,
	categoryById,
	budgetById,
	onOpen,
}: {
	op: OperationResponse;
	categoryById: Map<string, CategoryResponse>;
	budgetById: Map<string, BudgetResponse>;
	onOpen: (op: OperationResponse) => void;
}) {
	return (
		<OperationRow
			op={op}
			amount={Number(op.amount)}
			category={<OperationCategories op={op} categoryById={categoryById} />}
			budget={budgetNames(op, budgetById)}
			onOpen={onOpen}
		/>
	);
}

interface ResultGroup {
	key: string;
	title: string | null;
	operations: OperationResponse[];
}

/** By year of the accounting date when sorted by date, else a single group. */
function groupResults(
	operations: OperationResponse[],
	sort: OperationSort,
): ResultGroup[] {
	if (sort !== "date") {
		return [{ key: "all", title: null, operations }];
	}
	const groups: ResultGroup[] = [];
	for (const op of operations) {
		const year = accountingDate(op).slice(0, 4);
		const last = groups.at(-1);
		if (last?.key === year) {
			last.operations.push(op);
		} else {
			groups.push({ key: year, title: year, operations: [op] });
		}
	}
	return groups;
}

function ResultGroupCard({
	group,
	categoryById,
	budgetById,
	onOpen,
}: {
	group: ResultGroup;
	categoryById: Map<string, CategoryResponse>;
	budgetById: Map<string, BudgetResponse>;
	onOpen: (op: OperationResponse) => void;
}) {
	const titleId = useId();
	return (
		<Paper
			component="section"
			p={0}
			style={{ overflow: "hidden" }}
			aria-labelledby={group.title ? titleId : undefined}
		>
			{group.title && (
				<Title
					id={titleId}
					order={2}
					fz={{ base: 19, sm: 22 }}
					fw={700}
					px={{ base: "md", sm: 20 }}
					pt="md"
					pb="xs"
				>
					{group.title}
				</Title>
			)}
			<Box component="ul" m={0} className="list-none px-4 pb-2 sm:px-5">
				{group.operations.map((op) => (
					<ResultRow
						key={op.id}
						op={op}
						categoryById={categoryById}
						budgetById={budgetById}
						onOpen={onOpen}
					/>
				))}
			</Box>
		</Paper>
	);
}

function SortControl({
	filters,
	onChange,
}: {
	filters: OperationFilters;
	onChange: UpdateFilters;
}) {
	const { t } = useTranslation();
	const sort = filters.sort ?? "date";
	const order = filters.order ?? defaultOrder(sort);
	const nextOrder = order === "asc" ? "desc" : "asc";
	return (
		<Group gap="xs" wrap="nowrap">
			<Select
				aria-label={t("search.sort.label")}
				value={sort}
				onChange={(value) => {
					const next = OPERATION_SORTS.find((s) => s === value);
					if (next) onChange({ sort: next, order: defaultOrder(next) });
				}}
				data={OPERATION_SORTS.map((s) => ({
					value: s,
					label: t(`search.sort.${s === "label" ? "labelKey" : s}`),
				}))}
				allowDeselect={false}
				w={150}
				comboboxProps={{ withinPortal: true }}
			/>
			<Tooltip
				label={
					order === "asc"
						? t("operations.sortAscending")
						: t("operations.sortDescending")
				}
			>
				<ActionIcon
					variant="default"
					size={44}
					aria-label={
						order === "asc"
							? t("operations.sortAscending")
							: t("operations.sortDescending")
					}
					onClick={() => onChange({ sort, order: nextOrder })}
				>
					{order === "asc" ? (
						<IconSortAscending size={20} />
					) : (
						<IconSortDescending size={20} />
					)}
				</ActionIcon>
			</Tooltip>
		</Group>
	);
}

function SearchPage() {
	const { t } = useTranslation();
	const filters = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [drawerOpened, drawer] = useDisclosure(false);
	const categories = useCategories().data ?? [];
	const budgets = useBudgets().data ?? [];
	const query = useOperationSearch(filters);
	const chips = useFilterChips(filters, categories, budgets);

	const update: UpdateFilters = (patch, replace = false) => {
		navigate({ search: (prev) => mergeFilters(prev, patch), replace });
	};
	const reset = () => {
		navigate({
			search: (prev) =>
				mergeFilters({}, { sort: prev.sort, order: prev.order }),
		});
	};
	const [labelInput, setLabelInput] = useDebouncedField(
		filters.label,
		toLabelParam,
		(label) => update({ label }, true),
	);

	const emptyTitleId = useId();
	const filterCount = activeFilterCount(filters);
	const firstPage = query.data?.pages[0];
	const operations = query.data?.pages.flatMap((p) => p.data) ?? [];
	const total = firstPage?.total ?? 0;
	const categoryById = new Map(categories.map((c) => [c.id, c]));
	const budgetById = new Map(budgets.map((b) => [b.id, b]));
	const canReset = filterCount > 0 || filters.label !== undefined;
	const { handlers, dialogs } = useOperationActions({
		operations,
		budgets,
		categories,
		withMonthLink: true,
	});

	const controls = (
		<FilterControls
			filters={filters}
			categories={categories}
			budgets={budgets}
			onChange={update}
		/>
	);

	return (
		<div className="h-full overflow-auto">
			{dialogs}
			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<PageHeader title={t("search.title")} subtitle={t("search.subtitle")} />

				<Paper p={{ base: "sm", sm: "lg" }}>
					<Stack gap="md">
						<Group gap="sm" wrap="nowrap">
							<TextInput
								flex={1}
								miw={0}
								size="lg"
								aria-label={t("search.label")}
								placeholder={t("search.labelPlaceholder")}
								leftSection={<IconSearch size={20} />}
								value={labelInput}
								onChange={(e) => setLabelInput(e.currentTarget.value)}
								rightSection={
									labelInput && (
										<CloseButton
											aria-label={t("search.clearLabel")}
											onClick={() => setLabelInput("")}
										/>
									)
								}
							/>
							<Button
								hiddenFrom="sm"
								variant="default"
								size="lg"
								px="sm"
								onClick={drawer.open}
								leftSection={<IconAdjustmentsHorizontal size={20} />}
								rightSection={
									filterCount > 0 && (
										<Badge size="sm" circle variant="filled">
											{filterCount}
										</Badge>
									)
								}
							>
								{t("search.filters")}
							</Button>
						</Group>
						<Box visibleFrom="sm">
							<Stack gap="md">
								{controls}
								<Group justify="flex-end">
									<Button
										variant="subtle"
										leftSection={<IconRestore size={18} />}
										onClick={reset}
										disabled={!canReset}
									>
										{t("search.reset")}
									</Button>
								</Group>
							</Stack>
						</Box>
					</Stack>
				</Paper>

				<FilterChipRow chips={chips} onChange={update} />

				{query.isPending ? (
					<div className="flex items-center justify-center py-12">
						<Loader />
					</div>
				) : query.isError && !query.data ? (
					<Alert
						icon={<IconAlertCircle size={16} />}
						color="tangerine"
						title={t("common.error")}
					>
						{t("search.fetchError")}
					</Alert>
				) : firstPage && total === 0 ? (
					<Paper component="section" aria-labelledby={emptyTitleId}>
						<Stack align="center" gap="xs" py="lg">
							<IconSearchOff size={32} color={palette.dimmed} />
							<Title id={emptyTitleId} order={2} fz={20} fw={700} ta="center">
								{t("search.empty.title")}
							</Title>
							<Text c="dimmed" ta="center">
								{t("search.empty.hint")}
							</Text>
							{canReset && (
								<Button
									variant="light"
									mt="xs"
									leftSection={<IconRestore size={18} />}
									onClick={reset}
								>
									{t("search.reset")}
								</Button>
							)}
						</Stack>
					</Paper>
				) : (
					firstPage && (
						<Stack
							gap="md"
							style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}
						>
							<SearchTotals total={total} totals={firstPage.totals} />
							<Group justify="flex-end">
								<SortControl filters={filters} onChange={update} />
							</Group>
							{groupResults(operations, filters.sort ?? "date").map((group) => (
								<ResultGroupCard
									key={group.key}
									group={group}
									categoryById={categoryById}
									budgetById={budgetById}
									onOpen={handlers.onOpen}
								/>
							))}
							<Stack align="center" gap={6}>
								<Text size="sm" c="dimmed">
									{t("search.loadedOf", {
										loaded: operations.length,
										total,
									})}
								</Text>
								{query.hasNextPage && (
									<Button
										variant="default"
										onClick={() => query.fetchNextPage()}
										loading={query.isFetchingNextPage}
									>
										{t("search.showMore")}
									</Button>
								)}
							</Stack>
						</Stack>
					)
				)}
			</Stack>

			<Drawer
				opened={drawerOpened}
				onClose={drawer.close}
				position="bottom"
				size="auto"
				title={t("search.filters")}
				closeButtonProps={{ "aria-label": t("common.close") }}
			>
				<Stack gap="lg" pb="md">
					{controls}
					<Group grow>
						<Button
							variant="default"
							leftSection={<IconX size={18} />}
							onClick={reset}
							disabled={!canReset}
						>
							{t("search.reset")}
						</Button>
						<Button onClick={drawer.close}>
							{t("search.showResults", { count: total })}
						</Button>
					</Group>
				</Stack>
			</Drawer>
		</div>
	);
}
