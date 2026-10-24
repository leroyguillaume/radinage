import { type ReactNode, useState } from "react";
import {
	type BudgetInitialValues,
	BudgetModal,
} from "@/components/BudgetModal";
import { IgnoreRuleModal } from "@/components/IgnoreRuleForm";
import {
	type OperationHandlers,
	OperationSheet,
} from "@/components/OperationSheet";
import { SplitOperationModal } from "@/components/SplitOperationModal";
import {
	type TransferRuleDraft,
	TransferRuleModal,
} from "@/components/TransferRuleForm";
import {
	useAccounts,
	useIgnoreRules,
	useLinkBudget,
	useSetOperationAccount,
	useSetOperationCategory,
	useSetOperationIgnored,
	useSetOperationTransfer,
	useTransferRules,
	useUnlinkBudget,
	useUpdateEffectiveDate,
} from "@/lib/hooks";
import type {
	BudgetResponse,
	CategoryResponse,
	LabelPattern,
	OperationResponse,
} from "@/lib/types";

interface OperationActionsOptions {
	/** The operations on screen, where the sheet looks up the one it shows. */
	operations: OperationResponse[];
	budgets: BudgetResponse[];
	categories: CategoryResponse[];
	/** Whether the sheet links to the operation's month. */
	withMonthLink?: boolean;
}

interface OperationActions {
	handlers: OperationHandlers;
	/** The sheet and the modals the handlers open, to render once on the page. */
	dialogs: ReactNode;
}

/** Wires the operation mutations, the operation sheet and the modals they open. */
export function useOperationActions({
	operations,
	budgets,
	categories,
	withMonthLink = false,
}: OperationActionsOptions): OperationActions {
	const linkBudget = useLinkBudget();
	const unlinkBudget = useUnlinkBudget();
	const setOperationIgnored = useSetOperationIgnored();
	const setOperationCategory = useSetOperationCategory();
	const updateEffectiveDate = useUpdateEffectiveDate();
	const ignoreRules = useIgnoreRules().data ?? [];
	const accounts = useAccounts().data ?? [];
	const setOperationAccount = useSetOperationAccount();
	const setOperationTransfer = useSetOperationTransfer();
	const transferRules = useTransferRules().data ?? [];

	const [sheetId, setSheetId] = useState<string | null>(null);
	const [splitTarget, setSplitTarget] = useState<OperationResponse | null>(
		null,
	);
	const [budgetModalOpened, setBudgetModalOpened] = useState(false);
	const [budgetInitial, setBudgetInitial] = useState<
		BudgetInitialValues | undefined
	>();

	const [ignorePattern, setIgnorePattern] = useState<LabelPattern | null>(null);
	const [transferDraft, setTransferDraft] = useState<TransferRuleDraft | null>(
		null,
	);

	/** The label text the user selected, else the whole label. */
	function labelToMatch(op: OperationResponse): string {
		return window.getSelection()?.toString().trim() || op.label;
	}

	function createBudgetFrom(op: OperationResponse) {
		setBudgetInitial({
			amount: op.amount,
			rules: [{ patternType: "contains", patternValue: labelToMatch(op) }],
		});
		setBudgetModalOpened(true);
	}

	const handlers: OperationHandlers = {
		accounts,
		budgets,
		categories,
		ignoreRules,
		transferRules,
		onOpen: (op) => setSheetId(op.id),
		onSetAccount: (opId, accountId) =>
			setOperationAccount.mutate({ opId, accountId }),
		onSetCategory: (opId, categoryId) =>
			setOperationCategory.mutate({ opId, categoryId }),
		onCreateBudget: createBudgetFrom,
		onLink: (opId, budgetId) => linkBudget.mutate({ opId, budgetId }),
		onUnlink: (opId) => unlinkBudget.mutate(opId),
		onSetIgnored: (opId, ignored) =>
			setOperationIgnored.mutate({ opId, ignored }),
		onIgnoreAlways: (op) =>
			setIgnorePattern({ type: "contains", value: labelToMatch(op) }),
		onSetTransfer: (opId, transfer) =>
			setOperationTransfer.mutate({ opId, transfer }),
		onTransferAlways: (op) =>
			setTransferDraft({
				accountId: op.accountId,
				counterpartAccountId: op.transfer?.accountId,
				labelPattern: { type: "contains", value: labelToMatch(op) },
			}),
		onSplit: setSplitTarget,
		onEditEffectiveDate: (op, effectiveDate) =>
			updateEffectiveDate.mutate({ op, effectiveDate }),
	};

	// Looked up by id so the sheet follows the refetched operation after each change.
	const sheetOperation = operations.find((op) => op.id === sheetId) ?? null;
	// An operation that leaves the list (moved to another month) closes the sheet for good.
	if (sheetId !== null && sheetOperation === null) setSheetId(null);

	const dialogs = (
		<>
			<OperationSheet
				operation={sheetOperation}
				handlers={handlers}
				onClose={() => setSheetId(null)}
				withMonthLink={withMonthLink}
			/>
			<BudgetModal
				opened={budgetModalOpened}
				onClose={() => setBudgetModalOpened(false)}
				budget={null}
				initialValues={budgetInitial}
			/>
			<IgnoreRuleModal
				initialPattern={ignorePattern}
				onClose={() => setIgnorePattern(null)}
			/>
			<TransferRuleModal
				draft={transferDraft}
				onClose={() => setTransferDraft(null)}
			/>
			<SplitOperationModal
				operation={splitTarget}
				budgets={budgets}
				categories={categories}
				onClose={() => setSplitTarget(null)}
			/>
		</>
	);

	return { handlers, dialogs };
}
