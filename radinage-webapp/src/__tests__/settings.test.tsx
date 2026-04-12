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

function TestSettingsPage() {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSuccess(false);

		if (newPassword !== confirmPassword) {
			setError("New passwords do not match");
			return;
		}

		setLoading(true);
		try {
			await apiFetch("/users/me/password", {
				method: "PUT",
				body: JSON.stringify({ currentPassword, newPassword }),
			});
			setSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				setError("Current password is incorrect");
			} else {
				setError("An error occurred");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<div>
			<h2>Settings</h2>
			<form onSubmit={handleSubmit}>
				<label>
					Current password
					<input
						type="password"
						value={currentPassword}
						onChange={(e) => setCurrentPassword(e.target.value)}
						required
					/>
				</label>
				<label>
					New password
					<input
						type="password"
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
						required
					/>
				</label>
				<label>
					Confirm new password
					<input
						type="password"
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						required
					/>
				</label>
				{error && <div role="alert">{error}</div>}
				{success && <div role="status">Password changed successfully</div>}
				<button type="submit" disabled={loading}>
					Change
				</button>
			</form>
		</div>
	);
}

function createTestRouter() {
	const rootRoute = createRootRoute({ component: Outlet });
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		component: TestSettingsPage,
	});
	rootRoute.addChildren([settingsRoute]);
	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/settings"] }),
	});
}

beforeEach(() => {
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SettingsPage", () => {
	it("renders the change password form", async () => {
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Settings")).toBeInTheDocument();
		expect(screen.getByLabelText("Current password")).toBeInTheDocument();
		expect(screen.getByLabelText("New password")).toBeInTheDocument();
		expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
	});

	it("shows error when new passwords do not match", async () => {
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Current password"), "old");
		await user.type(screen.getByLabelText("New password"), "abc");
		await user.type(screen.getByLabelText("Confirm new password"), "xyz");
		await user.click(screen.getByRole("button", { name: "Change" }));

		expect(
			await screen.findByText("New passwords do not match"),
		).toBeInTheDocument();
		expect(apiFetchMock).not.toHaveBeenCalled();
	});

	it("changes password and shows success", async () => {
		apiFetchMock.mockResolvedValueOnce(undefined);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(
			await screen.findByLabelText("Current password"),
			"old_pass",
		);
		await user.type(screen.getByLabelText("New password"), "new_pass");
		await user.type(screen.getByLabelText("Confirm new password"), "new_pass");
		await user.click(screen.getByRole("button", { name: "Change" }));

		expect(
			await screen.findByText("Password changed successfully"),
		).toBeInTheDocument();

		expect(apiFetchMock).toHaveBeenCalledWith("/users/me/password", {
			method: "PUT",
			body: JSON.stringify({
				currentPassword: "old_pass",
				newPassword: "new_pass",
			}),
		});
	});

	it("clears form after successful change", async () => {
		apiFetchMock.mockResolvedValueOnce(undefined);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		const currentInput = await screen.findByLabelText("Current password");
		await user.type(currentInput, "old");
		await user.type(screen.getByLabelText("New password"), "new");
		await user.type(screen.getByLabelText("Confirm new password"), "new");
		await user.click(screen.getByRole("button", { name: "Change" }));

		await waitFor(() => {
			expect(
				screen.getByText("Password changed successfully"),
			).toBeInTheDocument();
		});

		expect(currentInput).toHaveValue("");
		expect(screen.getByLabelText("New password")).toHaveValue("");
		expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
	});

	it("shows error when current password is wrong (400)", async () => {
		apiFetchMock.mockRejectedValueOnce(new ApiError(400, "Bad Request"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Current password"), "wrong");
		await user.type(screen.getByLabelText("New password"), "new");
		await user.type(screen.getByLabelText("Confirm new password"), "new");
		await user.click(screen.getByRole("button", { name: "Change" }));

		expect(
			await screen.findByText("Current password is incorrect"),
		).toBeInTheDocument();
	});

	it("shows generic error on server failure", async () => {
		apiFetchMock.mockRejectedValueOnce(
			new ApiError(500, "Internal Server Error"),
		);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Current password"), "pass");
		await user.type(screen.getByLabelText("New password"), "new");
		await user.type(screen.getByLabelText("Confirm new password"), "new");
		await user.click(screen.getByRole("button", { name: "Change" }));

		expect(await screen.findByText("An error occurred")).toBeInTheDocument();
	});

	it("clears previous error on new submission", async () => {
		apiFetchMock.mockRejectedValueOnce(new ApiError(400, "Bad Request"));

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Current password"), "wrong");
		await user.type(screen.getByLabelText("New password"), "new");
		await user.type(screen.getByLabelText("Confirm new password"), "new");
		await user.click(screen.getByRole("button", { name: "Change" }));

		expect(
			await screen.findByText("Current password is incorrect"),
		).toBeInTheDocument();

		// Retry with success
		apiFetchMock.mockResolvedValueOnce(undefined);
		await user.clear(screen.getByLabelText("Current password"));
		await user.type(screen.getByLabelText("Current password"), "correct");
		await user.clear(screen.getByLabelText("New password"));
		await user.type(screen.getByLabelText("New password"), "newer");
		await user.clear(screen.getByLabelText("Confirm new password"));
		await user.type(screen.getByLabelText("Confirm new password"), "newer");
		await user.click(screen.getByRole("button", { name: "Change" }));

		await waitFor(() => {
			expect(
				screen.getByText("Password changed successfully"),
			).toBeInTheDocument();
		});
		expect(
			screen.queryByText("Current password is incorrect"),
		).not.toBeInTheDocument();
	});

	it("clears previous success on new submission", async () => {
		apiFetchMock.mockResolvedValueOnce(undefined);

		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Current password"), "old");
		await user.type(screen.getByLabelText("New password"), "new");
		await user.type(screen.getByLabelText("Confirm new password"), "new");
		await user.click(screen.getByRole("button", { name: "Change" }));

		await waitFor(() => {
			expect(
				screen.getByText("Password changed successfully"),
			).toBeInTheDocument();
		});

		// Submit again, this time failing
		apiFetchMock.mockRejectedValueOnce(new ApiError(400, "Bad Request"));
		await user.type(screen.getByLabelText("Current password"), "bad");
		await user.type(screen.getByLabelText("New password"), "x");
		await user.type(screen.getByLabelText("Confirm new password"), "x");
		await user.click(screen.getByRole("button", { name: "Change" }));

		await waitFor(() => {
			expect(
				screen.getByText("Current password is incorrect"),
			).toBeInTheDocument();
		});
		expect(
			screen.queryByText("Password changed successfully"),
		).not.toBeInTheDocument();
	});
});
