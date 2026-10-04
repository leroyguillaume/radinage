import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface PageHeaderProps {
	title: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
	return (
		<Group justify="space-between" align="center" gap="md" wrap="wrap">
			<Stack gap={4}>
				<Title order={1} fz={{ base: 30, sm: 40 }} lts="-0.02em" lh={1.1}>
					{title}
				</Title>
				{subtitle && <Text c="dimmed">{subtitle}</Text>}
			</Stack>
			{actions && (
				<Group gap="sm" wrap="wrap">
					{actions}
				</Group>
			)}
		</Group>
	);
}
