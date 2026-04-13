import {
	ActionIcon,
	Alert,
	Button,
	Grid,
	Group,
	Loader,
	Menu,
	Popover,
	Stack,
	Table,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { DatePicker, MonthPickerInput } from "@mantine/dates";
import {
	IconAlertCircle,
	IconArrowDown,
	IconArrowsSort,
	IconArrowUp,
	IconCalendar,
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronUp,
	IconEyeOff,
	IconLink,
	IconLinkOff,
	IconPlus,
	IconUpload,
	IconX,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BudgetInitialValues } from "@/components/BudgetModal";
import { BudgetModal } from "@/components/BudgetModal";
import type { ImportResult } from "@/components/ImportModal";
import { ImportModal } from "@/components/ImportModal";
import { getBudgetedAmountForMonth } from "@/lib/budget-utils";
import {
	useBudgets,
	useIgnoreOperation,
	useLinkBudget,
	useMonthlyOperations,
	useSummary,
	useUnlinkBudget,
	useUpdateEffectiveDate,
} from "@/lib/hooks";
import type { BudgetResponse, OperationResponse } from "@/lib/types";

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

interface BudgetGroup {
	budgetId: string | null;
	budgetLabel: string;
	budgetType: "expense" | "income" | "savings" | "monthly";
	realAmount: number;
	budgetedAmount: number | null;
	operations: OperationResponse[];
}

type BudgetSection = {
	type: "expense" | "income" | "savings" | "monthly";
	groups: BudgetGroup[];
	totalReal: number;
	totalBudgeted: number | null;
};

const SECTION_ORDER: BudgetSection["type"][] = [
	"income",
	"expense",
	"savings",
	"monthly",
];

function buildSections(groups: BudgetGroup[]): BudgetSection[] {
	const byType = new Map<BudgetSection["type"], BudgetGroup[]>();
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

	const incomeReal = byType.get("income")?.totalReal ?? 0;
	const expenseReal = byType.get("expense")?.totalReal ?? 0;
	const savingsReal = byType.get("savings")?.totalReal ?? 0;
	const balance = incomeReal + expenseReal + savingsReal;

	const cells: { label: string; value: number; isSavings?: boolean }[] = [
		{ label: t("operations.stats.income"), value: incomeReal },
		{ label: t("operations.stats.expenses"), value: expenseReal },
		{
			label: t("operations.stats.savings"),
			value: savingsReal,
			isSavings: true,
		},
		{ label: t("operations.stats.balance"), value: balance },
	];

	return (
		<Grid gap="xs" mb="md">
			{cells.map((cell) => (
				<Grid.Col key={cell.label} span={{ base: 6, sm: 3 }}>
					<Stack
						gap={2}
						p="xs"
						style={{
							borderRadius: 8,
							backgroundColor: "rgba(255,255,255,0.03)",
						}}
					>
						<Text size="xs" c="dimmed" ta="center">
							{cell.label}
						</Text>
						<Text
							size="sm"
							fw={700}
							ta="center"
							c={amountColor(
								cell.value,
								cell.isSavings ? "savings" : undefined,
							)}
						>
							{formatAmount(cell.value)}
						</Text>
					</Stack>
				</Grid.Col>
			))}
		</Grid>
	);
}

type SortColumn = "budget" | "realAmount" | "budgetedAmount" | "difference";
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

function groupOperationsByBudget(
	operations: OperationResponse[],
	budgets: BudgetResponse[],
	forecast: number | null,
	year: number,
	month: number,
): BudgetGroup[] {
	const budgetMap = new Map<string, BudgetResponse>();
	for (const b of budgets) {
		budgetMap.set(b.id, b);
	}

	const groups = new Map<string | null, OperationResponse[]>();

	for (const op of operations) {
		const budgetId =
			op.budgetLink.type === "unlinked" ? null : op.budgetLink.budgetId;
		const existing = groups.get(budgetId);
		if (existing) {
			existing.push(op);
		} else {
			groups.set(budgetId, [op]);
		}
	}

	const result: BudgetGroup[] = [];

	for (const [budgetId, ops] of groups) {
		const realAmount = ops.reduce((sum, op) => sum + Number(op.amount), 0);

		if (budgetId === null) {
			result.push({
				budgetId: null,
				budgetLabel: "operations.dailyOperations",
				budgetType: "monthly",
				realAmount,
				budgetedAmount: forecast,
				operations: ops,
			});
		} else {
			const budget = budgetMap.get(budgetId);
			const budgetedAmount = budget
				? (getBudgetedAmountForMonth(budget, year, month) ?? 0)
				: 0;
			result.push({
				budgetId,
				budgetLabel: budget?.label ?? "?",
				budgetType: budget?.budgetType ?? "expense",
				realAmount,
				budgetedAmount,
				operations: ops,
			});
		}
	}

	// Add empty groups for budgets with a budgeted amount this month but no linked operations
	for (const budget of budgets) {
		if (groups.has(budget.id)) continue;
		const budgetedAmount = getBudgetedAmountForMonth(budget, year, month);
		if (budgetedAmount !== null) {
			result.push({
				budgetId: budget.id,
				budgetLabel: budget.label,
				budgetType: budget.budgetType,
				realAmount: 0,
				budgetedAmount,
				operations: [],
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

function formatAmount(amount: number): string {
	return new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
}

function amountColor(
	amount: number,
	budgetType?: "expense" | "income" | "savings" | "monthly",
): string {
	if (budgetType === "savings") return "blue";
	if (amount > 0) return "green";
	if (amount < 0) return "red";
	return "white";
}

function formatDate(dateStr: string, locale: string): string {
	const date = new Date(dateStr);
	return new Intl.DateTimeFormat(locale, {
		day: "2-digit",
		month: "2-digit",
	}).format(date);
}

function MonthlyOperationsPage() {
	const { year, month } = Route.useSearch();
	const navigate = useNavigate();
	const { t, i18n } = useTranslation();

	const [importOpened, setImportOpened] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);
	const [budgetModalOpened, setBudgetModalOpened] = useState(false);
	const [budgetInitial, setBudgetInitial] = useState<
		BudgetInitialValues | undefined
	>();
	const operationsQuery = useMonthlyOperations(year, month);
	const budgetsQuery = useBudgets();

	// Fetch 3 previous months for daily expense forecast
	const prev3Start = new Date(year, month - 4); // 3 months before
	const prev3End = new Date(year, month - 2); // 1 month before
	const summaryQuery = useSummary(
		prev3Start.getFullYear(),
		prev3Start.getMonth() + 1,
		prev3End.getFullYear(),
		prev3End.getMonth() + 1,
	);

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

	const linkBudget = useLinkBudget();
	const unlinkBudget = useUnlinkBudget();
	const ignoreOperation = useIgnoreOperation();
	const updateEffectiveDate = useUpdateEffectiveDate();
	const budgets = budgetsQuery.data ?? [];

	function navigateMonth(delta: number) {
		navigateToDate(new Date(year, month - 1 + delta));
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader color="green" />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="red"
					title={t("common.error")}
				>
					{t("operations.fetchError")}
				</Alert>
			</div>
		);
	}

	// Compute daily expense forecast from 3 previous months
	const forecast = (() => {
		const months = summaryQuery.data?.months;
		if (!months || months.length === 0) return null;
		let totalUnbudgeted = 0;
		let totalDays = 0;
		for (const m of months) {
			totalUnbudgeted += Number(m.unbudgeted);
			totalDays += new Date(m.year, m.month, 0).getDate();
		}
		if (totalDays === 0) return null;
		const dailyAvg = totalUnbudgeted / totalDays;
		const daysInCurrentMonth = new Date(year, month, 0).getDate();
		return dailyAvg * daysInCurrentMonth;
	})();

	const groups = groupOperationsByBudget(
		operationsQuery.data?.operations ?? [],
		budgetsQuery.data ?? [],
		forecast,
		year,
		month,
	);

	const sections = buildSections(groups);

	function handleCreateBudgetFromOp(op: OperationResponse) {
		const selection = window.getSelection()?.toString().trim();
		setBudgetInitial({
			amount: op.amount,
			rules: [
				{
					patternType: "contains",
					patternValue: selection || op.label,
				},
			],
		});
		setBudgetModalOpened(true);
	}

	return (
		<div className="mx-auto flex h-full max-w-4xl flex-col p-3 sm:p-6">
			<BudgetModal
				opened={budgetModalOpened}
				onClose={() => setBudgetModalOpened(false)}
				budget={null}
				initialValues={budgetInitial}
			/>
			<ImportModal
				opened={importOpened}
				onClose={() => setImportOpened(false)}
				onSuccess={(result) => {
					setImportOpened(false);
					setImportResult(result);
				}}
			/>
			<Group justify="space-between" mb="lg">
				<ActionIcon
					variant="subtle"
					color="white"
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
					styles={{
						input: {
							color: "white",
							fontSize: "1.5rem",
							fontWeight: 700,
							textAlign: "center",
							textTransform: "capitalize",
							cursor: "pointer",
						},
					}}
				/>
				<ActionIcon
					variant="subtle"
					color="white"
					onClick={() => navigateMonth(1)}
					aria-label={t("operations.nextMonth")}
				>
					<IconChevronRight size={20} />
				</ActionIcon>
			</Group>
			<Group justify="center" mb="md">
				<Button
					leftSection={<IconUpload size={16} />}
					onClick={() => setImportOpened(true)}
				>
					{t("import.title")}
				</Button>
			</Group>

			{importResult && (
				<Alert
					variant="filled"
					color="green"
					icon={<IconCheck size={16} />}
					mb="md"
					withCloseButton
					onClose={() => setImportResult(null)}
				>
					<Text size="sm" c="white">
						{t("import.resultImported", { count: importResult.imported })}
					</Text>
					{importResult.skipped > 0 && (
						<Text size="sm" c="white">
							{t("import.resultSkipped", { count: importResult.skipped })}
						</Text>
					)}
					{importResult.errors.length > 0 && (
						<Text size="sm" c="red.2">
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
				<div className="min-h-0 flex-1 overflow-auto">
					<SummaryStats sections={sections} />
					<Stack gap="lg">
						{sections.map((section) => (
							<SectionTable
								key={section.type}
								section={section}
								locale={i18n.language}
								budgets={budgets}
								onCreateBudget={handleCreateBudgetFromOp}
								onLink={(opId: string, budgetId: string) =>
									linkBudget.mutate({ opId, budgetId })
								}
								onUnlink={(opId: string) => unlinkBudget.mutate(opId)}
								onIgnore={(opId: string) => ignoreOperation.mutate(opId)}
								onEditEffectiveDate={(
									op: OperationResponse,
									effectiveDate: string | null,
								) => updateEffectiveDate.mutate({ op, effectiveDate })}
							/>
						))}
					</Stack>
				</div>
			)}
		</div>
	);
}

function LinkBudgetMenu({
	budgets,
	onSelect,
}: {
	budgets: BudgetResponse[];
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
		<Menu position="bottom-end" onClose={() => setSearch("")}>
			<Menu.Target>
				<Tooltip label={t("operations.linkBudget")}>
					<ActionIcon
						variant="subtle"
						color="blue"
						size="sm"
						aria-label={t("operations.linkBudget")}
					>
						<IconLink size={14} />
					</ActionIcon>
				</Tooltip>
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

function sectionColor(type: BudgetSection["type"]): string {
	switch (type) {
		case "income":
			return "green";
		case "expense":
			return "red";
		case "savings":
			return "blue";
		default:
			return "gray";
	}
}

function SectionTable({
	section,
	locale,
	budgets,
	onCreateBudget,
	onLink,
	onUnlink,
	onIgnore,
	onEditEffectiveDate,
}: {
	section: BudgetSection;
	locale: string;
	budgets: BudgetResponse[];
	onCreateBudget: (op: OperationResponse) => void;
	onLink: (opId: string, budgetId: string) => void;
	onUnlink: (opId: string) => void;
	onIgnore: (opId: string) => void;
	onEditEffectiveDate: (
		op: OperationResponse,
		effectiveDate: string | null,
	) => void;
}) {
	const { t } = useTranslation();
	const [sort, setSort] = useState<SortState>({
		column: "budget",
		direction: "asc",
	});

	function toggleSort(column: SortColumn) {
		setSort((prev) =>
			prev.column === column
				? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
				: { column, direction: "asc" },
		);
	}

	function sortIcon(column: SortColumn) {
		if (sort.column !== column) return <IconArrowsSort size={14} />;
		return sort.direction === "asc" ? (
			<IconArrowUp size={14} />
		) : (
			<IconArrowDown size={14} />
		);
	}

	const sortedGroups = sortGroups(section.groups, sort);
	const label =
		section.type === "monthly"
			? t("operations.dailyOperations")
			: t(`budgets.types.${section.type}`);
	const color = sectionColor(section.type);
	const difference =
		section.totalBudgeted !== null
			? section.totalReal - section.totalBudgeted
			: null;
	const isMonthly = section.type === "monthly";
	const typ = section.type;

	return (
		<div style={{ overflowX: "auto" }}>
			<Table
				highlightOnHover
				highlightOnHoverColor="rgba(255,255,255,0.05)"
				layout="fixed"
				style={{ minWidth: 600 }}
			>
				<Table.Thead>
					<Table.Tr style={{ borderColor: "rgba(255,255,255,0.15)" }}>
						<Table.Th
							c="dimmed"
							style={{ width: "35%", cursor: "pointer" }}
							onClick={() => toggleSort("budget")}
						>
							<Group gap={4} wrap="nowrap">
								{t("operations.columns.budget")}
								{sortIcon("budget")}
							</Group>
						</Table.Th>
						<Table.Th c="dimmed" style={{ width: "10%" }}>
							{t("operations.columns.date")}
						</Table.Th>
						<Table.Th
							c="dimmed"
							style={{ textAlign: "right", width: "18%", cursor: "pointer" }}
							onClick={() => toggleSort("realAmount")}
						>
							<Group gap={4} wrap="nowrap" justify="flex-end">
								{t("operations.columns.realAmount")}
								{sortIcon("realAmount")}
							</Group>
						</Table.Th>
						<Table.Th
							c="dimmed"
							style={{ textAlign: "right", width: "19%", cursor: "pointer" }}
							onClick={() => toggleSort("budgetedAmount")}
						>
							<Group gap={4} wrap="nowrap" justify="flex-end">
								{isMonthly
									? t("operations.columns.forecastAmount")
									: t("operations.columns.budgetedAmount")}
								{sortIcon("budgetedAmount")}
							</Group>
						</Table.Th>
						<Table.Th
							c="dimmed"
							style={{ textAlign: "right", width: "18%", cursor: "pointer" }}
							onClick={() => toggleSort("difference")}
						>
							<Group gap={4} wrap="nowrap" justify="flex-end">
								{t("operations.columns.difference")}
								{sortIcon("difference")}
							</Group>
						</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{/* Section total row */}
					<Table.Tr
						style={{
							borderColor: "rgba(255,255,255,0.1)",
							backgroundColor: "rgba(255,255,255,0.03)",
						}}
					>
						<Table.Td colSpan={2}>
							<Text fw={700} size="sm" c={color} tt="uppercase">
								{label}
							</Text>
						</Table.Td>
						<Table.Td style={{ textAlign: "right" }}>
							<Text fw={700} size="sm" c={amountColor(section.totalReal, typ)}>
								{formatAmount(section.totalReal)}
							</Text>
						</Table.Td>
						<Table.Td style={{ textAlign: "right" }}>
							<Text
								fw={700}
								size="sm"
								c={
									section.totalBudgeted !== null
										? amountColor(section.totalBudgeted, typ)
										: "dimmed"
								}
							>
								{section.totalBudgeted !== null
									? formatAmount(section.totalBudgeted)
									: "-"}
							</Text>
						</Table.Td>
						<Table.Td style={{ textAlign: "right" }}>
							<Text
								fw={700}
								size="sm"
								c={
									difference !== null ? amountColor(difference, typ) : "dimmed"
								}
							>
								{difference !== null ? formatAmount(difference) : "-"}
							</Text>
						</Table.Td>
					</Table.Tr>
					{/* Budget groups or inline operations */}
					{isMonthly
						? sortedGroups.flatMap((group) =>
								group.operations.map((op) => (
									<OperationRow
										key={op.id}
										op={op}
										locale={locale}
										budgets={budgets}
										onCreateBudget={onCreateBudget}
										onLink={onLink}
										onUnlink={onUnlink}
										onIgnore={onIgnore}
										onEditEffectiveDate={onEditEffectiveDate}
									/>
								)),
							)
						: sortedGroups.map((group) => (
								<BudgetGroupRow
									key={group.budgetId ?? "__unlinked"}
									group={group}
									locale={locale}
									budgets={budgets}
									sectionType={typ}
									onCreateBudget={onCreateBudget}
									onLink={onLink}
									onUnlink={onUnlink}
									onIgnore={onIgnore}
									onEditEffectiveDate={onEditEffectiveDate}
								/>
							))}
				</Table.Tbody>
			</Table>
		</div>
	);
}

function OperationRow({
	op,
	locale,
	budgets,
	onCreateBudget,
	onLink,
	onUnlink,
	onIgnore,
	onEditEffectiveDate,
}: {
	op: OperationResponse;
	locale: string;
	budgets: BudgetResponse[];
	onCreateBudget: (op: OperationResponse) => void;
	onLink: (opId: string, budgetId: string) => void;
	onUnlink: (opId: string) => void;
	onIgnore: (opId: string) => void;
	onEditEffectiveDate: (
		op: OperationResponse,
		effectiveDate: string | null,
	) => void;
}) {
	const { t, i18n } = useTranslation();
	const [datePopoverOpened, setDatePopoverOpened] = useState(false);
	const borderStyle = { borderColor: "rgba(255,255,255,0.1)" };

	return (
		<Table.Tr
			style={{
				backgroundColor: "rgba(255,255,255,0.03)",
				...borderStyle,
			}}
		>
			<Table.Td pl="xl">
				<Text
					size="sm"
					c="rgba(255,255,255,0.6)"
					style={{ wordBreak: "break-word" }}
				>
					{op.label}
				</Text>
			</Table.Td>
			<Table.Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
				<Group gap={4} wrap="nowrap">
					<Text size="sm" c="rgba(255,255,255,0.6)">
						{formatDate(op.effectiveDate ?? op.date, locale)}
					</Text>
					<Popover
						opened={datePopoverOpened}
						onChange={setDatePopoverOpened}
						position="bottom"
						withArrow
					>
						<Popover.Target>
							<Tooltip label={t("operations.editEffectiveDate")}>
								<ActionIcon
									variant="subtle"
									color={op.effectiveDate ? "yellow" : "rgba(255,255,255,0.5)"}
									size="sm"
									onClick={(e: React.MouseEvent) => {
										e.stopPropagation();
										setDatePopoverOpened((o) => !o);
									}}
									aria-label={t("operations.editEffectiveDate")}
								>
									<IconCalendar size={14} />
								</ActionIcon>
							</Tooltip>
						</Popover.Target>
						<Popover.Dropdown
							onClick={(e: React.MouseEvent) => e.stopPropagation()}
						>
							<Stack gap="xs" align="center">
								<DatePicker
									locale={i18n.language}
									value={op.effectiveDate}
									onChange={(date) => {
										if (date) {
											onEditEffectiveDate(op, date);
										}
										setDatePopoverOpened(false);
									}}
								/>
								{op.effectiveDate && (
									<Button
										variant="subtle"
										color="red"
										size="xs"
										leftSection={<IconX size={14} />}
										onClick={() => {
											onEditEffectiveDate(op, null);
											setDatePopoverOpened(false);
										}}
									>
										{t("operations.clearEffectiveDate")}
									</Button>
								)}
							</Stack>
						</Popover.Dropdown>
					</Popover>
				</Group>
			</Table.Td>
			<Table.Td style={{ textAlign: "right" }}>
				<Text size="sm" c={amountColor(Number(op.amount))}>
					{formatAmount(Number(op.amount))}
				</Text>
			</Table.Td>
			<Table.Td />
			<Table.Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
				<Group gap={4} justify="flex-end" wrap="nowrap">
					{op.budgetLink.type === "unlinked" ? (
						<>
							<LinkBudgetMenu
								budgets={budgets.filter((b) =>
									Number(op.amount) >= 0
										? b.budgetType === "income"
										: b.budgetType !== "income",
								)}
								onSelect={(budgetId) => onLink(op.id, budgetId)}
							/>
							<Tooltip label={t("operations.createBudget")}>
								<ActionIcon
									variant="subtle"
									color="green"
									size="sm"
									onClick={(e: React.MouseEvent) => {
										e.stopPropagation();
										onCreateBudget(op);
									}}
									aria-label={t("operations.createBudget")}
								>
									<IconPlus size={14} />
								</ActionIcon>
							</Tooltip>
						</>
					) : (
						<Tooltip label={t("operations.unlinkBudget")}>
							<ActionIcon
								variant="subtle"
								color="red"
								size="sm"
								onClick={(e: React.MouseEvent) => {
									e.stopPropagation();
									onUnlink(op.id);
								}}
								aria-label={t("operations.unlinkBudget")}
							>
								<IconLinkOff size={14} />
							</ActionIcon>
						</Tooltip>
					)}
					<Tooltip label={t("operations.ignoreOperation")}>
						<ActionIcon
							variant="subtle"
							color="rgba(255,255,255,0.5)"
							size="sm"
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation();
								onIgnore(op.id);
							}}
							aria-label={t("operations.ignoreOperation")}
						>
							<IconEyeOff size={14} />
						</ActionIcon>
					</Tooltip>
				</Group>
			</Table.Td>
		</Table.Tr>
	);
}

function BudgetGroupRow({
	group,
	locale,
	budgets,
	sectionType,
	onCreateBudget,
	onLink,
	onUnlink,
	onIgnore,
	onEditEffectiveDate,
}: {
	group: BudgetGroup;
	locale: string;
	budgets: BudgetResponse[];
	sectionType: BudgetSection["type"];
	onCreateBudget: (op: OperationResponse) => void;
	onLink: (opId: string, budgetId: string) => void;
	onUnlink: (opId: string) => void;
	onIgnore: (opId: string) => void;
	onEditEffectiveDate: (
		op: OperationResponse,
		effectiveDate: string | null,
	) => void;
}) {
	const [opened, setOpened] = useState(false);
	const { t } = useTranslation();

	const label =
		group.budgetId === null ? t(group.budgetLabel) : group.budgetLabel;
	const difference =
		group.budgetedAmount !== null
			? group.realAmount - group.budgetedAmount
			: null;
	const hasOps = group.operations.length > 0;

	const borderStyle = { borderColor: "rgba(255,255,255,0.1)" };

	return (
		<>
			<Table.Tr
				style={{
					cursor: hasOps ? "pointer" : "default",
					...borderStyle,
				}}
				onClick={() => {
					if (hasOps) setOpened((o) => !o);
				}}
			>
				<Table.Td>
					<Group gap="xs" wrap="nowrap" align="flex-start">
						{!hasOps ? (
							<span style={{ width: 16, flexShrink: 0 }} />
						) : opened ? (
							<IconChevronUp
								size={16}
								color="white"
								style={{ flexShrink: 0, marginTop: 3 }}
							/>
						) : (
							<IconChevronDown
								size={16}
								color="white"
								style={{ flexShrink: 0, marginTop: 3 }}
							/>
						)}
						<Text fw={600} c="white" style={{ wordBreak: "break-word" }}>
							{label}
						</Text>
					</Group>
				</Table.Td>
				<Table.Td />
				<Table.Td style={{ textAlign: "right" }}>
					<Text fw={600} c={amountColor(group.realAmount, sectionType)}>
						{formatAmount(group.realAmount)}
					</Text>
				</Table.Td>
				<Table.Td style={{ textAlign: "right" }}>
					<Text
						fw={600}
						c={
							group.budgetedAmount !== null
								? amountColor(group.budgetedAmount, sectionType)
								: "white"
						}
					>
						{group.budgetedAmount !== null
							? formatAmount(group.budgetedAmount)
							: "-"}
					</Text>
				</Table.Td>
				<Table.Td style={{ textAlign: "right" }}>
					<Text
						fw={600}
						c={
							difference !== null
								? amountColor(difference, sectionType)
								: "white"
						}
					>
						{difference !== null ? formatAmount(difference) : "-"}
					</Text>
				</Table.Td>
			</Table.Tr>
			{opened &&
				group.operations.map((op) => (
					<OperationRow
						key={op.id}
						op={op}
						locale={locale}
						budgets={budgets}
						onCreateBudget={onCreateBudget}
						onLink={onLink}
						onUnlink={onUnlink}
						onIgnore={onIgnore}
						onEditEffectiveDate={onEditEffectiveDate}
					/>
				))}
		</>
	);
}
