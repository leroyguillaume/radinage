import { describe, expect, it } from "vitest";
import {
	categoriesCloseTo,
	colorDistance,
	generateColor,
	isHexColor,
} from "@/lib/category-colors";
import type { CategoryColor, CategoryResponse } from "@/lib/types";

function category(name: string, color: CategoryColor): CategoryResponse {
	return {
		id: name,
		name,
		color,
		icon: null,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

/** A deterministic `Math.random` stand-in cycling through `values`. */
function sequence(...values: number[]) {
	let i = 0;
	return () => values[i++ % values.length] ?? 0;
}

describe("isHexColor", () => {
	it("accepts #rrggbb in either case", () => {
		expect(isHexColor("#12b886")).toBe(true);
		expect(isHexColor("#12B886")).toBe(true);
	});

	it("rejects anything else", () => {
		for (const value of ["12b886", "#12b88", "#12b8867", "#12b88g", "teal"]) {
			expect(isHexColor(value)).toBe(false);
		}
	});
});

describe("colorDistance", () => {
	it("is zero for the same colour and grows with the difference", () => {
		expect(colorDistance("#12b886", "#12b886")).toBe(0);
		expect(colorDistance("#12b886", "#14ba88")).toBeLessThan(
			colorDistance("#12b886", "#fa5252"),
		);
	});
});

describe("categoriesCloseTo", () => {
	it("names the categories whose colour looks the same", () => {
		const categories = [
			category("Courses", "#12b886"),
			category("Resto", "#fa5252"),
		];
		expect(categoriesCloseTo("#14ba88", categories)).toEqual(["Courses"]);
		expect(categoriesCloseTo("#228be6", categories)).toEqual([]);
	});
});

describe("generateColor", () => {
	it("returns a #rrggbb colour", () => {
		expect(isHexColor(generateColor([], sequence(0.3, 0.5, 0.5)))).toBe(true);
	});

	it("keeps the candidate least like the other categories' colours", () => {
		const red = generateColor([], sequence(0, 0.5, 0.5));
		const teal = generateColor([], sequence(0.45, 0.5, 0.5));

		expect(
			generateColor(
				[category("Resto", red)],
				sequence(0, 0.5, 0.5, 0.45, 0.5, 0.5),
			),
		).toBe(teal);
	});
});
