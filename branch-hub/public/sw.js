/**
 * Premier ERP / POS Service Worker
 * Provides offline App Shell loading while explicitly preserving live
 * transaction semantics for all API and Supabase communication.
 */

const CACHE_NAME = 'premier-app-shell-v2-ca9555e644e52f71';
const BUILD_ASSETS = ["/assets/AccountsPage-B4lTqxIv.js","/assets/ActiveOrdersPage-Dr823G5I.js","/assets/AdministrationCenterPage-CEeZQUAi.js","/assets/ApprovalCenterPage-3UxbSNGk.js","/assets/AuditLogPage-mXN7KDNs.js","/assets/BranchesPage-DTkF3N3R.js","/assets/BusinessAttributesFields-BiIzvQs9.js","/assets/BusinessRecordsPage-Bw6redNW.js","/assets/CategoriesPage-BQteXvZY.js","/assets/CenterPageContent-DbJlUgGU.js","/assets/CenterTile-BIuINZyY.js","/assets/ConfirmDialog-DDVA5f5F.js","/assets/CostingCenterPage-CrU0eJ5b.js","/assets/CustomersPage-B2mso0Q0.js","/assets/DashboardEnhancedPage-3SmXUPkH.js","/assets/DashboardEnhancedPage-C59iLui1.css","/assets/DashboardSalesChart-DMbslhkA.js","/assets/DataTable-Dhlx8Ozg.js","/assets/DesignPagination-cOJt25gs.js","/assets/DesignPanel-IYSzHh1l.js","/assets/DesignSearch-DLgBwQA3.js","/assets/DesignSurface-BlxyY36D.js","/assets/EmployeeReceivablesPage-PlTXS0fV.js","/assets/ExpensesPage-BUNaskVH.js","/assets/FinanceCenterPage-DKpbHK-4.js","/assets/FinancialReportsPage-BYtpTPN2.js","/assets/ImportExportCenterPage-DaBoVmVr.js","/assets/Input-CdsAmKPo.js","/assets/InventoryBatchesPage-k_UbzLD_.js","/assets/InventoryCenterPage-67VGpqNr.js","/assets/InventoryLedgerPage-CqrMzZPq.js","/assets/InventoryPage-C78qf50w.js","/assets/InventoryUnitsPage-BDEH1ZAl.js","/assets/JournalPage-COgQQlmP.js","/assets/KitchenDisplayPage-BvVSfNFP.js","/assets/KitchenStationsPage-D_X2qFJc.js","/assets/LoginPage-CM50KfeT.js","/assets/LoginPage-DNxH5Brj.css","/assets/LowStockAlertsPage-BkzwEmmm.js","/assets/OpeningBalancesPage-CAUGACvS.js","/assets/OperationsCenterPage-DQTdvCxn.js","/assets/PageHeader-DaSgCZ8A.js","/assets/PaymentsPage-C3WvzitN.js","/assets/PeopleCenterPage-su7FpBl1.js","/assets/PermissionsPage-B9JJP8oU.js","/assets/PosWorkspacePage-Cs5XiD5l.js","/assets/PricingPage-7R-yxKqM.js","/assets/PrinterSettingsLauncher-BYKKdRP8.js","/assets/ProcurementCenterPage-C-VHacIO.js","/assets/ProductImageAdjustModal-CfIVnT5R.js","/assets/ProductModifierOptionsPage-CRE1zp9r.js","/assets/ProductModifiersPage-C-eRSFxZ.js","/assets/ProductSetupWizardPage-CI7GX_Q2.js","/assets/ProductionOrdersPage-Cm8rjyG7.js","/assets/ProductsPage-B9My_hg_.js","/assets/PurchaseRequestsPage-Dzr7cV46.js","/assets/PurchasesPage-CbWMqOzk.js","/assets/RawMaterialsPage-Do4dnRlZ.js","/assets/ReceivingPage-DIwaWBdx.js","/assets/ReconciliationPage-BjAjCRZK.js","/assets/RegisterPage-DvZ4xfk4.js","/assets/ReportsCenterPage-BjfZJ7fp.js","/assets/RfqsPage-BqpCDZ-_.js","/assets/RolesTab-DYqvWDZf.js","/assets/SalesPage-CaVzyhrZ.js","/assets/SettingsControlCenterPage-BB41OQn3.js","/assets/ShiftsPage-BxTYetVc.js","/assets/StockBalancesPage-B_U3-8QB.js","/assets/StockCountsPage-CRrYoFI-.js","/assets/StockValuationPage-ZLseuuYr.js","/assets/SuperAdminConsolePage-BckhQgMZ.js","/assets/SuppliersPage-CwL6UZ5L.js","/assets/SystemHealthPage-Butw-S4R.js","/assets/TransfersPage-D6BXRioQ.js","/assets/TreasuryPage-B2ZbTlSi.js","/assets/UsersPage-BcgoO9rI.js","/assets/V2GatewayPage-CcuHn6Sr.js","/assets/WarehousesPage-BkySsUCI.js","/assets/WasteCenterPage-DFARNNJZ.js","/assets/accounting-j5ZNWrwh.js","/assets/audit-CQGWNUhY.js","/assets/automaticShiftPrint-MPa1qNVs.js","/assets/badge-check-BVYICz4t.js","/assets/businessMetrics-BneG9EFh.js","/assets/catalog-Cn8cP6M6.js","/assets/check-check-BBTpX5_o.js","/assets/chevron-up-CqIyChgY.js","/assets/clipboard-list-DGl_Hsih.js","/assets/clock-3-D1YRqobH.js","/assets/clsx-B-dksMZM.js","/assets/coins-CKfqDI--.js","/assets/costing-CC9tfLh4.js","/assets/credit-card-Bg5yWdeH.js","/assets/dayClosingReport-BxqSASc1.js","/assets/download-C8KsawKI.js","/assets/excel-Bk5TM04N.js","/assets/eye-CcZ0h6U_.js","/assets/factory-CIaxg2A-.js","/assets/format-CL0o-XGd.js","/assets/history-Ml-bml-U.js","/assets/index-CvLJ2NL2.css","/assets/index-DT0DAaE3.js","/assets/invalidatePosCatalogCache-D119blQ8.js","/assets/inventory-62EzuufF.js","/assets/link-2-AXaCq_DQ.js","/assets/lock-keyhole-cEt5JilD.js","/assets/numericIntegrity-DpMIBd75.js","/assets/package-open-Ctb8Wq-O.js","/assets/package-search-DWwHKLCE.js","/assets/pen-BRyIkEEQ.js","/assets/pencil-BLVAijwu.js","/assets/phone-DOo0yqK0.js","/assets/printing-DJHiFqLo.js","/assets/procurement-Ct4nmItf.js","/assets/receipt-text-B4egh6BW.js","/assets/reporting-Ct9sUA6z.js","/assets/save-DXXJHP2t.js","/assets/shield-check-OnFi9UI9.js","/assets/shopping-bag-BYVfuvKL.js","/assets/smartphone-5Mk9ZsiS.js","/assets/trade-6MCfMg3X.js","/assets/trophy-B8yGT_eZ.js","/assets/unlock-DI0fOHtw.js","/assets/upload-w9k8N4Kp.js","/assets/useHistoryAccess-DMdjCM4m.js","/assets/useOperationalGuard-4wQqWhP5.js","/assets/usePaginatedRows-DIqJDrrZ.js","/assets/user-BQrXchuo.js","/assets/user-check-DL-F1mT3.js","/assets/user-plus-Cn71nQ1V.js","/assets/users-round-DMXH-814.js","/assets/utensils-crossed-C9YFv6Sa.js","/assets/wallet-cards--BH1uiFR.js","/assets/xlsx-D_0l8YDs.js"];

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/app-icon.svg',
  '/manifest.webmanifest',
  ...BUILD_ASSETS,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name.startsWith('premier-app-shell-') && name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Do not intercept other origins (including cloud API, CDN, analytics).
  if (url.origin !== self.location.origin) return;

  // 1. Only intercept GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 2. CRITICAL EXCLUSION: Never cache Supabase API, Auth, REST, or Realtime requests
  if (
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/realtime') ||
    url.hostname.includes('supabase.co')
  ) {
    return;
  }

  // 3. Navigation requests (HTML document): Network-first with cache fallback.
  // SPA routes load their lazy modules from the versioned BUILD_ASSETS precache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // 4. Static assets (JS, CSS, fonts, SVG, webmanifest): Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname === '/manifest.webmanifest';

  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Vite assets are immutable build files. Browsers send different
        // Accept/Vary request headers for module scripts, preload and CSS.
        // Match the same-origin asset by its exact pathname regardless of
        // those headers; never use this for API/auth/business data.
        const cachedResponse = await cache.match(url.pathname, { ignoreVary: true });
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
