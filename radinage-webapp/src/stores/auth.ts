import { create } from "zustand";
import { ApiError, apiFetch } from "@/lib/api";

interface LoginResponse {
	token: string;
	role: string;
}

interface AuthState {
	token: string | null;
	role: string | null;
	isAuthenticated: boolean;
	login: (username: string, password: string) => Promise<void>;
	logout: () => void;
}

function getStoredValue(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export const useAuthStore = create<AuthState>((set) => ({
	token: getStoredValue("auth_token"),
	role: getStoredValue("auth_role"),
	isAuthenticated: getStoredValue("auth_token") !== null,

	login: async (username: string, password: string) => {
		const data = await apiFetch<LoginResponse>("/auth/login", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		});

		try {
			globalThis.localStorage?.setItem("auth_token", data.token);
			globalThis.localStorage?.setItem("auth_role", data.role);
		} catch {
			// localStorage may not be available
		}
		set({ token: data.token, role: data.role, isAuthenticated: true });
	},

	logout: () => {
		try {
			globalThis.localStorage?.removeItem("auth_token");
			globalThis.localStorage?.removeItem("auth_role");
		} catch {
			// localStorage may not be available
		}
		set({ token: null, role: null, isAuthenticated: false });
	},
}));

export { ApiError };
