import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesSection } from "@/components/CategoriesSection";
import { i18n } from "@/i18n";
import type { CategoryResponse } from "@/lib/types";
import { theme } from "@/theme";

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

const food: CategoryResponse = {
	id: "c1",
	name: "Courses",
	color: "#12b886",
	icon: null,
	createdAt: "2026-01-01T00:00:00Z",
};

/** Serve `categories` on GET /categories and `onWrite` for every other call. */
function mockApi(
	categories: CategoryResponse[],
	onWrite: () => Promise<unknown> = () => Promise.resolve(food),
) {
	apiFetchMock.mockImplementation((path: string, options?: RequestInit) =>
		path === "/categories" && options?.method === undefined
			? Promise.resolve(categories)
			: onWrite(),
	);
}

function writes() {
	return apiFetchMock.mock.calls
		.filter(([, options]) => options?.method !== undefined)
		.map(([path, options]) => ({
			path,
			method: options?.method,
			body: typeof options?.body === "string" ? JSON.parse(options.body) : null,
		}));
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<CategoriesSection />
			</MantineProvider>
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("CategoriesSection", () => {
	it("lists the categories", async () => {
		mockApi([food]);
		renderSection();

		expect(await screen.findByText("Courses")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Modifier Courses" }),
		).toBeInTheDocument();
	});

	it("creates a category with the colour typed, lowercased", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une catégorie/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), " Loisirs ");
		const color = screen.getByRole("textbox", { name: /Couleur/ });
		await user.clear(color);
		await user.type(color, "#BE4BDB");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories",
					method: "POST",
					body: { name: "Loisirs", color: "#be4bdb", icon: null },
				},
			]),
		);
	});

	it("refuses a colour that is not a hex code without calling the API", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une catégorie/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Loisirs");
		const color = screen.getByRole("textbox", { name: /Couleur/ });
		await user.clear(color);
		await user.type(color, "violet");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText(/La couleur doit être un code hexadécimal/),
		).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("generates a new colour on demand", async () => {
		mockApi([food]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);
		const color = screen.getByRole("textbox", { name: /Couleur/ });
		expect(color).toHaveValue("#12b886");
		await user.click(
			screen.getByRole("button", { name: "Générer une couleur" }),
		);

		expect(color).not.toHaveValue("#12b886");
		expect((color as HTMLInputElement).value).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("creates a category with the icon picked, none by default", async () => {
		mockApi([]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une catégorie/ }),
		);
		expect(screen.getByRole("radio", { name: "Sans icône" })).toBeChecked();
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Resto");
		await user.click(screen.getByRole("radio", { name: "Restaurant" }));
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories",
					method: "POST",
					body: {
						name: "Resto",
						color: expect.stringMatching(/^#[0-9a-f]{6}$/),
						icon: "restaurant",
					},
				},
			]),
		);
	});

	it("removes the icon of a category", async () => {
		mockApi([{ ...food, icon: "cart" }]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);
		expect(screen.getByRole("radio", { name: "Courses" })).toBeChecked();
		await user.click(screen.getByRole("radio", { name: "Sans icône" }));
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories/c1",
					method: "PUT",
					body: { name: "Courses", color: "#12b886", icon: null },
				},
			]),
		);
	});

	it("warns when the colour looks like another category's, apart from the one edited", async () => {
		const leisure: CategoryResponse = { ...food, id: "c2", name: "Loisirs" };
		mockApi([food, leisure]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);

		expect(
			screen.getByText("Ressemble à la couleur de Loisirs"),
		).toBeInTheDocument();
	});

	it("refuses a name already taken without calling the API", async () => {
		mockApi([food]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une catégorie/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Courses");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText("Une catégorie porte déjà ce nom"),
		).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("says when the category limit is reached", async () => {
		mockApi([], () => Promise.reject(new ApiError(409, "Conflict")));
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: /Ajouter une catégorie/ }),
		);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Loisirs");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText("Nombre maximum de catégories atteint"),
		).toBeInTheDocument();
	});

	it("renames a category", async () => {
		mockApi([food]);
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);
		const name = screen.getByRole("textbox", { name: /Nom/ });
		await user.clear(name);
		await user.type(name, "Alimentation");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories/c1",
					method: "PUT",
					body: { name: "Alimentation", color: "#12b886", icon: null },
				},
			]),
		);
	});

	it("deletes a category once confirmed", async () => {
		mockApi([food], () => Promise.resolve(undefined));
		const user = renderSection();

		await user.click(
			await screen.findByRole("button", { name: "Supprimer Courses" }),
		);
		expect(writes()).toEqual([]);
		expect(screen.getByText(/Supprimer « Courses » \?/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Supprimer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{ path: "/categories/c1", method: "DELETE", body: null },
			]),
		);
	});
});
