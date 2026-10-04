import { Box, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { headingFont } from "@/theme";

interface StatTileProps {
	label: ReactNode;
	value: ReactNode;
	/** CSS colour of the small marker before the label. */
	dotColor: string;
	/** CSS colour of the value; defaults to the body text colour. */
	valueColor?: string;
}

export function StatTile({
	label,
	value,
	dotColor,
	valueColor,
}: StatTileProps) {
	return (
		<Paper radius="lg" p="md">
			<Stack gap={6}>
				<Group gap={8} wrap="nowrap">
					<Box w={10} h={10} bg={dotColor} style={{ borderRadius: 3 }} />
					<Text size="sm" fw={600} c="dimmed">
						{label}
					</Text>
				</Group>
				<Text
					className="tabular-nums"
					ff={headingFont}
					fz={{ base: 22, sm: 28 }}
					fw={700}
					c={valueColor}
				>
					{value}
				</Text>
			</Stack>
		</Paper>
	);
}
