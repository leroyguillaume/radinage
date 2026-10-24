import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	DATE_FORMATS,
	ImportProfileForm,
} from "@/components/ImportProfileForm";
import { columnLetter } from "@/lib/columns";
import {
	useBelowBreakpoint,
	useDeleteImportProfile,
	useImportProfiles,
} from "@/lib/hooks";
import type { AccountResponse, ImportProfileResponse } from "@/lib/types";
import { palette } from "@/theme";

function Chip({ children, color }: { children: string; color?: string }) {
	return (
		<Text
			component="span"
			size="xs"
			fw={600}
			px={8}
			py={2}
			c={color ? `${color}.8` : undefined}
			bg={color ? `var(--mantine-color-${color}-0)` : palette.surfaceMuted}
			className="whitespace-nowrap tabular-nums"
			style={{ border: `1px solid ${palette.border}`, borderRadius: 999 }}
		>
			{children}
		</Text>
	);
}

function ImportProfileRow({
	profile,
	onEdit,
}: {
	profile: ImportProfileResponse;
	onEdit: () => void;
}) {
	const { t, i18n } = useTranslation();
	const remove = useDeleteImportProfile();
	const [confirming, setConfirming] = useState(false);
	const { name } = profile;
	const editLabel = t("importProfiles.edit", { name });
	const deleteLabel = t("importProfiles.delete", { name });

	return (
		<Box
			component="li"
			py={8}
			style={{ borderBottom: `1px dashed ${palette.border}` }}
		>
			{confirming ? (
				<Stack gap="xs">
					<Text size="sm">{t("importProfiles.confirmDelete", { name })}</Text>
					{remove.isError && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{t("importProfile.deleteError")}
						</Alert>
					)}
					<Group grow>
						<Button variant="default" onClick={() => setConfirming(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							color="tangerine"
							loading={remove.isPending}
							onClick={() => remove.mutate(profile.id)}
						>
							{t("common.delete")}
						</Button>
					</Group>
				</Stack>
			) : (
				<Group justify="space-between" wrap="nowrap" align="flex-start">
					<Stack gap={6} miw={0}>
						<Text size="sm" fw={700} className="[overflow-wrap:anywhere]">
							{name}
						</Text>
						<Group gap={6}>
							<Chip color="forest">
								{`${t("importProfile.roles.label")} ${columnLetter(profile.labelCol)}`}
							</Chip>
							<Chip color="tangerine">
								{`${t("importProfile.roles.amount")} ${columnLetter(profile.amountCol)}`}
							</Chip>
							<Chip color="gold">
								{`${t("importProfile.roles.date")} ${columnLetter(profile.dateCol)}`}
							</Chip>
							<Chip>
								{DATE_FORMATS[profile.dateFormat] ?? profile.dateFormat}
							</Chip>
							<Chip>
								{t(`importProfile.csvDelimiters.${profile.csvDelimiter}`)}
							</Chip>
							<Chip>
								{t("importProfiles.skippedLines", {
									count: profile.skipLines,
								})}
							</Chip>
						</Group>
						<Text size="xs" c="dimmed">
							{profile.lastUsedAt
								? t("importProfiles.lastUsed", {
										date: new Date(profile.lastUsedAt).toLocaleDateString(
											i18n.language,
											{ day: "numeric", month: "long", year: "numeric" },
										),
									})
								: t("importProfiles.neverUsed")}
						</Text>
					</Stack>
					<Group gap={2} wrap="nowrap">
						<Tooltip label={editLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={onEdit}
								aria-label={editLabel}
							>
								<IconPencil size={18} />
							</ActionIcon>
						</Tooltip>
						<Tooltip label={deleteLabel}>
							<ActionIcon
								variant="subtle"
								color="gray"
								size={44}
								onClick={() => setConfirming(true)}
								aria-label={deleteLabel}
							>
								<IconTrash size={18} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Group>
			)}
		</Box>
	);
}

/** The profile being created (`profile: null`) or edited, while the modal is open. */
interface Editing {
	profile: ImportProfileResponse | null;
}

/**
 * The import profiles that import on an account. A new profile starts on it. Renders nothing
 * for an account not receiving operations and without profiles.
 */
export function ImportProfilesSection({
	account,
}: {
	account: AccountResponse;
}) {
	const { t } = useTranslation();
	const profilesQuery = useImportProfiles();
	const isMobile = useBelowBreakpoint("xs");
	const [editing, setEditing] = useState<Editing | null>(null);
	const profiles = (profilesQuery.data ?? []).filter(
		(p) => p.accountId === account.id,
	);
	const stopEditing = () => setEditing(null);

	if (!account.receivesOperations && profiles.length === 0) return null;

	return (
		<Paper>
			<Modal
				opened={editing !== null}
				onClose={stopEditing}
				title={
					editing?.profile
						? t("importProfile.editTitle")
						: t("importProfile.newTitle")
				}
				size="lg"
				fullScreen={isMobile}
			>
				{editing && (
					<ImportProfileForm
						profile={editing.profile}
						onSaved={stopEditing}
						onCancel={stopEditing}
						onDeleted={stopEditing}
						defaultAccountId={account.id}
					/>
				)}
			</Modal>

			<Stack>
				<Title order={2} fz="md" fw={700}>
					{t("importProfiles.title")}
				</Title>
				<Text size="sm" c="dimmed">
					{t("importProfiles.description")}
				</Text>

				{profilesQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{profilesQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("importProfiles.fetchError")}
					</Alert>
				)}

				{profilesQuery.isSuccess && (
					<>
						{profiles.length === 0 ? (
							<Text size="sm" c="dimmed">
								{t("importProfiles.empty")}
							</Text>
						) : (
							<Box component="ul" m={0} p={0} className="list-none">
								{profiles.map((profile) => (
									<ImportProfileRow
										key={profile.id}
										profile={profile}
										onEdit={() => setEditing({ profile })}
									/>
								))}
							</Box>
						)}
						{account.receivesOperations && (
							<Button
								variant="light"
								leftSection={<IconPlus size={18} />}
								onClick={() => setEditing({ profile: null })}
								className="self-start"
							>
								{t("importProfiles.add")}
							</Button>
						)}
					</>
				)}
			</Stack>
		</Paper>
	);
}
