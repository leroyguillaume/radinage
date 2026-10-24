import { Badge, Box, Checkbox, Text, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TransferBadge } from "@/components/TransferBadge";
import { formatIsoDate, formatSignedAmount } from "@/lib/format";
import { useAccounts } from "@/lib/hooks";
import { balanceTextColor } from "@/lib/tones";
import { transferFlow, transferTone } from "@/lib/transfers";
import type { OperationResponse } from "@/lib/types";
import { palette } from "@/theme";

const ROW_CLASS =
	"grid min-h-[44px] w-full items-center gap-x-3 py-2 text-left sm:gap-x-4 sm:py-1";

/**
 * Fixed column tracks from `sm` up, so every row of a list lines its
 * columns up whatever their content.
 */
const ROW_TRACKS =
	"[grid-template-areas:'label_amount'_'meta_meta'] grid-cols-[minmax(0,1fr)_auto] sm:[grid-template-areas:'date_label_category_budget_amount'] sm:grid-cols-[96px_minmax(0,1fr)_180px_160px_136px]";

/** `ROW_TRACKS` behind a leading checkbox column. */
const SELECTABLE_ROW_TRACKS =
	"[grid-template-areas:'check_label_amount'_'check_meta_meta'] grid-cols-[auto_minmax(0,1fr)_auto] sm:[grid-template-areas:'check_date_label_category_budget_amount'] sm:grid-cols-[auto_96px_minmax(0,1fr)_180px_160px_136px]";

interface OperationRowProps {
	op: OperationResponse;
	/** The amount shown: the whole operation's, or one of its parts'. */
	amount: number;
	/** The date shown (YYYY-MM-DD): the whole operation's, or one of its parts'. */
	date: string;
	category: ReactNode;
	budget: string;
	/** Shown after the label, before the ignored badge. */
	badge?: ReactNode;
	onOpen: (op: OperationResponse) => void;
	/** Turns the row into a checkbox toggling the operation in a selection. */
	selection?: { selected: boolean; onToggle: (op: OperationResponse) => void };
}

/** A list row opening the operation sheet, its columns lined up from `sm` up. */
export function OperationRow({
	op,
	amount,
	date,
	category,
	budget,
	badge,
	onOpen,
	selection,
}: OperationRowProps) {
	const { t, i18n } = useTranslation();
	const accounts = useAccounts().data ?? [];
	const flow = transferFlow(op, accounts);
	const amountColor = flow ? transferTone(flow).text : balanceTextColor(amount);

	return (
		<Box
			component="li"
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			<UnstyledButton
				onClick={() => (selection ? selection.onToggle(op) : onOpen(op))}
				role={selection ? "checkbox" : undefined}
				aria-checked={selection?.selected}
				className={`${ROW_CLASS} ${selection ? SELECTABLE_ROW_TRACKS : ROW_TRACKS}`}
			>
				{selection && (
					<Checkbox
						checked={selection.selected}
						readOnly
						tabIndex={-1}
						aria-hidden
						className="pointer-events-none [grid-area:check]"
					/>
				)}
				<Box className="flex min-w-0 items-center gap-2 [grid-area:label]">
					<Text
						fw={500}
						c={op.ignored ? "dimmed" : undefined}
						td={op.ignored ? "line-through" : undefined}
						className="line-clamp-2 [overflow-wrap:anywhere] sm:line-clamp-1"
						title={op.label}
					>
						{op.label}
					</Text>
					{badge}
					{op.transfer && <TransferBadge op={op} accounts={accounts} />}
					{op.ignored && (
						<Badge size="sm" color="gray" tt="none" flex="none">
							{op.ignoreRuleId === null
								? t("search.ignored")
								: t("ignoreRules.ignoredByRule")}
						</Badge>
					)}
				</Box>
				<Text
					fw={700}
					className="tabular-nums [grid-area:amount] sm:text-right"
					c={op.ignored ? "dimmed" : amountColor}
					td={op.ignored ? "line-through" : undefined}
					style={{ whiteSpace: "nowrap" }}
				>
					{formatSignedAmount(amount)}
				</Text>
				<Box className="flex min-w-0 flex-wrap items-center gap-x-3 [grid-area:meta] sm:contents">
					<Text
						span
						size="sm"
						c="dimmed"
						className="tabular-nums sm:[grid-area:date]"
					>
						{formatIsoDate(date, i18n.language)}
					</Text>
					<Box miw={0} className="overflow-hidden sm:[grid-area:category]">
						{category}
					</Box>
					<Text size="sm" c="dimmed" truncate className="sm:[grid-area:budget]">
						{budget}
					</Text>
				</Box>
			</UnstyledButton>
		</Box>
	);
}
