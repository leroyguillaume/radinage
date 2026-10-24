import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportProfilesSection } from "@/components/ImportProfilesSection";
import { i18n } from "@/i18n";
import type { AccountResponse, ImportProfileResponse } from "@/lib/types";
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

function makeProfile(
	overrides: Partial<ImportProfileResponse> = {},
): ImportProfileResponse {
	return {
		id: "p1",
		name: "Crédit Agricole",
		accountId: "account-1",
		labelCol: 1,
		amountCol: 3,
		dateCol: 0,
		dateFormat: "%d/%m/%Y",
		skipLines: 1,
		csvDelimiter: "semicolon",
		lastUsedAt: "2026-10-20T10:00:00Z",
		createdAt: "2026-01-01T10:00:00Z",
		...overrides,
	};
}

const account: AccountResponse = {
	id: "account-1",
	name: "Compte perso",
	kind: "checking",
	imported: true,
	receivesOperations: true,
	balance: null,
	currentBalance: null,
	transferredInto: false,
	createdAt: "2026-01-01T10:00:00Z",
};

const joint: AccountResponse = {
	...account,
	id: "account-2",
	name: "Compte joint",
};

const savings: AccountResponse = {
	...account,
	id: "account-3",
	name: "Livret A",
	kind: "savings",
	imported: false,
	receivesOperations: false,
};

/** Serve `profiles` on the list, two accounts receiving operations, and accept every write. */
function mockApi(profiles: ImportProfileResponse[]) {
	apiFetchMock.mockImplementation(async (path, init) => {
		if (path === "/import-profiles" && init?.method === undefined) {
			return profiles;
		}
		if (path === "/accounts") {
			return [joint, account, savings];
		}
		if (path.startsWith("/import-profiles")) return undefined;
		throw new Error(`unexpected call to ${path}`);
	});
}

function writes(method: string) {
	return apiFetchMock.mock.calls.filter(([, init]) => init?.method === method);
}

function renderSection(shown: AccountResponse = account) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<MantineProvider theme={theme} env="test">
				<ImportProfilesSection account={shown} />
			</MantineProvider>
		</QueryClientProvider>,
	);
}

describe("ImportProfilesSection", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("en");
	});

	afterEach(() => {
		apiFetchMock.mockReset();
	});

	it("lists each profile with its columns and settings", async () => {
		mockApi([
			makeProfile(),
			makeProfile({
				id: "p2",
				name: "Revolut",
				dateFormat: "%Y-%m-%d %H:%M:%S",
				skipLines: 3,
				lastUsedAt: null,
			}),
		]);
		renderSection();

		const items = await screen.findAllByRole("listitem");
		expect(items).toHaveLength(2);
		const [first, second] = items;
		if (!first || !second) throw new Error("missing rows");

		expect(within(first).getByText("Crédit Agricole")).toBeInTheDocument();
		expect(within(first).getByText("Label B")).toBeInTheDocument();
		expect(within(first).getByText("Amount D")).toBeInTheDocument();
		expect(within(first).getByText("Date A")).toBeInTheDocument();
		expect(within(first).getByText("31/12/2026")).toBeInTheDocument();
		expect(within(first).getByText("Semicolon ( ; )")).toBeInTheDocument();
		expect(within(first).getByText("1 skipped line")).toBeInTheDocument();
		expect(
			within(first).getByText("Last import on October 20, 2026"),
		).toBeInTheDocument();

		expect(within(second).getByText("2026-12-31 14:30:00")).toBeInTheDocument();
		expect(within(second).getByText("3 skipped lines")).toBeInTheDocument();
		expect(within(second).getByText("Never used")).toBeInTheDocument();
	});

	it("lists only the profiles importing on the account", async () => {
		mockApi([
			makeProfile(),
			makeProfile({ id: "p2", name: "Revolut", accountId: "account-2" }),
		]);
		renderSection();

		expect(await screen.findByText("Crédit Agricole")).toBeInTheDocument();
		expect(screen.queryByText("Revolut")).not.toBeInTheDocument();
	});

	it("starts a new profile on the account", async () => {
		const user = userEvent.setup();
		mockApi([]);
		renderSection();

		await user.click(
			await screen.findByRole("button", { name: "New profile" }),
		);

		const dialog = await screen.findByRole("dialog", { name: "New profile" });
		await waitFor(() =>
			expect(
				within(dialog).getByRole("combobox", { name: /^Account/ }),
			).toHaveValue("Compte perso"),
		);
	});

	it("renders nothing for an account without operations nor profiles", async () => {
		mockApi([makeProfile()]);
		renderSection(savings);

		await waitFor(() =>
			expect(
				apiFetchMock.mock.calls.some(([path]) => path === "/import-profiles"),
			).toBe(true),
		);
		expect(screen.queryByText("Import profiles")).not.toBeInTheDocument();
	});

	it("says so when there is no profile yet", async () => {
		mockApi([]);
		renderSection();

		expect(
			await screen.findByText(
				"No profile yet. Create one here or during your first import.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "New profile" }),
		).toBeInTheDocument();
	});

	it("opens the profile form filled with the profile to edit", async () => {
		const user = userEvent.setup();
		mockApi([makeProfile()]);
		renderSection();

		await user.click(
			await screen.findByRole("button", {
				name: "Edit profile Crédit Agricole",
			}),
		);

		const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
		expect(within(dialog).getByLabelText(/^Name/)).toHaveValue(
			"Crédit Agricole",
		);
	});

	it("deletes a profile only once confirmed", async () => {
		const user = userEvent.setup();
		mockApi([makeProfile()]);
		renderSection();

		await user.click(
			await screen.findByRole("button", {
				name: "Delete profile Crédit Agricole",
			}),
		);
		expect(
			screen.getByText(
				"Delete the profile “Crédit Agricole”? Operations already imported are kept.",
			),
		).toBeInTheDocument();
		expect(writes("DELETE")).toHaveLength(0);

		await user.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(writes("DELETE")).toHaveLength(1));
		expect(writes("DELETE")[0]?.[0]).toBe("/import-profiles/p1");
	});
});
