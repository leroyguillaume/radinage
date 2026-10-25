import { useEffect } from "react";
import { create } from "zustand";

const STORAGE_KEY = "last_search";

type Search = Record<string, unknown>;

interface LastSearchState {
	/** Search params each page was last shown with, by route path. */
	searches: Record<string, Search>;
	remember: (path: string, search: Search) => void;
	clear: () => void;
}

function readSearches(): Record<string, Search> {
	try {
		const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
		const parsed: unknown = stored ? JSON.parse(stored) : null;
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, Search>)
			: {};
	} catch {
		return {};
	}
}

function writeSearches(searches: Record<string, Search> | null) {
	try {
		if (searches === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
		else
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(searches));
	} catch {
		// localStorage may not be available
	}
}

export const useLastSearchStore = create<LastSearchState>((set, get) => ({
	searches: readSearches(),

	remember: (path, search) => {
		const searches = { ...get().searches, [path]: search };
		writeSearches(searches);
		set({ searches });
	},

	clear: () => {
		writeSearches(null);
		set({ searches: {} });
	},
}));

/** Keeps `search` as the one the menu link to `path` brings back. */
export function useRememberSearch(path: string, search: Search) {
	const remember = useLastSearchStore((s) => s.remember);
	const serialized = JSON.stringify(search);
	useEffect(() => {
		remember(path, JSON.parse(serialized));
	}, [path, serialized, remember]);
}
