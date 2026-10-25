import { create } from "zustand";

const STORAGE_KEY = "operations_open_sections";

interface OperationSectionsState {
	/** The monthly tracking sections shown unfolded; all others are folded. */
	open: string[];
	toggle: (section: string) => void;
}

function readOpen(): string[] {
	try {
		const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
		const parsed: unknown = stored ? JSON.parse(stored) : null;
		return Array.isArray(parsed)
			? parsed.filter((s): s is string => typeof s === "string")
			: [];
	} catch {
		return [];
	}
}

export const useOperationSectionsStore = create<OperationSectionsState>(
	(set, get) => ({
		open: readOpen(),

		toggle: (section) => {
			const current = get().open;
			const open = current.includes(section)
				? current.filter((s) => s !== section)
				: [...current, section];
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(open));
			} catch {
				// localStorage may not be available
			}
			set({ open });
		},
	}),
);
