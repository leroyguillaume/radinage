import {
	Alert,
	Button,
	Paper,
	PasswordInput,
	Stack,
	Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { useChangePassword } from "@/lib/hooks";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const { t } = useTranslation();
	const changePassword = useChangePassword();

	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSuccess(false);

		if (newPassword !== confirmPassword) {
			setError(t("settings.errorPasswordMismatch"));
			return;
		}

		try {
			await changePassword.mutateAsync({ currentPassword, newPassword });
			setSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				setError(t("settings.errorCurrentPassword"));
			} else {
				setError(t("common.error"));
			}
		}
	}

	return (
		<div className="h-full overflow-y-auto p-4">
			<Stack className="mx-auto max-w-lg" gap="lg">
				<Title order={2} c="white">
					{t("settings.title")}
				</Title>

				<Paper shadow="md" p="md" radius="md">
					<form onSubmit={handleSubmit}>
						<Stack>
							<Title order={4}>{t("settings.changePassword")}</Title>

							{error && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{error}
								</Alert>
							)}

							{success && (
								<Alert color="green" icon={<IconCheck size={16} />}>
									{t("settings.success")}
								</Alert>
							)}

							<PasswordInput
								label={t("settings.currentPassword")}
								value={currentPassword}
								onChange={(e) => setCurrentPassword(e.currentTarget.value)}
								required
								autoFocus
							/>

							<PasswordInput
								label={t("settings.newPassword")}
								value={newPassword}
								onChange={(e) => setNewPassword(e.currentTarget.value)}
								required
							/>

							<PasswordInput
								label={t("settings.confirmPassword")}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.currentTarget.value)}
								required
							/>

							<Button
								type="submit"
								loading={changePassword.isPending}
								size="md"
							>
								{t("settings.submit")}
							</Button>
						</Stack>
					</form>
				</Paper>
			</Stack>
		</div>
	);
}
