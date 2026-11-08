import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, Group, Notification, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Offers to reload once a new service worker is waiting. It never reloads by
 * itself, so an update cannot interrupt a form or an import in progress.
 */
export function UpdatePrompt() {
	const { t } = useTranslation();
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		// An installed app resumed from the background never navigates, which is
		// when browsers look for a new service worker: poll instead.
		onRegisteredSW(_url, registration) {
			if (registration) {
				setInterval(() => {
					registration.update().catch(() => undefined);
				}, UPDATE_CHECK_INTERVAL_MS);
			}
		},
	});

	if (!needRefresh) {
		return null;
	}

	return (
		<div
			className="fixed inset-x-3 z-[400] sm:left-auto sm:right-4 sm:w-96"
			style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
		>
			<Notification
				title={t("update.title")}
				icon={<IconRefresh size={20} />}
				color="forest"
				withBorder
				withCloseButton={false}
			>
				<Text size="sm">{t("update.message")}</Text>
				<Group justify="flex-end" gap="xs" mt="sm">
					<Button
						variant="default"
						h={44}
						onClick={() => setNeedRefresh(false)}
					>
						{t("update.dismiss")}
					</Button>
					<Button
						color="forest"
						h={44}
						onClick={() => updateServiceWorker(true)}
					>
						{t("update.reload")}
					</Button>
				</Group>
			</Notification>
		</div>
	);
}
