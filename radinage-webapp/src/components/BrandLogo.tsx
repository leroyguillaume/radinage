import { Group, Image, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { headingFont } from "@/theme";

interface BrandLogoProps {
	size?: "sm" | "lg";
	withTagline?: boolean;
	/** Light text, for dark backgrounds. */
	inverted?: boolean;
}

const sizes = {
	sm: { icon: 38, name: 22, tagline: "xs" },
	lg: { icon: 96, name: 52, tagline: "lg" },
} as const;

export function BrandLogo({
	size = "sm",
	withTagline = false,
	inverted = false,
}: BrandLogoProps) {
	const { t } = useTranslation();
	const s = sizes[size];

	return (
		<Group gap={size === "sm" ? 10 : "lg"} wrap="nowrap">
			<Image src="/logo.svg" alt="" h={s.icon} w={s.icon} />
			<Stack gap={2}>
				<Text
					ff={headingFont}
					fw={800}
					fz={s.name}
					lh={1}
					lts="-0.02em"
					c={inverted ? "white" : "forest.7"}
				>
					{t("common.appName")}
				</Text>
				{withTagline && (
					<Text c={inverted ? "forest.1" : "dimmed"} fz={s.tagline}>
						{t("home.subtitle")}
					</Text>
				)}
			</Stack>
		</Group>
	);
}
