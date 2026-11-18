import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, BarChart3, BadgeDollarSign, Boxes, BookOpenText, Building2, Calculator, ChefHat,
  ChevronDown, ClipboardCheck, FileSpreadsheet, FileText, FlaskConical,
  Globe, HandCoins, Landmark, Layers, LayoutDashboard, LayoutGrid, LogOut, Menu, Moon, NotebookPen,
  Package, Receipt, Scale, ScrollText, Settings, ShoppingCart, SlidersHorizontal, Store, Sun,
  Tags, Timer, Trash2, Truck, UserCog, Users, Wallet, Warehouse, X,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCan, isAdminRole } from '../lib/permissions';
import { useBranchFilter } from '../lib/useBranchFilter';
import { BranchScopeSelector } from './BranchScopeSelector';
import { useActiveOrderCount } from '../features/pos/hooks/useActiveOrderCount';
import { Logo } from './Logo';
import { ApprovalInbox } from './ApprovalInbox';
import { APP_ROUTES } from '@/core/navigation/routes';
import { prefetchAppRoute } from '@/core/navigation/prefetch';
import { MENU_GROUPS, MENU_ITEMS, SIDEBAR_SECTION_ORDER, sidebarSectionForItem, type MenuIcon, type SidebarSection } from '@/core/navigation/menu.config';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import { OfflineStatusIndicator } from './OfflineStatusIndicator';
import { PageUtilityControls } from './PageUtilityControls';
import { ReturnContextBanner } from '@/core/guard/ReturnContextBanner';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessGroupLabel, businessMenuLabel } from '@/core/organizations/businessRuntime';
import { moduleForRoute } from '@/core/modules/module.config';
import { useBranchScope } from '@/lib/branchScope';

