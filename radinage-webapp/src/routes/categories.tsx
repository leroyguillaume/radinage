import {
	Alert,
	Button,
	Code,
	Group,
	Loader,
	Paper,
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
	IconFilter,
	IconPlayerPlay,
	IconPlus,
	IconSearch,
	IconTrash,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CardAction } from "@/components/CardAction";
import { CategoryDot } from "@/components/CategoryBadge";
import { CategoryModal } from "@/components/CategoryModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { PageHeader } from "@/components/PageHeader";
import {
	useApplyCategory,
	useCategories,
	useDeleteCategory,
} from "@/lib/hooks";
import { budgetTypeTones } from "@/lib/tones";
import type { ApplyCategoryResponse, CategoryResponse } from "@/lib/types";
import { palette } from "@/theme";

export const Route = createFileRoute("/categories")({
	component: CategoriesPage,
});

type RulesFilter = "all" | "withRules" | "withoutRules";

const rulesFilters: RulesFilter[] = ["all", "withRules", "withoutRules"];

function isRulesFilter(value: string): value is RulesFilter {
	return rulesFilters.some((f) => f === value);
}

/** The category being edited: an existing one, a new one, or none. */
type Editing =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "edit"; category: CategoryResponse };

export function CategoriesPage() {
	const { t } = useTranslation();
	const categoriesQuery = useCategories();
	const deleteCategory = useDeleteCategory();
	const applyCategory = useApplyCategory();
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const [applyConfirm, setApplyConfirm] = useState<CategoryResponse | null>(
		null,
	);
	const [applyResults, setApplyResults] = useState<
		Record<string, ApplyCategoryResponse>
	>({});
	const [applyError, setApplyError] = useState(false);
	const [deleteConfirm, setDeleteConfirm] = useState<CategoryResponse | null>(
		null,
	);
	const [search, setSearch] = useState("");
	const [rulesFilter, setRulesFilter] = useState<RulesFilter>("all");

	const all = categoriesQuery.data ?? [];
	const categories = useMemo(() => {
		const query = search.trim().toLowerCase();
		return (categoriesQuery.data ?? []).filter(
			(c) =>
				(rulesFilter === "all" ||
					(rulesFilter === "withRules") === c.rules.length > 0) &&
				c.name.toLowerCase().includes(query),
		);
	}, [categoriesQuery.data, search, rulesFilter]);

	function handleSaved(saved: CategoryResponse, rulesChanged: boolean) {
		setEditing({ kind: "none" });
		if (rulesChanged && saved.rules.length > 0) {
			setApplyConfirm(saved);
		}
	}

	async function handleApplyConfirmed(force: boolean) {
		if (!applyConfirm) return;
		setApplyError(false);
		try {
			const result = await applyCategory.mutateAsync({
				id: applyConfirm.id,
				force,
			});
			setApplyResults((prev) => ({ ...prev, [applyConfirm.id]: result }));
		} catch {
			setApplyError(true);
		}
		setApplyConfirm(null);
	}

	async function handleDeleteConfirmed() {
		if (!deleteConfirm) return;
		await deleteCategory.mutateAsync(deleteConfirm.id);
		setDeleteConfirm(null);
	}

	if (categoriesQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	if (categoriesQuery.isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert
					icon={<IconAlertCircle size={16} />}
					color="tangerine"
					title={t("common.error")}
				>
					{t("categories.fetchError")}
				</Alert>
			</div>
		);
	}

	return (
		<div className="h-full overflow-auto">
			<CategoryModal
				opened={editing.kind !== "none"}
				category={editing.kind === "edit" ? editing.category : null}
				categories={all}
				onClose={() => setEditing({ kind: "none" })}
				onSaved={handleSaved}
			/>

			<ConfirmModal
				opened={applyConfirm !== null}
				onClose={() => setApplyConfirm(null)}
				title={t("categories.applyTitle", { name: applyConfirm?.name ?? "" })}
				message={t("categories.applyPrompt", {
					name: applyConfirm?.name ?? "",
				})}
			>
				<Button variant="default" onClick={() => setApplyConfirm(null)}>
					{t("common.cancel")}
				</Button>
				<Button
					variant="outline"
					onClick={() => handleApplyConfirmed(false)}
					loading={applyCategory.isPending}
				>
					{t("categories.applyKeep")}
				</Button>
				<Button
					onClick={() => handleApplyConfirmed(true)}
					loading={applyCategory.isPending}
				>
					{t("categories.applyForce")}
				</Button>
			</ConfirmModal>

			<ConfirmModal
				opened={deleteConfirm !== null}
				onClose={() => setDeleteConfirm(null)}
				title={t("categories.delete", { name: deleteConfirm?.name ?? "" })}
				message={t("categories.confirmDelete", {
					name: deleteConfirm?.name ?? "",
				})}
			>
				<Button variant="default" onClick={() => setDeleteConfirm(null)}>
					{t("common.cancel")}
				</Button>
				<Button
					color="tangerine.8"
					leftSection={<IconTrash size={18} />}
					onClick={handleDeleteConfirmed}
					loading={deleteCategory.isPending}
				>
					{t("common.delete")}
				</Button>
			</ConfirmModal>

			<Stack
				maw={1240}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<PageHeader
					title={t("categories.title")}
					subtitle={t("categories.description")}
					subtitleInfoLabel={t("categories.title")}
					actions={
						<Button
							leftSection={<IconPlus size={20} />}
							onClick={() => setEditing({ kind: "new" })}
						>
							{t("categories.create")}
						</Button>
					}
				/>

				{applyError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("categories.applyError")}
					</Alert>
				)}

				{all.length === 0 ? (
					<Text c="dimmed" ta="center" mt="xl">
						{t("categories.empty")}
					</Text>
				) : (
					<>
						<Group gap="sm" wrap="wrap" align="center">
							<TextInput
								placeholder={t("common.search")}
								aria-label={t("common.search")}
								leftSection={<IconSearch size={20} />}
								value={search}
								onChange={(e) => setSearch(e.currentTarget.value)}
								style={{ flex: "1 1 280px" }}
							/>
							<SegmentedControl
								radius="xl"
								size="md"
								aria-label={t("categories.filterByRules")}
								value={rulesFilter}
								onChange={(v) => {
									if (isRulesFilter(v)) setRulesFilter(v);
								}}
								data={rulesFilters.map((f) => ({
									value: f,
									label: t(`categories.filters.${f}`),
								}))}
							/>
						</Group>

						{categories.length === 0 ? (
							<Text c="dimmed" ta="center" mt="xl">
								{t("common.noResults")}
							</Text>
						) : (
							<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
								{categories.map((category) => (
									<CategoryCard
										key={category.id}
										category={category}
										applyResult={applyResults[category.id] ?? null}
										onApply={() => setApplyConfirm(category)}
										onEdit={() => setEditing({ kind: "edit", category })}
										onDelete={() => setDeleteConfirm(category)}
									/>
								))}
							</SimpleGrid>
						)}
					</>
				)}
			</Stack>
		</div>
	);
}

