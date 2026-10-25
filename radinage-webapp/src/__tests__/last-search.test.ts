import { afterEach, describe, expect, it } from "vitest";
import { useLastSearchStore } from "@/stores/last-search";

afterEach(() => {
	useLastSearchStore.getState().clear();
});

describe("useLastSearchStore", () => {
	it("remembers the last search of each page across reloads", () => {
		const { remember } = useLastSearchStore.getState();
		remember("/operations", { year: 2025, month: 3 });
		remember("/search", { label: "loyer" });
		remember("/operations", { year: 2025, month: 4 });

		const expected = {
			"/operations": { year: 2025, month: 4 },
			"/search": { label: "loyer" },
		};
		expect(useLastSearchStore.getState().searches).toEqual(expected);
		expect(JSON.parse(localStorage.getItem("last_search") ?? "null")).toEqual(
			expected,
		);
	});

	it("forgets every search on clear", () => {
		useLastSearchStore.getState().remember("/stats", { fromYear: 2025 });
		useLastSearchStore.getState().clear();

		expect(useLastSearchStore.getState().searches).toEqual({});
		expect(localStorage.getItem("last_search")).toBeNull();
	});
});
