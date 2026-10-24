import { Group, Stack, Text, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { toDisplayAmount } from "@/lib/format";

interface BalanceFieldsProps {
	label: string;
	amount: string;
	onAmountChange: (amount: string) => void;
	/** YYYY-MM-DD, today or earlier. */
	date: string | null;
	onDateChange: (date: string | null) => void;
}

/** The amount and day of a balance read on an account. */
export function BalanceFields({
	label,
	amount,
	onAmountChange,
	date,
	onDateChange,
}: BalanceFieldsProps) {
	const { t, i18n } = useTranslation();
	const locale = i18n.language;
	return (
		<Stack gap="xs">
			<Group grow align="flex-start" wrap="wrap">
				<TextInput
					label={label}
					inputMode="decimal"
					placeholder={toDisplayAmount("0", locale)}
					rightSection={
						<Text c="dimmed" aria-hidden>
							€
						</Text>
					}
					value={amount}
					onChange={(e) => onAmountChange(e.currentTarget.value)}
					miw={140}
				/>
				<DateInput
					label={t("accounts.balanceDate")}
					locale={locale}
					valueFormat="DD/MM/YYYY"
					maxDate={dayjs().format("YYYY-MM-DD")}
					value={date}
					onChange={onDateChange}
					miw={140}
				/>
			</Group>
			<Text size="xs" c="dimmed">
				{t("accounts.balanceHint")}
			</Text>
		</Stack>
	);
}
