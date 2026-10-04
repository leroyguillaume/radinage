import {
	Alert,
	Button,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import dayjs from "dayjs";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import {
	centsToDecimal,
	decimalToCents,
	parseSignedCents,
	toDisplayAmount,
} from "@/lib/format";
import {
	useAccountBalance,
	useDeleteAccountBalance,
	useUpdateAccountBalance,
} from "@/lib/hooks";
import type { AccountBalance } from "@/lib/types";

const ISO_DATE = "YYYY-MM-DD";

type Feedback =
	| { kind: "saved" | "cleared" }
	| { kind: "error"; message: string };

interface AccountBalanceFormProps {
	balance: AccountBalance | null;
	onFeedback: (feedback: Feedback | null) => void;
}

function AccountBalanceForm({ balance, onFeedback }: AccountBalanceFormProps) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	const update = useUpdateAccountBalance();
	const remove = useDeleteAccountBalance();
	const today = dayjs().format(ISO_DATE);

	const [amount, setAmount] = useState(
		balance
			? toDisplayAmount(centsToDecimal(decimalToCents(balance.amount)), locale)
			: "",
	);
	const [date, setDate] = useState<string | null>(balance?.date ?? today);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		onFeedback(null);
		const cents = parseSignedCents(amount);
		if (cents === null) {
			onFeedback({
				kind: "error",
				message: t("settings.balance.errorAmount"),
			});
			return;
		}
		if (date === null || date > today) {
			onFeedback({ kind: "error", message: t("settings.balance.errorDate") });
			return;
		}
		try {
			await update.mutateAsync({ amount: centsToDecimal(cents), date });
			onFeedback({ kind: "saved" });
		} catch (err) {
			onFeedback({
				kind: "error",
				message:
					err instanceof ApiError && err.status === 400
						? t("settings.balance.errorDate")
						: t("common.error"),
			});
		}
	}

	async function handleClear() {
		onFeedback(null);
		try {
			await remove.mutateAsync();
			onFeedback({ kind: "cleared" });
		} catch {
			onFeedback({ kind: "error", message: t("common.error") });
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack>
				<Group grow align="flex-start" wrap="wrap">
					<TextInput
						label={t("settings.balance.amount")}
						inputMode="decimal"
						placeholder={toDisplayAmount("0", locale)}
						rightSection={
							<Text c="dimmed" aria-hidden>
								€
							</Text>
						}
						value={amount}
						onChange={(e) => setAmount(e.currentTarget.value)}
						required
						miw={160}
					/>
					<DateInput
						label={t("settings.balance.date")}
						locale={locale}
						valueFormat="DD/MM/YYYY"
						maxDate={today}
						value={date}
						onChange={setDate}
						required
						miw={160}
					/>
				</Group>
				<Text size="sm" c="dimmed">
					{t("settings.balance.hint")}
				</Text>
				<Group grow>
					<Button type="submit" loading={update.isPending}>
						{t("settings.balance.save")}
					</Button>
					{balance && (
						<Button
							variant="default"
							loading={remove.isPending}
							onClick={handleClear}
						>
							{t("settings.balance.clear")}
						</Button>
					)}
				</Group>
			</Stack>
		</form>
	);
}

export function AccountBalanceSection() {
	const { t } = useTranslation();
	const balanceQuery = useAccountBalance();
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const balance = balanceQuery.data ?? null;

	return (
		<Paper>
			<Stack>
				<Title order={3} fz={20}>
					{t("settings.balance.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("settings.balance.description")}
				</Text>

				{feedback?.kind === "error" && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{feedback.message}
					</Alert>
				)}
				{(feedback?.kind === "saved" || feedback?.kind === "cleared") && (
					<Alert color="leaf" icon={<IconCheck size={16} />}>
						{t(
							feedback.kind === "saved"
								? "settings.balance.saved"
								: "settings.balance.cleared",
						)}
					</Alert>
				)}

				{balanceQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{balanceQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("common.error")}
					</Alert>
				)}
				{balanceQuery.isSuccess && (
					<AccountBalanceForm
						key={balance ? `${balance.amount}@${balance.date}` : "none"}
						balance={balance}
						onFeedback={setFeedback}
					/>
				)}
			</Stack>
		</Paper>
	);
}
