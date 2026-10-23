import { ActionIcon, Group, Popover, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
	title: ReactNode;
	subtitle?: ReactNode;
	/**
	 * Below `sm`, tucks the subtitle behind an info button with this
	 * accessible name instead of spelling it out under the title.
	 */
	subtitleInfoLabel?: string;
	actions?: ReactNode;
}

export function PageHeader({
	title,
	subtitle,
	subtitleInfoLabel,
	actions,
}: PageHeaderProps) {
	const collapsible = subtitle !== undefined && subtitleInfoLabel !== undefined;
	const heading = (
		<Title order={1} fz={{ base: 30, sm: 40 }} lts="-0.02em" lh={1.1}>
			{title}
		</Title>
	);
	return (
		<Group justify="space-between" align="center" gap="md" wrap="wrap">
			<Stack gap={4}>
				{collapsible ? (
					<Group gap={4} wrap="nowrap">
						{heading}
						<Popover position="bottom-start" width={300} withArrow shadow="md">
							<Popover.Target>
								<ActionIcon
									hiddenFrom="sm"
									size={44}
									radius="md"
									variant="subtle"
									color="gray"
									c="dimmed"
									aria-label={subtitleInfoLabel}
								>
									<IconInfoCircle aria-hidden size={22} />
								</ActionIcon>
							</Popover.Target>
							<Popover.Dropdown aria-label={subtitleInfoLabel}>
								<Text size="sm">{subtitle}</Text>
							</Popover.Dropdown>
						</Popover>
					</Group>
				) : (
					heading
				)}
				{subtitle && (
					<Text c="dimmed" visibleFrom={collapsible ? "sm" : undefined}>
						{subtitle}
					</Text>
				)}
			</Stack>
			{actions && (
				<Group gap="sm" wrap="wrap">
					{actions}
				</Group>
			)}
		</Group>
	);
}
