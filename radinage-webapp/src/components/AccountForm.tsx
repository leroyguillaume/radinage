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
import { IconAlertCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { BalanceFields } from "@/components/BalanceFields";
import { ApiError } from "@/lib/api";
import { readBalanceInput } from "@/lib/balance-history";
import { useSaveAccount, useSaveAccountBalance } from "@/lib/hooks";
import type { AccountKind, AccountResponse } from "@/lib/types";

const ISO_DATE = "YYYY-MM-DD";

interface AccountFormProps {
	/** The account to edit, null to create one. */
	account: AccountResponse | null;
	onSaved: () => void;
	onCancel: () => void;
}

/**
 * Name and kind of an account, plus an optional starting balance when it is created; later
 * balances are recorded in the account's history.
 */
export function AccountForm({ account, onSaved, onCancel }: AccountFormProps) {
	const { t } = useTranslation();
	const saveAccount = useSaveAccount();
	const saveBalance = useSaveAccountBalance();
	const today = dayjs().format(ISO_DATE);

	const [name, setName] = useState(account?.name ?? "");
	const [kind, setKind] = useState<AccountKind>(account?.kind ?? "checking");
	const [imported, setImported] = useState(account?.imported ?? true);
	const [amount, setAmount] = useState("");
	const [date, setDate] = useState<string | null>(today);
	const [error, setError] = useState<string | null>(null);

	const receivesOperations = kind === "checking" && imported;

	/** What a 409 on save means, judged from what the form changes on the account. */
	function conflictKey(): string {
		if (account?.receivesOperations && !receivesOperations) {
			return "accounts.inUse";
		}
		if (account?.kind === "savings" && kind !== "savings") {
			return "accounts.savedInto";
		}
		return "accounts.nameTaken";
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const starting = account ? null : readBalanceInput(amount, date, today);
		if (starting && !starting.ok) {
			setError(t(starting.error));
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
					? t(conflictKey())
					: t("accounts.saveError"),
			);
			return;
		}
		if (starting) {
			try {
				await saveBalance.mutateAsync({
					accountId: saved.id,
					body: starting.balance,
				});
			} catch {
				setError(t("accounts.saveError"));
				return;
			}
		}
		onSaved();
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
							: kind === "savings"
								? "accounts.savingsHint"
								: "accounts.notImportedHint",
					)}
				</Text>
				{account === null && (
					<BalanceFields
						label={t(
							receivesOperations
								? "accounts.startingBalance"
								: "accounts.balance",
						)}
						amount={amount}
						onAmountChange={setAmount}
						date={date}
						onDateChange={setDate}
					/>
				)}
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
			</Stack>
		</form>
	);
}
