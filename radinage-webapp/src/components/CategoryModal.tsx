import {
	ActionIcon,
	Alert,
	Button,
	ColorInput,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/CategoryBadge";
import {
	LabelPatternFields,
	type PatternType,
} from "@/components/LabelPatternFields";
import { ApiError } from "@/lib/api";
import {
	categoriesCloseTo,
	generateColor,
	isHexColor,
} from "@/lib/category-colors";
import { categoryIcons } from "@/lib/category-icons";
import { useBelowBreakpoint, useSaveCategory } from "@/lib/hooks";
import {
	CATEGORY_ICONS,
	type CategoryColor,
	type CategoryIcon,
	type CategoryResponse,
	type CategoryRule,
} from "@/lib/types";

const MAX_NAME_LENGTH = 50;
const MAX_RULE_LENGTH = 100;

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

function ColorPicker({
	value,
	others,
	onChange,
}: {
	/** As typed, so possibly not a colour yet. */
	value: string;
	/** The other categories, warned about when their colour looks the same. */
	others: CategoryResponse[];
	onChange: (color: string) => void;
}) {
	const { t } = useTranslation();
	const close = isHexColor(value) ? categoriesCloseTo(value, others) : [];
	const generateLabel = t("categories.generateColor");
	return (
		<Stack gap={4}>
			<Group gap="xs" align="flex-end" wrap="nowrap">
				<ColorInput
					label={t("categories.color")}
					value={value}
					onChange={onChange}
					format="hex"
					withEyeDropper={false}
					className="flex-1"
				/>
				<Tooltip label={generateLabel}>
					<ActionIcon
						variant="default"
						size={44}
						onClick={() => onChange(generateColor(others))}
						aria-label={generateLabel}
					>
						<IconRefresh size={20} />
					</ActionIcon>
				</Tooltip>
			</Group>
			{close.length > 0 && (
				<Text size="xs" c="dimmed">
					{t("categories.colorClose", { names: close.join(", ") })}
				</Text>
			)}
		</Stack>
	);
}

/** Shown in the icon swatches while the colour typed is not one yet. */
const PLACEHOLDER_COLOR = "#adb5bd";

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
			label={t("categories.icon")}
			value={value}
			onChange={onChange}
			swatches={[
				swatch(null, t("categories.noIcon")),
				...CATEGORY_ICONS.map((icon) =>
					swatch(icon, t(`categories.icons.${icon}`)),
				),
			]}
		/>
	);
}

let ruleIdCounter = 0;

interface RuleForm {
	id: number;
	type: PatternType;
	value: string;
}

function createRule(type: PatternType = "contains", value = ""): RuleForm {
	return { id: ++ruleIdCounter, type, value };
}

function ruleKey(type: PatternType, value: string): string {
	return `${type}:${value.trim().toLowerCase()}`;
}

/** The other categories that already have each rule typed, by rule. */
function rulesTakenElsewhere(
	rules: RuleForm[],
	others: CategoryResponse[],
): Map<number, string[]> {
	const taken = new Map<number, string[]>();
	for (const rule of rules) {
		if (rule.value.trim() === "") continue;
		const key = ruleKey(rule.type, rule.value);
		const names = others
			.filter((c) =>
				c.rules.some(
					(r) => ruleKey(r.labelPattern.type, r.labelPattern.value) === key,
				),
			)
			.map((c) => c.name);
		if (names.length > 0) taken.set(rule.id, names);
	}
	return taken;
}

function sameRules(a: CategoryRule[], b: CategoryRule[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(r, i) =>
				r.labelPattern.type === b[i].labelPattern.type &&
				r.labelPattern.value === b[i].labelPattern.value,
		)
	);
}

