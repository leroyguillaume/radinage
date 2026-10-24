import { create } from "zustand";

const COLLAPSED_KEY = "nav_collapsed";

interface NavState {
	/** Whether the side menu shows its icons only. */
	collapsed: boolean;
	toggleCollapsed: () => void;
}

function readCollapsed(): boolean {
	try {
		return globalThis.localStorage?.getItem(COLLAPSED_KEY) === "true";
	} catch {
		return false;
	}
}

export const useNavStore = create<NavState>((set, get) => ({
	collapsed: readCollapsed(),

	toggleCollapsed: () => {
		const collapsed = !get().collapsed;
		try {
			globalThis.localStorage?.setItem(COLLAPSED_KEY, String(collapsed));
		} catch {
			// localStorage may not be available
		}
		set({ collapsed });
	},
}));
