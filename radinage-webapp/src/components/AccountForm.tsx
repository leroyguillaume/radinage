import {
	Alert,
	Button,
	Group,
	SegmentedControl,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconAlertCircle } from "@tabler/icons-react";
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
	useDeleteAccountBalance,
	useSaveAccount,
	useSaveAccountBalance,
} from "@/lib/hooks";
import type { AccountKind, AccountResponse } from "@/lib/types";

const ISO_DATE = "YYYY-MM-DD";

interface AccountFormProps {
	/** The account to edit, null to create one. */
	account: AccountResponse | null;
	onSaved: () => void;
	onCancel: () => void;
}

/** Name, kind and starting balance of an account; the balance is optional. */
export function AccountForm({ account, onSaved, onCancel }: AccountFormProps) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	const saveAccount = useSaveAccount();
	const saveBalance = useSaveAccountBalance();
	const deleteBalance = useDeleteAccountBalance();
	const today = dayjs().format(ISO_DATE);
	const balance = account?.balance ?? null;

	const [name, setName] = useState(account?.name ?? "");
	const [kind, setKind] = useState<AccountKind>(account?.kind ?? "checking");
	const [imported, setImported] = useState(account?.imported ?? true);
	const [amount, setAmount] = useState(
		balance
			? toDisplayAmount(centsToDecimal(decimalToCents(balance.amount)), locale)
			: "",
	);
	const [date, setDate] = useState<string | null>(balance?.date ?? today);
	const [error, setError] = useState<string | null>(null);

	const receivesOperations = kind === "checking" && imported;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const cents = amount.trim() === "" ? null : parseSignedCents(amount);
		if (amount.trim() !== "" && cents === null) {
			setError(t("accounts.errorAmount"));
			return;
		}
		if (cents !== null && (date === null || date > today)) {
			setError(t("accounts.errorDate"));
			return;
		}
		let saved: AccountResponse;
		try {
			saved = await saveAccount.mutateAsync({
				...(account ? { id: account.id } : {}),
				body: { name: name.trim(), kind, imported: receivesOperations },
			});
		} catch (err) {
			setError(
				err instanceof ApiError && err.status === 409
					? t(
							account && !receivesOperations && account.receivesOperations
								? "accounts.inUse"
								: "accounts.nameTaken",
						)
					: t("accounts.saveError"),
			);
			return;
		}
		if (cents !== null && date !== null) {
			const body = { amount: centsToDecimal(cents), date };
			const unchanged =
				balance !== null &&
				decimalToCents(balance.amount) === cents &&
				balance.date === date;
			try {
				if (!unchanged) {
					await saveBalance.mutateAsync({
						accountId: saved.id,
						...(balance ? { balanceId: balance.id } : {}),
						body,
					});
				}
			} catch {
				setError(t("accounts.saveError"));
				return;
			}
		}
		onSaved();
	}

	async function handleClearBalance() {
		if (!account || !balance) return;
		setError(null);
		try {
			await deleteBalance.mutateAsync({
				accountId: account.id,
				balanceId: balance.id,
			});
			onSaved();
		} catch {
			setError(t("common.error"));
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="sm">
				<TextInput
					label={t("accounts.name")}
					placeholder={t("accounts.namePlaceholder")}
					value={name}
					onChange={(e) => setName(e.currentTarget.value)}
					required
					maxLength={100}
				/>
				<Stack gap={4}>
					<Text size="sm" fw={500}>
						{t("accounts.kind")}
					</Text>
					<SegmentedControl
						fullWidth
						value={kind}
						onChange={(value) =>
							setKind(value === "savings" ? value : "checking")
						}
						data={[
							{ value: "checking", label: t("accounts.kinds.checking") },
							{ value: "savings", label: t("accounts.kinds.savings") },
						]}
					/>
				</Stack>
				{kind === "checking" && (
					<Switch
						size="md"
						checked={imported}
						onChange={(e) => setImported(e.currentTarget.checked)}
						label={t("accounts.imported")}
					/>
				)}
				<Text size="sm" c="dimmed">
					{t(
						receivesOperations
							? "accounts.importedHint"
							: "accounts.notImportedHint",
					)}
				</Text>
				<Group grow align="flex-start" wrap="wrap">
					<TextInput
						label={t(
							receivesOperations
								? "accounts.startingBalance"
								: "accounts.balance",
						)}
						inputMode="decimal"
						placeholder={toDisplayAmount("0", locale)}
						rightSection={
							<Text c="dimmed" aria-hidden>
								€
							</Text>
						}
						value={amount}
						onChange={(e) => setAmount(e.currentTarget.value)}
						miw={140}
					/>
					<DateInput
						label={t("accounts.balanceDate")}
						locale={locale}
						valueFormat="DD/MM/YYYY"
						maxDate={today}
						value={date}
						onChange={setDate}
						miw={140}
					/>
				</Group>
				<Text size="xs" c="dimmed">
					{t("accounts.balanceHint")}
				</Text>
				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}
				<Group grow>
					<Button variant="default" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
					<Button
						type="submit"
						loading={saveAccount.isPending || saveBalance.isPending}
					>
						{t("common.save")}
					</Button>
				</Group>
				{balance && (
					<Button
						variant="subtle"
						color="gray"
						loading={deleteBalance.isPending}
						onClick={handleClearBalance}
					>
						{t("accounts.clearBalance")}
					</Button>
				)}
			</Stack>
		</form>
	);
}
