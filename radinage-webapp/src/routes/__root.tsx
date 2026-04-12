import {
	ActionIcon,
	Burger,
	Drawer,
	Group,
	Image,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconSettings } from "@tabler/icons-react";
import {
	createRootRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";

function NavLink({
	to,
	activePrefix,
	label,
	onClick,
}: {
	to: string;
	activePrefix?: string;
	label: string;
	onClick?: () => void;
}) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isActive = activePrefix
		? pathname.startsWith(activePrefix)
		: pathname === to;

	const activeStyle = {
		color: "white",
		fontWeight: 600,
		backgroundColor: "rgba(255,255,255,0.1)",
	};
	const inactiveStyle = { color: "rgba(255,255,255,0.5)" };

	return (
		<Link
			to={to}
			onClick={onClick}
			style={{
				textDecoration: "none",
				fontSize: "0.875rem",
				padding: "8px 12px",
				borderRadius: 4,
				...(isActive ? activeStyle : inactiveStyle),
			}}
		>
			{label}
		</Link>
	);
}

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	const role = useAuthStore((s) => s.role);
	const logout = useAuthStore((s) => s.logout);
	const navigate = useNavigate();
	const { t } = useTranslation();
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);

	useEffect(() => {
		const publicPaths = ["/login", "/activate"];
		const isPublic = publicPaths.some((p) =>
			window.location.pathname.startsWith(p),
		);
		if (!isAuthenticated && !isPublic) {
			navigate({ to: "/login" });
		}
	}, [isAuthenticated, navigate]);

	const navLinks = (
		<>
			<NavLink
				to="/"
				activePrefix="/summary"
				label={t("nav.forecast")}
				onClick={closeDrawer}
			/>
			<NavLink
				to="/operations"
				activePrefix="/operations"
				label={t("nav.operations")}
				onClick={closeDrawer}
			/>
			<NavLink to="/stats" label={t("nav.stats")} onClick={closeDrawer} />
			<NavLink to="/budgets" label={t("nav.budgets")} onClick={closeDrawer} />
			{role === "admin" && (
				<NavLink to="/admin" label={t("nav.admin")} onClick={closeDrawer} />
			)}
		</>
	);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-[#011e45]">
			{isAuthenticated && (
				<>
					<Group
						justify="space-between"
						px="md"
						py="xs"
						style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
					>
						<Group gap="md">
							<Link
								to="/summary"
								search={{ year: new Date().getFullYear() }}
								style={{ textDecoration: "none" }}
							>
								<Group gap="xs">
									<Image src="/logo-small.png" alt="Radinage" h={28} w="auto" />
									<Text c="white" fw={700} size="lg">
										{t("common.appName")}
									</Text>
								</Group>
							</Link>
							<Group gap="sm" visibleFrom="sm">
								{navLinks}
							</Group>
						</Group>
						<Group gap="xs">
							<Tooltip label={t("nav.settings")} visibleFrom="sm">
								<ActionIcon
									variant="subtle"
									color="white"
									onClick={() => navigate({ to: "/settings" })}
									aria-label={t("nav.settings")}
								>
									<IconSettings size={20} />
								</ActionIcon>
							</Tooltip>
							<Tooltip label={t("nav.logout")} visibleFrom="sm">
								<ActionIcon
									variant="subtle"
									color="white"
									onClick={() => {
										logout();
										navigate({ to: "/login" });
									}}
									aria-label={t("nav.logout")}
								>
									<IconLogout size={20} />
								</ActionIcon>
							</Tooltip>
							<Burger
								opened={drawerOpened}
								onClick={openDrawer}
								color="white"
								size="sm"
								hiddenFrom="sm"
								aria-label={t("nav.menu")}
							/>
						</Group>
					</Group>
					<Drawer
						opened={drawerOpened}
						onClose={closeDrawer}
						position="right"
						size="xs"
						hiddenFrom="sm"
						styles={{
							content: { backgroundColor: "#011e45" },
							body: { padding: 0 },
							header: { backgroundColor: "#011e45" },
						}}
					>
						<Stack gap={0} p="md">
							{navLinks}
							<NavLink
								to="/settings"
								label={t("nav.settings")}
								onClick={closeDrawer}
							/>
							<Link
								to="/login"
								onClick={() => {
									logout();
									closeDrawer();
								}}
								style={{
									textDecoration: "none",
									color: "rgba(255,255,255,0.5)",
									fontSize: "0.875rem",
									padding: "8px 12px",
									borderRadius: 4,
								}}
							>
								{t("nav.logout")}
							</Link>
						</Stack>
					</Drawer>
				</>
			)}
			<div className="min-h-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
		</div>
	);
}
