import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Group,
	Modal,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
	IconAlertCircle,
	IconArrowsSplit2,
	IconCheck,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	centsToDecimal,
	decimalToCents,
	formatAmount,
	formatSignedAmount,
	parseCents,
	toDisplayAmount,
} from "@/lib/format";
import { useSplitOperation, useUnsplitOperation } from "@/lib/hooks";
import { isSplit } from "@/lib/operation-parts";
import { budgetTypeTones } from "@/lib/tones";
import type {
	BudgetResponse,
	OperationResponse,
	OperationSplitRequest,
} from "@/lib/types";
import { headingFont, palette } from "@/theme";

const MIN_PARTS = 2;

let partIdCounter = 0;

interface PartForm {
	id: number;
	display: string;
	budgetId: string | null;
}

function createPart(display = "", budgetId: string | null = null): PartForm {
	return { id: ++partIdCounter, display, budgetId };
}

function initialParts(op: OperationResponse, locale: string): PartForm[] {
	if (isSplit(op)) {
		return op.splits.map((split) =>
			createPart(
				toDisplayAmount(
					centsToDecimal(Math.abs(decimalToCents(split.amount))),
					locale,
				),
				split.budgetId,
			),
		);
	}
	const currentBudget =
		op.budgetLink.type === "unlinked" ? null : op.budgetLink.budgetId;
	return [createPart("", currentBudget), createPart()];
}

/** Budgets whose type fits the operation's sign come first, then the rest. */
function budgetOptions(budgets: BudgetResponse[], isIncome: boolean) {
	const fits = (b: BudgetResponse) =>
		isIncome ? b.budgetType === "income" : b.budgetType !== "income";
	return [...budgets]
		.sort(
			(a, b) =>
				Number(fits(b)) - Number(fits(a)) || a.label.localeCompare(b.label),
		)
		.map((b) => ({ value: b.id, label: b.label }));
}

function formatOperationDate(date: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "long",
		timeZone: "UTC",
	}).format(new Date(date));
}

