import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { BrandLogo } from "@/components/BrandLogo";

function renderLogo(props: Parameters<typeof BrandLogo>[0] = {}) {
	return render(
		<MantineProvider>
			<BrandLogo {...props} />
		</MantineProvider>,
	);
}

describe("BrandLogo", () => {
	it("shows the app name next to the vector icon", () => {
		const { container } = renderLogo();
		expect(screen.getByText("Radinage")).toBeInTheDocument();
		expect(container.querySelector("img")).toHaveAttribute("src", "/logo.svg");
	});

	it("hides the tagline by default", () => {
		renderLogo();
		expect(
			screen.queryByText(/suivi bancaire malin|smart bank tracking/i),
		).toBeNull();
	});

	it("shows the tagline when asked", () => {
		renderLogo({ size: "lg", withTagline: true });
		expect(
			screen.getByText(/suivi bancaire malin|smart bank tracking/i),
		).toBeInTheDocument();
	});
});
