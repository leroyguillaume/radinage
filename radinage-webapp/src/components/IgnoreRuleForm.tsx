import {
	Alert,
	Button,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { LabelPatternFields } from "@/components/LabelPatternFields";
import { ApiError } from "@/lib/api";
import {
	centsToDecimal,
	decimalToCents,
	formatAmount,
	parseCents,
	toDisplayAmount,
} from "@/lib/format";
import { useApplyIgnoreRule, useSaveIgnoreRule } from "@/lib/hooks";
import type {
	ApplyIgnoreRuleResponse,
	IgnoreRuleResponse,
	LabelPattern,
} from "@/lib/types";

/** "Contains “VIR INTERNE” · amount €250.00", as shown wherever a rule is named. */
export function useDescribeIgnoreRule(): (rule: IgnoreRuleResponse) => string {
	const { t } = useTranslation();
	return (rule) => {
		const pattern = t("ignoreRules.pattern", {
			type: t(`rules.patterns.${rule.labelPattern.type}`),
			value: rule.labelPattern.value,
		});
		return rule.amount === null
			? pattern
			: `${pattern} · ${t("ignoreRules.amountSummary", { amount: formatAmount(rule.amount) })}`;
	};
}

/** Creates a rule, or edits `rule`; `initialPattern` pre-fills a new one. */
export function IgnoreRuleForm({
	rule,
	initialPattern,
	onSaved,
	onCancel,
}: {
	rule: IgnoreRuleResponse | null;
	initialPattern?: LabelPattern;
	onSaved: (rule: IgnoreRuleResponse, created: boolean) => void;
	onCancel: () => void;
}) {
	const { t, i18n } = useTranslation();
	const save = useSaveIgnoreRule();
	const start = rule?.labelPattern ?? initialPattern;
	const [patternType, setPatternType] = useState<LabelPattern["type"]>(
		start?.type ?? "contains",
	);
	const [value, setValue] = useState(start?.value ?? "");
	const [amount, setAmount] = useState(
		rule?.amount
			? toDisplayAmount(
					centsToDecimal(decimalToCents(rule.amount)),
					i18n.language,
				)
			: "",
	);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const trimmed = value.trim();
		if (trimmed === "") {
			setError(t("ignoreRules.errorValue"));
			return;
		}
		const cents = amount.trim() === "" ? null : parseCents(amount);
		if (cents === 0 || (cents === null && amount.trim() !== "")) {
			setError(t("ignoreRules.errorAmount"));
			return;
		}
		try {
			const saved = await save.mutateAsync({
				id: rule?.id,
				body: {
					labelPattern: { type: patternType, value: trimmed },
					amount: cents === null ? null : centsToDecimal(cents),
				},
			});
			onSaved(saved, rule === null);
		} catch (err) {
			setError(
				err instanceof ApiError && err.status === 409
					? t("ignoreRules.errorLimit")
					: t("ignoreRules.saveError"),
			);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="sm">
				<Group gap="sm" align="flex-end" wrap="wrap">
					<LabelPatternFields
						type={patternType}
						value={value}
						onTypeChange={setPatternType}
						onValueChange={setValue}
					/>
				</Group>
				<TextInput
					label={t("ignoreRules.amount")}
					description={t("ignoreRules.amountHint")}
					placeholder={t("ignoreRules.amountPlaceholder")}
					value={amount}
					onChange={(e) => setAmount(e.currentTarget.value)}
					inputMode="decimal"
					size="md"
				/>
				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}
				<Group grow>
					<Button variant="default" h={44} onClick={onCancel}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" h={44} loading={save.isPending}>
						{rule === null ? t("ignoreRules.create") : t("common.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

/** Offers to ignore the existing operations a new rule matches, then tells what it did. */
export function ApplyIgnoreRulePrompt({
	rule,
	onDone,
}: {
	rule: IgnoreRuleResponse;
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const describe = useDescribeIgnoreRule();
	const apply = useApplyIgnoreRule();
	const [result, setResult] = useState<ApplyIgnoreRuleResponse | null>(null);
	const [failed, setFailed] = useState(false);

	async function handleApply() {
		setFailed(false);
		try {
			setResult(await apply.mutateAsync(rule.id));
		} catch {
			setFailed(true);
		}
	}

	return (
		<Stack gap="sm">
			<Text size="sm" fw={600} c="forest.8">
				{describe(rule)}
			</Text>
			{result ? (
				<>
					<Alert color="leaf" icon={<IconCheck size={16} />}>
						{t("ignoreRules.applyResult", {
							ignored: result.ignored,
							alreadyIgnored: result.alreadyIgnored,
						})}
					</Alert>
					<Button h={44} onClick={onDone}>
						{t("common.close")}
					</Button>
				</>
			) : (
				<>
					<Text size="sm">{t("ignoreRules.applyPrompt")}</Text>
					{failed && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{t("ignoreRules.applyError")}
						</Alert>
					)}
					<Group grow>
						<Button variant="default" h={44} onClick={onDone}>
							{t("ignoreRules.later")}
						</Button>
						<Button h={44} loading={apply.isPending} onClick={handleApply}>
							{t("ignoreRules.apply")}
						</Button>
					</Group>
				</>
			)}
		</Stack>
	);
}

/** A new rule pre-filled from an operation, then the offer to apply it. */
export function IgnoreRuleModal({
	initialPattern,
	onClose,
}: {
	/** The modal is open while a pattern is given. */
	initialPattern: LabelPattern | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [created, setCreated] = useState<IgnoreRuleResponse | null>(null);
	const close = () => {
		setCreated(null);
		onClose();
	};

	return (
		<Modal
			opened={initialPattern !== null}
			onClose={close}
			title={
				created ? t("ignoreRules.applyTitle") : t("ignoreRules.createTitle")
			}
		>
			{created ? (
				<ApplyIgnoreRulePrompt rule={created} onDone={close} />
			) : (
				initialPattern && (
					<IgnoreRuleForm
						rule={null}
						initialPattern={initialPattern}
						onSaved={setCreated}
						onCancel={close}
					/>
				)
			)}
		</Modal>
	);
}
