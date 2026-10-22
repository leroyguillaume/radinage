import { Box, Group, Select, type SelectProps, Text } from "@mantine/core";
import { categoryFill } from "@/lib/tones";
import type { CategoryColor, CategoryResponse } from "@/lib/types";

export function CategoryDot({
	color,
	size = 10,
}: {
	color: CategoryColor;
	size?: number;
}) {
	return (
		<Box
			w={size}
			h={size}
			bg={categoryFill(color)}
			style={{ borderRadius: "50%", flexShrink: 0 }}
			aria-hidden
		/>
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
			<CategoryDot color={category.color} />
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
				selected ? <CategoryDot color={selected.color} /> : props.leftSection
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
