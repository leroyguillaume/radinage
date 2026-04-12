import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FormEvent, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useAuthStore } from "@/stores/auth";

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

const { apiFetch, ApiError } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

function TestLoginPage() {
	const login = useAuthStore((s) => s.login);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await login(username, password);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				setError("Invalid username or password");
			} else {
				setError("An error occurred");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<label>
				Username
				<input value={username} onChange={(e) => setUsername(e.target.value)} />
			</label>
			<label>
				Password
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</label>
			{error && <div role="alert">{error}</div>}
			<button type="submit" disabled={loading}>
				Sign in
			</button>
		</form>
	);
}

function createTestRouter(initialPath = "/login") {
	const rootRoute = createRootRoute({ component: Outlet });
	const loginRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/login",
		component: TestLoginPage,
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <div>Home</div>,
	});
	rootRoute.addChildren([loginRoute, indexRoute]);
	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	});
}

beforeEach(() => {
	try {
		globalThis.localStorage?.clear();
	} catch {
		// localStorage may not be available in test environment
	}
	useAuthStore.setState({
		token: null,
		role: null,
		isAuthenticated: false,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("LoginPage", () => {
	it("renders the login form", async () => {
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Username")).toBeInTheDocument();
		expect(screen.getByText("Password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
	});

	it("logs in successfully and updates auth state", async () => {
		apiFetchMock.mockResolvedValueOnce({
			token: "test-jwt-token",
			role: "user",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "testuser");
		await user.type(screen.getByLabelText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => {
			expect(useAuthStore.getState().isAuthenticated).toBe(true);
		});

		expect(useAuthStore.getState().token).toBe("test-jwt-token");
		expect(useAuthStore.getState().role).toBe("user");
	});

	it("shows error on invalid credentials", async () => {
		apiFetchMock.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "wrong");
		await user.type(screen.getByLabelText("Password"), "wrong");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		expect(
			await screen.findByText("Invalid username or password"),
		).toBeInTheDocument();
		expect(useAuthStore.getState().isAuthenticated).toBe(false);
	});

	it("shows generic error on server failure", async () => {
		apiFetchMock.mockRejectedValueOnce(
			new ApiError(500, "Internal Server Error"),
		);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "testuser");
		await user.type(screen.getByLabelText("Password"), "password");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		expect(await screen.findByText("An error occurred")).toBeInTheDocument();
	});
});
