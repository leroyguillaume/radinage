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
import { AccountForm } from "@/components/AccountForm";
import { ApiError } from "@/lib/api";
import { formatAmount, formatIsoDate } from "@/lib/format";
import { useAccounts, useBudgets, useDeleteAccount } from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import type { AccountResponse } from "@/lib/types";
import { palette } from "@/theme";

type AccountGroup = "imported" | "savings" | "other";

const GROUPS: AccountGroup[] = ["imported", "savings", "other"];

function groupOf(account: AccountResponse): AccountGroup {
	if (account.receivesOperations) return "imported";
	return account.kind === "savings" ? "savings" : "other";
}

function AccountRow({
	account,
	savedBy,
	onEdit,
}: {
	account: AccountResponse;
	/** Labels of the savings budgets sending their money to the account. */
	savedBy: string[];
	onEdit: () => void;
}) {
	const { t, i18n } = useTranslation();
	const remove = useDeleteAccount();
	const [confirming, setConfirming] = useState(false);
	const [inUse, setInUse] = useState(false);
	const editLabel = t("accounts.edit", { name: account.name });
	const deleteLabel = t("accounts.delete", { name: account.name });
	const date = account.balance
		? formatIsoDate(account.balance.date, i18n.language)
		: null;
	const detail =
		date === null
			? t("accounts.noBalance")
			: t(
					account.receivesOperations || savedBy.length > 0
						? "accounts.computed"
						: "accounts.readOn",
					{
						date,
					},
				);

	async function handleDelete() {
		try {
			await remove.mutateAsync(account.id);
		} catch (err) {
			setInUse(err instanceof ApiError && err.status === 409);
			setConfirming(false);
		}
	}

	return (
		<Box
			component="li"
			py={6}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			{confirming ? (
				<Stack gap="xs">
					<Text size="sm">
						{t("accounts.confirmDelete", { name: account.name })}
					</Text>
					<Group grow>
						<Button variant="default" onClick={() => setConfirming(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							color="tangerine"
							loading={remove.isPending}
							onClick={handleDelete}
						>
							{t("common.delete")}
						</Button>
					</Group>
				</Stack>
			) : (
				<Stack gap="xs">
					<Group justify="space-between" wrap="nowrap" gap="xs">
						<Box miw={0}>
							<Text size="sm" fw={600} className="[overflow-wrap:anywhere]">
								{account.name}
							</Text>
							<Text size="xs" c="dimmed">
								{detail}
							</Text>
							{savedBy.length > 0 && (
								<Text size="xs" c="dimmed" className="[overflow-wrap:anywhere]">
									{t("accounts.savedBy", { budgets: savedBy.join(", ") })}
								</Text>
							)}
						</Box>
						<Group gap={2} wrap="nowrap">
							{account.currentBalance !== null && (
								<Text
									size="sm"
									fw={700}
									className="tabular-nums whitespace-nowrap"
									c={balanceTextColor(Number(account.currentBalance))}
									mr="xs"
								>
									{formatAmount(account.currentBalance)}
								</Text>
							)}
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
									onClick={() => {
										setInUse(false);
										setConfirming(true);
									}}
									aria-label={deleteLabel}
								>
									<IconTrash size={18} />
								</ActionIcon>
							</Tooltip>
						</Group>
					</Group>
					{inUse && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{t("accounts.inUse")}
						</Alert>
					)}
				</Stack>
			)}
		</Box>
	);
}

/** The account being edited, a new one, or none. */
type Editing =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "edit"; id: string };

export function AccountsSection() {
	const { t } = useTranslation();
	const accountsQuery = useAccounts();
	const budgets = useBudgets().data ?? [];
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const accounts = accountsQuery.data ?? [];
	const stopEditing = () => setEditing({ kind: "none" });

	return (
		<Paper>
			<Stack>
				<Title order={3} fz={20}>
					{t("accounts.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("accounts.description")}
				</Text>

				{accountsQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{accountsQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("accounts.fetchError")}
					</Alert>
				)}

				{accountsQuery.isSuccess && (
					<>
						{accounts.length === 0 && (
							<Text size="sm" c="dimmed">
								{t("accounts.empty")}
							</Text>
						)}
						{GROUPS.map((group) => {
							const members = accounts.filter((a) => groupOf(a) === group);
							if (members.length === 0) return null;
							const total = members.reduce(
								(sum, a) => sum + Number(a.currentBalance ?? 0),
								0,
							);
							return (
								<Stack key={group} gap={0}>
									<Group justify="space-between">
										<Text
											size="xs"
											fw={700}
											c="dimmed"
											tt="uppercase"
											className="tracking-wide"
										>
											{t(`accounts.groups.${group}`)}
										</Text>
										<Text size="sm" fw={700} className="tabular-nums">
											{formatAmount(total)}
										</Text>
									</Group>
									<Box component="ul" m={0} p={0} className="list-none">
										{members.map((account) =>
											editing.kind === "edit" && editing.id === account.id ? (
												<Box component="li" key={account.id} py="xs">
													<AccountForm
														account={account}
														onSaved={stopEditing}
														onCancel={stopEditing}
													/>
												</Box>
											) : (
												<AccountRow
													key={account.id}
													account={account}
													savedBy={budgets
														.filter((b) => b.accountId === account.id)
														.map((b) => b.label)}
													onEdit={() =>
														setEditing({ kind: "edit", id: account.id })
													}
												/>
											),
										)}
									</Box>
								</Stack>
							);
						})}
						{editing.kind === "new" ? (
							<AccountForm
								account={null}
								onSaved={stopEditing}
								onCancel={stopEditing}
							/>
						) : (
							<Button
								variant="light"
								leftSection={<IconPlus size={18} />}
								onClick={() => setEditing({ kind: "new" })}
								className="self-start"
							>
								{t("accounts.add")}
							</Button>
						)}
					</>
				)}
			</Stack>
		</Paper>
	);
}
