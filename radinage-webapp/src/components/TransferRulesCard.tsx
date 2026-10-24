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
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ApplyTransferRulePrompt,
	TransferRuleForm,
	useDescribeTransferRule,
} from "@/components/TransferRuleForm";
import { useDeleteTransferRule, useTransferRules } from "@/lib/hooks";
import { transferFlowOf, transferTone } from "@/lib/transfers";
import type { AccountResponse, TransferRuleResponse } from "@/lib/types";
import { palette } from "@/theme";

/** The other account of a rule, coloured like the transfers it makes out of the account. */
function CounterpartBadge({ account }: { account: AccountResponse }) {
	const tone = transferTone(transferFlowOf(account.kind, -1));
	return (
		<Badge size="sm" color={tone.color} c={tone.text} tt="none">
			{account.name}
		</Badge>
	);
}

function OwnRuleRow({
	rule,
	counterpart,
	onEdit,
}: {
	rule: TransferRuleResponse;
	counterpart: AccountResponse | undefined;
	onEdit: () => void;
}) {
	const { t } = useTranslation();
	const describe = useDescribeTransferRule();
	const remove = useDeleteTransferRule();
	const [confirming, setConfirming] = useState(false);
	const description = describe(rule);
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
						<Text size="sm" fw={600} className="[overflow-wrap:anywhere]">
							{description}
						</Text>
						{counterpart && (
							<Group gap={6} wrap="wrap" c="dimmed">
								<IconArrowsExchange size={14} aria-hidden />
								<CounterpartBadge account={counterpart} />
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
 * The transfer rules of an account receiving operations, and the rules of other accounts
 * that make transfers to it. Renders nothing when there is neither.
 */
export function TransferRulesCard({
	account,
	accounts,
}: {
	account: AccountResponse;
	accounts: AccountResponse[];
}) {
	const { t } = useTranslation();
	const describe = useDescribeTransferRule();
	const rulesQuery = useTransferRules();
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const rules = rulesQuery.data ?? [];
	const own = rules.filter((r) => r.accountId === account.id);
	const incoming = rules.filter((r) => r.counterpartAccountId === account.id);
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const stopEditing = () => setEditing({ kind: "none" });
	const afterSave = (rule: TransferRuleResponse, created: boolean) =>
		setEditing(created ? { kind: "apply", rule } : { kind: "none" });

	if (!account.receivesOperations && incoming.length === 0) return null;

	return (
		<Paper>
			<Stack gap="sm">
				{rulesQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("transfers.rules.fetchError")}
					</Alert>
				)}
				{account.receivesOperations && (
					<>
						<Title order={2} fz="md" fw={700}>
							{t("transfers.rules.title")}
						</Title>
						<Text size="sm" c="dimmed">
							{t("transfers.rules.description")}
						</Text>
						{own.length === 0 && editing.kind !== "new" && (
							<Text size="sm" c="dimmed">
								{t("transfers.rules.empty")}
							</Text>
						)}
						<Box component="ul" m={0} p={0} className="list-none">
							{own.map((rule) =>
								editing.kind === "edit" && editing.id === rule.id ? (
									<Box component="li" key={rule.id} py="xs">
										<TransferRuleForm
											rule={rule}
											draft={{ accountId: account.id }}
											onSaved={afterSave}
											onCancel={stopEditing}
										/>
									</Box>
								) : (
									<OwnRuleRow
										key={rule.id}
										rule={rule}
										counterpart={byId.get(rule.counterpartAccountId)}
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
							<ApplyTransferRulePrompt
								rule={editing.rule}
								onDone={stopEditing}
							/>
						)}
						{editing.kind === "none" && (
							<Button
								variant="light"
								leftSection={<IconPlus size={18} />}
								onClick={() => setEditing({ kind: "new" })}
								className="self-start"
							>
								{t("transfers.rules.add")}
							</Button>
						)}
					</>
				)}
				{incoming.length > 0 && (
					<>
						<Title order={2} fz="md" fw={700}>
							{t("transfers.rules.incomingTitle")}
						</Title>
						<Box component="ul" m={0} p={0} className="list-none">
							{incoming.map((rule) => {
								const source = byId.get(rule.accountId);
								return (
									<Box
										component="li"
										key={rule.id}
										py={6}
										style={{ borderBottom: `1px dashed ${palette.border}` }}
									>
										<Text
											size="sm"
											fw={600}
											className="[overflow-wrap:anywhere]"
										>
											{describe(rule)}
										</Text>
										{source && (
											<Link
												to="/accounts/$accountId"
												params={{ accountId: source.id }}
												className="text-sm font-semibold"
												style={{ color: "var(--mantine-color-forest-7)" }}
											>
												{t("transfers.rules.on", { account: source.name })}
											</Link>
										)}
									</Box>
								);
							})}
						</Box>
					</>
				)}
			</Stack>
		</Paper>
	);
}
