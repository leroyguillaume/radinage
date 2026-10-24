import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	SegmentedControl,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconChevronLeft,
	IconInfoCircle,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountTransfersCard } from "@/components/AccountTransfersCard";
import { AnchorLink } from "@/components/AnchorLink";
import { BalanceHistoryChart } from "@/components/BalanceHistoryChart";
import { BalanceModal } from "@/components/BalanceModal";
import { TransferRulesCard } from "@/components/TransferRulesCard";
import {
	type HistoryPeriod,
	periodStart,
	readingGap,
} from "@/lib/balance-history";
import { formatAmount, formatIsoDate, formatSignedAmount } from "@/lib/format";
import {
	useAccountBalances,
	useAccounts,
	useBalanceHistory,
	useBudgets,
	useDeleteAccountBalance,
	useTransferRules,
} from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import { feederNames, feedersOf } from "@/lib/transfers";
import type { AccountResponse, BalanceReading } from "@/lib/types";
import { headingFont, palette } from "@/theme";

export const Route = createFileRoute("/accounts_/$accountId")({
	component: AccountPage,
});

const PERIODS: HistoryPeriod[] = ["3m", "1y", "all"];

function isPeriod(value: string): value is HistoryPeriod {
	return PERIODS.some((p) => p === value);
}

/** The balance being recorded or corrected, if any. */
type Editing =
	| { kind: "none" }
	| { kind: "record" }
	| { kind: "correct"; reading: BalanceReading };

