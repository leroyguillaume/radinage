import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { theme } from "@/theme";

function renderWithTheme(ui: ReactNode) {
	return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

describe("PageHeader", () => {
	it("renders the title as the page heading with subtitle and actions", () => {
		renderWithTheme(
			<PageHeader
				title="Budgets"
				subtitle="Avancement"
				actions={<button type="button">Nouveau budget</button>}
			/>,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Budgets" }),
		).toBeInTheDocument();
		expect(screen.getByText("Avancement")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Nouveau budget" }),
		).toBeInTheDocument();
	});

	it("only offers an info button when asked for one", () => {
		renderWithTheme(<PageHeader title="Budgets" subtitle="Avancement" />);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("reveals the subtitle from its info button", async () => {
		const user = userEvent.setup();
		renderWithTheme(
			<PageHeader
				title="Résumé"
				subtitle="Réel puis prévision"
				subtitleInfoLabel="Comment c'est calculé"
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Comment c'est calculé" }),
		);

		const popover = await screen.findByRole("dialog", {
			name: "Comment c'est calculé",
		});
		expect(
			within(popover).getByText("Réel puis prévision"),
		).toBeInTheDocument();
	});

	it("omits the subtitle when none is given", () => {
		const { container } = renderWithTheme(<PageHeader title="Résumé" />);
		expect(container.querySelectorAll("p")).toHaveLength(0);
	});
});

describe("StatTile", () => {
	it("shows its label and value", () => {
		renderWithTheme(
			<StatTile label="Revenus" value="3 420,00 €" dotColor="green" />,
		);
		expect(screen.getByText("Revenus")).toBeInTheDocument();
		expect(screen.getByText("3 420,00 €")).toBeInTheDocument();
	});
});
