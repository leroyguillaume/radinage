import {
	Alert,
	Button,
	FileInput,
	Modal,
	NumberInput,
	Stack,
	TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/api";

const STORAGE_KEY = "import_config";

interface ImportConfig {
	labelCol: number;
	amountCol: number;
	dateCol: number;
	dateFormat: string;
	skipLines: number;
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: { row: number; reason: string }[];
}

function loadConfig(): ImportConfig {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			return JSON.parse(stored) as ImportConfig;
		}
	} catch {
		// ignore
	}
	return {
		labelCol: 0,
		amountCol: 1,
		dateCol: 2,
		dateFormat: "%d/%m/%Y",
		skipLines: 1,
	};
}

function saveConfig(config: ImportConfig) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	} catch {
		// ignore
	}
}

export function ImportModal({
	opened,
	onClose,
	onSuccess,
}: {
	opened: boolean;
	onClose: () => void;
	onSuccess: (result: ImportResult) => void;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();

	const [config, setConfig] = useState<ImportConfig>(loadConfig);
	const [file, setFile] = useState<File | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (opened) {
			setFile(null);
			setError(null);
		}
	}, [opened]);

	function updateConfig(patch: Partial<ImportConfig>) {
		setConfig((prev) => {
			const next = { ...prev, ...patch };
			saveConfig(next);
			return next;
		});
	}

	async function handleImport() {
		if (!file) return;

		setLoading(true);
		setError(null);

		const formData = new FormData();
		formData.append("file", file);
		formData.append("labelCol", String(config.labelCol));
		formData.append("amountCol", String(config.amountCol));
		formData.append("dateCol", String(config.dateCol));
		formData.append("dateFormat", config.dateFormat);
		formData.append("skipLines", String(config.skipLines));

		try {
			const res = await apiFetch<ImportResult>("/operations/import", {
				method: "POST",
				body: formData,
			});
			queryClient.invalidateQueries({ queryKey: ["monthly-operations"] });
			onSuccess(res);
		} catch {
			setError(t("import.error"));
		} finally {
			setLoading(false);
		}
	}

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={t("import.title")}
			size="md"
		>
			<Stack>
				<FileInput
					label={t("import.file")}
					placeholder={t("import.filePlaceholder")}
					accept=".csv,.xls,.xlsx"
					leftSection={<IconUpload size={16} />}
					value={file}
					onChange={setFile}
				/>

				<NumberInput
					label={t("import.labelCol")}
					value={config.labelCol}
					onChange={(v) => updateConfig({ labelCol: Number(v) })}
					min={0}
				/>

				<NumberInput
					label={t("import.amountCol")}
					value={config.amountCol}
					onChange={(v) => updateConfig({ amountCol: Number(v) })}
					min={0}
				/>

				<NumberInput
					label={t("import.dateCol")}
					value={config.dateCol}
					onChange={(v) => updateConfig({ dateCol: Number(v) })}
					min={0}
				/>

				<TextInput
					label={t("import.dateFormat")}
					value={config.dateFormat}
					onChange={(e) => updateConfig({ dateFormat: e.currentTarget.value })}
				/>

				<NumberInput
					label={t("import.skipLines")}
					value={config.skipLines}
					onChange={(v) => updateConfig({ skipLines: Number(v) })}
					min={0}
				/>

				{error && (
					<Alert color="red" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}

				<Button
					onClick={handleImport}
					loading={loading}
					disabled={!file}
					fullWidth
				>
					{t("import.submit")}
				</Button>
			</Stack>
		</Modal>
	);
}
