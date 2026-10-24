import { Alert, Box, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconInfoCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { BalanceFields } from "@/components/BalanceFields";
import { ApiError } from "@/lib/api";
import { balanceOn, readBalanceInput } from "@/lib/balance-history";
import {
	centsToDecimal,
	decimalToCents,
	formatAmount,
	formatIsoDate,
	formatSignedAmount,
	parseSignedCents,
	toDisplayAmount,
} from "@/lib/format";
import { useBalanceHistory, useSaveAccountBalance } from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import type { AccountResponse, BalanceReading } from "@/lib/types";
import { palette } from "@/theme";

interface BalanceModalProps {
	opened: boolean;
	onClose: () => void;
	account: AccountResponse;
	/** The balance to correct, null to record a new one. */
	reading: BalanceReading | null;
}

/** Record a balance read on an account, or correct one, against what was estimated. */
export function BalanceModal({
	opened,
	onClose,
	account,
	reading,
}: BalanceModalProps) {
	const { t } = useTranslation();
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={t(
				reading
					? "accounts.balanceModal.editTitle"
					: "accounts.balanceModal.title",
				{ name: account.name },
			)}
		>
			<BalanceForm account={account} reading={reading} onDone={onClose} />
		</Modal>
	);
}

function ComparisonRow({
	label,
	value,
	color,
}: {
	label: string;
	value: string;
	color?: string;
}) {
	return (
		<Group
			justify="space-between"
			wrap="nowrap"
			px="sm"
			py={8}
			style={{ borderTop: `1px solid ${palette.divider}` }}
		>
			<Text size="sm" c="dimmed">
				{label}
			</Text>
			<Text size="sm" fw={700} c={color} className="tabular-nums">
				{value}
			</Text>
		</Group>
	);
}

function BalanceForm({
	account,
	reading,
	onDone,
}: {
	account: AccountResponse;
	reading: BalanceReading | null;
	onDone: () => void;
}) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	const today = dayjs().format("YYYY-MM-DD");
	const save = useSaveAccountBalance();
	const history = useBalanceHistory(account.id, null);
	const [amount, setAmount] = useState(
		reading
			? toDisplayAmount(centsToDecimal(decimalToCents(reading.amount)), locale)
			: "",
	);
	const [date, setDate] = useState<string | null>(reading?.date ?? today);
	const [error, setError] = useState<string | null>(null);

	// A balance already read that day is the estimate's result, not its input.
	const estimate =
		date === null
			? null
			: reading?.date === date
				? reading.estimated === null
					? null
					: Number(reading.estimated)
				: balanceOn(history.data ?? [], date);
	const cents = parseSignedCents(amount);
	const typed = cents === null ? null : cents / 100;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const input = readBalanceInput(amount, date, today);
		if (input === null || !input.ok) {
			setError(t(input?.error ?? "accounts.errorAmount"));
			return;
		}
		try {
			await save.mutateAsync({
				accountId: account.id,
				...(reading ? { balanceId: reading.id } : {}),
				body: input.balance,
			});
			onDone();
		} catch (err) {
			setError(
				t(
					err instanceof ApiError && err.status === 409
						? "accounts.balanceModal.dateTaken"
						: "accounts.saveError",
				),
			);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="md">
				<BalanceFields
					label={t("accounts.balance")}
					amount={amount}
					onAmountChange={setAmount}
					date={date}
					onDateChange={setDate}
				/>
				{estimate !== null && date !== null && (
					<Box
						style={{
							border: `1px solid ${palette.border}`,
							borderRadius: 12,
							overflow: "hidden",
						}}
						aria-live="polite"
					>
						<Group justify="space-between" wrap="nowrap" px="sm" py={8}>
							<Text size="sm" c="dimmed">
								{t("accounts.balanceModal.estimateOn", {
									date: formatIsoDate(date, locale),
								})}
							</Text>
							<Text size="sm" fw={700} className="tabular-nums">
								{formatAmount(estimate)}
							</Text>
						</Group>
						{typed !== null && (
							<>
								<ComparisonRow
									label={t("accounts.balanceModal.reading")}
									value={formatAmount(typed)}
								/>
								<ComparisonRow
									label={t("accounts.balanceModal.gap")}
									value={formatSignedAmount(
										Math.round((typed - estimate) * 100) / 100,
									)}
									color={balanceTextColor(typed - estimate)}
								/>
							</>
						)}
					</Box>
				)}
				<Alert
					color="gold"
					variant="light"
					icon={<IconInfoCircle size={16} />}
					c="gold.9"
				>
					{t("accounts.balanceModal.replaces")}
				</Alert>
				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}
				<Group grow>
					<Button variant="default" onClick={onDone}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" loading={save.isPending}>
						{t("common.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}
