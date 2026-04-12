import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.name = "ApiError";
			this.status = status;
		}
	},
	apiFetch: vi.fn(),
}));

const { apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

// Use the store directly since zustand creates a singleton
const { useAuthStore } = await import("@/stores/auth");

describe("useAuthStore", () => {
	beforeEach(() => {
		// Reset store state
		useAuthStore.setState({
			token: null,
			role: null,
			isAuthenticated: false,
		});
		apiFetchMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("login stores token and role in state", async () => {
		apiFetchMock.mockResolvedValue({
			token: "jwt-token-123",
			role: "admin",
		});

		await useAuthStore.getState().login("user", "pass");

		const state = useAuthStore.getState();
		expect(state.isAuthenticated).toBe(true);
		expect(state.token).toBe("jwt-token-123");
		expect(state.role).toBe("admin");
	});

	it("login calls apiFetch with correct params", async () => {
		apiFetchMock.mockResolvedValue({ token: "t", role: "r" });

		await useAuthStore.getState().login("myuser", "mypass");

		expect(apiFetchMock).toHaveBeenCalledWith("/auth/login", {
			method: "POST",
			body: JSON.stringify({ username: "myuser", password: "mypass" }),
		});
	});

	it("login propagates API errors and keeps state unauthenticated", async () => {
		const { ApiError } = await import("@/lib/api");
		apiFetchMock.mockRejectedValue(new ApiError(401, "Unauthorized"));

		await expect(
			useAuthStore.getState().login("bad", "creds"),
		).rejects.toThrow();

		expect(useAuthStore.getState().isAuthenticated).toBe(false);
	});

	it("logout clears state", async () => {
		// First login
		apiFetchMock.mockResolvedValue({ token: "t", role: "r" });
		await useAuthStore.getState().login("u", "p");
		expect(useAuthStore.getState().isAuthenticated).toBe(true);

		// Then logout
		useAuthStore.getState().logout();

		const state = useAuthStore.getState();
		expect(state.isAuthenticated).toBe(false);
		expect(state.token).toBeNull();
		expect(state.role).toBeNull();
	});

	it("logout is idempotent", () => {
		useAuthStore.getState().logout();
		useAuthStore.getState().logout();

		const state = useAuthStore.getState();
		expect(state.isAuthenticated).toBe(false);
	});
});
