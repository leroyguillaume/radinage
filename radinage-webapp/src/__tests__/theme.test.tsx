import { Drawer, MantineProvider, Modal, Paper } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { theme } from "@/theme";

function renderWithTheme(ui: React.ReactNode) {
	return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

describe("theme", () => {
	it("pads and borders a plain Paper", () => {
		renderWithTheme(<Paper data-testid="paper" />);
		const paper = screen.getByTestId("paper");
		expect(paper).toHaveAttribute("data-with-border", "true");
		expect(paper.style.padding).toContain("--mantine-spacing-lg");
	});

	it.each([
		[
			"Modal",
			<Modal key="modal" opened onClose={() => {}} title="Title">
				Body
			</Modal>,
		],
		[
			"Drawer",
			<Drawer key="drawer" opened onClose={() => {}} title="Title">
				Body
			</Drawer>,
		],
	])("keeps the %s header flush with the top of its content", (_, ui) => {
		renderWithTheme(ui);
		const dialog = screen.getByRole("dialog");
		expect(dialog).not.toHaveAttribute("data-with-border");
		expect(dialog.style.padding).not.toContain("--mantine-spacing-lg");
	});
});