function CategoryForm({
	category,
	categories,
	onCancel,
	onSaved,
}: {
	category: CategoryResponse | null;
	categories: CategoryResponse[];
	onCancel: () => void;
	onSaved: (saved: CategoryResponse, rulesChanged: boolean) => void;
}) {
	const { t } = useTranslation();
	const save = useSaveCategory();
	const [name, setName] = useState(category?.name ?? "");
	const others = categories.filter((c) => c.id !== category?.id);
	const [color, setColor] = useState(
		() => category?.color ?? generateColor(others),
	);
	const [icon, setIcon] = useState<CategoryIcon | null>(category?.icon ?? null);
	const [rules, setRules] = useState<RuleForm[]>(() =>
		(category?.rules ?? []).map((r) =>
			createRule(r.labelPattern.type, r.labelPattern.value),
		),
	);
	const [error, setError] = useState<string | null>(null);
	const taken = rulesTakenElsewhere(rules, others);

	function updateRule(id: number, patch: Partial<RuleForm>) {
		setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const trimmed = name.trim();
		if (trimmed === "" || trimmed.length > MAX_NAME_LENGTH) {
			setError(t("categories.errorName"));
			return;
		}
		if (categories.some((c) => c.name === trimmed && c.id !== category?.id)) {
			setError(t("categories.errorNameTaken"));
			return;
		}
		if (!isHexColor(color)) {
			setError(t("categories.errorColor"));
			return;
		}
		const ruleValues = rules.map((r) => ({ ...r, value: r.value.trim() }));
		if (
			ruleValues.some((r) => r.value === "" || r.value.length > MAX_RULE_LENGTH)
		) {
			setError(t("categories.errorRule"));
			return;
		}
		const body = {
			name: trimmed,
			color: color.toLowerCase(),
			icon,
			rules: ruleValues.map((r) => ({
				labelPattern: { type: r.type, value: r.value },
			})),
		};
		try {
			const saved = await save.mutateAsync({
				...(category ? { id: category.id } : {}),
				body,
			});
			onSaved(saved, !sameRules(category?.rules ?? [], body.rules));
		} catch (err) {
			// The name was checked above, so a conflict is the category limit.
			setError(
				err instanceof ApiError && err.status === 409
					? t("categories.errorLimit")
					: t("common.error"),
			);
		}
	}

	const addRuleLabel = t("categories.addRule");
	return (
		<form onSubmit={handleSubmit}>
			<Stack gap="md">
				<TextInput
					label={t("categories.name")}
					value={name}
					onChange={(e) => setName(e.currentTarget.value)}
					maxLength={MAX_NAME_LENGTH}
					required
					data-autofocus
				/>
				<ColorPicker value={color} others={others} onChange={setColor} />
				<IconPicker
					value={icon}
					color={isHexColor(color) ? color : PLACEHOLDER_COLOR}
					onChange={setIcon}
				/>

				<Stack gap={4}>
					<Group justify="space-between" wrap="nowrap">
						<Title order={4}>{t("categories.rules")}</Title>
						<Tooltip label={addRuleLabel}>
							<ActionIcon
								variant="light"
								size="xl"
								onClick={() => setRules((prev) => [...prev, createRule()])}
								aria-label={addRuleLabel}
							>
								<IconPlus size={20} />
							</ActionIcon>
						</Tooltip>
					</Group>
					<Text size="xs" c="dimmed">
						{t("categories.rulesHint")}
					</Text>
				</Stack>

				{rules.map((rule) => {
					const takenBy = taken.get(rule.id);
					return (
						<Stack key={rule.id} gap={6}>
							<Group align="flex-end" wrap="wrap" gap="xs">
								<LabelPatternFields
									type={rule.type}
									value={rule.value}
									onTypeChange={(type) => updateRule(rule.id, { type })}
									onValueChange={(value) => updateRule(rule.id, { value })}
								/>
								<Tooltip label={t("categories.removeRule")}>
									<ActionIcon
										variant="subtle"
										color="gray"
										size="xl"
										onClick={() =>
											setRules((prev) => prev.filter((r) => r.id !== rule.id))
										}
										aria-label={t("categories.removeRule")}
									>
										<IconTrash size={18} />
									</ActionIcon>
								</Tooltip>
							</Group>
							{takenBy && (
								<Alert color="gold" icon={<IconAlertCircle size={16} />}>
									{t("categories.ruleTaken", {
										rule: `${t(`rules.patterns.${rule.type}`).toLowerCase()} ${rule.value.trim()}`,
										names: takenBy.join(", "),
									})}
								</Alert>
							)}
						</Stack>
					);
				})}

				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}
				<Group justify="flex-end" gap="sm">
					<Button variant="default" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" loading={save.isPending}>
						{t("categories.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}

/** Creates a category, or edits `category`, in a modal. */
export function CategoryModal({
	opened,
	category,
	categories,
	onClose,
	onSaved,
}: {
	opened: boolean;
	category: CategoryResponse | null;
	categories: CategoryResponse[];
	onClose: () => void;
	/** Called once saved, instead of `onClose`. */
	onSaved: (saved: CategoryResponse, rulesChanged: boolean) => void;
}) {
	const { t } = useTranslation();
	const isMobile = useBelowBreakpoint("xs");
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={category ? t("categories.editTitle") : t("categories.createTitle")}
			size="lg"
			fullScreen={isMobile}
		>
			{opened && (
				<CategoryForm
					category={category}
					categories={categories}
					onCancel={onClose}
					onSaved={onSaved}
				/>
			)}
		</Modal>
	);
}
