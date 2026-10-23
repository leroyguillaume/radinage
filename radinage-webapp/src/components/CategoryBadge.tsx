import {
	Box,
	Center,
	Group,
	Select,
	type SelectProps,
	Text,
	ThemeIcon,
} from "@mantine/core";
import { categoryIcons } from "@/lib/category-icons";
import type { CategoryLook, CategoryResponse } from "@/lib/types";

/** Width of a category's mark, with or without an icon, so names line up in a list. */
export const CATEGORY_MARK_SIZE = 20;

/** A category's colour, with its icon inside when it has one. */
export function CategoryDot({
	category,
	size = CATEGORY_MARK_SIZE,
}: {
	category: CategoryLook;
	size?: number;
}) {
	const Icon = category.icon ? categoryIcons[category.icon] : undefined;
	return (
		<Center w={size} h={size} style={{ flexShrink: 0 }} aria-hidden>
			{Icon ? (
				<ThemeIcon color={category.color} autoContrast radius="xl" size={size}>
					<Icon size={size * 0.65} stroke={2} />
				</ThemeIcon>
			) : (
				<Box
					w={size / 2}
					h={size / 2}
					bg={category.color}
					style={{ borderRadius: "50%" }}
				/>
			)}
		</Center>
	);
}

/** A category's dot and name; `inherited` dims it when it comes from the budget. */
export function CategoryBadge({
	category,
	inherited = false,
}: {
	category: CategoryResponse;
	inherited?: boolean;
}) {
	return (
		<Group gap={6} wrap="nowrap" miw={0}>
			<CategoryDot category={category} />
			<Text
				size="sm"
				c={inherited ? "dimmed" : undefined}
				fs={inherited ? "italic" : undefined}
				truncate
			>
				{category.name}
			</Text>
		</Group>
	);
}

type CategorySelectProps = Omit<SelectProps, "data" | "renderOption"> & {
	categories: CategoryResponse[];
	/** Options listed before the categories, such as "all" or "none". */
	extraOptions?: { value: string; label: string }[];
};

/** A searchable Select of categories, each option shown with its dot. */
export function CategorySelect({
	categories,
	extraOptions = [],
	value,
	...props
}: CategorySelectProps) {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const selected = value ? byId.get(value) : undefined;
	return (
		<Select
			{...props}
			value={value}
			data={[
				...extraOptions,
				...categories.map((c) => ({ value: c.id, label: c.name })),
			]}
			leftSection={
				selected ? <CategoryDot category={selected} /> : props.leftSection
			}
			renderOption={({ option }) => {
				const category = byId.get(option.value);
				return category ? (
					<CategoryBadge category={category} />
				) : (
					<Text size="sm">{option.label}</Text>
				);
			}}
			searchable
			comboboxProps={{ withinPortal: true }}
		/>
	);
}
