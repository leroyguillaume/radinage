import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Card,
	Group,
	Loader,
	Modal,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconEdit,
	IconPlayerPlay,
	IconPlus,
	IconSearch,
	IconTrash,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BudgetModal } from "@/components/BudgetModal";
import { useApplyBudget, useBudgets, useDeleteBudget } from "@/lib/hooks";
import type { ApplyBudgetResponse, BudgetResponse } from "@/lib/types";

export const Route = createFileRoute("/budgets")({
	component: BudgetsPage,
});

function budgetTypeColor(type: string): string {
	switch (type) {
		case "income":
			return "green";
		case "expense":
			return "red";
		case "savings":
			return "blue";
		default:
			return "gray";
	}
}

function formatAmount(amount: string): string {
	return new Intl.NumberFormat("fr-FR", {
		style: "currency",
		currency: "EUR",
	}).format(Number(amount));
}

type BudgetSortKey = "label" | "type" | "amount";

function getCurrentAmount(budget: BudgetResponse): number {
	if (budget.kind.type === "occasional") return Number(budget.kind.amount);
	return Number(budget.kind.currentPeriod.amount);
}

function BudgetsPage() {
	const { t } = useTranslation();
	const budgetsQuery = useBudgets();
	const deleteBudget = useDeleteBudget();
	const applyBudget = useApplyBudget();

	const [modalOpened, setModalOpened] = useState(false);
	const [editingBudget, setEditingBudget] = useState<BudgetResponse | null>(
		null,
	);
	const [applyResults, setApplyResults] = useState<
		Record<string, ApplyBudgetResponse>
	>({});
	const [applyConfirm, setApplyConfirm] = useState<BudgetResponse | null>(null);
	const [sortKey, setSortKey] = useState<BudgetSortKey>("label");
	const [search, setSearch] = useState("");

	function handleEdit(budget: BudgetResponse) {
		setEditingBudget(budget);
		setModalOpened(true);
	}

	function handleCreate() {
		setEditingBudget(null);
		setModalOpened(true);
	}

	async function handleDelete(budget: BudgetResponse) {
		await deleteBudget.mutateAsync(budget.id);
	}

	async function handleApplyConfirmed(force: boolean) {
		if (!applyConfirm) return;
		const result = await applyBudget.mutateAsync({
			id: applyConfirm.id,
			force,
		});
		setApplyResults((prev) => ({ ...prev, [applyConfirm.id]: result }));
		setApplyConfirm(null);
	}

	const budgets = useMemo(() => {
		const all = budgetsQuery.data ?? [];
		const filtered = search
			? all.filter((b) => b.label.toLowerCase().includes(search.toLowerCase()))
			: all;

		return [...filtered].sort((a, b) => {
			switch (sortKey) {
				case "type":
					return a.budgetType.localeCompare(b.budgetType);
				case "amount":
					return getCurrentAmount(a) - getCurrentAmount(b);
				default:
					return a.label.localeCompare(b.label);
			}
		});
	}, [budgetsQuery.data, sortKey, search]);

	if (budgetsQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader color="green" />
			</div>
		);
	}

	if (budgetsQuery.isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="red"
					title={t("common.error")}
				>
					{t("budgets.fetchError")}
				</Alert>
			</div>
		);
	}

	return (
		<div className="mx-auto h-full max-w-4xl overflow-y-auto p-3 sm:p-6">
			<BudgetModal
				opened={modalOpened}
				onClose={() => setModalOpened(false)}
				budget={editingBudget}
			/>

			<Modal
				opened={applyConfirm !== null}
				onClose={() => setApplyConfirm(null)}
				title={t("budgets.applyRulesTitle")}
				size="sm"
			>
				<Stack>
					<Text>{t("budgets.applyForcePrompt")}</Text>
					<Group justify="flex-end">
						<Button variant="subtle" onClick={() => setApplyConfirm(null)}>
							{t("common.cancel")}
						</Button>
						<Button
							variant="outline"
							onClick={() => handleApplyConfirmed(false)}
							loading={applyBudget.isPending}
						>
							{t("budgets.applySkipManual")}
						</Button>
						<Button
							onClick={() => handleApplyConfirmed(true)}
							loading={applyBudget.isPending}
						>
							{t("budgets.applyForceManual")}
						</Button>
					</Group>
				</Stack>
			</Modal>

			<Group justify="space-between" mb="lg">
				<Title order={2} c="white">
					{t("budgets.title")}
				</Title>
				<Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
					{t("budgets.create")}
				</Button>
			</Group>

			<Group mb="md" gap="sm" wrap="wrap">
				<TextInput
					placeholder={t("common.search")}
					leftSection={<IconSearch size={14} />}
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					style={{ flex: 1, minWidth: 150, maxWidth: 300 }}
				/>
				<SegmentedControl
					size="xs"
					value={sortKey}
					onChange={(v) => setSortKey(v as BudgetSortKey)}
					data={[
						{ value: "label", label: t("budgets.fields.label") },
						{ value: "type", label: t("budgets.fields.budgetType") },
						{ value: "amount", label: t("budgets.fields.amount") },
					]}
				/>
			</Group>

			{budgets.length === 0 ? (
				<Text c="dimmed" ta="center" mt="xl">
					{t("common.noResults")}
				</Text>
			) : (
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
					{budgets.map((budget) => (
						<BudgetCard
							key={budget.id}
							budget={budget}
							onEdit={() => handleEdit(budget)}
							onDelete={() => handleDelete(budget)}
							onApply={() => setApplyConfirm(budget)}
							applyResult={applyResults[budget.id] ?? null}
						/>
					))}
				</SimpleGrid>
			)}
		</div>
	);
}

