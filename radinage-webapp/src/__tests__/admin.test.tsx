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

function TestAdminPage() {
	const role = useAuthStore((s) => s.role);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{
		username: string;
		invitationLink?: string;
	} | null>(null);
	const [loading, setLoading] = useState(false);

	const [resetUsername, setResetUsername] = useState("");
	const [resetError, setResetError] = useState<string | null>(null);
	const [resetLink, setResetLink] = useState<string | null>(null);
	const [resetLoading, setResetLoading] = useState(false);

	const [deleteUsername, setDeleteUsername] = useState("");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);

	if (role !== "admin") {
		return <div role="alert">Admin access only</div>;
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setResult(null);
		setLoading(true);

		const body: { username: string; password?: string } = { username };
		if (password) {
			body.password = password;
		}

		try {
			const data = (await apiFetch("/users", {
				method: "POST",
				body: JSON.stringify(body),
			})) as { username: string; invitationLink?: string };
			setResult({
				username: data.username,
				invitationLink: data.invitationLink,
			});
			setUsername("");
			setPassword("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				setError("This username already exists");
			} else {
				setError("An error occurred");
			}
		} finally {
			setLoading(false);
		}
	}

	async function handleDelete(e: FormEvent) {
		e.preventDefault();
		setDeleteError(null);
		setDeleteSuccess(null);
		setDeleteLoading(true);

		try {
			await apiFetch(`/users/${deleteUsername}`, { method: "DELETE" });
			setDeleteSuccess(deleteUsername);
			setDeleteUsername("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				setDeleteError("Cannot delete your own account");
			} else if (err instanceof ApiError && err.status === 404) {
				setDeleteError("User not found");
			} else {
				setDeleteError("An error occurred");
			}
		} finally {
			setDeleteLoading(false);
		}
	}

	async function handleReset(e: FormEvent) {
		e.preventDefault();
		setResetError(null);
		setResetLink(null);
		setResetLoading(true);

		try {
			const data = (await apiFetch("/users/reset-password", {
				method: "POST",
				body: JSON.stringify({ username: resetUsername }),
			})) as { resetLink: string };
			setResetLink(data.resetLink);
			setResetUsername("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				setResetError("User not found");
			} else if (err instanceof ApiError && err.status === 400) {
				setResetError("Cannot reset your own password");
			} else {
				setResetError("An error occurred");
			}
		} finally {
			setResetLoading(false);
		}
	}

	return (
		<div>
			<h2>Administration</h2>
			<form onSubmit={handleSubmit}>
				<label>
					Username
					<input
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						required
					/>
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
				{result && (
					<div role="status">
						User created: {result.username}
						{result.invitationLink && (
							<span data-testid="invitation-link">{result.invitationLink}</span>
						)}
					</div>
				)}
				<button type="submit" disabled={loading}>
					Create
				</button>
			</form>
			<form onSubmit={handleReset}>
				<label>
					Reset username
					<input
						value={resetUsername}
						onChange={(e) => setResetUsername(e.target.value)}
						required
					/>
				</label>
				{resetError && <div role="alert">{resetError}</div>}
				{resetLink && (
					<div role="status">
						<span data-testid="reset-link">{resetLink}</span>
					</div>
				)}
				<button type="submit" disabled={resetLoading}>
					Reset
				</button>
			</form>
			<form onSubmit={handleDelete}>
				<label>
					Delete username
					<input
						value={deleteUsername}
						onChange={(e) => setDeleteUsername(e.target.value)}
						required
					/>
				</label>
				{deleteError && <div role="alert">{deleteError}</div>}
				{deleteSuccess && (
					<div role="status">User deleted: {deleteSuccess}</div>
				)}
				<button type="submit" disabled={deleteLoading}>
					Delete
				</button>
			</form>
		</div>
	);
}

function createTestRouter() {
	const rootRoute = createRootRoute({ component: Outlet });
	const adminRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/admin",
		component: TestAdminPage,
	});
	rootRoute.addChildren([adminRoute]);
	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/admin"] }),
	});
}

