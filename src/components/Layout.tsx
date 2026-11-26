import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, BarChart3, BadgeDollarSign, Boxes, BookOpenText, Building2, Calculator, ChefHat,
  ChevronDown, ClipboardCheck, FileSpreadsheet, FileText, FlaskConical,
  Globe, GripVertical, HandCoins, HelpCircle, Keyboard, Landmark, Layers, LayoutDashboard, LayoutGrid, LogOut, Menu, Moon, NotebookPen,
  Package, Plus, Receipt, Scale, ScrollText, Settings, ShoppingCart, SlidersHorizontal, Store, Sun,
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
import { workspaceSectionForPath } from '@/core/navigation/workspaceSections';
import { prefetchAppRoute } from '@/core/navigation/prefetch';
import { MENU_GROUPS, MENU_ITEMS, SIDEBAR_SECTION_ORDER, sidebarSectionForItem, type MenuIcon, type SidebarSection } from '@/core/navigation/menu.config';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import { Modal } from './Modal';
import { OfflineStatusIndicator } from './OfflineStatusIndicator';
import { PageUtilityControls } from './PageUtilityControls';
import { ReturnContextBanner } from '@/core/guard/ReturnContextBanner';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessGroupLabel, businessMenuLabel } from '@/core/organizations/businessRuntime';
import { moduleForPath, moduleForRoute } from '@/core/modules/module.config';
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

function readSidebarPreference<T>(key: string, fallback: T): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSidebarPreference(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Customization remains usable in memory when browser storage is unavailable.
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <AccountLayout key={user?.id ?? 'guest'}>{children}</AccountLayout>;
}

function AccountLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickNewOpen, setQuickNewOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const quickNewRef = useRef<HTMLDivElement>(null);
  const preferenceKey = `premier:sidebar:${user?.id ?? 'guest'}`;
  const [desktopSidebarHidden, setDesktopSidebarHidden] = useState(
    () => readSidebarPreference(`${preferenceKey}:hidden`, false) === true,
  );
  const [sectionOrder, setSectionOrder] = useState(() => {
    const saved = readSidebarPreference(`${preferenceKey}:order`, []);
    const valid = Array.isArray(saved)
      ? saved.filter((section): section is SidebarSection => SIDEBAR_SECTION_ORDER.includes(section))
      : [];
    return [...new Set([...valid, ...SIDEBAR_SECTION_ORDER])];
  });
  const [editingSidebar, setEditingSidebar] = useState(false);
  const [draggedSection, setDraggedSection] = useState<SidebarSection | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const saved = readSidebarPreference(`${preferenceKey}:collapsed`, {});
    return Object.fromEntries(SIDEBAR_SECTION_ORDER.map((section) => [
      section,
      saved && typeof saved === 'object' && section in saved
        && typeof saved[section as keyof typeof saved] === 'boolean'
        ? saved[section as keyof typeof saved]
        : section !== 'main',
    ]));
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
  // Back-office data grids need the full workspace, not a 1600px cap.
  const fullWidthContent = true;

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
  const canOpenKitchen = visibleItems.some((item) => item.id === 'kitchen-display');
  const quickCreateActions = useMemo(() => [
    { id: 'pos-sale', to: APP_ROUTES.pos, ar: 'طلب / فاتورة بيع', en: 'New POS order', allowed: canOpenPos && can('pos.order.create'), icon: <ShoppingCart className="h-4 w-4" /> },
    { id: 'new-customer', to: `${APP_ROUTES.customers}?new=1`, ar: 'عميل جديد', en: 'New customer', allowed: can('customers.manage') && can('customers.view') && canAccessModule('customers') && canAccessPath(APP_ROUTES.customers), icon: <Users className="h-4 w-4" /> },
    { id: 'new-product', to: `${APP_ROUTES.products}?new=1`, ar: 'منتج جديد', en: 'New product', allowed: can('products.create') && can('products.view') && canAccessModule('catalog') && canAccessPath(APP_ROUTES.products), icon: <Package className="h-4 w-4" /> },
    { id: 'new-purchase', to: APP_ROUTES.purchases, ar: 'فاتورة شراء', en: 'Purchases', allowed: can('purchases.manage') && canAccessModule('purchases') && canAccessPath(APP_ROUTES.purchases), icon: <Truck className="h-4 w-4" /> },
    { id: 'stock-transfer', to: APP_ROUTES.transfers, ar: 'تحويل مخزون', en: 'Stock transfers', allowed: can('inventory.view') && canAccessModule('inventory') && canAccessPath(APP_ROUTES.transfers), icon: <ArrowLeftRight className="h-4 w-4" /> },
    { id: 'stock-count', to: APP_ROUTES.stockCounts, ar: 'جرد مخزني', en: 'Stock counts', allowed: can('inventory.view') && canAccessModule('inventory') && canAccessPath(APP_ROUTES.stockCounts), icon: <ClipboardCheck className="h-4 w-4" /> },
  ].filter((entry) => entry.allowed), [can, canAccessModule, canAccessPath, canOpenPos]);

  useEffect(() => {
    if (!quickNewOpen) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (quickNewRef.current && !quickNewRef.current.contains(event.target as Node)) setQuickNewOpen(false);
    };
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setQuickNewOpen(false); };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [quickNewOpen]);
  const grouped = useMemo(() => visibleItems.reduce<Partial<Record<SidebarSection, typeof visibleItems>>>((acc, item) => {
    if (item.id === 'pos') return acc;
    const section = sidebarSectionForItem(item);
    (acc[section] ??= []).push(item);
    return acc;
  }, {}), [visibleItems]);

  const workspace = workspaceSectionForPath(location.pathname);
  const sectionLinks = workspace?.section.links.filter((link) => {
    const menuItem = MENU_ITEMS.find((item) => item.route === link.route);
    if (menuItem) return visibleItems.includes(menuItem);
    return !!link.permission && can(link.permission) &&
      canAccessModule(moduleForPath(link.route)) && canAccessPath(link.route);
  }) ?? [];

  const activeMenuGroup = useMemo<SidebarSection | null>(() => {
    const activeItem = visibleItems.find((item) => item.route === workspace?.section.anchor)
      ?? visibleItems.find((item) =>
        location.pathname === item.route || location.pathname.startsWith(`${item.route}/`),
      );
    return activeItem ? sidebarSectionForItem(activeItem) : null;
  }, [location.pathname, visibleItems, workspace?.section.anchor]);

  const sidebarSectionLabel = (group: SidebarSection) => {
    if (group === 'delivery') return ar ? 'التوصيل' : 'Delivery';
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
    saveSidebarPreference(`${preferenceKey}:collapsed`, collapsed);
    saveSidebarPreference(`${preferenceKey}:hidden`, desktopSidebarHidden);
    saveSidebarPreference(`${preferenceKey}:order`, sectionOrder);
  }, [preferenceKey, collapsed, desktopSidebarHidden, sectionOrder]);

  const visibleSections = sectionOrder.filter((section) => grouped[section]?.length);

  function moveSection(section: SidebarSection, target: SidebarSection) {
    if (section === target) return;
    setSectionOrder((current) => {
      const reordered = current.filter((entry) => entry !== section);
      reordered.splice(current.indexOf(target), 0, section);
      return reordered;
    });
  }

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
    <div dir={ar ? 'rtl' : 'ltr'} className="premier-backoffice min-h-screen bg-ui-page text-ui-text overflow-x-clip" data-testid="app-shell">
      <header
        data-testid="app-header"
        className="premier-refresh-topbar-glass fixed top-2.5 inset-x-2.5 sm:inset-x-4 lg:inset-x-5 z-[60] flex h-[68px] min-w-0 items-center justify-between gap-2 rounded-[26px] border border-ui-border px-3 shadow-ui transition-all duration-200 sm:px-4"
      >
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2" data-testid="app-header-navigation">
          <button data-testid="sidebar-open" type="button" onClick={() => setMobileOpen(true)} className="rounded-full p-2 text-ui-muted hover:bg-ui-page-alt lg:hidden" aria-label={ar ? 'فتح القائمة' : 'Open sidebar'}>
            <Menu className="h-5 w-5" />
          </button>
          <Link to={APP_ROUTES.dashboard} className="hidden items-center gap-2.5 pe-1 lg:flex">
            <Logo variant="horizontal" size={32} tone="navy" showTagline={false} />
          </Link>
          {desktopSidebarHidden && (
            <button
              data-testid="desktop-sidebar-toggle"
              type="button"
              onClick={() => setDesktopSidebarHidden(false)}
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-ui-border bg-ui-page-alt text-ui-muted shadow-ui-sm transition hover:border-ui-border-strong hover:text-ui-text lg:inline-flex"
              aria-label={ar ? 'توسيع القائمة الجانبية' : 'Expand sidebar'}
              title={ar ? 'توسيع القائمة الجانبية' : 'Expand sidebar'}
            >
              <Menu className="h-4 w-4" />
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
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ui-border bg-ui-page-alt px-3 text-xs font-semibold text-ui-text transition hover:border-ui-border-strong hover:bg-ui-surface-raised active:scale-95"
              aria-label={ar ? 'رجوع' : 'Back'}
              title={ar ? 'رجوع' : 'Back'}
            >
              {ar ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              <span className="hidden 2xl:inline">{ar ? 'رجوع' : 'Back'}</span>
            </button>
          )}
          {canOpenPos && (
            <NavLink
              data-testid="header-pos-shortcut"
              to={APP_ROUTES.pos}
              onPointerEnter={() => prefetchAppRoute(APP_ROUTES.pos)}
              onFocus={() => prefetchAppRoute(APP_ROUTES.pos)}
              onTouchStart={() => prefetchAppRoute(APP_ROUTES.pos)}
              aria-label={ar ? 'نقطة البيع' : 'Point of Sale'}
              title={ar ? 'نقطة البيع' : 'Point of Sale'}
              className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${isPosRoute ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border border-ui-border bg-ui-page-alt text-ui-text hover:border-ui-border-strong hover:bg-ui-surface-raised'}`}
            >
              <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden 2xl:inline">{ar ? 'نقطة البيع' : 'Point of Sale'}</span>
            </NavLink>
          )}
          {canOpenKitchen && (
            <NavLink
              data-testid="header-kitchen-shortcut"
              to={APP_ROUTES.kitchenDisplay}
              onPointerEnter={() => prefetchAppRoute(APP_ROUTES.kitchenDisplay)}
              onFocus={() => prefetchAppRoute(APP_ROUTES.kitchenDisplay)}
              aria-label={ar ? 'شاشة المطبخ' : 'Kitchen Display'}
              title={ar ? 'شاشة المطبخ' : 'Kitchen Display'}
              className={({ isActive }) => `flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${isActive ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border border-ui-border bg-ui-page-alt text-ui-text hover:border-ui-border-strong hover:bg-ui-surface-raised'}`}
            >
              <ChefHat className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden 2xl:inline">{ar ? 'شاشة المطبخ' : 'Kitchen Display'}</span>
            </NavLink>
          )}
        </div>

        <div className="relative flex min-w-0 flex-1 items-center justify-end gap-1.5" data-testid="app-header-utilities">
          <CommandPaletteTrigger />
          <div className="hidden min-w-0 max-w-[135px] shrink lg:block xl:max-w-[180px]" data-testid="header-branch-wrapper"><BranchScopeSelector compact /></div>
          <div className="hidden shrink-0 xl:flex"><OfflineStatusIndicator /></div>
          <ApprovalInbox ar={ar} />
          {canViewFloorPlan && (
            <button data-testid="active-orders-button" type="button" onPointerEnter={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onFocus={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onTouchStart={() => prefetchAppRoute(APP_ROUTES.floorPlan)} onClick={() => navigate(APP_ROUTES.floorPlan)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-ui-border bg-ui-page-alt text-ui-muted transition-colors hover:border-ui-border-strong hover:text-ui-text" aria-label={ar ? 'الطلبات النشطة' : 'Active orders'}>
              <Activity className="h-4 w-4" />
              {activeOrderCount > 0 && <span data-testid="active-orders-count" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-danger px-1 text-[9px] font-bold text-white">{activeOrderCount}</span>}
            </button>
          )}
          {quickCreateActions.length > 0 && (
            <div ref={quickNewRef} className="relative hidden sm:block">
              <button
                type="button"
                data-testid="header-quick-new"
                aria-expanded={quickNewOpen}
                onClick={() => setQuickNewOpen((open) => !open)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ui-primary px-3.5 text-xs font-semibold text-ui-primary-fg shadow-ui-sm transition hover:bg-ui-primary-hover active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{ar ? 'جديد' : 'New'}</span>
              </button>
              {quickNewOpen && (
                <div className="absolute end-0 top-full z-[80] mt-2 w-60 overflow-hidden rounded-[22px] border border-ui-border bg-ui-surface p-1.5 shadow-ui-xl">
                  <p className="px-3 py-1.5 text-[11px] font-bold text-ui-subtle">{ar ? 'إنشاء سريع' : 'Quick create'}</p>
                  {quickCreateActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        setQuickNewOpen(false);
                        navigate(action.to);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-start text-[13px] font-semibold text-ui-text transition hover:bg-ui-page-alt hover:text-ui-primary"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ui-primary-soft text-ui-primary">{action.icon}</span>
                      <span className="truncate">{ar ? action.ar : action.en}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            data-testid="user-menu-button"
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-haspopup="dialog"
            aria-label={ar ? 'قائمة الحساب' : 'Account menu'}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ui-border bg-ui-primary-soft text-xs font-bold text-ui-primary transition hover:border-ui-border-strong lg:flex"
          >
            {(user?.full_name || user?.email || 'A').slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>

      <aside
        data-testid="app-sidebar"
        className={`fixed top-0 bottom-0 start-0 z-50 flex w-[272px] flex-col gap-2.5 bg-ui-page p-3 text-ui-text transition-transform duration-200 ease-[var(--ui-ease)] lg:top-[88px] lg:bottom-4 lg:start-4 lg:w-[252px] lg:bg-transparent lg:p-0 ${mobileOpen ? 'translate-x-0' : ar ? 'translate-x-full' : '-translate-x-full'} ${desktopSidebarHidden ? 'lg:hidden' : 'lg:translate-x-0'}`}
      >
        <div className="flex items-center justify-between rounded-[20px] border border-ui-border bg-ui-surface px-4 py-3 shadow-ui lg:hidden">
          <Logo variant="horizontal" size={32} tone="navy" showTagline={false} />
          <button data-testid="sidebar-close" type="button" onClick={() => setMobileOpen(false)} className="rounded-full p-1.5 text-ui-muted hover:bg-ui-page-alt" aria-label={ar ? 'إغلاق القائمة' : 'Close sidebar'}><X className="h-5 w-5" /></button>
        </div>

        <div className="hidden items-center justify-between rounded-[22px] border border-ui-border bg-ui-surface p-1.5 shadow-ui lg:flex">
          <div className="grid flex-1 grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => theme !== 'light' && toggleTheme()}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-all ${theme === 'light' ? 'bg-ui-text text-ui-surface shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
              aria-label={ar ? 'الوضع النهاري' : 'Light mode'}
            >
              <Sun className="h-3.5 w-3.5" />
              <span>{ar ? 'نهاري' : 'Light'}</span>
            </button>
            <button
              type="button"
              onClick={() => theme !== 'dark' && toggleTheme()}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-all ${theme === 'dark' ? 'bg-ui-text text-ui-surface shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
              aria-label={ar ? 'الوضع الليلي' : 'Dark mode'}
            >
              <Moon className="h-3.5 w-3.5" />
              <span>{ar ? 'ليلي' : 'Dark'}</span>
            </button>
          </div>
        </div>

        <nav data-testid="app-navigation" className="premier-motion-navigation min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-ui-border bg-ui-surface p-2.5 shadow-ui">
          <section data-testid="mobile-sidebar-controls" className="mb-4 grid gap-3 rounded-[18px] border border-ui-border bg-ui-page-alt p-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ui-primary-soft text-sm font-bold text-ui-primary">
                {(user?.full_name || user?.email || 'A').slice(0, 2).toUpperCase()}
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
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-ui-border bg-ui-surface text-xs font-semibold text-ui-muted"
              >
                <Globe className="h-4 w-4" />
                <span>{ar ? 'EN' : 'AR'}</span>
              </button>
              <button
                data-testid="mobile-theme-toggle"
                type="button"
                onClick={toggleTheme}
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-ui-border bg-ui-surface text-xs font-semibold text-ui-muted"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span>{ar ? 'المظهر' : 'Theme'}</span>
              </button>
              <button
                data-testid="mobile-sign-out"
                type="button"
                onClick={signOut}
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-ui-danger/30 bg-ui-danger-soft text-xs font-semibold text-ui-danger"
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
                className="flex min-h-10 items-center justify-center gap-2 rounded-full bg-ui-primary-soft px-3 text-xs font-bold text-ui-primary"
              >
                <Settings className="h-4 w-4" />
                {ar ? 'إعدادات الحساب والنظام' : 'Account & system settings'}
              </button>
            )}
          </section>

          {user && visibleSections.length > 1 && (
            <div className="mb-2 flex items-center justify-between gap-1 px-2 text-[11px]">
              <button
                type="button"
                aria-pressed={editingSidebar}
                onClick={() => setEditingSidebar((editing) => !editing)}
                className="rounded-full px-2.5 py-1 font-semibold text-ui-muted hover:bg-ui-page-alt hover:text-ui-text"
              >
                {editingSidebar ? (ar ? 'تم' : 'Done') : (ar ? 'ترتيب الأقسام' : 'Reorder')}
              </button>
              {editingSidebar && (
                <button type="button" className="rounded-full px-2.5 py-1 text-ui-muted hover:bg-ui-page-alt" onClick={() => setSectionOrder([...SIDEBAR_SECTION_ORDER])}>
                  {ar ? 'استعادة' : 'Reset'}
                </button>
              )}
            </div>
          )}

          {visibleSections.map((group, index) => {
            const items = grouped[group] ?? [];
            if (editingSidebar) {
              const label = sidebarSectionLabel(group);
              const previous = visibleSections[index - 1];
              const next = visibleSections[index + 1];
              return (
                <section
                  key={group}
                  data-testid={`nav-group-${group}`}
                  className="mb-1 flex min-h-11 items-center gap-1 rounded-[14px] border border-ui-border px-2 text-sm"
                  onDragOver={(event) => { if (draggedSection) event.preventDefault(); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedSection) moveSection(draggedSection, group);
                    setDraggedSection(null);
                  }}
                >
                  <span
                    draggable
                    className="cursor-grab touch-none p-1.5 active:cursor-grabbing"
                    aria-hidden="true"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', group);
                      setDraggedSection(group);
                    }}
                    onDragEnd={() => setDraggedSection(null)}
                  ><GripVertical className="h-4 w-4" /></span>
                  <span className="flex-1 truncate">{label}</span>
                  <button type="button" disabled={!previous} onClick={() => moveSection(group, previous)} aria-label={ar ? `رفع ${label}` : `Move ${label} up`} className="p-1.5 hover:bg-ui-page-alt disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" disabled={!next} onClick={() => moveSection(group, next)} aria-label={ar ? `خفض ${label}` : `Move ${label} down`} className="p-1.5 hover:bg-ui-page-alt disabled:opacity-30">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </section>
              );
            }
            // Orders (Sales Invoices) and Customers are one-click primary
            // destinations, not nested accordions.
            if (group === 'orders' || group === 'delivery' || group === 'customers' || group === 'main' || group === 'marketplace') {
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
                    className={({ isActive }) => `group flex min-h-[42px] items-center gap-3 rounded-[14px] px-3.5 text-[13.5px] transition-all ${isActive ? 'bg-ui-primary font-semibold text-ui-primary-fg shadow-ui-sm' : 'font-medium text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'}`}
                  >
                    {group === 'marketplace' ? <LayoutGrid className="h-[18px] w-[18px] shrink-0" /> : ICONS[item.icon]}
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
              <section key={group} data-testid={`nav-group-${group}`} className="mb-1">
                <button
                  data-testid={`nav-group-toggle-${group}`}
                  type="button"
                  onClick={() => setCollapsed((v) => ({ ...v, [group]: !v[group] }))}
                  aria-expanded={!collapsed[group]}
                  aria-controls={`nav-group-items-${group}`}
                  className="flex min-h-[42px] w-full items-center justify-between rounded-[14px] px-3.5 py-2 text-[13.5px] font-medium text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text"
                >
                  <span className="flex min-w-0 items-center gap-3 text-start">
                    <span className="shrink-0">{ICONS[items[0]?.icon] || <LayoutDashboard className="h-[18px] w-[18px]" />}</span>
                    <span className="truncate">{sidebarSectionLabel(group)}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-150 ${collapsed[group] ? '-rotate-90' : ''}`} />
                </button>
                <div
                  id={`nav-group-items-${group}`}
                  data-testid={`nav-group-panel-${group}`}
                  aria-hidden={collapsed[group]}
                  className={`premier-motion-nav-panel ${collapsed[group] ? 'premier-motion-nav-panel--closed' : ''}`}
                >
                  <div className="premier-motion-nav-panel-inner">
                    <div className="mt-0.5 space-y-0.5 pb-1.5">
                    {items.map((item) => (
                      <NavLink
                        data-testid={`nav-item-${item.id}`}
                        key={item.id}
                        to={item.route}
                        onPointerEnter={() => prefetchAppRoute(item.route)}
                        onFocus={() => prefetchAppRoute(item.route)}
                        onTouchStart={() => prefetchAppRoute(item.route)}
                        onClick={() => setMobileOpen(false)}
                        tabIndex={collapsed[group] ? -1 : undefined}
                        aria-current={location.pathname === item.route || location.pathname.startsWith(`${item.route}/`) ? 'page' : undefined}
                        className={({ isActive }) => `group flex min-h-[38px] items-center gap-2.5 rounded-[12px] ps-10 pe-3 text-[13px] transition-all ${isActive || location.pathname.startsWith(`${item.route}/`) ? 'bg-ui-primary font-semibold text-ui-primary-fg shadow-ui-sm' : 'font-medium text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'}`}
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
                  </div>
                </div>
              </section>
            );
          })}
        </nav>

        <div className="hidden flex-col gap-1 rounded-[22px] border border-ui-border bg-ui-surface p-2 shadow-ui lg:flex">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex h-10 w-full items-center gap-3 rounded-[14px] px-3 text-[13px] font-medium text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text"
          >
            <HelpCircle className="h-4 w-4 shrink-0" />
            <span>{ar ? 'الاختصارات والمساعدة' : 'Help & keys'}</span>
          </button>
          <button
            data-testid="desktop-sidebar-hide"
            type="button"
            onClick={() => setDesktopSidebarHidden(true)}
            className="flex h-10 w-full items-center gap-3 rounded-[14px] px-3 text-[13px] font-medium text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text"
            aria-label={ar ? 'تصغير القائمة الجانبية' : 'Collapse sidebar'}
            title={ar ? 'تصغير القائمة الجانبية' : 'Collapse sidebar'}
          >
            <ArrowLeft className={`h-4 w-4 shrink-0 ${ar ? 'rotate-180' : ''}`} />
            <span>{ar ? 'طي القائمة' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      {desktopSidebarHidden && (
        <nav aria-label={ar ? 'الأقسام الرئيسية' : 'Main sections'} data-testid="app-sidebar-rail"
          className="fixed top-[88px] bottom-4 start-4 z-50 hidden w-[72px] flex-col items-center gap-1.5 overflow-y-auto rounded-[22px] border border-ui-border bg-ui-surface p-2 shadow-ui lg:flex">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={ar ? 'تغيير المظهر' : 'Toggle theme'}
            className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ui-page-alt text-ui-text transition hover:bg-ui-primary-soft hover:text-ui-primary"
          >
            {theme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="my-0.5 h-px w-8 bg-ui-border" />
          <div className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
            {visibleSections.flatMap((section) => {
              const entries = new Map<string, (typeof visibleItems)[number]>();
              for (const item of grouped[section] ?? []) {
                const anchor = workspaceSectionForPath(item.route)?.section.anchor ?? item.route;
                if (!entries.has(anchor) || item.route === anchor) entries.set(anchor, item);
              }
              return [...entries].map(([anchor, item]) => {
                const label = businessMenuLabel(runtime, item.id, lang, item.label?.[lang] ?? t(item.labelKey));
                const active = workspace ? workspace.section.anchor === anchor : location.pathname === item.route;
                return (
                  <Link key={item.id} to={item.route} aria-label={label} title={label}
                    aria-current={active ? 'page' : undefined}
                    onPointerEnter={() => prefetchAppRoute(item.route)} onFocus={() => prefetchAppRoute(item.route)}
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] transition-all focus-visible:outline-2 focus-visible:outline-ui-ring ${active ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'}`}>
                    {ICONS[item.icon]}
                  </Link>
                );
              });
            })}
          </div>
          <button
            type="button"
            onClick={() => setDesktopSidebarHidden(false)}
            aria-label={ar ? 'توسيع القائمة الجانبية' : 'Expand sidebar'}
            title={ar ? 'توسيع القائمة الجانبية' : 'Expand sidebar'}
            className="mt-1 grid h-10 w-11 shrink-0 place-items-center rounded-[14px] text-ui-muted transition hover:bg-ui-page-alt hover:text-ui-text"
          >
            <ArrowRight className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
          </button>
        </nav>
      )}

      {mobileOpen && <button data-testid="mobile-sidebar-backdrop" type="button" className="fixed inset-0 z-40 bg-ui-text/20 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label={ar ? 'إغلاق' : 'Close'} />}

      <div data-testid="app-content-shell" className={`min-h-screen pt-[68px] transition-all duration-200 ${desktopSidebarHidden ? 'lg:ms-[88px]' : 'lg:ms-[272px]'}`}>
        {sectionLinks.length > 1 && workspace && (
          <nav aria-label={ar ? 'صفحات القسم' : 'Pages in this section'}
            data-testid="workspace-section-navigation"
            className="sticky top-[82px] z-[35] mx-3 mt-4 flex min-w-0 gap-1 overflow-x-auto rounded-full border border-ui-border bg-ui-surface/90 p-1 shadow-ui-sm backdrop-blur-md sm:mx-5">
            {sectionLinks.map((link) => (
              <Link key={link.route} to={link.route}
                aria-current={workspace.route === link.route ? 'page' : undefined}
                onPointerEnter={() => prefetchAppRoute(link.route)} onFocus={() => prefetchAppRoute(link.route)}
                className={`flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ui-ring ${workspace.route === link.route ? 'bg-ui-text font-semibold text-ui-surface shadow-ui-sm' : 'font-medium text-ui-muted hover:text-ui-text'}`}>
                {link.label[ar ? 0 : 1]}
              </Link>
            ))}
          </nav>
        )}
        <ReturnContextBanner />
        {branchScope.isAggregate && (
          <div data-testid="aggregate-branch-action-banner" className="mx-3 mt-4 rounded-[20px] border border-ui-warning/30 bg-ui-warning-soft/60 px-4 py-2.5 sm:mx-5 lg:mx-6">
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
                  className="min-h-9 min-w-[180px] rounded-full border border-ui-warning/40 bg-ui-surface px-3.5 text-xs font-bold text-ui-text outline-none focus:border-ui-primary"
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
        <main data-testid="app-main" className="min-h-[calc(100vh-68px)] bg-transparent px-3 pb-36 pt-6 sm:px-5 sm:pb-24 sm:pt-7 lg:px-6 lg:pb-24 lg:pt-8">
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
        className={`premier-refresh-topbar-glass fixed bottom-2.5 inset-x-2.5 sm:inset-x-4 z-[55] rounded-[24px] border border-ui-border shadow-ui-lg transition-all duration-200 print:hidden ${desktopSidebarHidden ? 'lg:start-[96px] lg:end-5' : 'lg:start-[276px] lg:end-5'} ${mobileOpen ? 'hidden lg:block' : ''}`}
      >
        <div data-testid="app-bottom-toolbar" className="flex h-12 items-center border-b border-ui-border px-3 sm:h-13 sm:px-5 md:border-b-0">
          <PageUtilityControls />
        </div>
        <nav
          data-testid="mobile-bottom-nav"
          className="grid grid-flow-col auto-cols-fr gap-1 px-1.5 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] md:hidden"
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
              `flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1.5 text-[10px] font-bold transition ${
                isActive
                  ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
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
          className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1.5 text-[10px] font-bold transition ${
            mobilePrimaryRouteActive ? 'text-ui-subtle' : 'bg-ui-primary text-ui-primary-fg'
          }`}
          aria-label={ar ? 'المزيد' : 'More'}
        >
          <span className="flex h-6 items-center justify-center"><Menu className="h-5 w-5" /></span>
          <span>{ar ? 'المزيد' : 'More'}</span>
        </button>
        </nav>
      </footer>

      <CommandPalette />
      <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title={ar ? 'الحساب' : 'Account'} size="sm" manageFocus>
        <p className="mb-3 truncate font-semibold text-ui-text">{user?.full_name || user?.email}</p>
        <div className="grid gap-2">
          {canOpenSettings && <Link to={APP_ROUTES.settings} onClick={() => setAccountOpen(false)}
            className="flex items-center gap-2 rounded-lg border border-ui-border px-3 py-2 text-sm hover:bg-ui-page-alt">
            <Settings className="h-4 w-4" />{ar ? 'الإعدادات' : 'Settings'}
          </Link>}
          <button data-testid="language-toggle" type="button" onClick={() => setLang(ar ? 'en' : 'ar')}
            className="flex items-center gap-2 rounded-lg border border-ui-border px-3 py-2 text-sm hover:bg-ui-page-alt">
            <Globe className="h-4 w-4" />{ar ? 'اللغة: English' : 'Language: العربية'}
          </button>
          <button data-testid="theme-toggle" type="button" onClick={toggleTheme}
            className="flex items-center gap-2 rounded-lg border border-ui-border px-3 py-2 text-sm hover:bg-ui-page-alt">
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === 'light' ? (ar ? 'الوضع الليلي' : 'Dark mode') : (ar ? 'الوضع النهاري' : 'Light mode')}
          </button>
          <button data-testid="sign-out-button" type="button" onClick={signOut}
            className="flex items-center gap-2 rounded-lg border border-ui-border px-3 py-2 text-sm text-ui-danger hover:bg-ui-danger-soft">
            <LogOut className="h-4 w-4" />{ar ? 'تسجيل الخروج' : 'Sign out'}
          </button>
        </div>
      </Modal>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={ar ? 'اختصارات لوحة المفاتيح والمساعدة' : 'Keyboard shortcuts & help'} size="sm">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-[16px] border border-ui-border bg-ui-page-alt px-4 py-3">
            <span className="flex items-center gap-2 font-semibold text-ui-text"><Keyboard className="h-4 w-4 text-ui-primary" />{ar ? 'البحث السريع والأوامر' : 'Quick search & command palette'}</span>
            <kbd className="rounded-full border border-ui-border bg-ui-surface px-2.5 py-0.5 text-xs font-bold text-ui-muted">Ctrl / ⌘ + K</kbd>
          </div>
          <div className="flex items-center justify-between rounded-[16px] border border-ui-border bg-ui-page-alt px-4 py-3">
            <span className="font-semibold text-ui-text">{ar ? 'إغلاق النوافذ المنبثقة' : 'Close open modal or drawer'}</span>
            <kbd className="rounded-full border border-ui-border bg-ui-surface px-2.5 py-0.5 text-xs font-bold text-ui-muted">Esc</kbd>
          </div>
          {canOpenSettings && (
            <button
              type="button"
              onClick={() => { setHelpOpen(false); navigate(APP_ROUTES.settings); }}
              className="flex w-full items-center justify-between rounded-[16px] border border-ui-border bg-ui-surface px-4 py-3 font-semibold text-ui-text transition hover:border-ui-primary/40 hover:bg-ui-page-alt"
            >
              <span>{ar ? 'إعدادات المظهر والفرع' : 'Appearance & branch settings'}</span>
              <span className="text-ui-primary">→</span>
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}