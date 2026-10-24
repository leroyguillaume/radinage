import {
	Alert,
	Badge,
	Button,
	FileInput,
	Group,
	Menu,
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	Table,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconCheck,
	IconFileSpreadsheet,
	IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { columnLetter } from "@/lib/columns";
import {
	useDeleteImportProfile,
	useImportPreview,
	useSaveImportProfile,
} from "@/lib/hooks";
import type { CsvDelimiter, ImportProfileResponse } from "@/lib/types";

export type ColumnRole = "label" | "amount" | "date";

export type ColumnRoles = Record<ColumnRole, number | null>;

const ROLES: ColumnRole[] = ["label", "amount", "date"];

const ROLE_COLORS: Record<ColumnRole, string> = {
	label: "forest",
	amount: "tangerine",
	date: "gold",
};

/** Formats offered by default, each shown as how it writes 31 December 2026 (at 14:30 when it has a time). */
export const DATE_FORMATS: Record<string, string> = {
	"%d/%m/%Y": "31/12/2026",
	"%Y-%m-%d": "2026-12-31",
	"%d-%m-%Y": "31-12-2026",
	"%d.%m.%Y": "31.12.2026",
	"%m/%d/%Y": "12/31/2026",
	"%d/%m/%y": "31/12/26",
	"%d/%m/%Y %H:%M:%S": "31/12/2026 14:30:00",
	"%d/%m/%Y %H:%M": "31/12/2026 14:30",
	"%Y-%m-%d %H:%M:%S": "2026-12-31 14:30:00",
	"%Y-%m-%d %H:%M": "2026-12-31 14:30",
	"%Y-%m-%dT%H:%M:%S": "2026-12-31T14:30:00",
};

const DEFAULT_DATE_FORMAT = "%d/%m/%Y";

const CSV_DELIMITERS: CsvDelimiter[] = ["comma", "semicolon", "tab", "pipe"];

/**
 * Give `column` the `role` (or no role when null). A role already held by another column
 * moves here, and that column takes over the role this one had, so no two roles share a column.
 */
export function assignColumn(
	roles: ColumnRoles,
	column: number,
	role: ColumnRole | null,
): ColumnRoles {
	const next = { ...roles };
	const current = ROLES.find((r) => roles[r] === column);
	if (current !== undefined) {
		next[current] = null;
	}
	if (role !== null) {
		next[role] = column;
		if (current !== undefined && current !== role) {
			next[current] = roles[role];
		}
	}
	return next;
}

function roleOf(roles: ColumnRoles, column: number): ColumnRole | null {
	return ROLES.find((r) => roles[r] === column) ?? null;
}

function columnOptions(roles: ColumnRoles) {
	const highest = Math.max(25, ...ROLES.map((r) => roles[r] ?? 0));
	return Array.from({ length: highest + 1 }, (_, i) => ({
		value: String(i),
		label: columnLetter(i),
	}));
}

export function ImportProfileForm({
	profile,
	onSaved,
	onCancel,
	onDeleted,
}: {
	profile: ImportProfileResponse | null;
	onSaved: (profile: ImportProfileResponse) => void;
	onCancel: () => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslation();
	const save = useSaveImportProfile();
	const remove = useDeleteImportProfile();
	const preview = useImportPreview();

	const [name, setName] = useState(profile?.name ?? "");
	const [roles, setRoles] = useState<ColumnRoles>({
		label: profile?.labelCol ?? null,
		amount: profile?.amountCol ?? null,
		date: profile?.dateCol ?? null,
	});
	// Raw input value: an empty field reads as "" until something is typed.
	const [skipInput, setSkipInput] = useState<number | string>(
		profile?.skipLines ?? 1,
	);
	const skipLines = typeof skipInput === "number" ? skipInput : 0;
	const [dateFormat, setDateFormat] = useState(
		profile?.dateFormat ?? DEFAULT_DATE_FORMAT,
	);
	const [csvDelimiter, setCsvDelimiter] = useState<CsvDelimiter>(
		profile?.csvDelimiter ?? "comma",
	);
	const [sample, setSample] = useState<File | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const rows =
		preview.data?.rows.map((cells, index) => ({ index, cells })) ?? null;
	const columns = Array.from(
		{ length: rows ? Math.max(0, ...rows.map((r) => r.cells.length)) : 0 },
		(_, column) => column,
	);
	const dateFormats = Object.entries(DATE_FORMATS).map(([value, label]) => ({
		value,
		label,
	}));
	if (!(dateFormat in DATE_FORMATS)) {
		dateFormats.push({ value: dateFormat, label: dateFormat });
	}
	const { label: labelCol, amount: amountCol, date: dateCol } = roles;
	const complete =
		name.trim() !== "" &&
		labelCol !== null &&
		amountCol !== null &&
		dateCol !== null;

	function loadPreview(file: File | null, delimiter: CsvDelimiter) {
		preview.reset();
		if (file) {
			preview.mutate({ file, csvDelimiter: delimiter });
		}
	}

	function handleSample(file: File | null) {
		setSample(file);
		loadPreview(file, csvDelimiter);
	}

	function handleDelimiter(delimiter: CsvDelimiter) {
		setCsvDelimiter(delimiter);
		loadPreview(sample, delimiter);
	}

	async function handleSave() {
		if (labelCol === null || amountCol === null || dateCol === null) return;
		setError(null);
		try {
			const saved = await save.mutateAsync({
				...(profile ? { id: profile.id } : {}),
				body: {
					name: name.trim(),
					labelCol,
					amountCol,
					dateCol,
					dateFormat,
					skipLines,
					csvDelimiter,
				},
			});
			onSaved(saved);
		} catch (e) {
			setError(
				e instanceof ApiError && e.status === 409
					? t("importProfile.nameTaken")
					: t("importProfile.saveError"),
			);
		}
	}

	async function handleDelete() {
		if (!profile) return;
		setError(null);
		try {
			await remove.mutateAsync(profile.id);
			onDeleted();
		} catch {
			setError(t("importProfile.deleteError"));
		}
	}

	return (
		<Stack gap="md">
			<TextInput
				label={t("importProfile.name")}
				placeholder={t("importProfile.namePlaceholder")}
				value={name}
				onChange={(e) => setName(e.currentTarget.value)}
				maxLength={100}
				required
			/>

			<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
				<FileInput
					label={t("importProfile.sample")}
					placeholder={t("importProfile.samplePlaceholder")}
					accept=".csv,.xls,.xlsx"
					leftSection={<IconFileSpreadsheet size={16} />}
					value={sample}
					onChange={handleSample}
					clearable
				/>
				<Select
					label={t("importProfile.csvDelimiter")}
					description={t("importProfile.csvDelimiterHint")}
					data={CSV_DELIMITERS.map((value) => ({
						value,
						label: t(`importProfile.csvDelimiters.${value}`),
					}))}
					value={csvDelimiter}
					onChange={(v) => {
						const delimiter = CSV_DELIMITERS.find((d) => d === v);
						if (delimiter) handleDelimiter(delimiter);
					}}
					allowDeselect={false}
				/>
			</SimpleGrid>

			{preview.isError && (
				<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
					{t("importProfile.sampleError")}
				</Alert>
			)}

			{rows ? (
				<Stack gap={6}>
					<Table.ScrollContainer minWidth={columns.length * 96}>
						<Table withTableBorder fz="xs" verticalSpacing={6}>
							<Table.Thead>
								<Table.Tr>
									{columns.map((column) => (
										<ColumnHeader
											key={column}
											column={column}
											role={roleOf(roles, column)}
											onAssign={(role) =>
												setRoles((prev) => assignColumn(prev, column, role))
											}
										/>
									))}
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{rows.map(({ index, cells }) => (
									<Table.Tr
										key={index}
										c={index < skipLines ? "dimmed" : undefined}
										td={index < skipLines ? "line-through" : undefined}
									>
										{columns.map((column) => {
											const role = roleOf(roles, column);
											return (
												<Table.Td
													key={column}
													style={{ whiteSpace: "nowrap" }}
													bg={
														role && index >= skipLines
															? `var(--mantine-color-${ROLE_COLORS[role]}-0)`
															: undefined
													}
												>
													{cells[column] ?? ""}
												</Table.Td>
											);
										})}
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
					<Text size="sm" c="dimmed">
						{t("importProfile.columnHint")}
					</Text>
				</Stack>
			) : (
				<SimpleGrid cols={3} spacing="sm">
					{ROLES.map((role) => (
						<Select
							key={role}
							label={t(`importProfile.${role}Col`)}
							data={columnOptions(roles)}
							value={roles[role] === null ? null : String(roles[role])}
							onChange={(v) =>
								setRoles((prev) =>
									v === null
										? { ...prev, [role]: null }
										: assignColumn(prev, Number(v), role),
								)
							}
							allowDeselect={false}
						/>
					))}
				</SimpleGrid>
			)}

			<SimpleGrid cols={2} spacing="sm">
				<NumberInput
					label={t("importProfile.skipLines")}
					value={skipInput}
					onChange={setSkipInput}
					min={0}
					allowDecimal={false}
					allowNegative={false}
				/>
				<Select
					label={t("importProfile.dateFormat")}
					data={dateFormats}
					value={dateFormat}
					onChange={(v) => v !== null && setDateFormat(v)}
					allowDeselect={false}
				/>
			</SimpleGrid>

			{error && (
				<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
					{error}
				</Alert>
			)}

			<Group justify="space-between" gap="sm">
				{profile ? (
					<Button
						variant={confirmingDelete ? "filled" : "subtle"}
						color="tangerine"
						leftSection={<IconTrash size={16} />}
						loading={remove.isPending}
						onClick={() =>
							confirmingDelete ? handleDelete() : setConfirmingDelete(true)
						}
					>
						{confirmingDelete
							? t("importProfile.deleteConfirm")
							: t("common.delete")}
					</Button>
				) : (
					<span />
				)}
				<Group gap="sm">
					<Button variant="default" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={handleSave}
						loading={save.isPending}
						disabled={!complete}
					>
						{t("common.save")}
					</Button>
				</Group>
			</Group>
		</Stack>
	);
}

function ColumnHeader({
	column,
	role,
	onAssign,
}: {
	column: number;
	role: ColumnRole | null;
	onAssign: (role: ColumnRole | null) => void;
}) {
	const { t } = useTranslation();
	const letter = columnLetter(column);
	const choices: (ColumnRole | null)[] = [...ROLES, null];

	return (
		<Table.Th p={4}>
			<Menu position="bottom-start" withinPortal>
				<Menu.Target>
					<UnstyledButton
						aria-label={t("importProfile.column", { column: letter })}
						mih={44}
						w="100%"
						px={6}
					>
						<Stack gap={4} align="flex-start">
							<Text size="xs" fw={700}>
								{letter}
							</Text>
							{role ? (
								<Badge size="sm" color={ROLE_COLORS[role]}>
									{t(`importProfile.roles.${role}`)}
								</Badge>
							) : (
								<Badge size="sm" variant="outline" color="gray">
									—
								</Badge>
							)}
						</Stack>
					</UnstyledButton>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Label>
						{t("importProfile.column", { column: letter })}
					</Menu.Label>
					{choices.map((choice) => (
						<Menu.Item
							key={choice ?? "none"}
							mih={44}
							onClick={() => onAssign(choice)}
							rightSection={choice === role ? <IconCheck size={14} /> : null}
						>
							{t(`importProfile.roles.${choice ?? "none"}`)}
						</Menu.Item>
					))}
				</Menu.Dropdown>
			</Menu>
		</Table.Th>
	);
}
