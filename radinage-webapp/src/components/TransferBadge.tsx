import { Badge } from "@mantine/core";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { transferFlowOf, transferTone } from "@/lib/transfers";
import type { AccountResponse, OperationResponse } from "@/lib/types";

/** Which way a transfer went and with which account, coloured by how it counts. */
export function TransferBadge({
	op,
	accounts,
}: {
	op: OperationResponse;
	accounts: AccountResponse[];
}) {
	const { t } = useTranslation();
	const other = accounts.find((a) => a.id === op.transfer?.accountId);
	if (!other) return null;
	const amount = Number(op.amount);
	const tone = transferTone(transferFlowOf(other.kind, amount));
	const outgoing = amount < 0;
	const Arrow = outgoing ? IconArrowRight : IconArrowLeft;
	return (
		<Badge
			size="sm"
			color={tone.color}
			c={tone.text}
			tt="none"
			flex="none"
			leftSection={<Arrow size={12} aria-hidden />}
		>
			{t(outgoing ? "transfers.badgeTo" : "transfers.badgeFrom", {
				account: other.name,
			})}
		</Badge>
	);
}
