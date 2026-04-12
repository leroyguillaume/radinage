import {
	ActionIcon,
	Alert,
	Autocomplete,
	Button,
	CopyButton,
	Paper,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import {
	IconAlertCircle,
	IconCheck,
	IconCopy,
	IconLock,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import {
	useCreateUser,
	useDeleteUser,
	useResetPassword,
	useSearchUsers,
} from "@/lib/hooks";
import { useAuthStore } from "@/stores/auth";

export const Route = createFileRoute("/admin")({
	component: AdminPage,
});

function AdminPage() {
	const { t } = useTranslation();
	const role = useAuthStore((s) => s.role);
	const createUser = useCreateUser();
	const resetPassword = useResetPassword();
	const deleteUser = useDeleteUser();

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{
		username: string;
		invitationLink?: string;
	} | null>(null);

	const [resetUsername, setResetUsername] = useState("");
	const [resetError, setResetError] = useState<string | null>(null);
	const [resetLink, setResetLink] = useState<string | null>(null);
	const searchUsers = useSearchUsers(resetUsername);

	const [deleteUsername, setDeleteUsername] = useState("");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
	const searchUsersForDelete = useSearchUsers(deleteUsername);

	if (role !== "admin") {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<Alert color="red" icon={<IconLock size={16} />}>
					{t("admin.forbidden")}
				</Alert>
			</div>
		);
	}

	async function handleReset(e: FormEvent) {
		e.preventDefault();
		setResetError(null);
		setResetLink(null);

		try {
			const data = await resetPassword.mutateAsync(resetUsername);
			setResetLink(data.resetLink);
			setResetUsername("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				setResetError(t("admin.resetNotFound"));
			} else if (err instanceof ApiError && err.status === 400) {
				setResetError(t("admin.resetSelf"));
			} else {
				setResetError(t("common.error"));
			}
		}
	}

	async function handleDelete(e: FormEvent) {
		e.preventDefault();
		setDeleteError(null);
		setDeleteSuccess(null);

		const match = searchUsersForDelete.data?.find(
			(u) => u.username === deleteUsername,
		);
		if (!match) {
			setDeleteError(t("admin.deleteNotFound"));
			return;
		}

		try {
			await deleteUser.mutateAsync(match.id);
			setDeleteSuccess(deleteUsername);
			setDeleteUsername("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				setDeleteError(t("admin.deleteSelf"));
			} else if (err instanceof ApiError && err.status === 404) {
				setDeleteError(t("admin.deleteNotFound"));
			} else {
				setDeleteError(t("common.error"));
			}
		}
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setResult(null);

		const body: { username: string; password?: string } = { username };
		if (password) {
			body.password = password;
		}

		try {
			const data = await createUser.mutateAsync(body);
			setResult({
				username: data.username,
				invitationLink: data.invitationLink,
			});
			setUsername("");
			setPassword("");
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				setError(t("admin.errorConflict"));
			} else {
				setError(t("common.error"));
			}
		}
	}

	return (
		<div className="h-full overflow-y-auto p-4">
			<Stack className="mx-auto max-w-lg" gap="lg">
				<Title order={2} c="white">
					{t("admin.title")}
				</Title>

				<Paper shadow="md" p="md" radius="md">
					<form onSubmit={handleSubmit}>
						<Stack>
							<Title order={4}>{t("admin.createUser")}</Title>

							{error && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{error}
								</Alert>
							)}

							{result && (
								<Alert color="green" icon={<IconCheck size={16} />}>
									<Stack gap="xs">
										<Text size="sm">
											{t("admin.success")} — <strong>{result.username}</strong>
										</Text>
										{result.invitationLink && (
											<>
												<Text size="sm" fw={500}>
													{t("admin.invitationLinkLabel")}
												</Text>
												<div className="flex items-center gap-2">
													<TextInput
														value={result.invitationLink}
														readOnly
														size="xs"
														className="flex-1"
														styles={{
															input: {
																fontFamily: "monospace",
																fontSize: "0.75rem",
															},
														}}
													/>
													<CopyButton value={result.invitationLink}>
														{({ copied, copy }) => (
															<Tooltip
																label={
																	copied
																		? t("admin.invitationCopied")
																		: t("admin.copyLink")
																}
															>
																<ActionIcon
																	color={copied ? "teal" : "gray"}
																	variant="subtle"
																	onClick={copy}
																	aria-label={t("admin.copyLink")}
																>
																	{copied ? (
																		<IconCheck size={16} />
																	) : (
																		<IconCopy size={16} />
																	)}
																</ActionIcon>
															</Tooltip>
														)}
													</CopyButton>
												</div>
											</>
										)}
									</Stack>
								</Alert>
							)}

							<TextInput
								label={t("admin.username")}
								value={username}
								onChange={(e) => setUsername(e.currentTarget.value)}
								required
								autoFocus
							/>

							<PasswordInput
								label={t("admin.password")}
								description={t("admin.passwordHelp")}
								value={password}
								onChange={(e) => setPassword(e.currentTarget.value)}
							/>

							<Button type="submit" loading={createUser.isPending} size="md">
								{t("admin.submit")}
							</Button>
						</Stack>
					</form>
				</Paper>

				<Paper shadow="md" p="md" radius="md">
					<form onSubmit={handleReset}>
						<Stack>
							<Title order={4}>{t("admin.resetPassword")}</Title>

							{resetError && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{resetError}
								</Alert>
							)}

							{resetLink && (
								<Alert color="green" icon={<IconCheck size={16} />}>
									<Stack gap="xs">
										<Text size="sm" fw={500}>
											{t("admin.resetLinkLabel")}
										</Text>
										<div className="flex items-center gap-2">
											<TextInput
												value={resetLink}
												readOnly
												size="xs"
												className="flex-1"
												styles={{
													input: {
														fontFamily: "monospace",
														fontSize: "0.75rem",
													},
												}}
											/>
											<CopyButton value={resetLink}>
												{({ copied, copy }) => (
													<Tooltip
														label={
															copied
																? t("admin.invitationCopied")
																: t("admin.copyLink")
														}
													>
														<ActionIcon
															color={copied ? "teal" : "gray"}
															variant="subtle"
															onClick={copy}
															aria-label={t("admin.copyLink")}
														>
															{copied ? (
																<IconCheck size={16} />
															) : (
																<IconCopy size={16} />
															)}
														</ActionIcon>
													</Tooltip>
												)}
											</CopyButton>
										</div>
									</Stack>
								</Alert>
							)}

							<Autocomplete
								label={t("admin.username")}
								value={resetUsername}
								onChange={setResetUsername}
								data={searchUsers.data?.map((u) => u.username) ?? []}
								required
							/>

							<Button
								type="submit"
								loading={resetPassword.isPending}
								size="md"
								color="orange"
							>
								{t("admin.resetSubmit")}
							</Button>
						</Stack>
					</form>
				</Paper>

				<Paper shadow="md" p="md" radius="md">
					<form onSubmit={handleDelete}>
						<Stack>
							<Title order={4}>{t("admin.deleteUser")}</Title>

							{deleteError && (
								<Alert color="red" icon={<IconAlertCircle size={16} />}>
									{deleteError}
								</Alert>
							)}

							{deleteSuccess && (
								<Alert color="green" icon={<IconCheck size={16} />}>
									{t("admin.deleteSuccess", { username: deleteSuccess })}
								</Alert>
							)}

							<Autocomplete
								label={t("admin.username")}
								value={deleteUsername}
								onChange={setDeleteUsername}
								data={searchUsersForDelete.data?.map((u) => u.username) ?? []}
								required
							/>

							<Button
								type="submit"
								loading={deleteUser.isPending}
								size="md"
								color="red"
							>
								{t("admin.deleteSubmit")}
							</Button>
						</Stack>
					</form>
				</Paper>
			</Stack>
		</div>
	);
}
