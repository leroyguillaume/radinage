import { Group, Modal, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

/** A modal asking to confirm an action, its buttons given as children. */
export function ConfirmModal({
	opened,
	onClose,
	title,
	message,
	children,
}: {
	opened: boolean;
	onClose: () => void;
	title: string;
	message: string;
	children: ReactNode;
}) {
	return (
		<Modal opened={opened} onClose={onClose} title={title} size="md">
			<Stack>
				<Text>{message}</Text>
				<Group justify="flex-end" gap="sm">
					{children}
				</Group>
			</Stack>
		</Modal>
	);
}
