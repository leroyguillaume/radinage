import {
	Alert,
	Button,
	Group,
	Modal,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconArrowsExchange,
	IconCheck,
	IconInfoCircle,
} from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { LabelPatternFields } from "@/components/LabelPatternFields";
import { ApiError } from "@/lib/api";
import {
	useAccounts,
	useApplyTransferRule,
	useSaveTransferRule,
} from "@/lib/hooks";
import type {
	ApplyTransferRuleResponse,
	LabelPattern,
	TransferRuleResponse,
} from "@/lib/types";

/** "Contains “VIR LIVRET A”", as shown wherever a side of a transfer rule is named. */
export function useDescribePattern(): (pattern: LabelPattern) => string {
	const { t } = useTranslation();
	return (pattern) =>
		t("ignoreRules.pattern", {
			type: t(`rules.patterns.${pattern.type}`),
			value: pattern.value,
		});
}

/** What a new transfer rule starts from: its account, and possibly patterns and the other account. */
export interface TransferRuleDraft {
	accountId: string;
	counterpartAccountId?: string;
	labelPattern?: LabelPattern;
	counterpartLabelPattern?: LabelPattern;
}

/** The criterion and value of one side's label, under the name of its account. */
function SidePattern({
	account,
	pattern,
	onChange,
}: {
	account: string;
	pattern: LabelPattern;
	onChange: (pattern: LabelPattern) => void;
}) {
	const { t } = useTranslation();
	return (
		<Stack gap={4}>
			<Text size="sm" fw={600}>
				{t("transfers.rules.labelOn", { account })}
			</Text>
			<Group gap="sm" align="flex-end" wrap="wrap">
				<LabelPatternFields
					type={pattern.type}
					value={pattern.value}
					onTypeChange={(type) => onChange({ ...pattern, type })}
					onValueChange={(value) => onChange({ ...pattern, value })}
				/>
			</Group>
		</Stack>
	);
}

/** Creates a rule on `draft.accountId`, or edits `rule`. */
export function TransferRuleForm({
	rule,
	draft,
	onSaved,
	onCancel,
}: {
	rule: TransferRuleResponse | null;
	draft: TransferRuleDraft;
	onSaved: (rule: TransferRuleResponse, created: boolean) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const save = useSaveTransferRule();
	const accounts = useAccounts().data ?? [];
	const accountId = rule?.accountId ?? draft.accountId;
	const [pattern, setPattern] = useState<LabelPattern>(
		rule?.labelPattern ?? draft.labelPattern ?? { type: "contains", value: "" },
	);
	const [counterpartPattern, setCounterpartPattern] = useState<LabelPattern>(
		rule?.counterpartLabelPattern ??
			draft.counterpartLabelPattern ?? { type: "contains", value: "" },
	);
	const [counterpart, setCounterpart] = useState<string | null>(
		rule?.counterpartAccountId ?? draft.counterpartAccountId ?? null,
	);
	const [error, setError] = useState<string | null>(null);
	const account = accounts.find((a) => a.id === accountId);
	const other = accounts.find((a) => a.id === counterpart);
	// Only an account whose statements are imported has another side to recognize.
	const twoSided = other?.receivesOperations ?? false;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const value = pattern.value.trim();
		const counterpartValue = counterpartPattern.value.trim();
		if (value === "" || (twoSided && counterpartValue === "")) {
			setError(t("transfers.rules.errorValue"));
			return;
		}
		if (counterpart === null) {
			setError(t("transfers.rules.errorAccount"));
			return;
		}
		try {
			const saved = await save.mutateAsync({
				id: rule?.id,
				body: {
					accountId,
					counterpartAccountId: counterpart,
					labelPattern: { ...pattern, value },
					counterpartLabelPattern: twoSided
						? { ...counterpartPattern, value: counterpartValue }
						: null,
				},
			});
			onSaved(saved, rule === null);
		} catch (err) {
			setError(
				err instanceof ApiError && err.status === 409
					? t("transfers.rules.errorLimit")
					: t("transfers.rules.saveError"),
			);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="sm">
				<SidePattern
					account={account?.name ?? ""}
					pattern={pattern}
					onChange={setPattern}
				/>
				<Select
					label={t("transfers.rules.otherAccount")}
					placeholder={t("transfers.accountPlaceholder")}
					data={accounts
						.filter((a) => a.id !== accountId)
						.map((a) => ({ value: a.id, label: a.name }))}
					value={counterpart}
					onChange={setCounterpart}
					leftSection={<IconArrowsExchange size={18} />}
					comboboxProps={{ withinPortal: true }}
				/>
				{other && twoSided && (
					<SidePattern
						account={other.name}
						pattern={counterpartPattern}
						onChange={setCounterpartPattern}
					/>
				)}
				<Group gap={8} wrap="nowrap" align="flex-start" c="dimmed">
					<IconInfoCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
					<Text size="sm">
						{t(
							twoSided
								? "transfers.rules.twoSidedHint"
								: "transfers.rules.hint",
						)}
					</Text>
				</Group>
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
						{rule === null ? t("transfers.rules.create") : t("common.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

/** Offers to make transfers of the existing operations a new rule matches, then tells what it did. */
export function ApplyTransferRulePrompt({
	rule,
	onDone,
}: {
	rule: TransferRuleResponse;
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const describe = useDescribePattern();
	const apply = useApplyTransferRule();
	const [result, setResult] = useState<ApplyTransferRuleResponse | null>(null);
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
				{describe(rule.labelPattern)}
			</Text>
			{result ? (
				<>
					<Alert color="leaf" icon={<IconCheck size={16} />}>
						{t("transfers.rules.applyResult", {
							transferred: result.transferred,
							skipped: result.skipped,
						})}
					</Alert>
					<Button h={44} onClick={onDone}>
						{t("common.close")}
					</Button>
				</>
			) : (
				<>
					<Text size="sm">{t("transfers.rules.applyPrompt")}</Text>
					{failed && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{t("transfers.rules.applyError")}
						</Alert>
					)}
					<Group grow>
						<Button variant="default" h={44} onClick={onDone}>
							{t("transfers.rules.later")}
						</Button>
						<Button h={44} loading={apply.isPending} onClick={handleApply}>
							{t("transfers.rules.apply")}
						</Button>
					</Group>
				</>
			)}
		</Stack>
	);
}

/** A new rule from a draft, then the offer to apply it. */
export function TransferRuleModal({
	draft,
	onClose,
}: {
	/** The modal is open while a draft is given. */
	draft: TransferRuleDraft | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [created, setCreated] = useState<TransferRuleResponse | null>(null);
	const close = () => {
		setCreated(null);
		onClose();
	};

	return (
		<Modal
			opened={draft !== null}
			onClose={close}
			title={
				created
					? t("transfers.rules.applyTitle")
					: t("transfers.rules.createTitle")
			}
		>
			{created ? (
				<ApplyTransferRulePrompt rule={created} onDone={close} />
			) : (
				draft && (
					<TransferRuleForm
						rule={null}
						draft={draft}
						onSaved={setCreated}
						onCancel={close}
					/>
				)
			)}
		</Modal>
	);
}
