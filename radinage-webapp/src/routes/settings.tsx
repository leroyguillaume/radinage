import {
	Alert,
	Button,
	Group,
	Paper,
	PasswordInput,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconCheck,
	IconDownload,
	IconUpload,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { useChangePassword, useExportData, useImportData } from "@/lib/hooks";
import type { ExportDataResponse, ImportDataResponse } from "@/lib/types";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

export function SettingsPage() {
	const { t } = useTranslation();
	const changePassword = useChangePassword();
	const exportData = useExportData();
	const importData = useImportData();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [passwordSuccess, setPasswordSuccess] = useState(false);

	const [dataError, setDataError] = useState<string | null>(null);
	const [dataSuccess, setDataSuccess] = useState<ImportDataResponse | null>(
		null,
	);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setPasswordError(null);
		setPasswordSuccess(false);

		if (newPassword !== confirmPassword) {
			setPasswordError(t("settings.errorPasswordMismatch"));
			return;
		}

		try {
			await changePassword.mutateAsync({ currentPassword, newPassword });
			setPasswordSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				setPasswordError(t("settings.errorCurrentPassword"));
			} else {
				setPasswordError(t("common.error"));
			}
		}
	}

	async function handleExport() {
		setDataError(null);
		setDataSuccess(null);
		try {
			const data = await exportData.mutateAsync();
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			const blob = new Blob([JSON.stringify(data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `radinage-export-${ts}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			setDataError(t("settings.data.exportError"));
		}
	}

	async function handleImportFile(file: File) {
		setDataError(null);
		setDataSuccess(null);
		try {
			const text = await file.text();
			const payload = JSON.parse(text) as ExportDataResponse;
			const result = await importData.mutateAsync(payload);
			setDataSuccess(result);
		} catch {
			setDataError(t("settings.data.importError"));
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

							{passwordError && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{passwordError}
								</Alert>
							)}

							{passwordSuccess && (
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

				<Paper shadow="md" p="md" radius="md">
					<Stack>
						<Title order={4}>{t("settings.data.title")}</Title>
						<Text size="sm" c="dimmed">
							{t("settings.data.description")}
						</Text>

						{dataError && (
							<Alert color="red" icon={<IconAlertCircle size={16} />}>
								{dataError}
							</Alert>
						)}

						{dataSuccess && (
							<Alert color="green" icon={<IconCheck size={16} />}>
								{t("settings.data.importSuccess", {
									budgets: dataSuccess.importedBudgets,
									skippedBudgets: dataSuccess.skippedBudgets,
									operations: dataSuccess.importedOperations,
									skippedOperations: dataSuccess.skippedOperations,
								})}
							</Alert>
						)}

						<Group grow>
							<Button
								variant="light"
								leftSection={<IconDownload size={16} />}
								loading={exportData.isPending}
								onClick={handleExport}
							>
								{t("settings.data.export")}
							</Button>
							<Button
								variant="light"
								leftSection={<IconUpload size={16} />}
								loading={importData.isPending}
								onClick={() => fileInputRef.current?.click()}
							>
								{t("settings.data.import")}
							</Button>
						</Group>

						<input
							ref={fileInputRef}
							type="file"
							accept="application/json,.json"
							className="hidden"
							aria-label={t("settings.data.import")}
							onChange={(e) => {
								const file = e.currentTarget.files?.[0];
								e.currentTarget.value = "";
								if (file) {
									handleImportFile(file);
								}
							}}
						/>
					</Stack>
				</Paper>
			</Stack>
		</div>
	);
}