function ReadingRow({
	account,
	reading,
	onCorrect,
}: {
	account: AccountResponse;
	reading: BalanceReading;
	onCorrect: () => void;
}) {
	const { t, i18n } = useTranslation();
	const remove = useDeleteAccountBalance();
	const [confirming, setConfirming] = useState(false);
	const date = formatIsoDate(reading.date, i18n.language);
	const gap = readingGap(reading.amount, reading.estimated);
	const correctLabel = t("accounts.detail.correct", { date });
	const deleteLabel = t("accounts.detail.deleteReading", { date });

	if (confirming) {
		return (
			<Stack component="li" gap="xs" px="md" py="sm">
				<Text size="sm">{t("accounts.detail.confirmDelete", { date })}</Text>
				<Group grow>
					<Button variant="default" onClick={() => setConfirming(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						color="tangerine"
						loading={remove.isPending}
						onClick={() =>
							remove.mutate({ accountId: account.id, balanceId: reading.id })
						}
					>
						{t("common.delete")}
					</Button>
				</Group>
			</Stack>
		);
	}

	return (
		<Group
			component="li"
			wrap="nowrap"
			gap="sm"
			pl="md"
			pr={4}
			py={6}
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			<Box miw={0} style={{ flex: 1 }}>
				<Text size="sm" fw={600}>
					{date}
				</Text>
				<Text size="xs" c="dimmed">
					{reading.estimated === null
						? t("accounts.detail.firstReading")
						: t("accounts.detail.estimation", {
								amount: formatAmount(reading.estimated),
							})}
				</Text>
			</Box>
			<Box ta="right">
				<Text size="sm" fw={700} className="tabular-nums whitespace-nowrap">
					{formatAmount(reading.amount)}
				</Text>
				{gap !== null && gap !== 0 && (
					<Text
						size="xs"
						fw={600}
						c={balanceTextColor(gap)}
						className="tabular-nums whitespace-nowrap"
					>
						{formatSignedAmount(gap)}
					</Text>
				)}
			</Box>
			<Group gap={0} wrap="nowrap">
				<Tooltip label={correctLabel}>
					<ActionIcon
						variant="subtle"
						color="gray"
						size={44}
						onClick={onCorrect}
						aria-label={correctLabel}
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
	);
}

function AccountPage() {
	const { t, i18n } = useTranslation();
	const { accountId } = Route.useParams();
	const [today] = useState(() => new Date());
	const [period, setPeriod] = useState<HistoryPeriod>("1y");
	const [editing, setEditing] = useState<Editing>({ kind: "none" });

	const accountsQuery = useAccounts();
	const budgets = useBudgets().data ?? [];
	const transferRules = useTransferRules().data ?? [];
	const balancesQuery = useAccountBalances(accountId);
	const historyQuery = useBalanceHistory(accountId, periodStart(period, today));
	const account = accountsQuery.data?.find((a) => a.id === accountId);

	if (accountsQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	if (!account) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{accountsQuery.isError
						? t("accounts.fetchError")
						: t("accounts.detail.notFound")}
				</Alert>
			</div>
		);
	}

	const savedBy = feederNames(
		feedersOf(account.id, budgets, transferRules, accountsQuery.data ?? []),
		(accounts) => t("transfers.fedBy", { accounts }),
	);
	const estimated =
		!account.receivesOperations &&
		(savedBy.length > 0 || account.transferredInto);
	const readings = balancesQuery.data ?? [];
	const latest = account.balance;
	const current = account.currentBalance;
	const movedSince =
		latest && current !== null ? Number(current) - Number(latest.amount) : 0;
	const points = historyQuery.data ?? [];
	const stopEditing = () => setEditing({ kind: "none" });

	return (
		<div className="h-full overflow-auto">
			<BalanceModal
				opened={editing.kind !== "none"}
				onClose={stopEditing}
				account={account}
				reading={editing.kind === "correct" ? editing.reading : null}
			/>
			<Stack
				maw={720}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<Group wrap="nowrap" gap="xs">
					<AnchorLink
						to="/accounts"
						aria-label={t("accounts.detail.back")}
						c="inherit"
						w={44}
						h={44}
						display="flex"
						style={{ alignItems: "center", justifyContent: "center" }}
					>
						<IconChevronLeft size={24} />
					</AnchorLink>
					<Title
						order={1}
						fz={{ base: 26, sm: 34 }}
						className="[overflow-wrap:anywhere]"
					>
						{account.name}
					</Title>
				</Group>

				<Stack gap={4}>
					<Text size="sm" c="dimmed">
						{t(`accounts.kinds.${account.kind}`)}
						{estimated &&
							savedBy.length > 0 &&
							` · ${t("accounts.savedBy", { budgets: savedBy.join(", ") })}`}
					</Text>
					{current !== null && (
						<Text
							ff={headingFont}
							fw={700}
							fz={34}
							c={balanceTextColor(Number(current))}
							className="tabular-nums"
						>
							{estimated && (
								<Text component="span" inherit c="dimmed">
									≈{" "}
								</Text>
							)}
							{formatAmount(current)}
						</Text>
					)}
					{latest && (
						<Text size="sm" c="dimmed">
							{t("accounts.detail.readOn", {
								amount: formatAmount(latest.amount),
								date: formatIsoDate(latest.date, i18n.language),
							})}
							{movedSince !== 0 &&
								` ${t(
									account.receivesOperations
										? "accounts.detail.operationsSince"
										: movedSince < 0
											? "accounts.detail.takenSince"
											: "accounts.detail.movedSince",
									{ amount: formatAmount(Math.abs(movedSince)) },
								)}`}
						</Text>
					)}
				</Stack>

				{latest === null ? (
					<Text size="sm" c="dimmed">
						{t("accounts.detail.noBalance")}
					</Text>
				) : (
					<Paper>
						<Stack gap="sm">
							<Group justify="space-between" wrap="wrap" gap="xs">
								<Text component="h2" fw={700} fz="md">
									{t("accounts.detail.chartTitle")}
								</Text>
								<SegmentedControl
									size="xs"
									aria-label={t("accounts.detail.period")}
									value={period}
									onChange={(value) => {
										if (isPeriod(value)) setPeriod(value);
									}}
									data={PERIODS.map((p) => ({
										value: p,
										label: t(`accounts.detail.periods.${p}`),
									}))}
								/>
							</Group>
							{historyQuery.isLoading ? (
								<Group justify="center" h={220}>
									<Loader size="sm" />
								</Group>
							) : points.length === 0 ? (
								<Text size="sm" c="dimmed">
									{t("accounts.detail.noHistory")}
								</Text>
							) : (
								<BalanceHistoryChart
									points={points}
									estimatedTail={estimated}
								/>
							)}
						</Stack>
					</Paper>
				)}

				{estimated && (
					<Alert
						color="gold"
						variant="light"
						c="gold.9"
						icon={<IconInfoCircle size={16} />}
					>
						{t("accounts.detail.estimateNote", { budgets: savedBy.join(", ") })}
					</Alert>
				)}

				<AccountTransfersCard
					account={account}
					accounts={accountsQuery.data ?? []}
				/>
				<TransferRulesCard
					account={account}
					accounts={accountsQuery.data ?? []}
				/>

				<Button
					size="md"
					leftSection={<IconPlus size={18} />}
					onClick={() => setEditing({ kind: "record" })}
				>
					{t("accounts.detail.record")}
				</Button>

				{readings.length > 0 && (
					<Paper p={0} style={{ overflow: "hidden" }}>
						<Text component="h2" fw={700} fz="md" px="md" py="sm">
							{t("accounts.detail.history")}
						</Text>
						<Box component="ul" m={0} p={0} className="list-none">
							{current !== null && movedSince !== 0 && (
								<Group
									component="li"
									wrap="nowrap"
									gap="sm"
									px="md"
									py="sm"
									bg={palette.surfaceMuted}
									style={{ borderTop: `1px solid ${palette.divider}` }}
								>
									<Box miw={0} style={{ flex: 1 }}>
										<Text size="sm" fw={600}>
											{t("accounts.detail.today")}
										</Text>
										<Text size="xs" c="dimmed">
											{t(
												account.receivesOperations
													? "accounts.detail.todayComputed"
													: "accounts.detail.todayEstimated",
											)}
										</Text>
									</Box>
									<Text
										size="sm"
										fw={700}
										c="dimmed"
										className="tabular-nums whitespace-nowrap"
									>
										{estimated ? "≈ " : ""}
										{formatAmount(current)}
									</Text>
								</Group>
							)}
							{readings.map((reading) => (
								<ReadingRow
									key={reading.id}
									account={account}
									reading={reading}
									onCorrect={() => setEditing({ kind: "correct", reading })}
								/>
							))}
						</Box>
						<Text
							size="xs"
							c="dimmed"
							px="md"
							py="sm"
							style={{ borderTop: `1px solid ${palette.divider}` }}
						>
							{t("accounts.detail.gapHint")}
						</Text>
					</Paper>
				)}
			</Stack>
		</div>
	);
}
