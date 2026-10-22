import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge, CategoryDot } from "@/components/CategoryBadge";
import { ApiError } from "@/lib/api";
import { categoriesByColor, leastUsedColor } from "@/lib/category-colors";
import { categoryIcons } from "@/lib/category-icons";
import { useCategories, useDeleteCategory, useSaveCategory } from "@/lib/hooks";
import { categoryFill } from "@/lib/tones";
import {
	CATEGORY_COLORS,
	CATEGORY_ICONS,
	type CategoryColor,
	type CategoryIcon,
	type CategoryResponse,
} from "@/lib/types";
import { palette } from "@/theme";

const MAX_NAME_LENGTH = 50;

interface Swatch<T> {
	value: T;
	label: string;
	content: ReactNode;
}

/** A labelled radio group of 44px swatches, the checked one outlined. */
function SwatchGroup<T>({
	id,
	label,
	swatches,
	value,
	onChange,
}: {
	id: string;
	label: string;
	swatches: Swatch<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<Stack gap={4}>
			<Text size="sm" fw={500} id={id}>
				{label}
			</Text>
			<Group gap={4} role="radiogroup" aria-labelledby={id}>
				{swatches.map((swatch) => (
					<UnstyledButton
						key={swatch.label}
						role="radio"
						aria-checked={swatch.value === value}
						aria-label={swatch.label}
						title={swatch.label}
						onClick={() => onChange(swatch.value)}
						w={44}
						h={44}
						className="flex items-center justify-center rounded-md"
						style={{
							outline:
								swatch.value === value
									? "2px solid var(--mantine-color-text)"
									: undefined,
						}}
					>
						{swatch.content}
					</UnstyledButton>
				))}
			</Group>
		</Stack>
	);
}

/** Opacity of a colour other categories already use, still recognisable but receding. */
const TAKEN_OPACITY = 0.35;

function ColorPicker({
	value,
	others,
	onChange,
}: {
	value: CategoryColor;
	/** The other categories, whose colours are shown as taken. */
	others: CategoryResponse[];
	onChange: (color: CategoryColor) => void;
}) {
	const { t } = useTranslation();
	const takenBy = categoriesByColor(others);
	return (
		<SwatchGroup
			id="category-color-label"
			label={t("settings.categories.color")}
			value={value}
			onChange={onChange}
			swatches={CATEGORY_COLORS.map((color) => {
				const names = takenBy.get(color);
				return {
					value: color,
					label: names
						? t("settings.categories.colorOptionTaken", {
								color,
								names: names.join(", "),
							})
						: t("settings.categories.colorOption", { color }),
					content: (
						<Box
							w={24}
							h={24}
							bg={categoryFill(color)}
							opacity={names && color !== value ? TAKEN_OPACITY : 1}
							style={{ borderRadius: "50%" }}
						/>
					),
				};
			})}
		/>
	);
}

/** Size of the icon swatches: the chosen one previews the category's mark. */
const ICON_SWATCH_SIZE = 28;

function IconPicker({
	value,
	color,
	onChange,
}: {
	value: CategoryIcon | null;
	color: CategoryColor;
	onChange: (icon: CategoryIcon | null) => void;
}) {
	const { t } = useTranslation();
	const swatch = (icon: CategoryIcon | null, label: string) => {
		const Icon = icon ? categoryIcons[icon] : undefined;
		return {
			value: icon,
			label,
			content:
				icon === value || !Icon ? (
					<CategoryDot category={{ color, icon }} size={ICON_SWATCH_SIZE} />
				) : (
					<Icon size={22} color="var(--mantine-color-dimmed)" aria-hidden />
				),
		};
	};
	return (
		<SwatchGroup
			id="category-icon-label"
			label={t("settings.categories.icon")}
			value={value}
			onChange={onChange}
			swatches={[
				swatch(null, t("settings.categories.noIcon")),
				...CATEGORY_ICONS.map((icon) =>
					swatch(icon, t(`settings.categories.icons.${icon}`)),
				),
			]}
		/>
	);
}

