import { describe, expect, it, vi } from 'vitest';
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

describe('Integrations Hub screen', () => {
  it('displays Egypt, Saudi Arabia and delivery sections with truthful inactive statuses', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'التكاملات والربط' })).toBeInTheDocument();
    expect(screen.getByTestId('integration-eta-einvoice')).toHaveTextContent('تطوير أولي — غير متصل');
    expect(screen.getByTestId('integration-eta-ereceipt')).toHaveTextContent('غير متصل');
    expect(screen.getByText(/لا يتم إرسال فواتير أو استيراد طلبات/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'الضرائب السعودية' }));
    expect(screen.getByTestId('integration-zatca-clearance')).toHaveTextContent('غير متصل');
    expect(screen.getByTestId('integration-zatca-reporting')).toBeInTheDocument();
    expect(screen.getByTestId('integration-zatca-egs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'تطبيقات التوصيل' }));
    expect(screen.getByTestId('integration-talabat')).toHaveTextContent('غير متصل');
    expect(screen.getByTestId('integration-hungerstation')).toHaveTextContent('غير متصل');
    expect(screen.getByTestId('integration-jahez')).toHaveTextContent('غير متصل');
    expect(screen.getByRole('link', { name: /فتح التوصيل الداخلي/ })).toHaveAttribute('href', '/delivery');
    expect(screen.queryByText('تفعيل الاتصال')).not.toBeInTheDocument();
  });

  it('keeps every integration disconnected and never displays a credential entry form', () => {
    for (const integrations of Object.values(INTEGRATION_TILES)) {
      for (const integration of integrations) {
        expect(['foundation', 'not_connected']).toContain(integration.stage);
      }
    }
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /إرسال|تفعيل الاتصال/ })).not.toBeInTheDocument();
  });

  it('selects a branch without implying official authority readiness', () => {
    render(<MemoryRouter><IntegrationsHubPage /></MemoryRouter>);
    expect(screen.getByTestId('integration-branch-scope')).toHaveTextContent('فرع القاهرة');
    expect(screen.getByTestId('integration-readiness-plan')).toHaveTextContent('فرع القاهرة');
    fireEvent.change(screen.getByRole('combobox', { name: 'اختيار فرع التكامل' }), {
      target: { value: 'branch-b' },
    });
    expect(screen.getByTestId('integration-branch-scope')).toHaveTextContent('فرع الرياض');
    fireEvent.click(screen.getByRole('tab', { name: 'الضرائب السعودية' }));
    expect(screen.getByTestId('integration-readiness-plan')).toHaveTextContent('شهادات CSID');
    expect(screen.getByTestId('integration-zatca-clearance')).toHaveTextContent('غير متصل');
    fireEvent.click(screen.getByRole('tab', { name: 'تطبيقات التوصيل' }));
    expect(screen.getByTestId('integration-readiness-plan')).toHaveTextContent('منع التكرار');
  });

  it('protects the route with settings permission and exposes it in settings, sidebar and admin center', () => {
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
