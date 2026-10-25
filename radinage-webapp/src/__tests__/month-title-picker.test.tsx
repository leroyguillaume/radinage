import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import "dayjs/locale/fr";
import { describe, expect, it, vi } from "vitest";
import { MonthTitlePicker } from "@/components/MonthTitlePicker";
import { theme } from "@/theme";

const renderPicker = (value: Date) =>
	render(
		<MantineProvider theme={theme}>
			<MonthTitlePicker value={value} locale="fr" onChange={vi.fn()} />
		</MantineProvider>,
	);

describe("MonthTitlePicker", () => {
	it("shows the selected month", () => {
		renderPicker(new Date(2026, 7));
		expect(screen.getByRole("button", { name: /août 2026/i })).toBeVisible();
	});

	it("reserves room for every month of the year, whichever is selected", () => {
		const { unmount } = renderPicker(new Date(2026, 4));
		const sizers = screen.getAllByTestId("month-title-sizer");
		expect(sizers.map((s) => s.textContent)).toContain("septembre 2026");
		expect(sizers).toHaveLength(12);
		unmount();

		renderPicker(new Date(2026, 8));
		expect(
			screen.getAllByTestId("month-title-sizer").map((s) => s.textContent),
		).toEqual(sizers.map((s) => s.textContent));
	});
});
