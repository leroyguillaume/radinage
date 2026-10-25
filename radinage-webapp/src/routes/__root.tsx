import {
	ActionIcon,
	Box,
	Drawer,
	Image,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
	IconBuildingBank,
	IconChartBar,
	IconLayoutDashboard,
	IconLayoutSidebarLeftCollapse,
	IconLayoutSidebarLeftExpand,
	IconListDetails,
	IconLogout,
	IconMenu2,
	IconSearch,
	IconSettings,
	IconShieldLock,
	IconTags,
	IconWallet,
} from "@tabler/icons-react";
import {
	createRootRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { type ComponentType, Fragment, type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuthStore } from "@/stores/auth";
import { useLastSearchStore } from "@/stores/last-search";
import { useNavStore } from "@/stores/nav";
import { palette } from "@/theme";

type NavIcon = ComponentType<{ size?: number; stroke?: number }>;

interface NavItem {
	to: string;
	activePrefix: string;
	labelKey: string;
	/** Label of the mobile tab, when `labelKey` is too long for it. */
	shortLabelKey?: string;
	icon: NavIcon;
}

interface NavGroup {
	labelKey: string;
	items: NavItem[];
}

const summaryNav: NavItem = {
	to: "/",
	activePrefix: "/summary",
	labelKey: "nav.forecast",
	icon: IconLayoutDashboard,
};
const operationsNav: NavItem = {
	to: "/operations",
	activePrefix: "/operations",
	labelKey: "nav.operations",
	icon: IconListDetails,
};
const searchNav: NavItem = {
	to: "/search",
	activePrefix: "/search",
	labelKey: "nav.search",
	icon: IconSearch,
};
const statsNav: NavItem = {
	to: "/stats",
	activePrefix: "/stats",
	labelKey: "nav.stats",
	shortLabelKey: "nav.statsShort",
	icon: IconChartBar,
};
const accountsNav: NavItem = {
	to: "/accounts",
	activePrefix: "/accounts",
	labelKey: "nav.accounts",
	icon: IconBuildingBank,
};
const budgetsNav: NavItem = {
	to: "/budgets",
	activePrefix: "/budgets",
	labelKey: "nav.budgets",
	icon: IconWallet,
};
const categoriesNav: NavItem = {
	to: "/categories",
	activePrefix: "/categories",
	labelKey: "nav.categories",
	icon: IconTags,
};
const settingsNav: NavItem = {
	to: "/settings",
	activePrefix: "/settings",
	labelKey: "nav.settings",
	icon: IconSettings,
};
const adminNav: NavItem = {
	to: "/admin",
	activePrefix: "/admin",
	labelKey: "nav.admin",
	icon: IconShieldLock,
};

const navGroups: NavGroup[] = [
	{
		labelKey: "nav.groups.tracking",
		items: [summaryNav, operationsNav, searchNav, statsNav],
	},
	{
		labelKey: "nav.groups.organize",
		items: [accountsNav, budgetsNav, categoriesNav],
	},
];

/** The mobile tab bar keeps the daily pages; the others sit in its menu. */
const tabNav: NavItem[] = [summaryNav, operationsNav, accountsNav, budgetsNav];

const SIDE_WIDTH = { expanded: 260, collapsed: 76 } as const;

function useIsActive(prefix: string): boolean {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return pathname.startsWith(prefix);
}

interface SideEntryProps {
	icon: NavIcon;
	label: string;
	/** Icon only, the label moving to a tooltip. */
	collapsed: boolean;
	children: (content: ReactNode) => ReactNode;
}

function SideEntry({ icon: Icon, label, collapsed, children }: SideEntryProps) {
	return (
		<Tooltip label={label} position="right" withArrow disabled={!collapsed}>
			{children(
				<>
					<Icon size={22} stroke={1.8} />
					{!collapsed && <span>{label}</span>}
				</>,
			)}
		</Tooltip>
	);
}

/** The search the page behind `to` was last shown with, so the menu brings it back. */
function useLastSearch(to: string): Record<string, unknown> | undefined {
	return useLastSearchStore((s) => s.searches[to]);
}

function SideLink({
	item,
	collapsed,
	onNavigate,
}: {
	item: NavItem;
	collapsed: boolean;
	onNavigate?: () => void;
}) {
	const { t } = useTranslation();
	const active = useIsActive(item.activePrefix);
	const label = t(item.labelKey);
	const search = useLastSearch(item.to);
	return (
		<SideEntry icon={item.icon} label={label} collapsed={collapsed}>
			{(content) => (
				<Link
					to={item.to}
					search={search}
					className="side-link"
					data-active={active}
					data-collapsed={collapsed}
					aria-current={active ? "page" : undefined}
					aria-label={label}
					onClick={onNavigate}
				>
					{content}
				</Link>
			)}
		</SideEntry>
	);
}

function SideButton({
	icon,
	label,
	collapsed,
	onClick,
}: {
	icon: NavIcon;
	label: string;
	collapsed: boolean;
	onClick: () => void;
}) {
	return (
		<SideEntry icon={icon} label={label} collapsed={collapsed}>
			{(content) => (
				<UnstyledButton
					className="side-link"
					data-collapsed={collapsed}
					aria-label={label}
					onClick={onClick}
				>
					{content}
				</UnstyledButton>
			)}
		</SideEntry>
	);
}

function CollapseToggle({
	collapsed,
	onClick,
}: {
	collapsed: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	const label = t(collapsed ? "nav.expand" : "nav.collapse");
	const Icon = collapsed
		? IconLayoutSidebarLeftExpand
		: IconLayoutSidebarLeftCollapse;
	return (
		<Tooltip label={label} position="right" withArrow>
			<ActionIcon
				variant="subtle"
				color="gray"
				size={44}
				radius="md"
				aria-label={label}
				onClick={onClick}
			>
				<Icon size={22} stroke={1.8} />
			</ActionIcon>
		</Tooltip>
	);
}

/** The full menu, shared by the side bar and the mobile drawer. */
function NavMenu({
	collapsed,
	onNavigate,
	onLogout,
}: {
	collapsed: boolean;
	onNavigate?: () => void;
	onLogout: () => void;
}) {
	const { t } = useTranslation();
	const role = useAuthStore((s) => s.role);
	return (
		<>
			<nav aria-label={t("nav.menu")} className="flex flex-col gap-0.5">
				{navGroups.map((group, index) => (
					<Fragment key={group.labelKey}>
						{collapsed ? (
							index > 0 && <div className="side-divider" />
						) : (
							<Text className="side-group">{t(group.labelKey)}</Text>
						)}
						{group.items.map((item) => (
							<SideLink
								key={item.to}
								item={item}
								collapsed={collapsed}
								onNavigate={onNavigate}
							/>
						))}
					</Fragment>
				))}
			</nav>
			<Box
				mt="auto"
				pt="sm"
				className="flex flex-col gap-0.5"
				style={{ borderTop: `1px solid ${palette.divider}` }}
			>
				<SideLink
					item={settingsNav}
					collapsed={collapsed}
					onNavigate={onNavigate}
				/>
				{role === "admin" && (
					<SideLink
						item={adminNav}
						collapsed={collapsed}
						onNavigate={onNavigate}
					/>
				)}
				<SideButton
					icon={IconLogout}
					label={t("nav.logout")}
					collapsed={collapsed}
					onClick={onLogout}
				/>
			</Box>
		</>
	);
}

function TabLink({ item }: { item: NavItem }) {
	const { t } = useTranslation();
	const active = useIsActive(item.activePrefix);
	const Icon = item.icon;
	const search = useLastSearch(item.to);
	return (
		<Link
			to={item.to}
			search={search}
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

function HomeLink({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	return (
		<Link
			to="/summary"
			search={{ year: new Date().getFullYear() }}
			aria-label={t("common.appName")}
			className="flex min-h-12 items-center no-underline"
		>
			{children}
		</Link>
	);
}

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	const logout = useAuthStore((s) => s.logout);
	const collapsed = useNavStore((s) => s.collapsed);
	const toggleCollapsed = useNavStore((s) => s.toggleCollapsed);
	const [menuOpened, menu] = useDisclosure(false);
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
		menu.close();
		logout();
		navigate({ to: "/login" });
	}

	// dvh, not 100vh: on mobile browsers 100vh ignores the URL bar and hides the bottom tab bar
	return (
		<div className="flex h-dvh overflow-hidden">
			{isAuthenticated && (
				<Box
					component="aside"
					visibleFrom="sm"
					w={collapsed ? SIDE_WIDTH.collapsed : SIDE_WIDTH.expanded}
					bg={palette.surface}
					px={12}
					py="md"
					className="flex-none flex-col gap-1 overflow-y-auto overflow-x-hidden"
					style={{
						display: "flex",
						borderRight: `1px solid ${palette.border}`,
						transition: "width 150ms ease",
					}}
				>
					<Box
						px={collapsed ? 0 : 4}
						className={
							collapsed
								? "flex flex-col items-center gap-1"
								: "flex items-center justify-between"
						}
					>
						<HomeLink>
							{collapsed ? (
								<Image src="/logo.svg" alt="" h={38} w={38} />
							) : (
								<BrandLogo />
							)}
						</HomeLink>
						<CollapseToggle collapsed={collapsed} onClick={toggleCollapsed} />
					</Box>
					<NavMenu collapsed={collapsed} onLogout={handleLogout} />
				</Box>
			)}
			<div className="flex min-w-0 flex-1 flex-col">
				{isAuthenticated && (
					<Box
						component="header"
						hiddenFrom="sm"
						bg={palette.surface}
						px="md"
						py={6}
						style={{ borderBottom: `1px solid ${palette.border}` }}
					>
						<HomeLink>
							<BrandLogo />
						</HomeLink>
					</Box>
				)}
				<div className="min-h-0 flex-1 overflow-hidden">
					<Outlet />
				</div>
				{isAuthenticated && (
					<Box
						component="nav"
						aria-label={t("nav.tabs")}
						hiddenFrom="sm"
						bg={palette.surface}
						p={6}
						style={{
							borderTop: `1px solid ${palette.border}`,
							display: "flex",
							gap: 4,
							paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))",
						}}
					>
						{tabNav.map((item) => (
							<TabLink key={item.to} item={item} />
						))}
						<UnstyledButton
							className="tab-link"
							aria-expanded={menuOpened}
							onClick={menu.open}
						>
							<IconMenu2 size={22} />
							<span className="tab-label">{t("nav.menu")}</span>
						</UnstyledButton>
					</Box>
				)}
			</div>
			{isAuthenticated && (
				<Drawer
					opened={menuOpened}
					onClose={menu.close}
					size={308}
					title={<BrandLogo />}
					closeButtonProps={{ "aria-label": t("nav.closeMenu"), size: 44 }}
				>
					<Box px="sm" pb="md" className="flex flex-col gap-1">
						<NavMenu
							collapsed={false}
							onNavigate={menu.close}
							onLogout={handleLogout}
						/>
					</Box>
				</Drawer>
			)}
		</div>
	);
}
