import {
	Alert,
	Button,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/AuthLayout";
import { ApiError, useAuthStore } from "@/stores/auth";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const login = useAuthStore((s) => s.login);

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			await login(username, password);
			await navigate({ to: "/" });
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				setError(t("login.error"));
			} else {
				setError(t("common.error"));
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthLayout>
			<form onSubmit={handleSubmit}>
				<Stack gap="lg">
					<Stack gap={6}>
						<Title order={1} fz={36} lts="-0.02em">
							{t("login.title")}
						</Title>
						<Text c="dimmed">{t("login.welcome")}</Text>
					</Stack>

					{error && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{error}
						</Alert>
					)}

					<TextInput
						label={t("login.username")}
						value={username}
						onChange={(e) => setUsername(e.currentTarget.value)}
						required
						autoFocus
						autoComplete="username"
						size="md"
					/>

					<PasswordInput
						label={t("login.password")}
						value={password}
						onChange={(e) => setPassword(e.currentTarget.value)}
						required
						autoComplete="current-password"
						size="md"
					/>

					<Button type="submit" fullWidth loading={loading} size="lg">
						{t("login.submit")}
					</Button>
				</Stack>
			</form>
		</AuthLayout>
	);
}
