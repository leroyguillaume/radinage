import {
	CATEGORY_COLORS,
	type CategoryColor,
	type CategoryResponse,
} from "@/lib/types";

/** Names of the categories using each colour, in the order they are listed. */
export function categoriesByColor(
	categories: CategoryResponse[],
): Map<CategoryColor, string[]> {
	const byColor = new Map<CategoryColor, string[]>();
	for (const category of categories) {
		byColor.set(category.color, [
			...(byColor.get(category.color) ?? []),
			category.name,
		]);
	}
	return byColor;
}

/**
 * The colour the fewest categories use, the first of the palette on a tie, so a new
 * category does not look like an existing one until the palette runs out.
 */
export function leastUsedColor(categories: CategoryResponse[]): CategoryColor {
	const byColor = categoriesByColor(categories);
	const uses = (color: CategoryColor) => byColor.get(color)?.length ?? 0;
	return CATEGORY_COLORS.reduce((best, color) =>
		uses(color) < uses(best) ? color : best,
	);
}
