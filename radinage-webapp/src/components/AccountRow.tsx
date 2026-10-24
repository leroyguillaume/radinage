import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Group,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconPencil, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchorLink } from "@/components/AnchorLink";
import { ApiError } from "@/lib/api";
import { formatAmount, formatIsoDate } from "@/lib/format";
import { useDeleteAccount } from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import type { AccountResponse } from "@/lib/types";
import { palette } from "@/theme";

export function AccountRow({
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
	const estimated =
		!account.receivesOperations &&
		(savedBy.length > 0 || account.transferredInto);
	const detail =
		date === null
			? t("accounts.noBalance")
			: t(
					account.receivesOperations
						? "accounts.computed"
						: estimated
							? "accounts.estimatedFrom"
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
							<AnchorLink
								to="/accounts/$accountId"
								params={{ accountId: account.id }}
								aria-label={t("accounts.open", { name: account.name })}
								size="sm"
								fw={600}
								c="inherit"
								className="[overflow-wrap:anywhere]"
							>
								{account.name}
							</AnchorLink>
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
									{estimated && (
										<Text component="span" inherit c="dimmed" fw={500}>
											≈{" "}
										</Text>
									)}
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
