import { Badge, Box, Text, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatSignedAmount } from "@/lib/format";
import { balanceTextColor } from "@/lib/tones";
import type { OperationResponse } from "@/lib/types";
import { palette } from "@/theme";

export function accountingDate(op: OperationResponse): string {
	return op.effectiveDate ?? op.date;
}

/**
 * Fixed column tracks from `sm` up, so every row of a list lines its
 * columns up whatever their content.
 */
const ROW_CLASS =
	"grid min-h-[44px] w-full items-center gap-x-3 py-2 text-left [grid-template-areas:'label_amount'_'meta_meta'] grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4 sm:py-1 sm:[grid-template-areas:'date_label_category_budget_amount'] sm:grid-cols-[96px_minmax(0,1fr)_180px_160px_136px]";

interface OperationRowProps {
	op: OperationResponse;
	/** The amount shown: the whole operation's, or one of its parts'. */
	amount: number;
	category: ReactNode;
	budget: string;
	/** Shown after the label, before the ignored badge. */
	badge?: ReactNode;
	onOpen: (op: OperationResponse) => void;
}

/** A list row opening the operation sheet, its columns lined up from `sm` up. */
export function OperationRow({
	op,
	amount,
	category,
	budget,
	badge,
	onOpen,
}: OperationRowProps) {
	const { t, i18n } = useTranslation();

	return (
		<Box
			component="li"
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			<UnstyledButton onClick={() => onOpen(op)} className={ROW_CLASS}>
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
					c={op.ignored ? "dimmed" : balanceTextColor(amount)}
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
						{formatIsoDate(accountingDate(op), i18n.language)}
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
