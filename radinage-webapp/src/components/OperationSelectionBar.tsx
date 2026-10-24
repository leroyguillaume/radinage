import {
	Button,
	Group,
	Modal,
	Paper,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconBuildingBank,
	IconCheck,
	IconTag,
	IconX,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategorySelect } from "@/components/CategoryBadge";
import { useSetOperationsAccount, useSetOperationsCategory } from "@/lib/hooks";
import { isSplit } from "@/lib/operation-parts";
import type {
	AccountResponse,
	CategoryResponse,
	OperationResponse,
} from "@/lib/types";

interface OperationSelectionBarProps {
	selected: OperationResponse[];
	/** How many operations could be selected, to offer selecting them all. */
	selectable: number;
	accounts: AccountResponse[];
	categories: CategoryResponse[];
	onSelectAll: () => void;
	onClear: () => void;
	/** Leaves the selection mode. */
	onDone: () => void;
}

type Editing = "account" | "category" | null;

/** The category option clearing the operations' own category. */
const NO_CATEGORY = "none";

/** What can be done to the selected operations at once, stuck to the bottom of the page. */
export function OperationSelectionBar({
	selected,
	selectable,
	accounts,
	categories,
	onSelectAll,
	onClear,
	onDone,
}: OperationSelectionBarProps) {
	const { t } = useTranslation();
	const [editing, setEditing] = useState<Editing>(null);
	const count = selected.length;
	const allSelected = count === selectable;
	const close = () => setEditing(null);
	const applied = () => {
		close();
		onClear();
	};

	return (
		<>
			<Paper
				shadow="md"
				p="sm"
				radius="lg"
				className="sticky bottom-0 z-10"
				role="region"
				aria-label={t("search.selection.region")}
			>
				<Stack gap="xs">
					<Group justify="space-between" wrap="nowrap" gap="xs">
						<Text fw={700} aria-live="polite">
							{t("search.selection.count", { count })}
						</Text>
						<Group gap={4} wrap="nowrap">
							<Button
								variant="subtle"
								h={44}
								onClick={allSelected ? onClear : onSelectAll}
							>
								{allSelected
									? t("search.selection.selectNone")
									: t("search.selection.selectAll")}
							</Button>
							<Button
								variant="subtle"
								color="gray"
								h={44}
								leftSection={<IconX size={18} />}
								onClick={onDone}
							>
								{t("search.selection.done")}
							</Button>
						</Group>
					</Group>
					<Group grow gap="xs">
						<Button
							variant="light"
							h={48}
							leftSection={<IconBuildingBank size={18} />}
							disabled={count === 0}
							onClick={() => setEditing("account")}
						>
							{t("search.selection.account")}
						</Button>
						<Button
							variant="light"
							h={48}
							leftSection={<IconTag size={18} />}
							disabled={count === 0 || categories.length === 0}
							onClick={() => setEditing("category")}
						>
							{t("search.selection.category")}
						</Button>
					</Group>
				</Stack>
			</Paper>
			<AccountModal
				opened={editing === "account"}
				selected={selected}
				accounts={accounts}
				onClose={close}
				onApplied={applied}
			/>
			<CategoryModal
				opened={editing === "category"}
				selected={selected}
				categories={categories}
				onClose={close}
				onApplied={applied}
			/>
		</>
	);
}

interface EditModalProps {
	opened: boolean;
	selected: OperationResponse[];
	onClose: () => void;
	onApplied: () => void;
}

function AccountModal({
	accounts,
	...props
}: EditModalProps & { accounts: AccountResponse[] }) {
	const { t } = useTranslation();
	const setAccount = useSetOperationsAccount();
	const [accountId, setAccountId] = useState<string | null>(null);
	const options = accounts.filter((a) => a.receivesOperations);

	return (
		<EditModal
			{...props}
			title={t("search.selection.accountTitle", {
				count: props.selected.length,
			})}
			canApply={accountId !== null}
			pending={setAccount.isPending}
			failed={setAccount.isError}
			onApply={() => {
				if (accountId === null) return;
				setAccount.mutate(
					{ operationIds: props.selected.map((op) => op.id), accountId },
					{ onSuccess: props.onApplied },
				);
			}}
		>
			<Select
				label={t("operations.sheet.account")}
				data={options.map((a) => ({ value: a.id, label: a.name }))}
				value={accountId}
				onChange={setAccountId}
				placeholder={t("search.selection.pick")}
				leftSection={<IconBuildingBank size={18} />}
				comboboxProps={{ withinPortal: true }}
				data-autofocus
			/>
		</EditModal>
	);
}

function CategoryModal({
	categories,
	...props
}: EditModalProps & { categories: CategoryResponse[] }) {
	const { t } = useTranslation();
	const setCategory = useSetOperationsCategory();
	const [choice, setChoice] = useState<string | null>(null);
	const unsplit = props.selected.filter((op) => !isSplit(op));
	const splitCount = props.selected.length - unsplit.length;

	return (
		<EditModal
			{...props}
			title={t("search.selection.categoryTitle", {
				count: props.selected.length,
			})}
			canApply={choice !== null && unsplit.length > 0}
			pending={setCategory.isPending}
			failed={setCategory.isError}
			onApply={() => {
				if (choice === null) return;
				setCategory.mutate(
					{
						operationIds: unsplit.map((op) => op.id),
						categoryId: choice === NO_CATEGORY ? null : choice,
					},
					{ onSuccess: props.onApplied },
				);
			}}
		>
			<CategorySelect
				label={t("operations.sheet.category")}
				categories={categories}
				extraOptions={[
					{ value: NO_CATEGORY, label: t("search.selection.noCategory") },
				]}
				value={choice}
				onChange={setChoice}
				placeholder={t("search.selection.pick")}
				leftSection={<IconTag size={18} />}
				data-autofocus
			/>
			{splitCount > 0 && (
				<Text size="sm" c="dimmed">
					{t("search.selection.splitKept", { count: splitCount })}
				</Text>
			)}
		</EditModal>
	);
}

function EditModal({
	opened,
	onClose,
	title,
	canApply,
	pending,
	failed,
	onApply,
	children,
}: Omit<EditModalProps, "selected" | "onApplied"> & {
	title: string;
	canApply: boolean;
	pending: boolean;
	failed: boolean;
	onApply: () => void;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={title}
			closeButtonProps={{ size: 44, "aria-label": t("common.close") }}
		>
			<Stack gap="md">
				{children}
				{failed && (
					<Text size="sm" c="tangerine.8" role="alert">
						{t("common.error")}
					</Text>
				)}
				<Group justify="flex-end" gap="xs">
					<Button variant="default" h={44} onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						h={44}
						leftSection={<IconCheck size={18} />}
						disabled={!canApply}
						loading={pending}
						onClick={onApply}
					>
						{t("search.selection.apply")}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
