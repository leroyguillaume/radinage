import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Group,
	Paper,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconArrowsExchange,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ApplyTransferRulePrompt,
	TransferRuleForm,
	useDescribePattern,
} from "@/components/TransferRuleForm";
import { useDeleteTransferRule, useTransferRules } from "@/lib/hooks";
import { transferFlowOf, transferTone } from "@/lib/transfers";
import type {
	AccountResponse,
	LabelPattern,
	TransferRuleResponse,
} from "@/lib/types";
import { palette } from "@/theme";

/** A rule seen from one of its accounts: the label on that account, and the other side. */
interface RuleSides {
	own: LabelPattern | null;
	other: AccountResponse | undefined;
	otherPattern: LabelPattern | null;
}

function sidesOf(
	rule: TransferRuleResponse,
	accountId: string,
	byId: Map<string, AccountResponse>,
): RuleSides {
	return rule.accountId === accountId
		? {
				own: rule.labelPattern,
				other: byId.get(rule.counterpartAccountId),
				otherPattern: rule.counterpartLabelPattern,
			}
		: {
				own: rule.counterpartLabelPattern,
				other: byId.get(rule.accountId),
				otherPattern: rule.labelPattern,
			};
}

/** The other account of a rule, coloured like the transfers it makes to it. */
function OtherAccountBadge({ account }: { account: AccountResponse }) {
	const tone = transferTone(transferFlowOf(account.kind, -1));
	return (
		<Badge size="sm" color={tone.color} c={tone.text} tt="none">
			{account.name}
		</Badge>
	);
}

function RuleRow({
	rule,
	sides,
	onEdit,
}: {
	rule: TransferRuleResponse;
	sides: RuleSides;
	onEdit: () => void;
}) {
	const { t } = useTranslation();
	const describe = useDescribePattern();
	const remove = useDeleteTransferRule();
	const [confirming, setConfirming] = useState(false);
	const description = describe(sides.own ?? rule.labelPattern);
	const editLabel = t("transfers.rules.edit", { rule: description });
	const deleteLabel = t("transfers.rules.delete", { rule: description });

	return (
		<Box
			component="li"
			py={6}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			{confirming ? (
				<Stack gap="xs">
					<Text size="sm">
						{t("transfers.rules.confirmDelete", { rule: description })}
					</Text>
					<Group grow>
						<Button variant="default" onClick={() => setConfirming(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							color="tangerine"
							loading={remove.isPending}
							onClick={() => remove.mutate(rule.id)}
						>
							{t("common.delete")}
						</Button>
					</Group>
				</Stack>
			) : (
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Stack gap={4} miw={0}>
						{sides.own && (
							<Text size="sm" fw={600} className="[overflow-wrap:anywhere]">
								{describe(sides.own)}
							</Text>
						)}
						{sides.other && (
							<Group gap={6} wrap="wrap" c="dimmed">
								<IconArrowsExchange size={14} aria-hidden />
								<OtherAccountBadge account={sides.other} />
								{sides.otherPattern && (
									<Text
										size="sm"
										c="dimmed"
										className="[overflow-wrap:anywhere]"
									>
										{describe(sides.otherPattern)}
									</Text>
								)}
							</Group>
						)}
					</Stack>
					<Group gap={2} wrap="nowrap">
						<Tooltip label={editLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={onEdit}
								aria-label={editLabel}
							>
								<IconPencil size={18} />
							</ActionIcon>
						</Tooltip>
						<Tooltip label={deleteLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={() => setConfirming(true)}
								aria-label={deleteLabel}
							>
								<IconTrash size={18} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>
			)}
		</Box>
	);
}

/** The rule being worked on: an existing one, a new one, one just created, or none. */
type Editing =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "edit"; id: string }
	| { kind: "apply"; rule: TransferRuleResponse };

/**
 * Every transfer rule with an account, on either side, editable from here. A new rule starts
 * from an account receiving operations. Renders nothing for another account without rules.
 */
export function TransferRulesCard({
	account,
	accounts,
}: {
	account: AccountResponse;
	accounts: AccountResponse[];
}) {
	const { t } = useTranslation();
	const rulesQuery = useTransferRules();
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const rules = (rulesQuery.data ?? []).filter(
		(r) => r.accountId === account.id || r.counterpartAccountId === account.id,
	);
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const stopEditing = () => setEditing({ kind: "none" });
	const afterSave = (rule: TransferRuleResponse, created: boolean) =>
		setEditing(created ? { kind: "apply", rule } : { kind: "none" });

	if (!account.receivesOperations && rules.length === 0) return null;

	return (
		<Paper>
			<Stack gap="sm">
				<Title order={2} fz="md" fw={700}>
					{t("transfers.rules.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t(
						account.receivesOperations
							? "transfers.rules.description"
							: "transfers.rules.descriptionOther",
					)}
				</Text>
				{rulesQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("transfers.rules.fetchError")}
					</Alert>
				)}
				{rules.length === 0 && editing.kind !== "new" && (
					<Text size="sm" c="dimmed">
						{t("transfers.rules.empty")}
					</Text>
				)}
				<Box component="ul" m={0} p={0} className="list-none">
					{rules.map((rule) =>
						editing.kind === "edit" && editing.id === rule.id ? (
							<Box component="li" key={rule.id} py="xs">
								<TransferRuleForm
									rule={rule}
									draft={{ accountId: rule.accountId }}
									onSaved={afterSave}
									onCancel={stopEditing}
								/>
							</Box>
						) : (
							<RuleRow
								key={rule.id}
								rule={rule}
								sides={sidesOf(rule, account.id, byId)}
								onEdit={() => setEditing({ kind: "edit", id: rule.id })}
							/>
						),
					)}
				</Box>
				{editing.kind === "new" && (
					<TransferRuleForm
						rule={null}
						draft={{ accountId: account.id }}
						onSaved={afterSave}
						onCancel={stopEditing}
					/>
				)}
				{editing.kind === "apply" && (
					<ApplyTransferRulePrompt rule={editing.rule} onDone={stopEditing} />
				)}
				{editing.kind === "none" && account.receivesOperations && (
					<Button
						variant="light"
						leftSection={<IconPlus size={18} />}
						onClick={() => setEditing({ kind: "new" })}
						className="self-start"
					>
						{t("transfers.rules.add")}
					</Button>
				)}
			</Stack>
		</Paper>
	);
}
