import { Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconFilter, IconTrendingUp, IconUpload } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";

const features = [
	{ icon: IconUpload, key: "import" },
	{ icon: IconFilter, key: "rules" },
	{ icon: IconTrendingUp, key: "forecast" },
] as const;

interface AuthLayoutProps {
	children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
	const { t } = useTranslation();

	return (
		<div className="flex h-full flex-col overflow-auto md:flex-row">
			<Box
				component="aside"
				bg="forest.7"
				c="white"
				className="flex flex-none flex-col justify-center md:flex-1"
				p={{ base: "lg", md: 56 }}
				style={{ gap: 40 }}
			>
				<BrandLogo size="lg" withTagline inverted />
				<Stack gap="lg" maw={460} visibleFrom="md" component="ul" p={0} m={0}>
					{features.map(({ icon: Icon, key }) => (
						<Group
							key={key}
							component="li"
							gap="md"
							align="flex-start"
							wrap="nowrap"
							style={{ listStyle: "none" }}
						>
							<ThemeIcon
								size={44}
								radius="md"
								color="gold.5"
								variant="transparent"
								bg="rgba(255,255,255,0.12)"
								aria-hidden
							>
								<Icon size={22} color="var(--mantine-color-gold-5)" />
							</ThemeIcon>
							<Stack gap={2}>
								<Text fw={700} fz="md">
									{t(`auth.features.${key}Title`)}
								</Text>
								<Text c="forest.1">{t(`auth.features.${key}Text`)}</Text>
							</Stack>
						</Group>
					))}
				</Stack>
			</Box>
			<main className="flex flex-1 items-start justify-center px-6 py-10 md:items-center">
				<div className="w-full max-w-[400px]">{children}</div>
			</main>
		</div>
	);
}
