import { Box, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatSignedAmount } from "@/lib/format";
import { useAccountTransfers } from "@/lib/hooks";
import { transferFlowOf, transferTone } from "@/lib/transfers";
import type { AccountResponse } from "@/lib/types";
import { palette } from "@/theme";

const SHOWN = 5;

/** The latest transfers with `account`, seen from its side. Renders nothing without any. */
export function AccountTransfersCard({
	account,
	accounts,
}: {
	account: AccountResponse;
	accounts: AccountResponse[];
}) {
	const { t, i18n } = useTranslation();
	const transfers = useAccountTransfers(account.id, SHOWN).data;
	if (!transfers || transfers.total === 0) return null;

	return (
		<Paper p={0} style={{ overflow: "hidden" }}>
			<Stack gap={2} px="md" py="sm">
				<Title order={2} fz="md" fw={700}>
					{t("transfers.account.title")}
				</Title>
				<Text size="xs" c="dimmed">
					{t("transfers.account.total", { count: transfers.total })}
				</Text>
			</Stack>
			<Box component="ul" m={0} p={0} className="list-none">
				{transfers.data.map((op) => {
					const source = accounts.find((a) => a.id === op.accountId);
					// What left the other account landed here, and the other way round.
					const amount = -Number(op.amount);
					const tone = transferTone(
						transferFlowOf(account.kind, Number(op.amount)),
					);
					return (
						<Group
							component="li"
							key={op.id}
							justify="space-between"
							wrap="nowrap"
							gap="sm"
							px="md"
							py={8}
							style={{ borderTop: `1px solid ${palette.divider}` }}
						>
							<Stack gap={0} miw={0}>
								<Text
									size="sm"
									fw={500}
									c={op.ignored ? "dimmed" : undefined}
									td={op.ignored ? "line-through" : undefined}
									truncate
								>
									{op.label}
								</Text>
								<Text size="xs" c="dimmed">
									{formatIsoDate(op.date, i18n.language)}
									{source &&
										` · ${t(amount > 0 ? "transfers.account.from" : "transfers.account.to", { account: source.name })}`}
								</Text>
							</Stack>
							<Text
								size="sm"
								fw={700}
								c={tone.text}
								className="tabular-nums"
								style={{ whiteSpace: "nowrap" }}
							>
								{formatSignedAmount(amount)}
							</Text>
						</Group>
					);
				})}
			</Box>
		</Paper>
	);
}
