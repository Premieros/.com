import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AppProviders } from './providers';
import { AppRoutes } from './routes';
import { SessionProfileGuard } from '@/core/security/SessionProfileGuard';
import { CloudPrintAgent } from '@/features/pos/components/settings/CloudPrintAgent';
import { APP_ROUTES } from '@/core/navigation/routes';
import { WorkAuthorizationAppBoundary } from '@/features/admin/work-authorization/WorkAuthorizationAppBoundary';
import { PageLoadProgressProvider } from '@/components/PageProgressLoader';
import { CustomerSupportLauncher } from '@/components/CustomerSupportLauncher';

const PrinterSettingsLauncher = lazy(() =>
  import('@/features/pos/components/settings/PrinterSettingsLauncher').then((module) => ({
    default: module.PrinterSettingsLauncher,
  })),
);

function RouteScopedExtras() {
  const { pathname } = useLocation();
  const onSettings = pathname.startsWith(APP_ROUTES.settings);

  return (
    <>
      {onSettings && (
        <Suspense fallback={null}>
          <PrinterSettingsLauncher />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  return (
    <AppProviders>
      <PageLoadProgressProvider>
      <SessionProfileGuard>
        <WorkAuthorizationAppBoundary>
          <>
            <AppRoutes />
            <RouteScopedExtras />
          </>
        </WorkAuthorizationAppBoundary>
        <CloudPrintAgent />
        <CustomerSupportLauncher />
      </SessionProfileGuard>
      </PageLoadProgressProvider>
    </AppProviders>
  );
}
