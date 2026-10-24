import {
	Box,
	Button,
	Drawer,
	Group,
	Modal,
	Paper,
	Select,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import {
	IconArrowRight,
	IconCalendar,
	IconChevronDown,
	IconEye,
	IconEyeOff,
	IconFilterOff,
	IconLink,
	IconLinkOff,
	IconPlus,
	IconScissors,
	IconTag,
	IconX,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	CategoryBadge,
	CategoryDot,
	CategorySelect,
} from "@/components/CategoryBadge";
import { useDescribeIgnoreRule } from "@/components/IgnoreRuleForm";
import { budgetFitsAmount } from "@/lib/budget-utils";
import {
	formatIsoDate,
	formatMonthYear,
	formatSignedAmount,
} from "@/lib/format";
import { useBelowBreakpoint } from "@/lib/hooks";
import { isSplit, operationEntries } from "@/lib/operation-parts";
import { budgetTypeTones } from "@/lib/tones";
import type {
	BudgetResponse,
	CategoryResponse,
	IgnoreRuleResponse,
	OperationResponse,
} from "@/lib/types";
import { headingFont, palette } from "@/theme";

/** What can be done to an operation, shared by every list that shows some. */
export interface OperationHandlers {
	budgets: BudgetResponse[];
	categories: CategoryResponse[];
	/** The user's ignore rules, to name the one that ignored an operation. */
	ignoreRules: IgnoreRuleResponse[];
	onOpen: (op: OperationResponse) => void;
	onSetCategory: (opId: string, categoryId: string | null) => void;
	onCreateBudget: (op: OperationResponse) => void;
	onLink: (opId: string, budgetId: string) => void;
	onUnlink: (opId: string) => void;
	onSetIgnored: (opId: string, ignored: boolean) => void;
	/** Opens a new ignore rule pre-filled from the operation's label. */
	onIgnoreAlways: (op: OperationResponse) => void;
	onSplit: (op: OperationResponse) => void;
	onEditEffectiveDate: (
		op: OperationResponse,
		effectiveDate: string | null,
	) => void;
}

/** A calendar picking the date an operation counts on, and a way back to its bank date. */
export function EffectiveDatePicker({
	op,
	onChange,
}: {
	op: OperationResponse;
	onChange: (effectiveDate: string | null) => void;
}) {
	const { t, i18n } = useTranslation();
	return (
		<Stack gap="xs" align="center">
			<DatePicker
				locale={i18n.language}
				value={op.effectiveDate}
				defaultDate={op.effectiveDate ?? op.date}
				onChange={(date) => {
					if (date) onChange(date);
				}}
			/>
			{op.effectiveDate && (
				<Button
					variant="subtle"
					color="tangerine"
					size="xs"
					h={44}
					leftSection={<IconX size={14} />}
					onClick={() => onChange(null)}
				>
					{t("operations.clearEffectiveDate")}
				</Button>
			)}
		</Stack>
	);
}

function capitalize(text: string): string {
	return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function accountingMonth(op: OperationResponse) {
	const [year = 0, month = 1] = (op.effectiveDate ?? op.date)
		.split("-")
		.map(Number);
	return { year, month };
}

interface OperationSheetProps {
	/** The operation shown; the sheet is closed while null. */
	operation: OperationResponse | null;
	handlers: OperationHandlers;
	onClose: () => void;
	/** Adds a link to the operation's month on the operations page. */
	withMonthLink?: boolean;
}

/**
 * Everything about one operation: a bottom sheet on a phone, a modal from
 * the `sm` breakpoint up.
 */
export function OperationSheet({
	operation,
	handlers,
	onClose,
	withMonthLink = false,
}: OperationSheetProps) {
	const { t, i18n } = useTranslation();
	const isDesktop = !useBelowBreakpoint("sm");
	// Keeps the last operation on screen while the sheet slides out.
	const [shown, setShown] = useState(operation);
	if (operation !== null && operation !== shown) setShown(operation);

	const amount = shown ? Number(shown.amount) : 0;
	const title = shown && (
		<Stack component="span" gap={2}>
			<Text component="span" size="sm" c="dimmed" fw={600}>
				{capitalize(
					formatIsoDate(shown.date, i18n.language, { dateStyle: "full" }),
				)}
			</Text>
			<Text
				component="span"
				ff={headingFont}
				fw={800}
				fz={32}
				lh={1.1}
				className="tabular-nums"
				c={amount > 0 ? budgetTypeTones.income.text : undefined}
			>
				{formatSignedAmount(amount)}
			</Text>
		</Stack>
	);
	const body = shown && (
		<SheetBody
			key={shown.id}
			op={shown}
			handlers={handlers}
			onClose={onClose}
			withMonthLink={withMonthLink}
		/>
	);
	const common = {
		opened: operation !== null,
		onClose,
		title,
		closeButtonProps: { size: 44, "aria-label": t("common.close") },
	};

	return isDesktop ? (
		<Modal {...common} size="md">
			{body}
		</Modal>
	) : (
		<Drawer
			{...common}
			position="bottom"
			size="auto"
			styles={{
				content: {
					borderTopLeftRadius: 24,
					borderTopRightRadius: 24,
					maxHeight: "calc(100dvh - 48px)",
				},
				body: {
					paddingBottom:
						"calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom))",
				},
			}}
		>
			{body}
		</Drawer>
	);
}

function SheetRow({
	first,
	children,
}: {
	first: boolean;
	children: ReactNode;
}) {
	return (
		<Box
			px="md"
			py="sm"
			style={first ? undefined : { borderTop: `1px solid ${palette.divider}` }}
		>
			{children}
		</Box>
	);
}

function SheetBody({
	op,
	handlers,
	onClose,
	withMonthLink,
}: {
	op: OperationResponse;
	handlers: OperationHandlers;
	onClose: () => void;
	withMonthLink: boolean;
}) {
	const { t, i18n } = useTranslation();
	const split = isSplit(op);
	const closeThen = (action: () => void) => () => {
		onClose();
		action();
	};
	const month = accountingMonth(op);

	return (
		<Stack gap="md">
			<Text
				fw={500}
				lh={1.4}
				bg={palette.surfaceMuted}
				px="md"
				py="sm"
				className="[overflow-wrap:anywhere]"
				style={{ border: `1px solid ${palette.border}`, borderRadius: 14 }}
			>
				{op.label}
			</Text>
			{op.ignored && <IgnoredNotice op={op} handlers={handlers} />}
			<Paper p={0} radius="lg" style={{ overflow: "hidden" }}>
				{split ? (
					<SheetRow first>
						<SplitParts op={op} handlers={handlers} />
					</SheetRow>
				) : (
					<>
						<SheetRow first>
							<CategoryField op={op} handlers={handlers} />
						</SheetRow>
						<SheetRow first={false}>
							<BudgetField
								op={op}
								handlers={handlers}
								onCreate={closeThen(() => handlers.onCreateBudget(op))}
							/>
						</SheetRow>
					</>
				)}
				<SheetRow first={false}>
					<EffectiveDateField
						op={op}
						onChange={(date) => handlers.onEditEffectiveDate(op, date)}
					/>
				</SheetRow>
			</Paper>
			<SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
				<Button
					variant="default"
					h={48}
					leftSection={<IconScissors size={18} />}
					onClick={closeThen(() => handlers.onSplit(op))}
				>
					{split
						? t("operations.split.editAction")
						: t("operations.split.action")}
				</Button>
				<Button
					variant="light"
					color={op.ignored ? "leaf" : "tangerine"}
					h={48}
					leftSection={
						op.ignored ? <IconEye size={18} /> : <IconEyeOff size={18} />
					}
					onClick={closeThen(() => handlers.onSetIgnored(op.id, !op.ignored))}
				>
					{op.ignored
						? t("operations.unignoreOperation")
						: t("operations.ignoreOperation")}
				</Button>
				{op.ignoreRuleId === null && (
					<Button
						variant="default"
						h={48}
						leftSection={<IconFilterOff size={18} />}
						onClick={closeThen(() => handlers.onIgnoreAlways(op))}
						style={{ gridColumn: "1 / -1" }}
					>
						{t("ignoreRules.always")}
					</Button>
				)}
			</SimpleGrid>
			{withMonthLink && (
				<Link
					to="/operations"
					search={month}
					onClick={onClose}
					className="flex min-h-[44px] items-center justify-center gap-2 font-semibold"
					style={{ color: "var(--mantine-color-forest-7)" }}
				>
					{t("operations.sheet.openMonth", {
						month: formatMonthYear(month, i18n.language),
					})}
					<IconArrowRight size={18} aria-hidden />
				</Link>
			)}
		</Stack>
	);
}

/** Why the operation is out of the totals: by hand, or by the rule that matched it. */
function IgnoredNotice({
	op,
	handlers,
}: {
	op: OperationResponse;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const describe = useDescribeIgnoreRule();
	const rule = handlers.ignoreRules.find((r) => r.id === op.ignoreRuleId);
	return (
		<Group gap={8} wrap="nowrap" c="dimmed" align="flex-start">
			<IconEyeOff size={16} style={{ flexShrink: 0, marginTop: 2 }} />
			<Stack gap={4}>
				<Text size="sm">
					{rule
						? t("ignoreRules.sheetIgnoredByRule", { rule: describe(rule) })
						: t("operations.sheet.ignored")}
				</Text>
				{rule && (
					<Link
						to="/settings"
						className="text-sm font-semibold"
						style={{ color: "var(--mantine-color-forest-7)" }}
					>
						{t("ignoreRules.seeRule")}
					</Link>
				)}
			</Stack>
		</Group>
	);
}

function CategoryField({
	op,
	handlers,
}: {
	op: OperationResponse;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const inherited =
		op.categoryId === null && op.effectiveCategoryId !== null
			? handlers.categories.find((c) => c.id === op.effectiveCategoryId)
			: undefined;

	if (handlers.categories.length === 0) {
		return (
			<Stack gap={2}>
				<Text size="sm" fw={600}>
					{t("operations.sheet.category")}
				</Text>
				<Text size="sm" c="dimmed">
					{t("operations.category.noneYet")}
				</Text>
			</Stack>
		);
	}
	return (
		<CategorySelect
			label={t("operations.sheet.category")}
			categories={handlers.categories}
			value={op.categoryId}
			onChange={(categoryId) => handlers.onSetCategory(op.id, categoryId)}
			clearable
			placeholder={
				inherited
					? t("operations.split.budgetCategory", { name: inherited.name })
					: t("operations.sheet.categoryPlaceholder")
			}
			leftSection={
				inherited ? <CategoryDot category={inherited} /> : <IconTag size={18} />
			}
		/>
	);
}

function BudgetField({
	op,
	handlers,
	onCreate,
}: {
	op: OperationResponse;
	handlers: OperationHandlers;
	onCreate: () => void;
}) {
	const { t } = useTranslation();
	const amount = Number(op.amount);
	const linkedId =
		op.budgetLink.type === "unlinked" ? null : op.budgetLink.budgetId;
	const options = handlers.budgets.filter(
		(b) => b.id === linkedId || budgetFitsAmount(b, amount),
	);

	return (
		<Stack gap="xs">
			<Select
				label={t("operations.sheet.budget")}
				data={options.map((b) => ({ value: b.id, label: b.label }))}
				value={linkedId}
				onChange={(budgetId) =>
					budgetId ? handlers.onLink(op.id, budgetId) : handlers.onUnlink(op.id)
				}
				placeholder={t("operations.sheet.unlinked")}
				description={
					op.budgetLink.type === "auto"
						? t("operations.sheet.autoLinked")
						: undefined
				}
				leftSection={<IconLink size={18} />}
				searchable
				nothingFoundMessage={t("common.noResults")}
				comboboxProps={{ withinPortal: true }}
			/>
			{linkedId === null ? (
				<Button
					variant="default"
					h={44}
					leftSection={<IconPlus size={16} />}
					onClick={onCreate}
					style={{ borderStyle: "dashed" }}
				>
					{t("operations.createBudget")}
				</Button>
			) : (
				<Button
					variant="subtle"
					color="gray"
					h={44}
					leftSection={<IconLinkOff size={16} />}
					onClick={() => handlers.onUnlink(op.id)}
				>
					{t("operations.unlinkBudget")}
				</Button>
			)}
		</Stack>
	);
}

function EffectiveDateField({
	op,
	onChange,
}: {
	op: OperationResponse;
	onChange: (effectiveDate: string | null) => void;
}) {
	const { t, i18n } = useTranslation();
	const [opened, setOpened] = useState(false);
	const pickerId = useId();
	const longDate = (iso: string) =>
		formatIsoDate(iso, i18n.language, { dateStyle: "long" });

	return (
		<Stack gap="xs">
			<UnstyledButton
				onClick={() => setOpened((o) => !o)}
				aria-expanded={opened}
				aria-controls={pickerId}
				className="flex min-h-[44px] w-full items-center gap-3"
			>
				<IconCalendar
					size={18}
					color="var(--mantine-color-forest-7)"
					style={{ flexShrink: 0 }}
				/>
				<Text fw={600} flex={1}>
					{t("operations.sheet.countOn")}
				</Text>
				<Text
					size="sm"
					c={op.effectiveDate ? "gold.8" : "dimmed"}
					fw={op.effectiveDate ? 600 : undefined}
					ta="right"
				>
					{op.effectiveDate
						? longDate(op.effectiveDate)
						: t("operations.sheet.bankDate", { date: longDate(op.date) })}
				</Text>
				<IconChevronDown
					size={18}
					color={palette.dimmed}
					style={{
						flexShrink: 0,
						transform: opened ? "rotate(180deg)" : undefined,
						transition: "transform 150ms ease",
					}}
				/>
			</UnstyledButton>
			{opened && (
				<Box id={pickerId}>
					<EffectiveDatePicker
						op={op}
						onChange={(date) => {
							onChange(date);
							setOpened(false);
						}}
					/>
				</Box>
			)}
		</Stack>
	);
}

function SplitParts({
	op,
	handlers,
}: {
	op: OperationResponse;
	handlers: OperationHandlers;
}) {
	const { t } = useTranslation();
	const budgetById = new Map(handlers.budgets.map((b) => [b.id, b]));
	const categoryById = new Map(handlers.categories.map((c) => [c.id, c]));

	return (
		<Stack gap={6}>
			<Text size="sm" fw={600}>
				{t("operations.sheet.parts")}
			</Text>
			<Stack component="ul" gap={6} m={0} p={0} style={{ listStyle: "none" }}>
				{operationEntries(op).map((entry) => {
					const category = entry.categoryId
						? categoryById.get(entry.categoryId)
						: undefined;
					const budget = entry.budgetId
						? budgetById.get(entry.budgetId)
						: undefined;
					return (
						<Group
							component="li"
							key={entry.key}
							justify="space-between"
							gap="sm"
							wrap="nowrap"
						>
							<Stack gap={0} miw={0}>
								<Text size="sm" fw={600}>
									{t("operations.split.partLabel", { n: entry.part?.index })}
									{" · "}
									<Text span inherit c="dimmed" fw={400}>
										{budget?.label ?? t("operations.sheet.unlinked")}
									</Text>
								</Text>
								{category && (
									<CategoryBadge
										category={category}
										inherited={entry.categoryFromBudget}
									/>
								)}
							</Stack>
							<Text
								fw={700}
								className="tabular-nums"
								style={{ whiteSpace: "nowrap" }}
							>
								{formatSignedAmount(entry.amount)}
							</Text>
						</Group>
					);
				})}
			</Stack>
		</Stack>
	);
}
