import {
	Alert,
	Button,
	Image,
	Paper,
	PasswordInput,
	Stack,
	TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
		<div className="flex h-full flex-col items-center justify-center px-4">
			<Image
				src="/logo-full.png"
				alt="Radinage"
				className="w-full max-w-sm"
				mb="xl"
			/>
			<Paper
				shadow="md"
				p="md"
				radius="md"
				className="w-full max-w-sm"
				style={{ minHeight: "auto" }}
			>
				<form onSubmit={handleSubmit}>
					<Stack>
						{error && (
							<Alert color="red" icon={<IconAlertCircle size={16} />}>
								{error}
							</Alert>
						)}

						<TextInput
							label={t("login.username")}
							value={username}
							onChange={(e) => setUsername(e.currentTarget.value)}
							required
							autoFocus
						/>

						<PasswordInput
							label={t("login.password")}
							value={password}
							onChange={(e) => setPassword(e.currentTarget.value)}
							required
						/>

						<Button type="submit" fullWidth loading={loading} size="md">
							{t("login.submit")}
						</Button>
					</Stack>
				</form>
			</Paper>
		</div>
	);
}
