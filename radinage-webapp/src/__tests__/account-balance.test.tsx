import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountBalanceSection } from "@/components/AccountBalanceSection";
import { i18n } from "@/i18n";
import type { AccountBalance } from "@/lib/types";
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

const BALANCE_PATH = "/users/me/balance";

/** Serve `balance` on GET and answer writes with `onWrite`. */
function mockBalanceApi(
	balance: AccountBalance | null,
	onWrite: (init: RequestInit) => Promise<unknown> = (init) =>
		Promise.resolve(
			init.method === "PUT" ? JSON.parse(String(init.body)) : undefined,
		),
) {
	apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
		if (path !== BALANCE_PATH) {
			return Promise.reject(new Error(`Unexpected path: ${path}`));
		}
		if (init?.method) {
			return onWrite(init);
		}
		return balance
			? Promise.resolve(balance)
			: Promise.reject(new ApiError(404, "Not Found"));
	});
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<DatesProvider settings={{ locale: "fr" }}>
					<AccountBalanceSection />
				</DatesProvider>
			</MantineProvider>
		</QueryClientProvider>,
	);
}

function writes() {
	return apiFetchMock.mock.calls.filter(([, init]) => init?.method);
}

beforeEach(async () => {
	await i18n.changeLanguage("fr");
	apiFetchMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("AccountBalanceSection", () => {
	it("explains that operations on the balance date are already included", async () => {
		mockBalanceApi(null);
		renderSection();

		expect(
			await screen.findByText(/considérées comme déjà incluses dans ce solde/),
		).toBeInTheDocument();
	});

	it("records a balance dated today by default", async () => {
		mockBalanceApi(null);
		renderSection();
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText(/^Solde/), "-1523,4");
		expect(
			screen.queryByRole("button", { name: "Effacer le solde" }),
		).not.toBeInTheDocument();
		await user.click(
			screen.getByRole("button", { name: "Enregistrer le solde" }),
		);

		await waitFor(() => {
			expect(writes()).toEqual([
				[
					BALANCE_PATH,
					{
						method: "PUT",
						body: JSON.stringify({
							amount: "-1523.40",
							date: dayjs().format("YYYY-MM-DD"),
						}),
					},
				],
			]);
		});
		expect(await screen.findByText("Solde enregistré")).toBeInTheDocument();
	});

	it("prefills the recorded balance and clears it", async () => {
		mockBalanceApi({ amount: "-80.1000", date: "2026-03-31" });
		renderSection();
		const user = userEvent.setup();

		expect(await screen.findByDisplayValue("-80,10")).toBeInTheDocument();
		expect(screen.getByDisplayValue("31/03/2026")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Effacer le solde" }));

		await waitFor(() => {
			expect(writes()).toEqual([[BALANCE_PATH, { method: "DELETE" }]]);
		});
		expect(
			await screen.findByText("Solde effacé : le résumé repart de zéro."),
		).toBeInTheDocument();
	});

	it("rejects an amount that is not one without calling the API", async () => {
		mockBalanceApi(null);
		renderSection();
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText(/^Solde/), "beaucoup");
		await user.click(
			screen.getByRole("button", { name: "Enregistrer le solde" }),
		);

		expect(await screen.findByText("Montant invalide")).toBeInTheDocument();
		expect(writes()).toEqual([]);
	});

	it("explains a refusal of the date by the API", async () => {
		mockBalanceApi(null, () => Promise.reject(new ApiError(400, "future")));
		renderSection();
		const user = userEvent.setup();

		await user.type(await screen.findByLabelText(/^Solde/), "12");
		await user.click(
			screen.getByRole("button", { name: "Enregistrer le solde" }),
		);

		expect(
			await screen.findByText(
				"La date du solde ne peut pas être dans le futur",
			),
		).toBeInTheDocument();
	});
});
