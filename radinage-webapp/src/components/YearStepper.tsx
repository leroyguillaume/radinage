import { ActionIcon, Group, Text } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { headingFont, palette } from "@/theme";

interface YearStepperProps {
	year: number;
	onChange: (delta: number) => void;
}

export function YearStepper({ year, onChange }: YearStepperProps) {
	const { t } = useTranslation();
	return (
		<Group
			gap={4}
			p={4}
			wrap="nowrap"
			bg={palette.surface}
			bd={`1px solid ${palette.border}`}
			style={{ borderRadius: 999 }}
		>
			<ActionIcon
				size={44}
				radius="xl"
				variant="subtle"
				aria-label={t("common.previousYear")}
				onClick={() => onChange(-1)}
			>
				<IconChevronLeft size={20} />
			</ActionIcon>
			<Text
				className="tabular-nums"
				ff={headingFont}
				fw={700}
				fz={{ base: 17, sm: 20 }}
				miw={{ base: 48, sm: 64 }}
				ta="center"
			>
				{year}
			</Text>
			<ActionIcon
				size={44}
				radius="xl"
				variant="subtle"
				aria-label={t("common.nextYear")}
				onClick={() => onChange(1)}
			>
				<IconChevronRight size={20} />
			</ActionIcon>
		</Group>
	);
}
