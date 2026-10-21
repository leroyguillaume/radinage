import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** Pick `optionLabel` in the Mantine Select labelled `inputName`. */
export async function selectMantineOption(
	inputName: RegExp | string,
	optionLabel: string,
) {
	const input = screen.getByRole("combobox", { name: inputName });
	// Focus then click to ensure combobox opens
	fireEvent.focus(input);
	fireEvent.click(input);
	const option = await screen.findByRole("option", { name: optionLabel });
	fireEvent.click(option);
	// Wait for the dropdown to close and state to settle
	await waitFor(() => {
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
	});
}