function CategoryCard({
	category,
	applyResult,
	onApply,
	onEdit,
	onDelete,
}: {
	category: CategoryResponse;
	applyResult: ApplyCategoryResponse | null;
	onApply: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const { name, rules } = category;

	return (
		<Paper component="article" aria-label={name} p="lg">
			<Stack gap="sm">
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Group gap="sm" wrap="nowrap" miw={0}>
						<CategoryDot category={category} size={34} />
						<Title order={2} fz={20} lineClamp={1}>
							{name}
						</Title>
					</Group>
					<Group gap={0} wrap="nowrap" mr={-8}>
						{rules.length > 0 && (
							<CardAction
								label={t("categories.applyRules", { name })}
								onClick={onApply}
							>
								<IconPlayerPlay size={18} />
							</CardAction>
						)}
						<CardAction label={t("categories.edit", { name })} onClick={onEdit}>
							<IconEdit size={18} />
						</CardAction>
						<CardAction
							label={t("categories.delete", { name })}
							onClick={onDelete}
						>
							<IconTrash size={18} />
						</CardAction>
					</Group>
				</Group>

				{rules.length > 0 ? (
					<>
						<Group gap={6} wrap="wrap">
							{rules.map(({ labelPattern }) => (
								<Text
									key={`${labelPattern.type}:${labelPattern.value}`}
									component="span"
									size="sm"
									px={8}
									py={2}
									bg={palette.surfaceMuted}
									style={{
										border: `1px solid ${palette.border}`,
										borderRadius: 8,
									}}
								>
									<Text component="span" size="sm" c="dimmed">
										{t(`rules.patterns.${labelPattern.type}`).toLowerCase()}
									</Text>{" "}
									<Code fw={600}>{labelPattern.value}</Code>
								</Text>
							))}
						</Group>
						<Group gap={6} wrap="nowrap">
							<IconFilter size={16} color="var(--mantine-color-dimmed)" />
							<Text size="sm" c="dimmed">
								{t("categories.rulesCount", { count: rules.length })}
							</Text>
						</Group>
					</>
				) : (
					<Text size="sm" c="dimmed">
						{t("categories.noRules")}
					</Text>
				)}

				{applyResult && (
					<Text size="sm" fw={600} c={budgetTypeTones.income.text}>
						{t("categories.applyResult", {
							updated: applyResult.updated,
							skipped: applyResult.skipped,
						})}
					</Text>
				)}
			</Stack>
		</Paper>
	);
}
