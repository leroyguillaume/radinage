import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { i18n } from "@/i18n";

const sw = vi.hoisted(() => ({
	needRefresh: false,
	setNeedRefresh: vi.fn<(value: boolean) => void>(),
	updateServiceWorker: vi.fn<(reloadPage?: boolean) => Promise<void>>(),
}));

vi.mock("virtual:pwa-register/react", async () => {
	const { useState } = await import("react");
	return {
		useRegisterSW: () => {
			const [needRefresh, setNeedRefresh] = useState(sw.needRefresh);
			return {
				needRefresh: [
					needRefresh,
					(value: boolean) => {
						sw.setNeedRefresh(value);
						setNeedRefresh(value);
					},
				],
				offlineReady: [false, vi.fn()],
				updateServiceWorker: sw.updateServiceWorker,
			};
		},
	};
});

function renderPrompt() {
	return render(
		<MantineProvider>
			<UpdatePrompt />
		</MantineProvider>,
	);
}

describe("UpdatePrompt", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("en");
		sw.needRefresh = false;
		sw.setNeedRefresh.mockClear();
		sw.updateServiceWorker.mockReset().mockResolvedValue(undefined);
	});

	it("stays hidden while no new version is waiting", () => {
		renderPrompt();
		expect(screen.queryByText("New version available")).toBeNull();
	});

	it("offers to reload once a new version is waiting", () => {
		sw.needRefresh = true;
		renderPrompt();
		expect(screen.getByText("New version available")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
	});

	it("activates the waiting service worker on reload", async () => {
		sw.needRefresh = true;
		renderPrompt();
		await userEvent.click(screen.getByRole("button", { name: "Reload" }));
		expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
	});

	it("hides the prompt when dismissed, without updating", async () => {
		sw.needRefresh = true;
		renderPrompt();
		await userEvent.click(screen.getByRole("button", { name: "Later" }));
		expect(screen.queryByText("New version available")).toBeNull();
		expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
		expect(sw.updateServiceWorker).not.toHaveBeenCalled();
	});
});
