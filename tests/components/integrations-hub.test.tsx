import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'ar', t: (key: string) => key }),
}));
const branchContext = vi.hoisted(() => ({
  user: { id: 'user-1', role: 'super_admin', branch_id: null as string | null },
  branches: [
    { id: 'branch-a', name: 'فرع القاهرة' },
    { id: 'branch-b', name: 'فرع الرياض' },
  ],
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: branchContext.user }),
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({ branches: branchContext.branches, loading: false, error: null }),
}));
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header><h1>{title}</h1><p>{subtitle}</p></header>
  ),
}));

import { IntegrationsHubPage, INTEGRATION_TILES } from '@/features/integrations/pages/IntegrationsHubPage';

beforeEach(() => localStorage.clear());

describe('compact app-store integrations screen', () => {
  it('renders a compact catalogue with search, category chips and no setup walls', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'متجر التطبيقات' })).toBeInTheDocument();
    expect(screen.getByTestId('apps-catalog-grid').children).toHaveLength(9);
    expect(screen.getByTestId('integration-eta-einvoice')).toBeInTheDocument();
    expect(screen.queryByTestId('integration-readiness-plan')).not.toBeInTheDocument();
    expect(screen.queryByText('خطوات تجهيز هذا التطبيق')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث عن تطبيق' }), { target: { value: 'jahez' } });
    expect(screen.getByTestId('apps-catalog-grid').children).toHaveLength(1);
    expect(screen.getByTestId('integration-jahez')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث عن تطبيق' }), { target: { value: 'unknown-nonsense' } });
    expect(screen.getByTestId('empty-app-results')).toBeInTheDocument();
  });

  it('filters categories without showing full app setup, and opens an app detail', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'الضرائب السعودية' }));
    expect(screen.getByTestId('apps-catalog-grid').children).toHaveLength(3);
    fireEvent.click(screen.getByTestId('integration-zatca-clearance'));
    expect(screen.getByTestId('app-detail-zatca-clearance')).toBeInTheDocument();
    expect(screen.getByText('غير متصل بمزوّد الخدمة')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-integration-zatca-clearance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'كل التطبيقات' }));
    expect(screen.getByTestId('apps-catalog-grid')).toBeInTheDocument();
  });

  it('reveals per-app settings only after installing an app', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'تطبيقات التوصيل' }));
    fireEvent.click(screen.getByTestId('integration-talabat'));
    expect(screen.queryByTestId('setup-integration-talabat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('install-integration-talabat'));
    expect(screen.getByTestId('setup-integration-talabat')).toHaveTextContent('إعدادات التطبيق');
    expect(screen.getByTestId('setup-integration-talabat')).toHaveTextContent('الحصول على موافقة منصة التوصيل');
    expect(screen.getByTestId('setup-integration-talabat')).toHaveTextContent('غير');
    expect(screen.getByRole('link', { name: /فتح التوصيل الداخلي/ })).toHaveAttribute('href', '/delivery');
    expect(screen.getByText('غير متصل بمزوّد الخدمة')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remove-integration-talabat'));
    expect(screen.queryByTestId('setup-integration-talabat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'تطبيقاتي' }));
    expect(screen.getByTestId('empty-app-results')).toBeInTheDocument();
  });

  it('retains branch-scoped installs and does not auto-install in a different branch', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('integration-eta-ereceipt'));
    fireEvent.click(screen.getByTestId('install-integration-eta-ereceipt'));
    fireEvent.click(screen.getByRole('button', { name: 'كل التطبيقات' }));
    expect(screen.getByTestId('installed-app-count')).toHaveTextContent('1');

    fireEvent.change(screen.getByRole('combobox', { name: 'اختيار فرع التكامل' }), {
      target: { value: 'branch-b' },
    });
    expect(screen.getByTestId('integration-branch-scope')).toHaveTextContent('فرع الرياض');
    expect(screen.getByTestId('installed-app-count')).toHaveTextContent('0');
  });

  it('never pretends to connect to providers or accepts credentials', () => {
    for (const integrations of Object.values(INTEGRATION_TILES)) {
      for (const integration of integrations) {
        expect(['foundation', 'not_connected']).toContain(integration.stage);
      }
    }
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /تفعيل الاتصال|إرسال للهيئة/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/API|CSID|secret/i)).not.toBeInTheDocument();
  });

  it('keeps protected navigation and settings access', () => {
    const routes = readFileSync('src/app/routes.tsx', 'utf8');
    const nav = readFileSync('src/core/navigation/menu.config.ts', 'utf8');
    const settings = readFileSync('src/features/admin/pages/SettingsControlCenterPage.tsx', 'utf8');
    const admin = readFileSync('src/features/admin/pages/AdministrationCenterPage.tsx', 'utf8');
    expect(routes).toContain('path={APP_ROUTES.integrations} element={<ProtectedRoute permission="settings.manage">');
    expect(nav).toContain("id: 'integrations-hub'");
    expect(nav).toContain("route: APP_ROUTES.integrations");
    expect(settings).toContain('data-testid="settings-integrations-link"');
    expect(admin).toContain("route: APP_ROUTES.integrations");
  });
});
