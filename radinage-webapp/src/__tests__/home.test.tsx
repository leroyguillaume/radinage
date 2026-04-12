import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n";

function HomePage() {
	return <div data-testid="redirect" data-to="/summary" />;
}

function createTestRouter() {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: HomePage,
	});
	rootRoute.addChildren([indexRoute]);
	return createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
}

describe("HomePage", () => {
	it("redirects to forecast page", async () => {
		const router = createTestRouter();
		render(<RouterProvider router={router} />);

		await waitFor(() => {
			const el = document.querySelector("[data-testid='redirect']");
			expect(el).toBeInTheDocument();
			expect(el?.getAttribute("data-to")).toBe("/summary");
		});
	});
});
