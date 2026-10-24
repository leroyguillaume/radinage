import {
	ActionIcon,
	Button,
	Checkbox,
	Group,
	Modal,
	Paper,
	Select,
	Stack,
	Text,
	Tooltip,
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
				aria-label={t("selection.region")}
			>
				<Stack gap="xs">
					<Group justify="space-between" wrap="nowrap" gap="xs">
						<Checkbox
							size="md"
							checked={count > 0 && allSelected}
							indeterminate={count > 0 && !allSelected}
							onChange={allSelected ? onClear : onSelectAll}
							aria-label={
								allSelected
									? t("selection.selectNone")
									: t("selection.selectAll")
							}
							label={
								<Text span fw={700} aria-live="polite">
									{t("selection.count", { count })}
								</Text>
							}
							styles={{ body: { alignItems: "center", minHeight: 44 } }}
						/>
						<Tooltip label={t("selection.done")}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								aria-label={t("selection.done")}
								onClick={onDone}
							>
								<IconX size={20} />
							</ActionIcon>
						</Tooltip>
					</Group>
					<Group grow gap="xs">
						<Button
							variant="light"
							h={48}
							leftSection={<IconBuildingBank size={18} />}
							disabled={count === 0}
							onClick={() => setEditing("account")}
						>
							{t("selection.account")}
						</Button>
						<Button
							variant="light"
							h={48}
							leftSection={<IconTag size={18} />}
							disabled={count === 0 || categories.length === 0}
							onClick={() => setEditing("category")}
						>
							{t("selection.category")}
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
			title={t("selection.accountTitle", {
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
				placeholder={t("selection.pick")}
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
			title={t("selection.categoryTitle", {
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
					{ value: NO_CATEGORY, label: t("selection.noCategory") },
				]}
				value={choice}
				onChange={setChoice}
				placeholder={t("selection.pick")}
				leftSection={<IconTag size={18} />}
				data-autofocus
			/>
			{splitCount > 0 && (
				<Text size="sm" c="dimmed">
					{t("selection.splitKept", { count: splitCount })}
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
						{t("selection.apply")}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
