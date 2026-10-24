import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ApplyIgnoreRulePrompt,
	IgnoreRuleForm,
	useDescribeIgnoreRule,
} from "@/components/IgnoreRuleForm";
import { useDeleteIgnoreRule, useIgnoreRules } from "@/lib/hooks";
import type { IgnoreRuleResponse } from "@/lib/types";
import { palette } from "@/theme";

function IgnoreRuleRow({
	rule,
	onEdit,
}: {
	rule: IgnoreRuleResponse;
	onEdit: () => void;
}) {
	const { t } = useTranslation();
	const describe = useDescribeIgnoreRule();
	const remove = useDeleteIgnoreRule();
	const [confirming, setConfirming] = useState(false);
	const description = describe(rule);
	const editLabel = t("ignoreRules.edit", { rule: description });
	const deleteLabel = t("ignoreRules.delete", { rule: description });

	return (
		<Box
			component="li"
			py={6}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			{confirming ? (
				<Stack gap="xs">
					<Text size="sm">
						{t("ignoreRules.confirmDelete", { rule: description })}
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
				<Group justify="space-between" wrap="nowrap">
					<Text size="sm" fw={600} className="[overflow-wrap:anywhere]">
						{description}
					</Text>
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
	| { kind: "apply"; rule: IgnoreRuleResponse };

export function IgnoreRulesSection() {
	const { t } = useTranslation();
	const rulesQuery = useIgnoreRules();
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const rules = rulesQuery.data ?? [];
	const stopEditing = () => setEditing({ kind: "none" });
	const afterSave = (rule: IgnoreRuleResponse, created: boolean) =>
		setEditing(created ? { kind: "apply", rule } : { kind: "none" });

	return (
		<Paper>
			<Stack>
				<Title order={3} fz={20}>
					{t("ignoreRules.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("ignoreRules.description")}
				</Text>

				{rulesQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{rulesQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("ignoreRules.fetchError")}
					</Alert>
				)}

				{rulesQuery.isSuccess && (
					<>
						{rules.length === 0 ? (
							<Text size="sm" c="dimmed">
								{t("ignoreRules.empty")}
							</Text>
						) : (
							<Box component="ul" m={0} p={0} className="list-none">
								{rules.map((rule) =>
									editing.kind === "edit" && editing.id === rule.id ? (
										<Box component="li" key={rule.id} py="xs">
											<IgnoreRuleForm
												rule={rule}
												onSaved={afterSave}
												onCancel={stopEditing}
											/>
										</Box>
									) : (
										<IgnoreRuleRow
											key={rule.id}
											rule={rule}
											onEdit={() => setEditing({ kind: "edit", id: rule.id })}
										/>
									),
								)}
							</Box>
						)}
						{editing.kind === "new" ? (
							<IgnoreRuleForm
								rule={null}
								onSaved={afterSave}
								onCancel={stopEditing}
							/>
						) : editing.kind === "apply" ? (
							<Box
								p="sm"
								bg={palette.surfaceMuted}
								style={{
									border: `1px solid ${palette.border}`,
									borderRadius: 10,
								}}
							>
								<ApplyIgnoreRulePrompt
									rule={editing.rule}
									onDone={stopEditing}
								/>
							</Box>
						) : (
							<Button
								variant="light"
								leftSection={<IconPlus size={18} />}
								onClick={() => setEditing({ kind: "new" })}
								className="self-start"
							>
								{t("ignoreRules.add")}
							</Button>
						)}
					</>
				)}
			</Stack>
		</Paper>
	);
}
