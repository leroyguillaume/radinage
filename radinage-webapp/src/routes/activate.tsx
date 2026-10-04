import { Alert, Button, PasswordInput, Stack, Title } from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/AuthLayout";
import { ApiError, apiFetch } from "@/lib/api";

interface ActivateSearch {
	token?: string;
	reset?: boolean;
}

export const Route = createFileRoute("/activate")({
	component: ActivatePage,
	validateSearch: (search: Record<string, unknown>): ActivateSearch => ({
		token: typeof search.token === "string" ? search.token : undefined,
		reset: search.reset === "true" || search.reset === true,
	}),
});

interface ActivateApiResponse {
	token: string;
	role: string;
}

function ActivatePage() {
	const { t } = useTranslation();
	const { token, reset } = Route.useSearch();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);

	if (!token) {
		return (
			<AuthLayout>
				<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
					{t("activate.errorMissingToken")}
				</Alert>
			</AuthLayout>
		);
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);

		if (password !== confirmPassword) {
			setError(t("activate.errorPasswordMismatch"));
			return;
		}

		setLoading(true);
		try {
			const data = await apiFetch<ActivateApiResponse>("/auth/activate", {
				method: "POST",
				body: JSON.stringify({ token, password }),
			});

			try {
				globalThis.localStorage?.setItem("auth_token", data.token);
				globalThis.localStorage?.setItem("auth_role", data.role);
			} catch {
				// localStorage may not be available
			}

			setSuccess(true);
			setTimeout(() => {
				// Force a full page load so the auth store re-hydrates from localStorage
				window.location.href = "/";
			}, 1500);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				setError(t("activate.errorInvalidToken"));
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
					<Title order={1} fz={36} lts="-0.02em">
						{t(reset ? "activate.resetSubmit" : "activate.title")}
					</Title>

					{error && (
						<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
							{error}
						</Alert>
					)}

					{success && (
						<Alert color="leaf" icon={<IconCheck size={16} />}>
							{t(reset ? "activate.resetSuccess" : "activate.success")}
						</Alert>
					)}

					<PasswordInput
						label={t("activate.password")}
						value={password}
						onChange={(e) => setPassword(e.currentTarget.value)}
						required
						disabled={success}
						autoFocus
						autoComplete="new-password"
						size="md"
					/>

					<PasswordInput
						label={t("activate.confirmPassword")}
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.currentTarget.value)}
						required
						disabled={success}
						autoComplete="new-password"
						size="md"
					/>

					<Button
						type="submit"
						fullWidth
						loading={loading}
						disabled={success}
						size="lg"
					>
						{t(reset ? "activate.resetSubmit" : "activate.submit")}
					</Button>
				</Stack>
			</form>
		</AuthLayout>
	);
}
