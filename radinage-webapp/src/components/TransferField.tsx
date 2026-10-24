import {
	Badge,
	Group,
	SegmentedControl,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconArrowsExchange,
	IconInfoCircle,
	IconLink,
	IconPigMoney,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDescribeTransferRule } from "@/components/TransferRuleForm";
import { formatAmount, formatIsoDate, formatSignedAmount } from "@/lib/format";
import { useOperation } from "@/lib/hooks";
import { transferFlowOf, transferTone } from "@/lib/transfers";
import type {
	AccountResponse,
	OperationResponse,
	SetTransferRequest,
	TransferRuleResponse,
} from "@/lib/types";
import { palette } from "@/theme";

type Nature = "operation" | "transfer";

function isNature(value: string): value is Nature {
	return value === "operation" || value === "transfer";
}

/** Whether the operation is a transfer, and with which account. */
export function TransferField({
	op,
	accounts,
	transferRules,
	onChange,
}: {
	op: OperationResponse;
	accounts: AccountResponse[];
	transferRules: TransferRuleResponse[];
	onChange: (transfer: SetTransferRequest | null) => void;
}) {
	const { t } = useTranslation();
	// Picking "transfer" shows the account choice before anything is saved.
	const [nature, setNature] = useState<Nature>(
		op.transfer ? "transfer" : "operation",
	);
	const amount = Number(op.amount);
	const outgoing = amount < 0;
	const other = accounts.find((a) => a.id === op.transfer?.accountId);

	return (
		<Stack gap="sm">
			<Stack gap={4}>
				<Text size="sm" fw={600}>
					{t("transfers.nature")}
				</Text>
				<SegmentedControl
					fullWidth
					value={nature}
					onChange={(value) => {
						if (!isNature(value)) return;
						setNature(value);
						if (value === "operation" && op.transfer) onChange(null);
					}}
					data={(["operation", "transfer"] as const).map((n) => ({
						value: n,
						label: t(`transfers.natures.${n}`),
					}))}
					styles={{
						label: { minHeight: 36, display: "grid", alignContent: "center" },
					}}
				/>
			</Stack>
			{nature === "transfer" && (
				<>
					<Select
						label={t(
							outgoing ? "transfers.toAccount" : "transfers.fromAccount",
						)}
						description={t(
							outgoing ? "transfers.toHint" : "transfers.fromHint",
						)}
						placeholder={t("transfers.accountPlaceholder")}
						data={accounts
							.filter((a) => a.id !== op.accountId)
							.map((a) => ({ value: a.id, label: a.name }))}
						value={op.transfer?.accountId ?? null}
						onChange={(accountId) => {
							if (accountId && accountId !== op.transfer?.accountId) {
								onChange({ accountId });
							}
						}}
						allowDeselect={false}
						leftSection={<IconArrowsExchange size={18} />}
						comboboxProps={{ withinPortal: true }}
					/>
					{other && (
						<TransferDetails
							op={op}
							other={other}
							transferRules={transferRules}
						/>
					)}
				</>
			)}
		</Stack>
	);
}

/** How the transfer counts, the rule that made it, and its other side. */
function TransferDetails({
	op,
	other,
	transferRules,
}: {
	op: OperationResponse;
	other: AccountResponse;
	transferRules: TransferRuleResponse[];
}) {
	const { t } = useTranslation();
	const describe = useDescribeTransferRule();
	const amount = Number(op.amount);
	const flow = transferFlowOf(other.kind, amount);
	const tone = transferTone(flow);
	const rule = transferRules.find((r) => r.id === op.transfer?.ruleId);

	return (
		<Stack gap="sm">
			<Group
				gap={8}
				wrap="nowrap"
				align="flex-start"
				px="sm"
				py={10}
				c={tone.text}
				bg={`${tone.color}.0`}
				style={{ borderRadius: 12 }}
			>
				{flow === "internal" ? (
					<IconArrowsExchange size={18} style={{ flexShrink: 0 }} />
				) : (
					<IconPigMoney size={18} style={{ flexShrink: 0 }} />
				)}
				<Text size="sm">
					{t(`transfers.flows.${flow}`, {
						amount: formatAmount(Math.abs(amount)),
						account: other.name,
					})}
				</Text>
			</Group>
			{rule && (
				<Group gap={8} wrap="nowrap" c="dimmed" align="flex-start">
					<IconInfoCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
					<Stack gap={2}>
						<Text size="sm">
							{t("transfers.byRule", { rule: describe(rule) })}
						</Text>
						<Link
							to="/accounts/$accountId"
							params={{ accountId: rule.accountId }}
							className="text-sm font-semibold"
							style={{ color: "var(--mantine-color-forest-7)" }}
						>
							{t("transfers.seeRules")}
						</Link>
					</Stack>
				</Group>
			)}
			{other.receivesOperations && (
				<Counterpart id={op.transfer?.operationId ?? null} account={other} />
			)}
		</Stack>
	);
}

/** The operation on the other account, or why there is none yet. */
function Counterpart({
	id,
	account,
}: {
	id: string | null;
	account: AccountResponse;
}) {
	const { t, i18n } = useTranslation();
	const counterpart = useOperation(id).data;

	return (
		<Stack gap={4}>
			<Text size="sm" fw={600}>
				{t("transfers.counterpart", { account: account.name })}
			</Text>
			{id === null ? (
				<Text size="sm" c="dimmed">
					{t("transfers.waiting", { account: account.name })}
				</Text>
			) : (
				counterpart && (
					<Stack
						gap={2}
						px="sm"
						py={10}
						style={{ border: `1px solid ${palette.border}`, borderRadius: 12 }}
					>
						<Group justify="space-between" wrap="nowrap" gap="sm">
							<Group gap={6} wrap="nowrap" miw={0}>
								<Badge
									size="sm"
									color="forest"
									c="forest.8"
									tt="none"
									flex="none"
									leftSection={<IconLink size={12} aria-hidden />}
								>
									{t("transfers.linked")}
								</Badge>
								<Text size="sm" fw={600} truncate>
									{counterpart.label}
								</Text>
							</Group>
							<Text
								size="sm"
								fw={700}
								className="tabular-nums"
								style={{ whiteSpace: "nowrap" }}
							>
								{formatSignedAmount(Number(counterpart.amount))}
							</Text>
						</Group>
						<Text size="xs" c="dimmed">
							{formatIsoDate(counterpart.date, i18n.language, {
								dateStyle: "long",
							})}
						</Text>
					</Stack>
				)
			)}
		</Stack>
	);
}