export function SplitOperationModal({
	operation,
	budgets,
	onClose,
}: {
	operation: OperationResponse | null;
	budgets: BudgetResponse[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const isMobile = useMediaQuery("(max-width: 36em)") ?? false;

	return (
		<Modal
			opened={operation !== null}
			onClose={onClose}
			title={t("operations.split.title")}
			size="lg"
			fullScreen={isMobile}
		>
			{operation && (
				<SplitForm
					key={operation.id}
					operation={operation}
					budgets={budgets}
					onClose={onClose}
				/>
			)}
		</Modal>
	);
}

function SplitForm({
	operation,
	budgets,
	onClose,
}: {
	operation: OperationResponse;
	budgets: BudgetResponse[];
	onClose: () => void;
}) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	const splitOperation = useSplitOperation();
	const unsplitOperation = useUnsplitOperation();
	const [parts, setParts] = useState<PartForm[]>(() =>
		initialParts(operation, locale),
	);
	const [error, setError] = useState<string | null>(null);

	const totalCents = decimalToCents(operation.amount);
	const sign = totalCents < 0 ? -1 : 1;
	const partCents = parts.map((p) => parseCents(p.display));
	const allocated = partCents.reduce<number>((s, c) => s + (c ?? 0), 0);
	const remainder = Math.abs(totalCents) - allocated;
	const balanced = remainder === 0;
	const canSave =
		parts.length >= MIN_PARTS &&
		balanced &&
		partCents.every((c) => c !== null && c > 0);

	const lastIndex = parts.length - 1;
	const lastCents = partCents[lastIndex] ?? 0;
	const canFillRemainder = remainder !== 0 && lastCents + remainder > 0;

	const options = budgetOptions(budgets, sign > 0);
	const tone = balanced ? budgetTypeTones.income : budgetTypeTones.expense;

	function updatePart(index: number, patch: Partial<PartForm>) {
		setParts((prev) =>
			prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
		);
	}

	function fillRemainder() {
		updatePart(lastIndex, {
			display: toDisplayAmount(centsToDecimal(lastCents + remainder), locale),
		});
	}

	async function handleSave() {
		setError(null);
		const splits: OperationSplitRequest[] = parts.map((p, i) => ({
			amount: centsToDecimal(sign * (partCents[i] ?? 0)),
			budgetId: p.budgetId,
		}));
		try {
			await splitOperation.mutateAsync({ opId: operation.id, splits });
			onClose();
		} catch {
			setError(t("operations.split.saveError"));
		}
	}

	async function handleUnsplit() {
		setError(null);
		try {
			await unsplitOperation.mutateAsync(operation.id);
			onClose();
		} catch {
			setError(t("operations.split.unsplitError"));
		}
	}

	return (
		<Stack gap="md">
			<Paper radius="lg" p="md" bg={palette.surfaceMuted}>
				<Group justify="space-between" align="center" wrap="nowrap" gap="sm">
					<Stack gap={2} miw={0}>
						<Text fw={700} truncate title={operation.label}>
							{operation.label}
						</Text>
						<Text size="sm" c="dimmed">
							{formatOperationDate(
								operation.effectiveDate ?? operation.date,
								locale,
							)}
						</Text>
					</Stack>
					<Stack gap={4} align="flex-end">
						<Text
							ff={headingFont}
							fz={22}
							fw={700}
							className="tabular-nums"
							style={{ whiteSpace: "nowrap" }}
							c={sign > 0 ? budgetTypeTones.income.text : undefined}
						>
							{formatSignedAmount(totalCents / 100)}
						</Text>
						{isSplit(operation) && (
							<Badge size="sm" color="forest" tt="none">
								{t("operations.split.splitInto", {
									count: operation.splits.length,
								})}
							</Badge>
						)}
					</Stack>
				</Group>
			</Paper>

			{parts.map((part, index) => {
				const partLabel = t("operations.split.partLabel", { n: index + 1 });
				return (
					<Paper key={part.id} radius="lg" p="md" withBorder>
						<Stack gap="xs">
							<Group justify="space-between" align="center">
								<Text size="sm" fw={600} c="dimmed">
									{partLabel}
								</Text>
								{parts.length > MIN_PARTS && (
									<Tooltip label={t("operations.split.removePart")}>
										<ActionIcon
											variant="subtle"
											color="gray"
											size={44}
											radius="md"
											onClick={() =>
												setParts((prev) => prev.filter((_, i) => i !== index))
											}
											aria-label={`${t("operations.split.removePart")} (${partLabel})`}
										>
											<IconTrash size={18} />
										</ActionIcon>
									</Tooltip>
								)}
							</Group>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
								<TextInput
									label={t("operations.split.amount")}
									aria-label={`${t("operations.split.amount")} (${partLabel})`}
									inputMode="decimal"
									placeholder={toDisplayAmount("0", locale)}
									leftSection={
										<Text fw={700} c="dimmed" aria-hidden>
											{sign < 0 ? "−" : "+"}
										</Text>
									}
									rightSection={<Text c="dimmed">€</Text>}
									value={part.display}
									error={
										part.display !== "" && partCents[index] === null
											? t("operations.split.invalidAmount")
											: undefined
									}
									onChange={(e) =>
										updatePart(index, { display: e.currentTarget.value })
									}
									onBlur={() => {
										const cents = partCents[index];
										if (cents !== null && cents !== undefined) {
											updatePart(index, {
												display: toDisplayAmount(centsToDecimal(cents), locale),
											});
										}
									}}
								/>
								<Select
									label={t("operations.split.budget")}
									aria-label={`${t("operations.split.budget")} (${partLabel})`}
									placeholder={t("operations.split.noBudget")}
									data={options}
									value={part.budgetId}
									onChange={(value) => updatePart(index, { budgetId: value })}
									searchable
									clearable
									nothingFoundMessage={t("common.noResults")}
									comboboxProps={{ withinPortal: true }}
								/>
							</div>
						</Stack>
					</Paper>
				);
			})}

			<Button
				variant="light"
				leftSection={<IconPlus size={18} />}
				onClick={() => setParts((prev) => [...prev, createPart()])}
				className="self-start"
			>
				{t("operations.split.addPart")}
			</Button>

			<Paper
				radius="lg"
				p="md"
				bg={balanced ? "leaf.0" : "tangerine.0"}
				withBorder={false}
			>
				<Group justify="space-between" align="center" gap="sm">
					<Group gap={8} wrap="nowrap">
						{balanced ? (
							<IconCheck size={18} color={tone.text} />
						) : (
							<IconAlertCircle size={18} color={tone.text} />
						)}
						<Text fw={700} c={tone.text} className="tabular-nums" role="status">
							{t("operations.split.remainder", {
								amount: formatAmount(remainder / 100),
							})}
						</Text>
					</Group>
					<Button
						variant="subtle"
						leftSection={<IconArrowsSplit2 size={18} />}
						disabled={!canFillRemainder}
						onClick={fillRemainder}
					>
						{t("operations.split.fillRemainder")}
					</Button>
				</Group>
			</Paper>

			{error && (
				<Alert color="tangerine" icon={<IconAlertCircle size={18} />}>
					{error}
				</Alert>
			)}

			<Group justify="space-between" gap="sm" mt="xs" wrap="wrap">
				{isSplit(operation) ? (
					<Button
						variant="subtle"
						color="tangerine"
						c="tangerine.8"
						onClick={handleUnsplit}
						loading={unsplitOperation.isPending}
					>
						{t("operations.split.unsplit")}
					</Button>
				) : (
					<span />
				)}
				<Group gap="sm" ml="auto">
					<Button variant="default" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={handleSave}
						loading={splitOperation.isPending}
						disabled={!canSave}
					>
						{t("common.save")}
					</Button>
				</Group>
			</Group>
		</Stack>
	);
}