const ICONS: Record<MenuIcon, ReactNode> = {
  dashboard: <LayoutDashboard className="h-5 w-5" />,
  pos: <ShoppingCart className="h-5 w-5" />,
  products: <Package className="h-5 w-5" />,
  pricing: <BadgeDollarSign className="h-5 w-5" />,
  productModifiers: <SlidersHorizontal className="h-5 w-5" />,
  categories: <Tags className="h-5 w-5" />,
  components: <Layers className="h-5 w-5" />,
  rawMaterials: <FlaskConical className="h-5 w-5" />,
  recipes: <ChefHat className="h-5 w-5" />,
  inventory: <Boxes className="h-5 w-5" />,
  warehouses: <Warehouse className="h-5 w-5" />,
  transfers: <ArrowLeftRight className="h-5 w-5" />,
  inventoryLedger: <BookOpenText className="h-5 w-5" />,
  stockCounts: <ClipboardCheck className="h-5 w-5" />,
  inventoryBatches: <Layers className="h-5 w-5" />,
  stockValuation: <BadgeDollarSign className="h-5 w-5" />,
  lowStockAlerts: <AlertTriangle className="h-5 w-5" />,
  inventoryUnits: <Package className="h-5 w-5" />,
  wasteCenter: <Trash2 className="h-5 w-5" />,
  kitchenDisplay: <ChefHat className="h-5 w-5" />,
  kitchenStations: <SlidersHorizontal className="h-5 w-5" />,
  costingCenter: <Calculator className="h-5 w-5" />,
  branches: <Store className="h-5 w-5" />,
  purchases: <Truck className="h-5 w-5" />,
  customers: <Users className="h-5 w-5" />,
  suppliers: <Building2 className="h-5 w-5" />,
  expenses: <Receipt className="h-5 w-5" />,
  accounts: <Landmark className="h-5 w-5" />,
  openingBalances: <HandCoins className="h-5 w-5" />,
  payments: <HandCoins className="h-5 w-5" />,
  journal: <NotebookPen className="h-5 w-5" />,
  treasury: <Wallet className="h-5 w-5" />,
  reconciliation: <Scale className="h-5 w-5" />,
  financialReports: <FileSpreadsheet className="h-5 w-5" />,
  sales: <FileText className="h-5 w-5" />,
  shifts: <Timer className="h-5 w-5" />,
  reports: <BarChart3 className="h-5 w-5" />,
  users: <UserCog className="h-5 w-5" />,
  auditLog: <ScrollText className="h-5 w-5" />,
  settings: <Settings className="h-5 w-5" />,
  superAdmin: <SlidersHorizontal className="h-5 w-5 text-brand-500" />,
  importExport: <FileSpreadsheet className="h-5 w-5" />,
};

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('premier:desktop-sidebar-hidden') === '1',
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {
      main: false,
      orders: true,
      customers: true,
      centers: true,
      catalog: true,
      reports: true,
      inventory: true,
      operations: true,
      people: true,
      finance: true,
      admin: true,
    };
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(window.localStorage.getItem('premier:nav-collapsed-groups') || '{}') as Record<string, unknown>;
        // Preserve each user's existing choices while new headings start
        // collapsed rather than unexpectedly expanding old saved menus.
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
          for (const key of Object.keys(defaults)) {
            if (typeof saved[key] === 'boolean') defaults[key] = saved[key];
          }
        }
      } catch {
        // Use safe defaults if stored preferences are malformed.
      }
    }
    return defaults;
  });
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const branchScope = useBranchScope();
  const { canAccessModule, canAccessPath, runtime } = useOrganizationModules();
  const isPosRoute = location.pathname === APP_ROUTES.pos || location.pathname.startsWith(`${APP_ROUTES.pos}/`);
  const orderTrackingEnabled = canAccessModule('pos') && canAccessPath(APP_ROUTES.floorPlan) && !isPosRoute;
  const activeOrderCount = useActiveOrderCount(branchFilter || user?.branch_id || '', orderTrackingEnabled);

  const isAdmin = isAdminRole(user?.role);
  const canViewFloorPlan = can('floor_plan.view') && canAccessPath(APP_ROUTES.floorPlan);
  const canOpenSettings = can('settings.manage');

  const showBackButton = location.pathname !== APP_ROUTES.dashboard;
  const isReportsWorkspace = location.pathname === APP_ROUTES.reports || location.pathname === '/reports/view';
  const fullWidthContent = location.pathname === APP_ROUTES.dashboard || isReportsWorkspace;

  const visibleItems = useMemo(() => {
    const order = new Map(runtime.navigation.order.map((id, index) => [id, index]));
    return MENU_ITEMS
      .filter((item) =>
        (!item.permission || can(item.permission)) &&
        (!item.permissionsAny || item.permissionsAny.some((permission) => can(permission))) &&
        (!item.superAdminOnly || user?.role === 'super_admin') &&
        (!item.ownerOnly || isAdmin) &&
        !runtime.navigation.hidden.has(item.id) &&
        canAccessModule(moduleForRoute(item.route)) &&
        canAccessPath(item.route),
      )
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [can, user?.role, isAdmin, canAccessModule, canAccessPath, runtime]);
  // POS has a permanent top-bar shortcut. Reuse the exact same permission,
  // organization-module and route filters as every other navigation entry.
  const canOpenPos = visibleItems.some((item) => item.id === 'pos');
  const grouped = useMemo(() => visibleItems.reduce<Partial<Record<SidebarSection, typeof visibleItems>>>((acc, item) => {
    if (item.id === 'pos') return acc;
    const section = sidebarSectionForItem(item);
    (acc[section] ??= []).push(item);
    return acc;
  }, {}), [visibleItems]);

  const activeMenuGroup = useMemo<SidebarSection | null>(() => {
    const activeItem = visibleItems.find((item) =>
      location.pathname === item.route || location.pathname.startsWith(`${item.route}/`),
    );
    return activeItem ? sidebarSectionForItem(activeItem) : null;
  }, [location.pathname, visibleItems]);

  const sidebarSectionLabel = (group: SidebarSection) => {
    if (group === 'orders') return ar ? 'الطلبات' : 'Orders';
    if (group === 'customers') return ar ? 'العملاء' : 'Customers';
    if (group === 'reports') return ar ? 'التقارير' : 'Reports';
    if (group === 'inventory') return ar ? 'المخزون' : 'Inventory';
    if (group === 'marketplace') return ar ? 'متجر التطبيقات' : 'Marketplace';
    if (group === 'catalog') return ar ? 'القائمة والمنتجات' : 'Menu';
    if (group === 'centers') return ar ? 'الإدارة' : 'Manage';
    if (group === 'admin') return ar ? 'إدارة المنصة' : 'Administration';
    return businessGroupLabel(runtime, group, ar ? 'ar' : 'en', MENU_GROUPS[group][ar ? 'ar' : 'en']);
  };

  useEffect(() => {
    if (!activeMenuGroup) return;
    setCollapsed((current) => current[activeMenuGroup]
      ? { ...current, [activeMenuGroup]: false }
      : current);
  }, [activeMenuGroup]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('premier:nav-collapsed-groups', JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('premier:desktop-sidebar-hidden', desktopSidebarHidden ? '1' : '0');
  }, [desktopSidebarHidden]);

  const mobilePrimaryItems = useMemo(() => {
    const priority = runtime.navigation.order;
    const picked = priority
      .map((id) => visibleItems.find((item) => item.id === id))
      .filter((item): item is (typeof visibleItems)[number] => !!item);

    if (picked.length < 4) {
      for (const item of visibleItems) {
        if (picked.some((candidate) => candidate.id === item.id)) continue;
        picked.push(item);
        if (picked.length >= 4) break;
      }
    }

    return picked.slice(0, 4);
  }, [runtime.navigation.order, visibleItems]);

  const mobilePrimaryRouteActive = mobilePrimaryItems.some((item) =>
    location.pathname === item.route || location.pathname.startsWith(`${item.route}/`),
  );

  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="premier-backoffice min-h-screen bg-ui-page text-ui-text overflow-x-hidden" data-testid="app-shell">
      <header data-testid="app-header" className={`fixed top-0 start-0 end-0 z-[60] flex h-[68px] items-center justify-between gap-3 border-b border-ui-border bg-ui-surface px-4 shadow-none transition-all duration-200 sm:px-6 ${desktopSidebarHidden ? 'lg:start-0' : 'lg:start-[272px]'}`}>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button data-testid="sidebar-open" type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt lg:hidden" aria-label={ar ? 'فتح القائمة' : 'Open sidebar'}>
            <Menu className="h-5 w-5" />
          </button>
          {desktopSidebarHidden && (
            <button
              data-testid="desktop-sidebar-toggle"
              type="button"
              onClick={() => setDesktopSidebarHidden(false)}
              className="hidden h-9 w-9 items-center justify-center rounded-xl border border-ui-border bg-ui-surface text-ui-muted shadow-ui-xs transition hover:bg-ui-page-alt hover:text-ui-text lg:inline-flex"
              aria-label={ar ? 'إظهار القائمة الجانبية' : 'Show sidebar'}
              title={ar ? 'إظهار القائمة الجانبية' : 'Show sidebar'}
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
          )}
          {showBackButton && (
            <button
              data-testid="header-back-button"
              type="button"
              onClick={() => {
                if (window.history.length > 1) navigate(-1);
                else navigate(APP_ROUTES.dashboard);
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ui-border bg-ui-surface px-2.5 text-xs font-black text-ui-text shadow-ui-xs transition hover:bg-ui-page-alt active:scale-95 sm:px-3"
              aria-label={ar ? 'رجوع' : 'Back'}
              title={ar ? 'رجوع' : 'Back'}
            >
              {ar ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              <span className="hidden sm:inline">{ar ? 'رجوع' : 'Back'}</span>
            </button>
          )}
          <CommandPaletteTrigger />
          {canOpenPos && (
            <NavLink
              data-testid="header-pos-shortcut"
              to={APP_ROUTES.pos}
              onPointerEnter={() => prefetchAppRoute(APP_ROUTES.pos)}
              onFocus={() => prefetchAppRoute(APP_ROUTES.pos)}
              onTouchStart={() => prefetchAppRoute(APP_ROUTES.pos)}
              aria-label={ar ? 'نقطة البيع' : 'Point of Sale'}
              title={ar ? 'نقطة البيع' : 'Point of Sale'}
              className={`flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-2.5 text-xs font-bold text-ui-text shadow-ui-xs transition hover:bg-ui-page-alt active:scale-95 sm:px-3 ${isPosRoute ? 'border-ui-primary text-ui-primary' : ''}`}
            >
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{ar ? 'نقطة البيع' : 'Point of Sale'}</span>
            </NavLink>
          )}
        </div>

        <div className="relative flex items-center gap-1.5 sm:gap-2">
          <BranchScopeSelector compact />
          <div className="hidden sm:flex"><OfflineStatusIndicator /></div>
          <ApprovalInbox ar={ar} />
          {canViewFloorPlan && (
            <button data-testid="active-orders-button" type="button" onPointerEnter={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onFocus={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onTouchStart={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onClick={() => navigate(APP_ROUTES.floorPlan)} className="relative rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text" aria-label={ar ? 'الطلبات النشطة' : 'Active orders'}>
              <Activity className="h-5 w-5" />
              {activeOrderCount > 0 && <span data-testid="active-orders-count" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-danger px-1 text-[9px] font-bold text-ui-primary-fg">{activeOrderCount}</span>}
            </button>
          )}
          <div className="hidden h-6 w-px bg-ui-border sm:block" />
          <button
            data-testid="user-menu-button"
            type="button"
            onPointerEnter={canOpenSettings ? () => prefetchAppRoute(APP_ROUTES.settings) : undefined}
            onFocus={canOpenSettings ? () => prefetchAppRoute(APP_ROUTES.settings) : undefined}
            onTouchStart={canOpenSettings ? () => prefetchAppRoute(APP_ROUTES.settings) : undefined}
            onClick={canOpenSettings ? () => navigate(APP_ROUTES.settings) : undefined}
            disabled={!canOpenSettings}
            aria-label={canOpenSettings ? (ar ? 'فتح الإعدادات' : 'Open settings') : (ar ? 'هوية المستخدم' : 'User identity')}
            title={canOpenSettings ? (ar ? 'الإعدادات' : 'Settings') : undefined}
            className={`flex items-center gap-2.5 rounded-xl p-1.5 pe-2 transition-colors ${canOpenSettings ? 'hover:bg-ui-page-alt' : 'cursor-default'}`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ui-primary-soft text-xs font-bold text-ui-primary">{(user?.full_name || user?.email || 'A').slice(0, 1).toUpperCase()}</div>
            <div className="hidden text-start sm:block">
              <p className="text-sm font-semibold leading-tight text-ui-text">{user?.full_name || user?.email || (ar ? 'مدير النظام' : 'System Admin')}</p>
              <p className="text-[10px] leading-tight text-ui-subtle">{user?.role || 'admin'}</p>
            </div>
          </button>
          <button data-testid="language-toggle" type="button" onClick={() => setLang(ar ? 'en' : 'ar')} className="hidden items-center gap-1.5 rounded-xl border border-ui-border px-2.5 py-1.5 text-xs font-semibold text-ui-muted transition-colors hover:bg-ui-page-alt sm:flex">
            <Globe className="h-3.5 w-3.5" /><span className="hidden md:inline">{ar ? 'العربية' : 'English'}</span>
          </button>
          <button data-testid="theme-toggle" type="button" onClick={toggleTheme} className="rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text" aria-label={ar ? 'تغيير المظهر' : 'Toggle theme'}>
            {theme === 'light' ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
          </button>
          <button data-testid="sign-out-button" type="button" onClick={signOut} className="rounded-xl p-2 text-ui-subtle transition-colors hover:bg-ui-danger-soft hover:text-ui-danger" aria-label={ar ? 'تسجيل الخروج' : 'Sign out'}>
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      <aside data-testid="app-sidebar" className={`fixed top-0 bottom-0 start-0 z-50 w-[272px] border-e border-ui-border bg-[#F5F5F9] text-[#191a20] shadow-none dark:bg-ui-surface transition-transform duration-200 ease-[var(--ui-ease)] ${mobileOpen ? 'translate-x-0' : ar ? 'translate-x-full' : '-translate-x-full'} ${desktopSidebarHidden ? (ar ? 'lg:translate-x-full' : 'lg:-translate-x-full') : 'lg:translate-x-0'}`}>
        <div className="flex h-[68px] items-center justify-between px-5">
          <Logo variant="horizontal" size={28} tone="mono" showTagline={false} className="text-ui-primary" />
          <button data-testid="sidebar-close" type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt lg:hidden" aria-label={ar ? 'إغلاق القائمة' : 'Close sidebar'}><X className="h-5 w-5" /></button>
          <button
            data-testid="desktop-sidebar-hide"
            type="button"
            onClick={() => setDesktopSidebarHidden(true)}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text lg:inline-flex"
            aria-label={ar ? 'إخفاء القائمة الجانبية' : 'Hide sidebar'}
            title={ar ? 'إخفاء القائمة الجانبية' : 'Hide sidebar'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav data-testid="app-navigation" className="h-[calc(100%-68px)] overflow-y-auto px-2 py-5">
          <section data-testid="mobile-sidebar-controls" className="mb-4 grid gap-3 rounded-2xl border border-ui-border bg-ui-surface/80 p-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft text-sm font-black text-ui-primary">
                {(user?.full_name || user?.email || 'A').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ui-text">
                  {user?.full_name || user?.email || (ar ? 'مستخدم النظام' : 'System user')}
                </p>
                <p className="truncate text-xs text-ui-subtle">{user?.role || 'user'}</p>
              </div>
            </div>

            <BranchScopeSelector mobile />

            <div className="grid grid-cols-3 gap-2">
              <button
                data-testid="mobile-language-toggle"
                type="button"
                onClick={() => setLang(ar ? 'en' : 'ar')}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-ui-border bg-ui-page text-xs font-bold text-ui-muted"
              >
                <Globe className="h-4 w-4" />
                <span>{ar ? 'EN' : 'AR'}</span>
              </button>
              <button
                data-testid="mobile-theme-toggle"
                type="button"
                onClick={toggleTheme}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-ui-border bg-ui-page text-xs font-bold text-ui-muted"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span>{ar ? 'المظهر' : 'Theme'}</span>
              </button>
              <button
                data-testid="mobile-sign-out"
                type="button"
                onClick={signOut}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-ui-danger/30 bg-ui-danger-soft text-xs font-bold text-ui-danger"
              >
                <LogOut className="h-4 w-4" />
                <span>{ar ? 'خروج' : 'Exit'}</span>
              </button>
            </div>

            {canOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  navigate(APP_ROUTES.settings);
                }}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ui-primary-soft px-3 text-sm font-bold text-ui-primary"
              >
                <Settings className="h-4 w-4" />
                {ar ? 'إعدادات الحساب والنظام' : 'Account & system settings'}
              </button>
            )}
          </section>

          {SIDEBAR_SECTION_ORDER.map((group) => {
            const items = grouped[group] ?? [];
            if (!items.length) return null;
            // Orders (Sales Invoices) and Customers are one-click primary
            // destinations, not nested accordions. Other sections keep their
            // existing expand/collapse behavior and Premier visual styling.
            if (group === 'orders' || group === 'customers' || group === 'marketplace') {
              const item = items[0];
              return (
                <section key={group} data-testid={`nav-group-${group}`} className="mb-1">
                  <NavLink
                    to={item.route}
                    data-testid={`nav-item-${item.id}`}
                    onPointerEnter={() => prefetchAppRoute(item.route)}
                    onFocus={() => prefetchAppRoute(item.route)}
                    onTouchStart={() => prefetchAppRoute(item.route)}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => `group flex min-h-[48px] items-center gap-3 rounded-lg px-4 text-sm font-medium transition-colors ${isActive ? 'bg-[#D0D0D5] font-bold text-[#191a20] dark:bg-ui-page-alt dark:text-ui-text' : 'text-[#24252b] hover:bg-[#e5e5eb] dark:text-ui-muted dark:hover:bg-ui-page-alt'}`}
                  >
                    {group === 'marketplace' ? <LayoutGrid className="h-5 w-5 shrink-0" /> : ICONS[item.icon]}
                    <span className="flex-1 truncate">{group === 'marketplace'
                      ? (ar ? 'متجر التطبيقات' : 'Marketplace')
                      : businessMenuLabel(
                      runtime, item.id, ar ? 'ar' : 'en',
                      item.label ? item.label[ar ? 'ar' : 'en'] : t(item.labelKey),
                    )}</span>
                  </NavLink>
                </section>
              );
            }
            return (
              <section key={group} data-testid={`nav-group-${group}`} className="mb-2">
                <button
                  data-testid={`nav-group-toggle-${group}`}
                  type="button"
                  onClick={() => setCollapsed((v) => ({ ...v, [group]: !v[group] }))}
                  aria-expanded={!collapsed[group]}
                  aria-controls={`nav-group-items-${group}`}
                  className="flex min-h-[48px] w-full items-center justify-between rounded-lg px-4 py-2 text-sm font-semibold text-[#24252b] transition hover:bg-[#e5e5eb] dark:text-ui-text dark:hover:bg-ui-page-alt"
                >
                  <span className="flex min-w-0 items-center gap-3 text-start">
                    <span className="shrink-0">{ICONS[items[0]?.icon] || <LayoutDashboard className="h-5 w-5" />}</span>
                    <span className="truncate">{sidebarSectionLabel(group)}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-150 ${collapsed[group] ? '-rotate-90' : ''}`} />
                </button>
                {!collapsed[group] && (
                  <div id={`nav-group-items-${group}`} className="mt-0.5 space-y-0.5 pb-2">
                    {items.map((item) => (
                      <NavLink
                        data-testid={`nav-item-${item.id}`}
                        key={item.id}
                        to={item.route}
                        onPointerEnter={() => prefetchAppRoute(item.route)}
                        onFocus={() => prefetchAppRoute(item.route)}
                        onTouchStart={() => prefetchAppRoute(item.route)}
                        onClick={() => setMobileOpen(false)}
                        aria-current={location.pathname === item.route || location.pathname.startsWith(`${item.route}/`) ? 'page' : undefined}
                        className={({ isActive }) => `group flex min-h-[42px] items-center gap-2.5 rounded-lg ps-12 pe-3 text-sm transition-colors ${isActive || location.pathname.startsWith(`${item.route}/`) ? 'bg-[#c8c8cd] font-bold text-[#17171d] dark:bg-ui-page-alt dark:text-ui-text' : 'font-medium text-[#34343a] hover:bg-[#e5e5eb] dark:text-ui-muted dark:hover:bg-ui-page-alt'}`}
                      >
                        <span className="flex-1 truncate">{businessMenuLabel(
                          runtime,
                          item.id,
                          ar ? 'ar' : 'en',
                          item.label ? item.label[ar ? 'ar' : 'en'] : item.labelKey ? t(item.labelKey) : item.id,
                        )}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
      </aside>

      {mobileOpen && <button data-testid="mobile-sidebar-backdrop" type="button" className="fixed inset-0 z-40 bg-ui-text/20 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label={ar ? 'إغلاق' : 'Close'} />}

      <div data-testid="app-content-shell" className={`min-h-screen pt-[68px] transition-all duration-200 ${desktopSidebarHidden ? 'lg:ms-0' : 'lg:ms-[272px]'}`}>
        <ReturnContextBanner />
        {branchScope.isAggregate && (
          <div data-testid="aggregate-branch-action-banner" className="border-b border-ui-warning/30 bg-ui-warning/10 px-4 py-2.5 sm:px-6 lg:px-7">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black text-ui-text">
                  {ar
                    ? `عرض مجمع لـ ${branchScope.selectedBranchIds.length} فروع`
                    : `Combined view for ${branchScope.selectedBranchIds.length} branches`}
                </p>
                <p className="text-[11px] font-semibold text-ui-muted">
                  {ar
                    ? 'حدد فرع الإجراء قبل الإنشاء أو التعديل أو الحذف. العرض يبقى مجمعًا للفروع المحددة.'
                    : 'Choose the action branch before create, edit, or delete. The view remains combined for selected branches.'}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] font-black text-ui-warning">{ar ? 'فرع الإجراء' : 'Action branch'}</span>
                <select
                  data-testid="aggregate-action-branch-select"
                  value={branchScope.actionBranchId || ''}
                  onChange={(event) => branchScope.setActionBranchId(event.target.value)}
                  className="min-h-9 min-w-[180px] rounded-xl border border-ui-warning/40 bg-ui-surface px-3 text-xs font-black text-ui-text outline-none focus:border-ui-primary"
                >
                  {branchScope.organizationBranches
                    .filter((branch) => branchScope.selectedBranchSet.has(branch.id))
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {lang === 'ar' ? branch.name : branch.name_en || branch.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>
        )}
        <main data-testid="app-main" className="min-h-[calc(100vh-68px)] bg-ui-page px-4 pb-36 pt-6 sm:px-6 sm:pb-24 sm:pt-7 lg:px-9 lg:pb-24 lg:pt-8">
          <div
            data-testid="design-content-surface"
            className={`min-h-[calc(100vh-68px)] w-full min-w-0 space-y-5 ${fullWidthContent ? 'max-w-none' : 'mx-auto max-w-[1600px]'}`}
          >
            {children}
          </div>
        </main>
      </div>

      <footer
        data-testid="app-bottom-footer"
        className={`fixed bottom-0 start-0 end-0 z-[55] border-t border-ui-border bg-ui-surface/95 shadow-[0_-8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-all duration-200 print:hidden ${desktopSidebarHidden ? 'lg:start-0' : 'lg:start-[260px]'} ${mobileOpen ? 'hidden lg:block' : ''}`}
      >
        <div data-testid="app-bottom-toolbar" className="flex h-12 items-center border-b border-ui-border px-3 sm:h-14 sm:px-5 md:border-b-0">
          <PageUtilityControls />
        </div>
        <nav
          data-testid="mobile-bottom-nav"
          className="grid grid-flow-col auto-cols-fr gap-1 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
          aria-label={ar ? 'التنقل السريع' : 'Quick navigation'}
        >
        {mobilePrimaryItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.route}
            data-testid={`mobile-nav-${item.id}`}
            onPointerEnter={() => prefetchAppRoute(item.route)}
            onFocus={() => prefetchAppRoute(item.route)}
            onTouchStart={() => prefetchAppRoute(item.route)}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-bold transition ${
                isActive
                  ? 'bg-ui-primary-soft text-ui-primary'
                  : 'text-ui-subtle active:bg-ui-page-alt'
              }`
            }
          >
            <span className="flex h-6 items-center justify-center">{ICONS[item.icon]}</span>
            <span className="w-full truncate text-center">
              {businessMenuLabel(
                runtime,
                item.id,
                ar ? 'ar' : 'en',
                item.label ? item.label[ar ? 'ar' : 'en'] : item.labelKey ? t(item.labelKey) : item.id,
              )}
            </span>
          </NavLink>
        ))}
        <button
          data-testid="mobile-bottom-more"
          type="button"
          onClick={() => setMobileOpen(true)}
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-bold transition ${
            mobilePrimaryRouteActive ? 'text-ui-subtle' : 'bg-ui-primary-soft text-ui-primary'
          }`}
          aria-label={ar ? 'المزيد' : 'More'}
        >
          <span className="flex h-6 items-center justify-center"><Menu className="h-5 w-5" /></span>
          <span>{ar ? 'المزيد' : 'More'}</span>
        </button>
        </nav>
      </footer>

      <CommandPalette />
    </div>
  );
}