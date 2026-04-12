import {
	ActionIcon,
	Alert,
	Button,
	Card,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import {
	IconAlertCircle,
	IconCurrencyEuro,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApplyBudget, useCreateBudget, useUpdateBudget } from "@/lib/hooks";
import type {
	ApplyBudgetResponse,
	BudgetResponse,
	Recurrence,
	YearMonth,
} from "@/lib/types";

// ── YearMonth helpers ───────────────────────────────────────────────────────

function ymToDate(ym: YearMonth): Date {
	return new Date(ym.year, ym.month - 1);
}

function dateToYm(d: Date): YearMonth {
	return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// ── Amount formatting ───────────────────────────────────────────────────────

function getDecimalSeparator(locale: string): string {
	return locale.startsWith("fr") ? "," : ".";
}

function toDisplayAmount(raw: string, locale: string): string {
	if (raw === "" || raw === "-") return raw;
	const sep = getDecimalSeparator(locale);
	const num = Number.parseFloat(raw);
	if (Number.isNaN(num)) return raw;
	return num.toFixed(2).replace(".", sep);
}

function toRawAmount(display: string, locale: string): string {
	const sep = getDecimalSeparator(locale);
	return display.replace(sep, ".");
}

// ── ID counters ─────────────────────────────────────────────────────────────

let ruleIdCounter = 0;
let periodIdCounter = 0;

// ── Rule form ───────────────────────────────────────────────────────────────

interface RuleForm {
	id: number;
	patternType: "startsWith" | "endsWith" | "contains";
	patternValue: string;
	matchAmount: boolean;
}

function createRule(
	partial: Omit<RuleForm, "id"> = {
		patternType: "contains",
		patternValue: "",
		matchAmount: false,
	},
): RuleForm {
	return { ...partial, id: ++ruleIdCounter };
}

// ── Period form ─────────────────────────────────────────────────────────────

interface PeriodForm {
	id: number;
	start: Date;
	end: Date | null;
	amount: string;
	displayAmount: string;
}

function createPeriod(partial?: {
	start: Date;
	end: Date | null;
	amount: string;
	displayAmount: string;
}): PeriodForm {
	return {
		id: ++periodIdCounter,
		start: partial?.start ?? new Date(),
		end: partial?.end ?? null,
		amount: partial?.amount ?? "",
		displayAmount: partial?.displayAmount ?? "",
	};
}

// ── Budget form ─────────────────────────────────────────────────────────────

interface BudgetForm {
	label: string;
	budgetType: "expense" | "income" | "savings";
	kindType: "recurring" | "occasional";
	recurrence: Recurrence;
	periods: PeriodForm[];
	occasionalAmount: string;
	displayOccasionalAmount: string;
	occasionalMonth: Date;
	rules: RuleForm[];
}

function defaultForm(): BudgetForm {
	return {
		label: "",
		budgetType: "expense",
		kindType: "recurring",
		recurrence: "monthly",
		periods: [createPeriod()],
		occasionalAmount: "",
		displayOccasionalAmount: "",
		occasionalMonth: new Date(),
		rules: [],
	};
}

function formFromBudget(budget: BudgetResponse, locale: string): BudgetForm {
	const rules: RuleForm[] = budget.rules.map((r) =>
		createRule({
			patternType: r.labelPattern.type,
			patternValue: r.labelPattern.value,
			matchAmount: r.matchAmount,
		}),
	);

	if (budget.kind.type === "occasional") {
		return {
			label: budget.label,
			budgetType: budget.budgetType,
			kindType: "occasional",
			recurrence: "monthly",
			periods: [createPeriod()],
			occasionalAmount: budget.kind.amount,
			displayOccasionalAmount: toDisplayAmount(budget.kind.amount, locale),
			occasionalMonth: new Date(budget.kind.year, budget.kind.month - 1),
			rules,
		};
	}

	const closedPeriods: PeriodForm[] = budget.kind.closedPeriods.map((p) =>
		createPeriod({
			start: ymToDate(p.start),
			end: ymToDate(p.end),
			amount: p.amount,
			displayAmount: toDisplayAmount(p.amount, locale),
		}),
	);

	const cp = budget.kind.currentPeriod;
	const currentPeriod = createPeriod({
		start: ymToDate(cp.start),
		end: cp.end ? ymToDate(cp.end) : null,
		amount: cp.amount,
		displayAmount: toDisplayAmount(cp.amount, locale),
	});

	return {
		label: budget.label,
		budgetType: budget.budgetType,
		kindType: "recurring",
		recurrence: budget.kind.recurrence,
		periods: [...closedPeriods, currentPeriod],
		occasionalAmount: "",
		displayOccasionalAmount: "",
		occasionalMonth: new Date(),
		rules,
	};
}

function formToPayload(form: BudgetForm) {
	const rules = form.rules.map((r) => ({
		labelPattern: { type: r.patternType, value: r.patternValue },
		matchAmount: r.matchAmount,
	}));

	if (form.kindType === "occasional") {
		return {
			label: form.label,
			budgetType: form.budgetType,
			kind: {
				type: "occasional" as const,
				month: form.occasionalMonth.getMonth() + 1,
				year: form.occasionalMonth.getFullYear(),
				amount: form.occasionalAmount,
			},
			rules,
		};
	}

	const allPeriods = form.periods;
	const closedPeriods = allPeriods.slice(0, -1).map((p) => ({
		start: dateToYm(p.start),
		end: p.end ? dateToYm(p.end) : dateToYm(p.start),
		amount: p.amount,
	}));

	const last = allPeriods[allPeriods.length - 1];
	const currentPeriod = {
		start: dateToYm(last.start),
		end: last.end ? dateToYm(last.end) : null,
		amount: last.amount,
	};

	return {
		label: form.label,
		budgetType: form.budgetType,
		kind: {
			type: "recurring" as const,
			recurrence: form.recurrence,
			closedPeriods,
			currentPeriod,
		},
		rules,
	};
}

// ── Period overlap validation ───────────────────────────────────────────────

function periodsOverlap(periods: PeriodForm[]): boolean {
	if (periods.length < 2) return false;

	// Convert each period to a [startValue, endValue] range for comparison.
	// YearMonth values are encoded as year*12+month so they can be compared as integers.
	const ranges = periods.map((p) => {
		const start = p.start.getFullYear() * 12 + p.start.getMonth();
		const end =
			p.end !== null
				? p.end.getFullYear() * 12 + p.end.getMonth()
				: Number.MAX_SAFE_INTEGER;
		return { start, end };
	});

	for (let i = 0; i < ranges.length; i++) {
		for (let j = i + 1; j < ranges.length; j++) {
			const a = ranges[i];
			const b = ranges[j];
			if (a.start <= b.end && b.start <= a.end) {
				return true;
			}
		}
	}
	return false;
}

// ── Locale-aware amount input ───────────────────────────────────────────────

function AmountInput({
	label,
	displayValue,
	onChange,
	locale,
	required,
}: {
	label: string;
	displayValue: string;
	onChange: (raw: string, display: string) => void;
	locale: string;
	required?: boolean;
}) {
	return (
		<TextInput
			label={label}
			value={displayValue}
			onChange={(e) => {
				const display = e.currentTarget.value;
				onChange(toRawAmount(display, locale), display);
			}}
			onBlur={() => {
				const raw = toRawAmount(displayValue, locale);
				const num = Number.parseFloat(raw);
				if (!Number.isNaN(num)) {
					onChange(num.toFixed(2), toDisplayAmount(raw, locale));
				}
			}}
			required={required}
		/>
	);
}

// ── Date input ──────────────────────────────────────────────────────────────

function MonthInput({
	label,
	value,
	onChange,
	clearable,
}: {
	label: string;
	value: Date | null;
	onChange: (d: Date | null) => void;
	clearable?: boolean;
}) {
	return (
		<MonthPickerInput
			label={label}
			value={value}
			onChange={(date) => onChange(date ? new Date(date) : null)}
			clearable={clearable}
		/>
	);
}

// ── Main component ──────────────────────────────────────────────────────────

export interface BudgetInitialValues {
	amount?: string;
	label?: string;
	rules?: {
		patternType: "startsWith" | "endsWith" | "contains";
		patternValue: string;
	}[];
}

export function BudgetModal({
	opened,
	onClose,
	budget,
	initialValues,
}: {
	opened: boolean;
	onClose: () => void;
	budget: BudgetResponse | null;
	initialValues?: BudgetInitialValues;
}) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	const createBudget = useCreateBudget();
	const updateBudget = useUpdateBudget();
	const applyBudget = useApplyBudget();
	const [form, setForm] = useState<BudgetForm>(defaultForm);
	const [error, setError] = useState<string | null>(null);
	const [applyPrompt, setApplyPrompt] = useState<{
		budgetId: string;
		result: ApplyBudgetResponse | null;
	} | null>(null);

	const isEdit = budget !== null;

	const initForm = useCallback(() => {
		if (budget) {
			setForm(formFromBudget(budget, locale));
		} else {
			const base = defaultForm();
			if (initialValues) {
				if (initialValues.label) base.label = initialValues.label;
				if (initialValues.amount) {
					base.periods = [
						createPeriod({
							start: new Date(),
							end: null,
							amount: initialValues.amount,
							displayAmount: toDisplayAmount(initialValues.amount, locale),
						}),
					];
				}
				if (initialValues.rules) {
					base.rules = initialValues.rules.map((r) =>
						createRule({
							patternType: r.patternType,
							patternValue: r.patternValue,
							matchAmount: false,
						}),
					);
				}
			}
			setForm(base);
		}
		setError(null);
		setApplyPrompt(null);
	}, [budget, initialValues, locale]);

	useEffect(() => {
		if (opened) initForm();
	}, [opened, initForm]);

	function update(patch: Partial<BudgetForm>) {
		setForm((prev) => ({ ...prev, ...patch }));
	}

	// ── Period management ─────────────────────────────────────────────────

	function updatePeriod(index: number, patch: Partial<PeriodForm>) {
		setForm((prev) => ({
			...prev,
			periods: prev.periods.map((p, i) =>
				i === index ? { ...p, ...patch } : p,
			),
		}));
	}

	function addPeriod() {
		setForm((prev) => ({
			...prev,
			periods: [...prev.periods, createPeriod()],
		}));
	}

	function removePeriod(index: number) {
		setForm((prev) => ({
			...prev,
			periods: prev.periods.filter((_, i) => i !== index),
		}));
	}

	// ── Rule management ───────────────────────────────────────────────────

	function updateRule(index: number, patch: Partial<RuleForm>) {
		setForm((prev) => ({
			...prev,
			rules: prev.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
		}));
	}

	function addRule() {
		setForm((prev) => ({
			...prev,
			rules: [...prev.rules, createRule()],
		}));
	}

	function removeRule(index: number) {
		setForm((prev) => ({
			...prev,
			rules: prev.rules.filter((_, i) => i !== index),
		}));
	}

	// ── Submit ─────────────────────────────────────────────────────────────

	async function handleSubmit() {
		setError(null);
		const payload = formToPayload(form);
		try {
			if (isEdit) {
				await updateBudget.mutateAsync({ id: budget.id, body: payload });
				onClose();
			} else {
				const created = await createBudget.mutateAsync(payload);
				if (form.rules.length > 0) {
					setApplyPrompt({ budgetId: created.id, result: null });
				} else {
					onClose();
				}
			}
		} catch {
			setError(t("budgets.saveError"));
		}
	}

	async function handleApply(force: boolean) {
		if (!applyPrompt) return;
		setError(null);
		try {
			const result = await applyBudget.mutateAsync({
				id: applyPrompt.budgetId,
				force,
			});
			setApplyPrompt((prev) => (prev ? { ...prev, result } : null));
		} catch {
			setError(t("budgets.applyError"));
		}
	}

	const isLoading =
		createBudget.isPending || updateBudget.isPending || applyBudget.isPending;

	const hasAmount =
		form.kindType === "occasional"
			? form.occasionalAmount !== ""
			: form.periods.some((p) => p.amount !== "");

	const hasOverlap =
		form.kindType === "recurring" && periodsOverlap(form.periods);

	const modalTitle = applyPrompt
		? t("budgets.applyRulesTitle")
		: isEdit
			? t("budgets.editTitle")
			: t("budgets.createTitle");

	if (applyPrompt) {
		return (
			<Modal opened={opened} onClose={onClose} title={modalTitle} size="md">
				<Stack>
					{applyPrompt.result ? (
						<>
							<Alert color="green" icon={<IconAlertCircle size={16} />}>
								{t("budgets.applyResult", {
									updated: applyPrompt.result.updated,
									skipped: applyPrompt.result.skipped,
								})}
							</Alert>
							<Group justify="flex-end">
								<Button onClick={onClose}>{t("common.close")}</Button>
							</Group>
						</>
					) : (
						<>
							<Text>{t("budgets.applyForcePrompt")}</Text>
							{error && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{error}
								</Alert>
							)}
							<Group justify="flex-end">
								<Button variant="subtle" onClick={onClose}>
									{t("common.skip")}
								</Button>
								<Button
									variant="outline"
									onClick={() => handleApply(false)}
									loading={applyBudget.isPending}
								>
									{t("budgets.applySkipManual")}
								</Button>
								<Button
									onClick={() => handleApply(true)}
									loading={applyBudget.isPending}
								>
									{t("budgets.applyForceManual")}
								</Button>
							</Group>
						</>
					)}
				</Stack>
			</Modal>
		);
	}

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={modalTitle}
			size="lg"
			fullScreen={false}
		>
			<Stack>
				<TextInput
					label={t("budgets.fields.label")}
					value={form.label}
					onChange={(e) => update({ label: e.currentTarget.value })}
					required
				/>

				<Select
					label={t("budgets.fields.budgetType")}
					value={form.budgetType}
					onChange={(v) =>
						update({
							budgetType: (v as "expense" | "income" | "savings") ?? "expense",
						})
					}
					data={[
						{ value: "expense", label: t("budgets.types.expense") },
						{ value: "income", label: t("budgets.types.income") },
						{ value: "savings", label: t("budgets.types.savings") },
					]}
				/>

				<Select
					label={t("budgets.fields.kind")}
					value={form.kindType}
					onChange={(v) =>
						update({
							kindType: (v as "recurring" | "occasional") ?? "recurring",
						})
					}
					data={[
						{ value: "recurring", label: t("budgets.kinds.recurring") },
						{ value: "occasional", label: t("budgets.kinds.occasional") },
					]}
				/>

				{form.kindType === "recurring" && (
					<Select
						label={t("budgets.fields.recurrence")}
						value={form.recurrence}
						onChange={(v) =>
							update({
								recurrence:
									(v as "weekly" | "monthly" | "quarterly" | "yearly") ??
									"monthly",
							})
						}
						data={[
							{ value: "weekly", label: t("budgets.recurrences.weekly") },
							{
								value: "monthly",
								label: t("budgets.recurrences.monthly"),
							},
							{
								value: "quarterly",
								label: t("budgets.recurrences.quarterly"),
							},
							{ value: "yearly", label: t("budgets.recurrences.yearly") },
						]}
					/>
				)}

				{form.kindType === "recurring" && (
					<>
						<Group justify="space-between">
							<Text fw={600}>{t("budgets.fields.periods")}</Text>
							<ActionIcon
								variant="subtle"
								color="green"
								onClick={addPeriod}
								aria-label={t("budgets.addPeriod")}
							>
								<IconPlus size={16} />
							</ActionIcon>
						</Group>

						{form.periods.map((period, index) => {
							const isLast = index === form.periods.length - 1;
							return (
								<Card key={period.id} padding="sm" radius="sm" withBorder>
									<Stack gap="xs">
										<Group justify="space-between" align="center">
											<Text size="sm" fw={500} c="dimmed">
												{isLast
													? t("budgets.periodCurrent")
													: t("budgets.periodClosed", { n: index + 1 })}
											</Text>
											{form.periods.length > 1 && (
												<ActionIcon
													variant="subtle"
													color="red"
													size="sm"
													onClick={() => removePeriod(index)}
													aria-label={t("common.delete")}
												>
													<IconTrash size={14} />
												</ActionIcon>
											)}
										</Group>

										<Group grow gap="xs" wrap="wrap">
											<MonthInput
												label={t("budgets.fields.periodStart")}
												value={period.start}
												onChange={(d) => {
													if (d) updatePeriod(index, { start: d });
												}}
											/>
											<MonthInput
												label={t("budgets.fields.periodEnd")}
												value={period.end}
												onChange={(d) => updatePeriod(index, { end: d })}
												clearable={isLast}
											/>
										</Group>

										<AmountInput
											label={t("budgets.fields.amount")}
											displayValue={period.displayAmount}
											onChange={(raw, display) =>
												updatePeriod(index, {
													amount: raw,
													displayAmount: display,
												})
											}
											locale={locale}
											required
										/>
									</Stack>
								</Card>
							);
						})}
					</>
				)}

				{form.kindType === "occasional" && (
					<>
						<AmountInput
							label={t("budgets.fields.amount")}
							displayValue={form.displayOccasionalAmount}
							onChange={(raw, display) =>
								update({
									occasionalAmount: raw,
									displayOccasionalAmount: display,
								})
							}
							locale={locale}
							required
						/>
						<MonthPickerInput
							label={t("budgets.fields.occasionalMonth")}
							value={form.occasionalMonth}
							onChange={(date) => {
								if (date) update({ occasionalMonth: new Date(date) });
							}}
						/>
					</>
				)}

				<Group justify="space-between">
					<Text fw={600}>{t("budgets.fields.rules")}</Text>
					<ActionIcon
						variant="subtle"
						color="green"
						onClick={addRule}
						aria-label={t("budgets.addRule")}
					>
						<IconPlus size={16} />
					</ActionIcon>
				</Group>

				{form.rules.map((rule, index) => (
					<Group key={rule.id} align="flex-end" wrap="wrap" gap="xs">
						<Select
							label={t("budgets.fields.patternType")}
							value={rule.patternType}
							onChange={(v) =>
								updateRule(index, {
									patternType:
										(v as "startsWith" | "endsWith" | "contains") ?? "contains",
								})
							}
							data={[
								{
									value: "contains",
									label: t("budgets.patterns.contains"),
								},
								{
									value: "startsWith",
									label: t("budgets.patterns.startsWith"),
								},
								{
									value: "endsWith",
									label: t("budgets.patterns.endsWith"),
								},
							]}
							style={{ flex: 1 }}
						/>
						<TextInput
							label={t("budgets.fields.patternValue")}
							value={rule.patternValue}
							onChange={(e) =>
								updateRule(index, {
									patternValue: e.currentTarget.value,
								})
							}
							style={{ flex: 2 }}
						/>
						<Tooltip label={t("budgets.fields.matchAmountTooltip")}>
							<ActionIcon
								variant={rule.matchAmount ? "filled" : "subtle"}
								color={rule.matchAmount ? "green" : "gray"}
								onClick={() =>
									updateRule(index, {
										matchAmount: !rule.matchAmount,
									})
								}
								aria-label={t("budgets.fields.matchAmountTooltip")}
							>
								<IconCurrencyEuro size={16} />
							</ActionIcon>
						</Tooltip>
						<ActionIcon
							variant="subtle"
							color="red"
							onClick={() => removeRule(index)}
							aria-label={t("common.delete")}
						>
							<IconTrash size={16} />
						</ActionIcon>
					</Group>
				))}

				{hasOverlap && (
					<Alert color="orange" icon={<IconAlertCircle size={16} />}>
						{t("budgets.periodsOverlap")}
					</Alert>
				)}

				{error && (
					<Alert color="red" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}

				<Group justify="flex-end">
					<Button variant="subtle" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={handleSubmit}
						loading={isLoading}
						disabled={!form.label || !hasAmount || hasOverlap}
					>
						{t("common.save")}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
