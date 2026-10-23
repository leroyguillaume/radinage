const defaultMatchMedia = window.matchMedia;

const WIDTH_QUERY =
	/\((min|max)-width:\s*(?:calc\()?([\d.]+)(em|px)(?:\s*-\s*([\d.]+)px\))?\)/g;

/** Whether every width condition of `query` holds at `width` px; false without any. */
function matchesWidth(query: string, width: number): boolean {
	const conditions = [...query.matchAll(WIDTH_QUERY)];
	return (
		conditions.length > 0 &&
		conditions.every(([, kind, value, unit, offset]) => {
			const px = Number(value) * (unit === "em" ? 16 : 1) - Number(offset ?? 0);
			return kind === "min" ? width >= px : width <= px;
		})
	);
}

/** Makes `matchMedia` answer width queries as a viewport `width` px wide would. */
export function setViewportWidth(width: number) {
	window.matchMedia = (query: string) => ({
		...defaultMatchMedia(query),
		matches: matchesWidth(query, width),
	});
}

export function resetViewport() {
	window.matchMedia = defaultMatchMedia;
}
