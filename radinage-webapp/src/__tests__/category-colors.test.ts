import { describe, expect, it } from "vitest";
import { categoriesByColor, leastUsedColor } from "@/lib/category-colors";
import {
	CATEGORY_COLORS,
	type CategoryColor,
	type CategoryResponse,
} from "@/lib/types";

function category(name: string, color: CategoryColor): CategoryResponse {
	return { id: name, name, color, createdAt: "2026-01-01T00:00:00Z" };
}

describe("categoriesByColor", () => {
	it("groups the names by colour", () => {
		const byColor = categoriesByColor([
			category("Courses", "teal"),
			category("Loisirs", "grape"),
			category("Resto", "teal"),
		]);

		expect(byColor.get("teal")).toEqual(["Courses", "Resto"]);
		expect(byColor.get("grape")).toEqual(["Loisirs"]);
		expect(byColor.has("red")).toBe(false);
	});
});

describe("leastUsedColor", () => {
	it("starts with the first colour of the palette", () => {
		expect(leastUsedColor([])).toBe("forest");
	});

	it("skips the colours already taken", () => {
		expect(
			leastUsedColor([
				category("Courses", "forest"),
				category("Resto", "blue"),
			]),
		).toBe("cyan");
	});

	it("reuses the least used colour once the palette runs out", () => {
		const all = CATEGORY_COLORS.map((color) => category(color, color));
		expect(
			leastUsedColor([
				...all,
				category("Courses", "forest"),
				category("Resto", "cyan"),
			]),
		).toBe("blue");
	});
});
