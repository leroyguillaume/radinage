import { describe, expect, it } from "vitest";
import { columnLetter } from "@/lib/columns";

describe("columnLetter", () => {
	it("names columns like a spreadsheet", () => {
		expect(columnLetter(0)).toBe("A");
		expect(columnLetter(25)).toBe("Z");
		expect(columnLetter(26)).toBe("AA");
		expect(columnLetter(27)).toBe("AB");
		expect(columnLetter(701)).toBe("ZZ");
		expect(columnLetter(702)).toBe("AAA");
	});
});
