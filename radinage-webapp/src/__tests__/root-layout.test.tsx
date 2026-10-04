import { MantineProvider } from "@mantine/core";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import { Route as RootRoute } from "@/routes/__root";
import { useAuthStore } from "@/stores/auth";
import { theme } from "@/theme";

function renderLayout(path: string) {
	const rootRoute = createRootRoute({ component: RootRoute.options.component });
	const children = ["/summary", "/operations", "/stats", "/budgets"].map((p) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path: p,
			component: () => <p>page {p}</p>,
		}),
	);
	rootRoute.addChildren(children);
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	return render(
		<MantineProvider theme={theme}>
			<RouterProvider router={router} />
		</MantineProvider>,
	);
}

function signIn(role: string) {
	useAuthStore.setState({ isAuthenticated: true, role });
}

afterEach(() => {
	useAuthStore.setState({ isAuthenticated: false, role: null });
});

describe("RootLayout", () => {
	it("marks the current section in both navigations", async () => {
		signIn("user");
		renderLayout("/operations");
		await screen.findByText("page /operations");
		const current = screen.getAllByRole("link", { current: "page" });
		expect(current).toHaveLength(2);
		for (const link of current) {
			expect(link).toHaveTextContent(/opérations|operations/i);
		}
	});

	it("shows the admin entry to admins only", async () => {
		signIn("admin");
		const { unmount } = renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
		unmount();

		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.queryByRole("link", { name: /admin/i })).toBeNull();
	});

	it("hides the navigation when signed out", async () => {
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.queryAllByRole("navigation")).toHaveLength(0);
	});

	it("offers settings and logout as labelled buttons", async () => {
		signIn("user");
		renderLayout("/summary");
		const header = await screen.findByRole("banner");
		expect(
			within(header).getByRole("button", { name: /paramètres|settings/i }),
		).toBeInTheDocument();
		expect(
			within(header).getByRole("button", { name: /déconnecter|log out/i }),
		).toBeInTheDocument();
	});
});
