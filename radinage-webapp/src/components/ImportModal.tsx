import {
	ActionIcon,
	Alert,
	Button,
	Center,
	FileInput,
	Group,
	Loader,
	Modal,
	Select,
	Stack,
	Text,
	ThemeIcon,
	Title,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconFileImport,
	IconPencil,
	IconPlus,
	IconUpload,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImportProfileForm } from "@/components/ImportProfileForm";
import { useImportOperations, useImportProfiles } from "@/lib/hooks";
import type { ImportProfileResponse, ImportResult } from "@/lib/types";
import { headingFont } from "@/theme";

const NEW_PROFILE = "__new__";

/** The profile being created (`profile: null`) or edited, while the form is shown. */
interface Editing {
	profile: ImportProfileResponse | null;
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
	const profiles = useImportProfiles();
	const importOperations = useImportOperations();

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (opened) {
			setSelectedId(null);
			setEditing(null);
			setFile(null);
			setError(null);
		}
	}, [opened]);

	const list = profiles.data ?? [];
	// The list comes most recently used first, so that is the default choice.
	const selected = list.find((p) => p.id === selectedId) ?? list[0] ?? null;

	async function handleImport() {
		if (!file || !selected) return;
		setError(null);
		try {
			onSuccess(
				await importOperations.mutateAsync({ file, profile: selected }),
			);
		} catch {
			setError(t("import.error"));
		}
	}

	function title() {
		if (!editing) return t("import.title");
		return editing.profile
			? t("importProfile.editTitle")
			: t("importProfile.newTitle");
	}

	function body() {
		if (editing) {
			return (
				<ImportProfileForm
					profile={editing.profile}
					onSaved={(profile) => {
						setSelectedId(profile.id);
						setEditing(null);
					}}
					onCancel={() => setEditing(null)}
					onDeleted={() => {
						setSelectedId(null);
						setEditing(null);
					}}
				/>
			);
		}
		if (profiles.isPending) {
			return (
				<Center py="xl">
					<Loader />
				</Center>
			);
		}
		if (profiles.isError) {
			return (
				<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
					{t("common.error")}
				</Alert>
			);
		}
		if (!selected) {
			return (
				<Stack align="center" gap="sm" py="md" ta="center">
					<ThemeIcon size={56} radius="lg" variant="light">
						<IconFileImport size={28} />
					</ThemeIcon>
					<Title order={4}>{t("import.noProfiles")}</Title>
					<Text c="dimmed" size="sm">
						{t("import.noProfilesText")}
					</Text>
					<Button
						leftSection={<IconPlus size={18} />}
						onClick={() => setEditing({ profile: null })}
						fullWidth
						mt="xs"
					>
						{t("import.createProfile")}
					</Button>
				</Stack>
			);
		}
		return (
			<Stack gap="md">
				<Group gap="xs" align="flex-end" wrap="nowrap">
					<Select
						label={t("import.profile")}
						data={[
							...list.map((p) => ({ value: p.id, label: p.name })),
							{ value: NEW_PROFILE, label: t("import.newProfile") },
						]}
						value={selected.id}
						onChange={(v) => {
							if (v === NEW_PROFILE) {
								setEditing({ profile: null });
							} else if (v !== null) {
								setSelectedId(v);
							}
						}}
						allowDeselect={false}
						style={{ flex: 1 }}
					/>
					<ActionIcon
						variant="default"
						size={44}
						radius="md"
						aria-label={t("import.editProfile")}
						onClick={() => setEditing({ profile: selected })}
					>
						<IconPencil size={18} />
					</ActionIcon>
				</Group>

				<FileInput
					label={t("import.file")}
					placeholder={t("import.filePlaceholder")}
					accept=".csv,.xls,.xlsx"
					leftSection={<IconUpload size={16} />}
					value={file}
					onChange={setFile}
				/>

				{error && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{error}
					</Alert>
				)}

				<Button
					onClick={handleImport}
					loading={importOperations.isPending}
					disabled={!file}
					leftSection={<IconUpload size={18} />}
					fullWidth
					mt="xs"
				>
					{t("import.submit")}
				</Button>
			</Stack>
		);
	}

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={title()}
			size="lg"
			styles={{
				title: { fontFamily: headingFont, fontSize: 22, fontWeight: 700 },
			}}
		>
			{body()}
		</Modal>
	);
}
