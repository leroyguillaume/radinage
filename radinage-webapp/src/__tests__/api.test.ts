import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logoutFn = vi.fn();

vi.mock("@/stores/auth", () => ({
	useAuthStore: {
		getState: () => ({
			logout: logoutFn,
		}),
	},
}));

const { apiFetch, ApiError } = await import("@/lib/api");

describe("apiFetch", () => {
	const storage = new Map<string, string>();

	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		storage.clear();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		});
		logoutFn.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("sends request to API path and parses JSON response", async () => {
		const mockData = { id: 1, name: "test" };
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify(mockData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const result = await apiFetch("/test");

		expect(fetch).toHaveBeenCalledWith(
			expect.stringContaining("/test"),
			expect.objectContaining({ headers: expect.any(Headers) }),
		);
		expect(result).toEqual(mockData);
	});

	it("injects Authorization header when token is in localStorage", async () => {
		storage.set("auth_token", "my-secret-token");

		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 200 }),
		);

		await apiFetch("/test");

		const call = vi.mocked(fetch).mock.calls[0];
		const headers = call[1]?.headers as Headers;
		expect(headers.get("Authorization")).toBe("Bearer my-secret-token");
	});

	it("sets Content-Type to application/json for string body", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 200 }),
		);

		await apiFetch("/test", {
			method: "POST",
			body: JSON.stringify({ key: "value" }),
		});

		const call = vi.mocked(fetch).mock.calls[0];
		const headers = call[1]?.headers as Headers;
		expect(headers.get("Content-Type")).toBe("application/json");
	});

	it("does not set Content-Type for FormData body", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 200 }),
		);

		const formData = new FormData();
		formData.append("file", "data");

		await apiFetch("/test", { method: "POST", body: formData });

		const call = vi.mocked(fetch).mock.calls[0];
		const headers = call[1]?.headers as Headers;
		expect(headers.get("Content-Type")).toBeNull();
	});

	it("throws ApiError on non-200 response", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response("Not Found", { status: 404, statusText: "Not Found" }),
		);

		await expect(apiFetch("/missing")).rejects.toThrow(ApiError);
	});

	it("triggers logout on 401 for non-auth paths", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response("Unauthorized", {
				status: 401,
				statusText: "Unauthorized",
			}),
		);

		await expect(apiFetch("/budgets")).rejects.toThrow(ApiError);
		expect(logoutFn).toHaveBeenCalled();
	});

	it("does not trigger logout on 401 for auth paths", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response("Unauthorized", {
				status: 401,
				statusText: "Unauthorized",
			}),
		);

		await expect(apiFetch("/auth/login")).rejects.toThrow(ApiError);
		expect(logoutFn).not.toHaveBeenCalled();
	});

	it("returns undefined for 204 No Content", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

		const result = await apiFetch("/test");
		expect(result).toBeUndefined();
	});

	it("passes through method and body options", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 200 }),
		);

		const body = JSON.stringify({ name: "test" });
		await apiFetch("/test", { method: "PUT", body });

		expect(fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ method: "PUT", body }),
		);
	});
});
