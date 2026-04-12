const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

export async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const token = localStorage.getItem("auth_token");
	const headers = new Headers(options.headers);

	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	if (
		!headers.has("Content-Type") &&
		options.body &&
		!(options.body instanceof FormData)
	) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(`${API_BASE_URL}${path}`, {
		...options,
		headers,
	});

	if (response.status === 401 && !path.startsWith("/auth/")) {
		const { useAuthStore } = await import("@/stores/auth");
		useAuthStore.getState().logout();
	}

	if (!response.ok) {
		throw new ApiError(response.status, response.statusText);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}