function CategoryForm({
	category,
	categories,
	onDone,
}: {
	category: CategoryResponse | null;
	categories: CategoryResponse[];
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const save = useSaveCategory();
	const [name, setName] = useState(category?.name ?? "");
	const others = categories.filter((c) => c.id !== category?.id);
	const [color, setColor] = useState<CategoryColor>(
		category?.color ?? leastUsedColor(others),
	);
	const [icon, setIcon] = useState<CategoryIcon | null>(category?.icon ?? null);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const trimmed = name.trim();
		if (trimmed === "" || trimmed.length > MAX_NAME_LENGTH) {
			setError(t("settings.categories.errorName"));
			return;
		}
		if (categories.some((c) => c.name === trimmed && c.id !== category?.id)) {
			setError(t("settings.categories.errorNameTaken"));
			return;
		}
		try {
			await save.mutateAsync({
				...(category ? { id: category.id } : {}),
				body: { name: trimmed, color, icon },
			});
			onDone();
		} catch (err) {
			// The name was checked above, so a conflict is the category limit.
			setError(
				err instanceof ApiError && err.status === 409
					? t("settings.categories.errorLimit")
					: t("common.error"),
			);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="sm">
				<TextInput
					label={t("settings.categories.name")}
					value={name}
					onChange={(e) => setName(e.currentTarget.value)}
					maxLength={MAX_NAME_LENGTH}
					required
					autoFocus
				/>
				<ColorPicker value={color} others={others} onChange={setColor} />
				<IconPicker value={icon} color={color} onChange={setIcon} />
				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}
				<Group grow>
					<Button variant="default" onClick={onDone}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" loading={save.isPending}>
						{t("settings.categories.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

function CategoryRow({
	category,
	onEdit,
}: {
	category: CategoryResponse;
	onEdit: () => void;
}) {
	const { t } = useTranslation();
	const remove = useDeleteCategory();
	const [confirming, setConfirming] = useState(false);
	const editLabel = t("settings.categories.edit", { name: category.name });
	const deleteLabel = t("settings.categories.delete", { name: category.name });

	return (
		<Box
			component="li"
			py={6}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			{confirming ? (
				<Stack gap="xs">
					<Text size="sm">
						{t("settings.categories.confirmDelete", { name: category.name })}
					</Text>
					<Group grow>
						<Button variant="default" onClick={() => setConfirming(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							color="tangerine"
							loading={remove.isPending}
							onClick={() => remove.mutate(category.id)}
						>
							{t("common.delete")}
						</Button>
					</Group>
				</Stack>
			) : (
				<Group justify="space-between" wrap="nowrap">
					<CategoryBadge category={category} />
					<Group gap={2} wrap="nowrap">
						<Tooltip label={editLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={onEdit}
								aria-label={editLabel}
							>
								<IconPencil size={18} />
							</ActionIcon>
						</Tooltip>
						<Tooltip label={deleteLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={() => setConfirming(true)}
								aria-label={deleteLabel}
							>
								<IconTrash size={18} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>
			)}
		</Box>
	);
}

/** The category being edited: an existing one, a new one, or none. */
type Editing =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "edit"; id: string };

export function CategoriesSection() {
	const { t } = useTranslation();
	const categoriesQuery = useCategories();
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const categories = categoriesQuery.data ?? [];
	const stopEditing = () => setEditing({ kind: "none" });

	return (
		<Paper>
			<Stack>
				<Title order={3} fz={20}>
					{t("settings.categories.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("settings.categories.description")}
				</Text>

				{categoriesQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{categoriesQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("settings.categories.fetchError")}
					</Alert>
				)}

				{categoriesQuery.isSuccess && (
					<>
						{categories.length === 0 ? (
							<Text size="sm" c="dimmed">
								{t("settings.categories.empty")}
							</Text>
						) : (
							<Box component="ul" m={0} p={0} className="list-none">
								{categories.map((category) =>
									editing.kind === "edit" && editing.id === category.id ? (
										<Box component="li" key={category.id} py="xs">
											<CategoryForm
												category={category}
												categories={categories}
												onDone={stopEditing}
											/>
										</Box>
									) : (
										<CategoryRow
											key={category.id}
											category={category}
											onEdit={() =>
												setEditing({ kind: "edit", id: category.id })
											}
										/>
									),
								)}
							</Box>
						)}
						{editing.kind === "new" ? (
							<CategoryForm
								category={null}
								categories={categories}
								onDone={stopEditing}
							/>
						) : (
							<Button
								variant="light"
								leftSection={<IconPlus size={18} />}
								onClick={() => setEditing({ kind: "new" })}
								className="self-start"
							>
								{t("settings.categories.add")}
							</Button>
						)}
					</>
				)}
			</Stack>
		</Paper>
	);
}
