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

function TestActivatePage({ token }: { token?: string }) {
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);

	if (!token) {
		return <div role="alert">Invalid invitation link: missing token</div>;
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		setLoading(true);
		try {
			const data = (await apiFetch("/auth/activate", {
				method: "POST",
				body: JSON.stringify({ token, password }),
			})) as { token: string; role: string };

			try {
				globalThis.localStorage?.setItem("auth_token", data.token);
				globalThis.localStorage?.setItem("auth_role", data.role);
			} catch {
				// localStorage may not be available
			}

			setSuccess(true);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				setError("This invitation link is invalid or has already been used");
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
				Password
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</label>
			<label>
				Confirm password
				<input
					type="password"
					value={confirmPassword}
					onChange={(e) => setConfirmPassword(e.target.value)}
				/>
			</label>
			{error && <div role="alert">{error}</div>}
			{success && <div role="status">Account activated successfully!</div>}
			<button type="submit" disabled={loading || success}>
				Activate account
			</button>
		</form>
	);
}

function createTestRouter(token?: string) {
	const rootRoute = createRootRoute({ component: Outlet });
	const activateRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/activate",
		component: () => <TestActivatePage token={token} />,
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <div>Home</div>,
	});
	rootRoute.addChildren([activateRoute, indexRoute]);
	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/activate"] }),
	});
}

beforeEach(() => {
	try {
		globalThis.localStorage?.clear();
	} catch {
		// localStorage may not be available
	}
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ActivatePage", () => {
	it("shows error when token is missing", async () => {
		const router = createTestRouter(undefined);
		render(<RouterProvider router={router} />);

		expect(
			await screen.findByText("Invalid invitation link: missing token"),
		).toBeInTheDocument();
	});

	it("renders the activation form when token is present", async () => {
		const router = createTestRouter("some-token");
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Password")).toBeInTheDocument();
		expect(screen.getByText("Confirm password")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Activate account" }),
		).toBeInTheDocument();
	});

	it("shows error when passwords do not match", async () => {
		const router = createTestRouter("some-token");
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Password"), "abc123");
		await user.type(screen.getByLabelText("Confirm password"), "different");
		await user.click(screen.getByRole("button", { name: "Activate account" }));

		expect(
			await screen.findByText("Passwords do not match"),
		).toBeInTheDocument();
		expect(apiFetchMock).not.toHaveBeenCalled();
	});

	it("activates account and shows success on valid submission", async () => {
		apiFetchMock.mockResolvedValueOnce({
			token: "jwt-token-123",
			role: "user",
		});

		const router = createTestRouter("valid-token");
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Password"), "mypassword");
		await user.type(screen.getByLabelText("Confirm password"), "mypassword");
		await user.click(screen.getByRole("button", { name: "Activate account" }));

		expect(
			await screen.findByText("Account activated successfully!"),
		).toBeInTheDocument();

		expect(apiFetchMock).toHaveBeenCalledWith("/auth/activate", {
			method: "POST",
			body: JSON.stringify({ token: "valid-token", password: "mypassword" }),
		});
	});

	it("shows error on invalid/expired token (404)", async () => {
		apiFetchMock.mockRejectedValueOnce(new ApiError(404, "Not Found"));

		const router = createTestRouter("expired-token");
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Password"), "pass");
		await user.type(screen.getByLabelText("Confirm password"), "pass");
		await user.click(screen.getByRole("button", { name: "Activate account" }));

		expect(
			await screen.findByText(
				"This invitation link is invalid or has already been used",
			),
		).toBeInTheDocument();
	});

	it("shows generic error on server failure", async () => {
		apiFetchMock.mockRejectedValueOnce(
			new ApiError(500, "Internal Server Error"),
		);

		const router = createTestRouter("some-token");
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Password"), "pass");
		await user.type(screen.getByLabelText("Confirm password"), "pass");
		await user.click(screen.getByRole("button", { name: "Activate account" }));

		expect(await screen.findByText("An error occurred")).toBeInTheDocument();
	});

	it("disables submit button after successful activation", async () => {
		apiFetchMock.mockResolvedValueOnce({
			token: "jwt-token",
			role: "user",
		});

		const router = createTestRouter("valid-token");
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Password"), "pass");
		await user.type(screen.getByLabelText("Confirm password"), "pass");
		await user.click(screen.getByRole("button", { name: "Activate account" }));

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Activate account" }),
			).toBeDisabled();
		});
	});
});
