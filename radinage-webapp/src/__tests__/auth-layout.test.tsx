import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthLayout } from "@/components/AuthLayout";
import { i18n } from "@/i18n";
import { theme } from "@/theme";

function renderLayout() {
	return render(
		<MantineProvider theme={theme}>
			<AuthLayout>
				<button type="button">child action</button>
			</AuthLayout>
		</MantineProvider>,
	);
}

describe("AuthLayout", () => {
	it("shows the brand with its tagline", () => {
		renderLayout();
		expect(screen.getByText("Radinage")).toBeInTheDocument();
		expect(screen.getByText(i18n.t("home.subtitle"))).toBeInTheDocument();
	});

	it("lists the three product features", () => {
		renderLayout();
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
		expect(
			screen.getByText(i18n.t("auth.features.importTitle")),
		).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("auth.features.rulesTitle")),
		).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("auth.features.forecastTitle")),
		).toBeInTheDocument();
	});

	it("renders its children in the form column", () => {
		renderLayout();
		expect(screen.getByRole("main").querySelector("button")).toHaveTextContent(
			"child action",
		);
	});
});
