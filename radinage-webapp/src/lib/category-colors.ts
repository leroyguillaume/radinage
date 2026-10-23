import type { CategoryColor, CategoryResponse } from "@/lib/types";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
	return HEX_COLOR.test(value);
}

function rgb(color: CategoryColor): [number, number, number] {
	const n = Number.parseInt(color.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * How different two colours look, from 0 (identical) to about 765: the "redmean"
 * approximation, which weighs channels the way the eye does without a colour space.
 */
export function colorDistance(a: CategoryColor, b: CategoryColor): number {
	const [r1, g1, b1] = rgb(a);
	const [r2, g2, b2] = rgb(b);
	const r = (r1 + r2) / 2;
	return Math.sqrt(
		(2 + r / 256) * (r1 - r2) ** 2 +
			4 * (g1 - g2) ** 2 +
			(2 + (255 - r) / 256) * (b1 - b2) ** 2,
	);
}

/** Below this distance two category dots are easily mistaken for one another. */
const CLOSE_DISTANCE = 100;

/** Names of the categories whose colour looks like `color`. */
export function categoriesCloseTo(
	color: CategoryColor,
	categories: CategoryResponse[],
): string[] {
	return categories
		.filter((c) => colorDistance(color, c.color) < CLOSE_DISTANCE)
		.map((c) => c.name);
}

function hslToHex(h: number, s: number, l: number): CategoryColor {
	const a = s * Math.min(l, 1 - l);
	const channel = (n: number) => {
		const k = (n + h / 30) % 12;
		const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Candidates drawn per generated colour, the one furthest from the others kept. */
const CANDIDATES = 24;

/**
 * A random colour, saturated and mid-light enough for a white or dark icon to stand
 * out on it, picked among a few candidates as the one least like `others`' colours.
 */
export function generateColor(
	others: CategoryResponse[],
	random: () => number = Math.random,
): CategoryColor {
	const candidate = () =>
		hslToHex(random() * 360, 0.55 + random() * 0.25, 0.4 + random() * 0.15);
	const nearest = (color: CategoryColor) =>
		Math.min(...others.map((c) => colorDistance(color, c.color)));
	let best = candidate();
	for (let i = 1; i < CANDIDATES && others.length > 0; i++) {
		const next = candidate();
		if (nearest(next) > nearest(best)) best = next;
	}
	return best;
}