beforeEach(() => {
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("AdminPage", () => {
	it("shows forbidden message for non-admin users", async () => {
		useAuthStore.setState({ token: "t", role: "user", isAuthenticated: true });
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Admin access only")).toBeInTheDocument();
	});

	it("renders the create user form for admin users", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Administration")).toBeInTheDocument();
		expect(screen.getByLabelText("Username")).toBeInTheDocument();
		expect(screen.getByLabelText("Password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
	});

	it("creates a user with password and shows success", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-1",
			username: "alice",
			role: "user",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "alice");
		await user.type(screen.getByLabelText("Password"), "secret123");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(await screen.findByText(/User created: alice/)).toBeInTheDocument();
		expect(screen.queryByTestId("invitation-link")).not.toBeInTheDocument();

		expect(apiFetchMock).toHaveBeenCalledWith("/users", {
			method: "POST",
			body: JSON.stringify({ username: "alice", password: "secret123" }),
		});
	});

	it("creates a user without password and shows invitation link", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-2",
			username: "bob",
			role: "user",
			invitationLink: "https://app.example.com/activate?token=abc",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "bob");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(await screen.findByText(/User created: bob/)).toBeInTheDocument();
		const linkEl = screen.getByTestId("invitation-link");
		expect(linkEl.textContent).toBe(
			"https://app.example.com/activate?token=abc",
		);

		expect(apiFetchMock).toHaveBeenCalledWith("/users", {
			method: "POST",
			body: JSON.stringify({ username: "bob" }),
		});
	});

	it("shows error on duplicate username (409)", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(409, "Conflict"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "existing");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(
			await screen.findByText("This username already exists"),
		).toBeInTheDocument();
	});

	it("shows generic error on server failure", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(
			new ApiError(500, "Internal Server Error"),
		);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "someone");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(await screen.findByText("An error occurred")).toBeInTheDocument();
	});

	it("clears the form after successful creation", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-3",
			username: "charlie",
			role: "user",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		const usernameInput = await screen.findByLabelText("Username");
		await user.type(usernameInput, "charlie");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(screen.getByText(/User created: charlie/)).toBeInTheDocument();
		});

		expect(usernameInput).toHaveValue("");
	});

	it("shows forbidden message for unauthenticated user (null role)", async () => {
		useAuthStore.setState({
			token: null,
			role: null,
			isAuthenticated: false,
		});
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Admin access only")).toBeInTheDocument();
	});

	it("clears previous result when creating another user", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-1",
			username: "first",
			role: "user",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "first");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(screen.getByText(/User created: first/)).toBeInTheDocument();
		});

		// Now create a second user — previous result should be cleared
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-2",
			username: "second",
			role: "user",
		});

		await user.type(screen.getByLabelText("Username"), "second");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(screen.getByText(/User created: second/)).toBeInTheDocument();
		});
		expect(screen.queryByText(/User created: first/)).not.toBeInTheDocument();
	});

	it("clears error when submitting again", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(409, "Conflict"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "taken");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(
			await screen.findByText("This username already exists"),
		).toBeInTheDocument();

		// Submit again with success — error should be cleared
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-ok",
			username: "taken2",
			role: "user",
		});

		await user.clear(screen.getByLabelText("Username"));
		await user.type(screen.getByLabelText("Username"), "taken2");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(screen.getByText(/User created: taken2/)).toBeInTheDocument();
		});
		expect(
			screen.queryByText("This username already exists"),
		).not.toBeInTheDocument();
	});

	it("resets password and shows reset link", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			resetLink: "https://app.example.com/activate?token=reset-abc",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Reset username"), "alice");
		await user.click(screen.getByRole("button", { name: "Reset" }));

		const linkEl = await screen.findByTestId("reset-link");
		expect(linkEl.textContent).toBe(
			"https://app.example.com/activate?token=reset-abc",
		);

		expect(apiFetchMock).toHaveBeenCalledWith("/users/reset-password", {
			method: "POST",
			body: JSON.stringify({ username: "alice" }),
		});
	});

	it("shows error when resetting unknown user", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(404, "Not Found"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Reset username"), "ghost");
		await user.click(screen.getByRole("button", { name: "Reset" }));

		expect(await screen.findByText("User not found")).toBeInTheDocument();
	});

	it("clears reset form after successful reset", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			resetLink: "https://app.example.com/activate?token=xyz",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		const resetInput = await screen.findByLabelText("Reset username");
		await user.type(resetInput, "bob");
		await user.click(screen.getByRole("button", { name: "Reset" }));

		await waitFor(() => {
			expect(screen.getByTestId("reset-link")).toBeInTheDocument();
		});

		expect(resetInput).toHaveValue("");
	});

	it("shows error when trying to reset own password", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(400, "Bad Request"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Reset username"), "myadmin");
		await user.click(screen.getByRole("button", { name: "Reset" }));

		expect(
			await screen.findByText("Cannot reset your own password"),
		).toBeInTheDocument();
	});

	it("deletes a user and shows success", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce(undefined);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Delete username"), "alice");
		await user.click(screen.getByRole("button", { name: "Delete" }));

		expect(await screen.findByText("User deleted: alice")).toBeInTheDocument();

		expect(apiFetchMock).toHaveBeenCalledWith("/users/alice", {
			method: "DELETE",
		});
	});

	it("shows error when deleting unknown user", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(404, "Not Found"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Delete username"), "ghost");
		await user.click(screen.getByRole("button", { name: "Delete" }));

		expect(await screen.findByText("User not found")).toBeInTheDocument();
	});

	it("shows error when trying to delete own account", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockRejectedValueOnce(new ApiError(400, "Bad Request"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Delete username"), "myadmin");
		await user.click(screen.getByRole("button", { name: "Delete" }));

		expect(
			await screen.findByText("Cannot delete your own account"),
		).toBeInTheDocument();
	});

	it("clears delete form after successful deletion", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce(undefined);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		const deleteInput = await screen.findByLabelText("Delete username");
		await user.type(deleteInput, "bob");
		await user.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => {
			expect(screen.getByText("User deleted: bob")).toBeInTheDocument();
		});

		expect(deleteInput).toHaveValue("");
	});

	it("clears password field after successful creation", async () => {
		useAuthStore.setState({
			token: "t",
			role: "admin",
			isAuthenticated: true,
		});
		apiFetchMock.mockResolvedValueOnce({
			id: "uuid-4",
			username: "dave",
			role: "user",
		});

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Username"), "dave");
		const passwordInput = screen.getByLabelText("Password");
		await user.type(passwordInput, "secret");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(screen.getByText(/User created: dave/)).toBeInTheDocument();
		});

		expect(passwordInput).toHaveValue("");
	});
});
