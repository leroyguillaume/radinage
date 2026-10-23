import { MantineProvider } from "@mantine/core";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import { Route as RootRoute } from "@/routes/__root";
import { useAuthStore } from "@/stores/auth";
import { theme } from "@/theme";

function renderLayout(path: string) {
	const rootRoute = createRootRoute({ component: RootRoute.options.component });
	const children = [
		"/summary",
		"/operations",
		"/search",
		"/stats",
		"/budgets",
	].map((p) =>
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

async function accountMenuItems(): Promise<string[]> {
	await userEvent.click(
		within(screen.getByRole("banner")).getByRole("button", {
			name: /compte|account/i,
		}),
	);
	// jsdom lays nothing out, so Mantine's floating dropdown hides itself as
	// detached from its target: the items are only reachable with `hidden`.
	const items = await screen.findAllByRole("menuitem", { hidden: true });
	return items.map((item) => item.textContent ?? "");
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

	it("puts search between operations and statistics in both navigations", async () => {
		signIn("user");
		renderLayout("/search");
		await screen.findByText("page /search");
		const navs = screen.getAllByRole("navigation");
		expect(navs).toHaveLength(2);
		for (const nav of navs) {
			const hrefs = within(nav)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href"));
			expect(hrefs.slice(1, 4)).toEqual(["/operations", "/search", "/stats"]);
			expect(
				within(nav).getByRole("link", { current: "page" }),
			).toHaveTextContent(/recherche|search/i);
		}
	});

	it("keeps admin out of the navigations and in the account menu", async () => {
		signIn("admin");
		const { unmount } = renderLayout("/summary");
		await screen.findByText("page /summary");
		for (const nav of screen.getAllByRole("navigation")) {
			expect(within(nav).queryByRole("link", { name: /admin/i })).toBeNull();
		}
		expect(await accountMenuItems()).toContain("Admin");
		unmount();

		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(await accountMenuItems()).not.toContain("Admin");
	});

	it("keeps nav pills named when their label is hidden", async () => {
		signIn("user");
		renderLayout("/summary");
		const header = await screen.findByRole("banner");
		const links = within(within(header).getByRole("navigation")).getAllByRole(
			"link",
		);
		expect(links).toHaveLength(5);
		for (const link of links) {
			expect(link).toHaveAttribute("aria-label");
		}
	});

	it("hides the navigation when signed out", async () => {
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.queryAllByRole("navigation")).toHaveLength(0);
	});

	it("offers settings and logout from the account menu", async () => {
		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");
		const items = await accountMenuItems();
		expect(items.some((i) => /paramètres|settings/i.test(i))).toBe(true);
		expect(items.some((i) => /déconnecter|log out/i.test(i))).toBe(true);
	});
});
