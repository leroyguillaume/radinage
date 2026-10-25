import { MantineProvider } from "@mantine/core";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n";
import { Route as RootRoute } from "@/routes/__root";
import { useAuthStore } from "@/stores/auth";
import { useLastSearchStore } from "@/stores/last-search";
import { useNavStore } from "@/stores/nav";
import { theme } from "@/theme";

function renderLayout(path: string) {
	const rootRoute = createRootRoute({ component: RootRoute.options.component });
	const children = [
		"/summary",
		"/operations",
		"/search",
		"/stats",
		"/budgets",
		"/accounts",
		"/categories",
		"/settings",
		"/admin",
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

/** The side bar's menu: the first navigation, before the mobile tab bar. */
function sideMenu(): HTMLElement {
	const [side] = screen.getAllByRole("navigation", { name: "Menu" });
	if (!side) throw new Error("no side menu");
	return side;
}

function tabBar(): HTMLElement {
	return screen.getByRole("navigation", { name: "Navigation rapide" });
}

function hrefs(container: HTMLElement): (string | null)[] {
	return within(container)
		.getAllByRole("link")
		.map((link) => link.getAttribute("href"));
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
});

afterEach(() => {
	useAuthStore.setState({ isAuthenticated: false, role: null });
	useNavStore.setState({ collapsed: false });
	useLastSearchStore.setState({ searches: {} });
	localStorage.clear();
});

describe("RootLayout", () => {
	it("marks the current section in the side menu and the tab bar", async () => {
		signIn("user");
		renderLayout("/operations");
		await screen.findByText("page /operations");
		const current = screen.getAllByRole("link", { current: "page" });
		expect(current.map((link) => link.textContent)).toEqual([
			"Suivi mensuel",
			"Mois",
		]);
	});

	it("groups the pages to follow apart from the ones to organize", async () => {
		signIn("user");
		renderLayout("/search");
		await screen.findByText("page /search");
		expect(hrefs(sideMenu())).toEqual([
			"/",
			"/operations",
			"/search",
			"/stats",
			"/accounts",
			"/budgets",
			"/categories",
		]);
		expect(within(sideMenu()).getByText("Suivi")).toBeInTheDocument();
		expect(within(sideMenu()).getByText("Organisation")).toBeInTheDocument();
	});

	it("keeps four daily pages in the tab bar and the rest behind its menu", async () => {
		signIn("user");
		renderLayout("/accounts");
		await screen.findByText("page /accounts");
		expect(hrefs(tabBar())).toEqual([
			"/",
			"/operations",
			"/accounts",
			"/budgets",
		]);
		expect(
			within(tabBar()).getByRole("link", { current: "page" }),
		).toHaveTextContent("Comptes");

		const user = userEvent.setup();
		await user.click(within(tabBar()).getByRole("button", { name: "Menu" }));
		const drawer = await screen.findByRole("dialog");
		await user.click(within(drawer).getByRole("link", { name: "Recherche" }));

		expect(await screen.findByText("page /search")).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("brings each page back as it was last shown", async () => {
		useLastSearchStore.setState({
			searches: {
				"/operations": { year: 2025, month: 3 },
				"/search": { label: "loyer" },
				"/stats": { fromYear: 2025, fromMonth: 1, toYear: 2025, toMonth: 6 },
			},
		});
		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");

		expect(hrefs(sideMenu())).toEqual([
			"/",
			"/operations?year=2025&month=3",
			"/search?label=loyer",
			"/stats?fromYear=2025&fromMonth=1&toYear=2025&toMonth=6",
			"/accounts",
			"/budgets",
			"/categories",
		]);
		expect(hrefs(tabBar())).toContain("/operations?year=2025&month=3");
	});

	it("offers settings and logout, and admin to admins only", async () => {
		signIn("admin");
		const { unmount } = renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute(
			"href",
			"/settings",
		);
		expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Se déconnecter" }),
		).toBeInTheDocument();
		for (const nav of screen.getAllByRole("navigation")) {
			expect(within(nav).queryByRole("link", { name: "Admin" })).toBeNull();
		}
		unmount();

		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
	});

	it("collapses the side menu to named icons and remembers it", async () => {
		signIn("user");
		renderLayout("/summary");
		await screen.findByText("page /summary");
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "Réduire le menu" }));

		expect(
			screen.getByRole("button", { name: "Déplier le menu" }),
		).toBeInTheDocument();
		expect(within(sideMenu()).queryByText("Suivi")).toBeNull();
		for (const link of within(sideMenu()).getAllByRole("link")) {
			expect(link).toHaveTextContent("");
			expect(link).toHaveAccessibleName();
		}
		expect(localStorage.getItem("nav_collapsed")).toBe("true");
	});

	it("hides the navigation when signed out", async () => {
		renderLayout("/summary");
		await screen.findByText("page /summary");
		expect(screen.queryAllByRole("navigation")).toHaveLength(0);
	});
});