function BudgetCard({
	budget,
	onEdit,
	onDelete,
	onApply,
	applyResult,
}: {
	budget: BudgetResponse;
	onEdit: () => void;
	onDelete: () => void;
	onApply: () => void;
	applyResult: ApplyBudgetResponse | null;
}) {
	const { t } = useTranslation();

	const amount =
		budget.kind.type === "occasional"
			? budget.kind.amount
			: budget.kind.currentPeriod.amount;

	const kindLabel =
		budget.kind.type === "occasional"
			? `${t("budgets.kinds.occasional")} — ${budget.kind.month}/${budget.kind.year}`
			: `${t("budgets.kinds.recurring")} — ${t(`budgets.recurrences.${budget.kind.recurrence}`)}`;

	return (
		<Card
			padding="md"
			radius="md"
			style={{
				backgroundColor: "rgba(255,255,255,0.05)",
				border: "1px solid rgba(255,255,255,0.1)",
			}}
		>
			<Group justify="space-between" mb="xs">
				<Text fw={600} c="white" size="lg">
					{budget.label}
				</Text>
				<Group gap="xs">
					{budget.rules.length > 0 && (
						<ActionIcon
							variant="subtle"
							color="green"
							onClick={onApply}
							aria-label={t("budgets.applyRules")}
						>
							<IconPlayerPlay size={16} />
						</ActionIcon>
					)}
					<ActionIcon
						variant="subtle"
						color="white"
						onClick={onEdit}
						aria-label={t("common.edit")}
					>
						<IconEdit size={16} />
					</ActionIcon>
					<ActionIcon
						variant="subtle"
						color="red"
						onClick={onDelete}
						aria-label={t("common.delete")}
					>
						<IconTrash size={16} />
					</ActionIcon>
				</Group>
			</Group>

			<Stack gap="xs">
				<Group gap="xs">
					<Badge color={budgetTypeColor(budget.budgetType)} size="sm">
						{t(`budgets.types.${budget.budgetType}`)}
					</Badge>
					<Badge variant="outline" color="gray" size="sm">
						{kindLabel}
					</Badge>
				</Group>

				<Text c="white" fw={500} size="xl">
					{formatAmount(amount)}
				</Text>

				{budget.rules.length > 0 && (
					<Text c="dimmed" size="sm">
						{t("budgets.rulesCount", { count: budget.rules.length })}
					</Text>
				)}

				{applyResult && (
					<Text c="green" size="sm">
						{t("budgets.applyResult", {
							updated: applyResult.updated,
							skipped: applyResult.skipped,
						})}
					</Text>
				)}
			</Stack>
		</Card>
	);
}
