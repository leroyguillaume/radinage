import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type { CategoryResponse } from "@/lib/types";
import { CategoriesPage } from "@/routes/categories";
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
	netTotals: false,
	rules: [],
	createdAt: "2026-01-01T00:00:00Z",
};

const transport: CategoryResponse = {
	...food,
	id: "c2",
	name: "Transport",
	color: "#fd7e14",
	rules: [{ labelPattern: { type: "contains", value: "LECLERC" } }],
};

/** Serve `categories` on GET /categories and `onWrite` for every other call. */
function mockApi(
	categories: CategoryResponse[],
	onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(food),
) {
	apiFetchMock.mockImplementation((path: string, options?: RequestInit) =>
		path === "/categories" && options?.method === undefined
			? Promise.resolve(categories)
			: onWrite(path),
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

function renderPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<CategoriesPage />
			</MantineProvider>
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

async function openNew(user: ReturnType<typeof userEvent.setup>) {
	await user.click(
		await screen.findByRole("button", { name: /Nouvelle catégorie/ }),
	);
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("CategoriesPage", () => {
	it("lists the categories with their rules", async () => {
		mockApi([food, transport]);
		renderPage();

		const card = await screen.findByRole("article", { name: "Transport" });
		expect(within(card).getByText("LECLERC")).toBeInTheDocument();
		expect(within(card).getByText("1 règle")).toBeInTheDocument();
		expect(
			within(screen.getByRole("article", { name: "Courses" })).getByText(
				/Aucune règle/,
			),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Appliquer les règles de Courses" }),
		).not.toBeInTheDocument();
	});

	it("filters the categories by rules", async () => {
		mockApi([food, transport]);
		const user = renderPage();

		await user.click(await screen.findByText("Sans règle"));

		expect(screen.getByRole("article", { name: "Courses" })).toBeVisible();
		expect(
			screen.queryByRole("article", { name: "Transport" }),
		).not.toBeInTheDocument();
	});

	it("creates a category with the colour typed, lowercased", async () => {
		mockApi([]);
		const user = renderPage();

		await openNew(user);
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
					body: {
						name: "Loisirs",
						color: "#be4bdb",
						icon: null,
						netTotals: false,
						rules: [],
					},
				},
			]),
		);
	});

	it("refuses a colour that is not a hex code without calling the API", async () => {
		mockApi([]);
		const user = renderPage();

		await openNew(user);
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
		const user = renderPage();

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
		const user = renderPage();

		await openNew(user);
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
						netTotals: false,
						rules: [],
					},
				},
			]),
		);
	});

	it("warns when the colour looks like another category's, apart from the one edited", async () => {
		const leisure: CategoryResponse = { ...food, id: "c3", name: "Loisirs" };
		mockApi([food, leisure]);
		const user = renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);

		expect(
			screen.getByText("Ressemble à la couleur de Loisirs"),
		).toBeInTheDocument();
	});

	it("refuses a name already taken without calling the API", async () => {
		mockApi([food]);
		const user = renderPage();

		await openNew(user);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Courses");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText("Une catégorie porte déjà ce nom"),
		).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("says when the category limit is reached", async () => {
		mockApi([], () => Promise.reject(new ApiError(409, "Conflict")));
		const user = renderPage();

		await openNew(user);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Loisirs");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText("Nombre maximum de catégories atteint"),
		).toBeInTheDocument();
	});

	it("renames a category, keeping its rules, without offering to apply them", async () => {
		mockApi([transport], () => Promise.resolve(transport));
		const user = renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Transport" }),
		);
		const name = screen.getByRole("textbox", { name: /Nom/ });
		await user.clear(name);
		await user.type(name, "Carburant");
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories/c2",
					method: "PUT",
					body: {
						name: "Carburant",
						color: "#fd7e14",
						icon: null,
						netTotals: false,
						rules: transport.rules,
					},
				},
			]),
		);
		expect(screen.queryByText(/Garder les catégories/)).not.toBeInTheDocument();
	});

	it("turns on offsetting refunds, off by default", async () => {
		mockApi([food]);
		const user = renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);
		const offset = screen.getByRole("switch", {
			name: /Compenser les remboursements/,
		});
		expect(offset).not.toBeChecked();
		await user.click(offset);
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(writes()).toEqual([
				expect.objectContaining({
					path: "/categories/c1",
					body: expect.objectContaining({ netTotals: true }),
				}),
			]),
		);
	});

	it("creates a category with a rule, trimmed, then applies it on demand", async () => {
		const created: CategoryResponse = {
			...food,
			id: "c9",
			name: "Énergie",
			rules: [{ labelPattern: { type: "startsWith", value: "PRLV EDF" } }],
		};
		mockApi([], (path) =>
			Promise.resolve(
				path.endsWith("/apply") ? { updated: 3, skipped: 1 } : created,
			),
		);
		const user = renderPage();

		await openNew(user);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Énergie");
		await user.click(screen.getByRole("button", { name: "Ajouter une règle" }));
		await user.click(screen.getByRole("combobox", { name: "Critère" }));
		await user.click(
			await screen.findByRole("option", { name: "Commence par" }),
		);
		await user.type(
			screen.getByRole("textbox", { name: "Valeur" }),
			" PRLV EDF ",
		);
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		await user.click(
			await screen.findByRole("button", {
				name: "Garder les catégories existantes",
			}),
		);

		await waitFor(() =>
			expect(writes()).toEqual([
				{
					path: "/categories",
					method: "POST",
					body: {
						name: "Énergie",
						color: expect.stringMatching(/^#[0-9a-f]{6}$/),
						icon: null,
						netTotals: false,
						rules: created.rules,
					},
				},
				{
					path: "/categories/c9/apply",
					method: "POST",
					body: { force: false },
				},
			]),
		);
	});

	it("refuses a rule without a value without calling the API", async () => {
		mockApi([]);
		const user = renderPage();

		await openNew(user);
		await user.type(screen.getByRole("textbox", { name: /Nom/ }), "Énergie");
		await user.click(screen.getByRole("button", { name: "Ajouter une règle" }));
		await user.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(
			await screen.findByText(/Chaque règle doit avoir une valeur/),
		).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("warns when another category already has the rule typed", async () => {
		mockApi([food, transport]);
		const user = renderPage();

		await user.click(
			await screen.findByRole("button", { name: "Modifier Courses" }),
		);
		await user.click(screen.getByRole("button", { name: "Ajouter une règle" }));
		await user.type(screen.getByRole("textbox", { name: "Valeur" }), "leclerc");

		expect(
			screen.getByText(/« contient leclerc » est aussi une règle de Transport/),
		).toBeInTheDocument();
	});

	it("applies a category's rules to every operation when asked to replace all", async () => {
		mockApi([transport], () => Promise.resolve({ updated: 5, skipped: 0 }));
		const user = renderPage();

		await user.click(
			await screen.findByRole("button", {
				name: "Appliquer les règles de Transport",
			}),
		);
		await user.click(screen.getByRole("button", { name: "Tout remplacer" }));

		expect(
			await screen.findByText(
				"5 opération(s) classée(s), 0 laissée(s) telle(s) quelle(s)",
			),
		).toBeInTheDocument();
		expect(writes()).toEqual([
			{ path: "/categories/c2/apply", method: "POST", body: { force: true } },
		]);
	});

	it("deletes a category once confirmed", async () => {
		mockApi([food], () => Promise.resolve(undefined));
		const user = renderPage();

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
