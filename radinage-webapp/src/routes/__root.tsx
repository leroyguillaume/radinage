import {
	ActionIcon,
	Box,
	Group,
	Menu,
	Tooltip,
	useMatches,
} from "@mantine/core";
import {
	IconChartBar,
	IconLayoutDashboard,
	IconListDetails,
	IconLogout,
	IconSearch,
	IconSettings,
	IconShieldLock,
	IconUserCircle,
	IconWallet,
} from "@tabler/icons-react";
import {
	createRootRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { type ComponentType, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuthStore } from "@/stores/auth";
import { palette } from "@/theme";

interface NavItem {
	to: string;
	activePrefix: string;
	labelKey: string;
	/** Label of the mobile tab, when `labelKey` is too long for it. */
	shortLabelKey?: string;
	icon: ComponentType<{ size?: number; stroke?: number }>;
}

const primaryNav: NavItem[] = [
	{
		to: "/",
		activePrefix: "/summary",
		labelKey: "nav.forecast",
		icon: IconLayoutDashboard,
	},
	{
		to: "/operations",
		activePrefix: "/operations",
		labelKey: "nav.operations",
		icon: IconListDetails,
	},
	{
		to: "/search",
		activePrefix: "/search",
		labelKey: "nav.search",
		icon: IconSearch,
	},
	{
		to: "/stats",
		activePrefix: "/stats",
		labelKey: "nav.stats",
		shortLabelKey: "nav.statsShort",
		icon: IconChartBar,
	},
	{
		to: "/budgets",
		activePrefix: "/budgets",
		labelKey: "nav.budgets",
		icon: IconWallet,
	},
];

/**
 * Below this breakpoint the header nav pills show their icon only: with labels,
 * the pills, logo and account menu need roughly 950px and would wrap.
 */
const LABELLED_NAV_FROM = "lg";

function useIsActive(prefix: string): boolean {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return pathname.startsWith(prefix);
}

function NavPill({ item }: { item: NavItem }) {
	const { t } = useTranslation();
	const active = useIsActive(item.activePrefix);
	const labelled = useMatches({ base: false, [LABELLED_NAV_FROM]: true });
	const Icon = item.icon;
	const label = t(item.labelKey);
	return (
		<Tooltip label={label} disabled={labelled}>
			<Link
				to={item.to}
				className="nav-pill"
				data-active={active}
				aria-current={active ? "page" : undefined}
				aria-label={label}
			>
				<Icon size={20} />
				<Box component="span" visibleFrom={LABELLED_NAV_FROM}>
					{label}
				</Box>
			</Link>
		</Tooltip>
	);
}

function TabLink({ item }: { item: NavItem }) {
	const { t } = useTranslation();
	const active = useIsActive(item.activePrefix);
	const Icon = item.icon;
	return (
		<Link
			to={item.to}
			className="tab-link"
			data-active={active}
			aria-current={active ? "page" : undefined}
		>
			<Icon size={22} />
			<span className="tab-label">
				{t(item.shortLabelKey ?? item.labelKey)}
			</span>
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

	useEffect(() => {
		const publicPaths = ["/login", "/activate"];
		const isPublic = publicPaths.some((p) =>
			window.location.pathname.startsWith(p),
		);
		if (!isAuthenticated && !isPublic) {
			navigate({ to: "/login" });
		}
	}, [isAuthenticated, navigate]);

	function handleLogout() {
		logout();
		navigate({ to: "/login" });
	}

	return (
		<div className="flex h-screen flex-col overflow-hidden">
			{isAuthenticated && (
				<Box
					component="header"
					bg={palette.surface}
					style={{ borderBottom: `1px solid ${palette.border}` }}
				>
					<Group
						maw={1240}
						mx="auto"
						px={{ base: "md", sm: "lg" }}
						py={10}
						gap="xl"
						wrap="nowrap"
					>
						<Link
							to="/summary"
							search={{ year: new Date().getFullYear() }}
							style={{ textDecoration: "none" }}
						>
							<BrandLogo />
						</Link>
						<Group
							component="nav"
							aria-label={t("nav.menu")}
							gap={4}
							visibleFrom="sm"
							wrap="nowrap"
						>
							{primaryNav.map((item) => (
								<NavPill key={item.to} item={item} />
							))}
						</Group>
						<Box ml="auto">
							<Menu position="bottom-end" width={220}>
								<Menu.Target>
									<ActionIcon
										variant="default"
										size={44}
										aria-label={t("nav.account")}
									>
										<IconUserCircle size={22} />
									</ActionIcon>
								</Menu.Target>
								<Menu.Dropdown>
									<Menu.Item
										leftSection={<IconSettings size={18} />}
										onClick={() => navigate({ to: "/settings" })}
									>
										{t("nav.settings")}
									</Menu.Item>
									{role === "admin" && (
										<Menu.Item
											leftSection={<IconShieldLock size={18} />}
											onClick={() => navigate({ to: "/admin" })}
										>
											{t("nav.admin")}
										</Menu.Item>
									)}
									<Menu.Item
										leftSection={<IconLogout size={18} />}
										onClick={handleLogout}
									>
										{t("nav.logout")}
									</Menu.Item>
								</Menu.Dropdown>
							</Menu>
						</Box>
					</Group>
				</Box>
			)}
			<div className="min-h-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
			{isAuthenticated && (
				<Box
					component="nav"
					aria-label={t("nav.menu")}
					hiddenFrom="sm"
					bg={palette.surface}
					p={6}
					style={{
						borderTop: `1px solid ${palette.border}`,
						display: "flex",
						gap: 4,
					}}
				>
					{primaryNav.map((item) => (
						<TabLink key={item.to} item={item} />
					))}
				</Box>
			)}
		</div>
	);
}
