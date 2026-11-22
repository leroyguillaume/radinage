import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";

describe("modal sizes", () => {
	it("widens every named Mantine modal size on desktop only", () => {
		const block = css.match(
			/@media \(min-width: 62em\)\s*{\s*\.mantine-Modal-root\s*{([^}]*)}/,
		);
		expect(block).not.toBeNull();
		for (const size of ["xs", "sm", "md", "lg", "xl"]) {
			expect(block?.[1]).toContain(`--modal-size-${size}:`);
		}
	});
});
