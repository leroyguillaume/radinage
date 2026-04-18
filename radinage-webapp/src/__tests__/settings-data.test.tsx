import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { SettingsPage } from "@/routes/settings";
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

const { apiFetch } = await import("@/lib/api");
const apiFetchMock = vi.mocked(apiFetch);

function renderPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<SettingsPage />
			</MantineProvider>
		</QueryClientProvider>,
	);
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SettingsPage data section", () => {
	it("renders export and import buttons", () => {
		renderPage();
		expect(
			screen.getByRole("button", { name: /Exporter les données/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Importer des données/ }),
		).toBeInTheDocument();
	});

	it("calls /data/export and triggers a file download", async () => {
		const exportPayload = {
			version: 1,
			exportedAt: "2026-04-18T00:00:00Z",
			budgets: [],
			operations: [],
		};
		apiFetchMock.mockResolvedValueOnce(exportPayload);

		const createUrl = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:mock-url");
		const revokeUrl = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {
				/* noop */
			});
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {
				/* noop */
			});

		renderPage();
		const user = userEvent.setup();
		await user.click(
			screen.getByRole("button", { name: /Exporter les données/ }),
		);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith("/data/export");
		});
		expect(createUrl).toHaveBeenCalled();
		expect(clickSpy).toHaveBeenCalled();
		expect(revokeUrl).toHaveBeenCalled();
	});

	it("shows an error when export fails", async () => {
		apiFetchMock.mockRejectedValueOnce(new Error("boom"));
		renderPage();

		const user = userEvent.setup();
		await user.click(
			screen.getByRole("button", { name: /Exporter les données/ }),
		);

		expect(
			await screen.findByText("Erreur lors de l'export"),
		).toBeInTheDocument();
	});

	it("imports a JSON file and displays the result counts", async () => {
		apiFetchMock.mockResolvedValueOnce({
			importedBudgets: 2,
			skippedBudgets: 1,
			importedOperations: 5,
			skippedOperations: 3,
		});

		renderPage();

		const payload = { version: 1, budgets: [], operations: [] };
		const file = new File([JSON.stringify(payload)], "backup.json", {
			type: "application/json",
		});

		const user = userEvent.setup();
		const fileInput = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await user.upload(fileInput, file);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith("/data/import", {
				method: "POST",
				body: JSON.stringify(payload),
			});
		});
		expect(
			await screen.findByText(
				"2 budget(s) importé(s) (1 ignoré(s)), 5 opération(s) importée(s) (3 ignorée(s))",
			),
		).toBeInTheDocument();
	});

	it("shows an error when the uploaded file is not valid JSON", async () => {
		renderPage();
		const file = new File(["not json at all"], "bad.json", {
			type: "application/json",
		});

		const user = userEvent.setup();
		const fileInput = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await user.upload(fileInput, file);

		expect(
			await screen.findByText("Fichier invalide ou import refusé"),
		).toBeInTheDocument();
		expect(apiFetchMock).not.toHaveBeenCalled();
	});

	it("shows an error when the import API rejects the payload", async () => {
		apiFetchMock.mockRejectedValueOnce(new Error("reject"));
		renderPage();

		const payload = { version: 999, budgets: [], operations: [] };
		const file = new File([JSON.stringify(payload)], "backup.json", {
			type: "application/json",
		});

		const user = userEvent.setup();
		const fileInput = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await user.upload(fileInput, file);

		expect(
			await screen.findByText("Fichier invalide ou import refusé"),
		).toBeInTheDocument();
	});
});
