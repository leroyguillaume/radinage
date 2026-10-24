import {
	Autocomplete,
	ColorInput,
	Drawer,
	FileInput,
	MantineProvider,
	Modal,
	MultiSelect,
	NumberInput,
	Paper,
	PasswordInput,
	Select,
	TextInput,
} from "@mantine/core";
import { DateInput, DatePickerInput, MonthPickerInput } from "@mantine/dates";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
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

	it.each<[string, ComponentType<{ label: string }>]>([
		["TextInput", TextInput],
		["PasswordInput", PasswordInput],
		["NumberInput", NumberInput],
		["Select", Select],
		["MultiSelect", MultiSelect],
		["Autocomplete", Autocomplete],
		["FileInput", FileInput],
		["ColorInput", ColorInput],
		["DateInput", DateInput],
		["DatePickerInput", DatePickerInput],
		["MonthPickerInput", MonthPickerInput],
	])("gives %s 16px text so iOS does not zoom on focus", (_, Input) => {
		const { container } = renderWithTheme(<Input label="Field" />);
		const wrapper = container.querySelector<HTMLElement>(
			".mantine-Input-wrapper",
		);
		expect(wrapper?.style.getPropertyValue("--input-fz")).toBe(
			"var(--mantine-font-size-md)",
		);
	});
});
