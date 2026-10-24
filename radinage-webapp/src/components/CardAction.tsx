import { ActionIcon, Tooltip } from "@mantine/core";
import type { ReactNode } from "react";

/** An icon button of a card's header, its label shown as a tooltip. */
export function CardAction({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip label={label}>
			<ActionIcon
				variant="subtle"
				color="gray"
				size="xl"
				radius="md"
				onClick={onClick}
				aria-label={label}
			>
				{children}
			</ActionIcon>
		</Tooltip>
	);
}
