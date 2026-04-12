import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportModal } from "@/components/ImportModal";
import { i18n } from "@/i18n";
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

const STORAGE_KEY = "import_config";

function renderModal(onClose = vi.fn(), onSuccess = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme}>
				<ImportModal opened onClose={onClose} onSuccess={onSuccess} />
			</MantineProvider>
		</QueryClientProvider>,
	);

	return { onClose, onSuccess, queryClient };
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ImportModal", () => {
	it("renders all configuration fields", () => {
		renderModal();

		expect(screen.getByText("Importer des opérations")).toBeInTheDocument();
		expect(
			screen.getByText("Colonne du libellé (à partir de 0)"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Colonne du montant (à partir de 0)"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Colonne de la date (à partir de 0)"),
		).toBeInTheDocument();
		expect(screen.getByText("Format de date")).toBeInTheDocument();
		expect(screen.getByText("Lignes à ignorer (en-tête)")).toBeInTheDocument();
	});

	it("has import button disabled when no file is selected", () => {
		renderModal();

		const button = screen.getByRole("button", { name: "Importer" });
		expect(button).toBeDisabled();
	});

	it("saves config to localStorage when changed", async () => {
		renderModal();
		const user = userEvent.setup();

		const dateFormatInput = screen.getByDisplayValue("%d/%m/%Y");
		await user.clear(dateFormatInput);
		await user.type(dateFormatInput, "%Y-%m-%d");

		expect(screen.getByDisplayValue("%Y-%m-%d")).toBeInTheDocument();
	});

	it("renders with default config values", () => {
		renderModal();

		expect(screen.getByDisplayValue("%d/%m/%Y")).toBeInTheDocument();
		expect(
			screen.getByLabelText("Colonne du libellé (à partir de 0)"),
		).toHaveValue("0");
		expect(
			screen.getByLabelText("Colonne du montant (à partir de 0)"),
		).toHaveValue("1");
		expect(
			screen.getByLabelText("Colonne de la date (à partir de 0)"),
		).toHaveValue("2");
		expect(screen.getByLabelText("Lignes à ignorer (en-tête)")).toHaveValue(
			"1",
		);
	});

	it("calls onSuccess on successful import", async () => {
		const importResult = { imported: 5, skipped: 1, errors: [] };
		apiFetchMock.mockResolvedValueOnce(importResult);

		const { onSuccess } = renderModal();
		const user = userEvent.setup();

		const file = new File(["test,data"], "test.csv", { type: "text/csv" });
		const fileInput = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await user.upload(fileInput, file);

		const button = screen.getByRole("button", { name: "Importer" });
		await user.click(button);

		await waitFor(() => {
			expect(onSuccess).toHaveBeenCalledWith(importResult);
		});
	});

	it("shows error on failed import", async () => {
		apiFetchMock.mockRejectedValueOnce(new Error("Network error"));

		renderModal();
		const user = userEvent.setup();

		const file = new File(["test,data"], "test.csv", { type: "text/csv" });
		const fileInput = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await user.upload(fileInput, file);

		const button = screen.getByRole("button", { name: "Importer" });
		await user.click(button);

		expect(
			await screen.findByText("Erreur lors de l'import"),
		).toBeInTheDocument();
	});
});
