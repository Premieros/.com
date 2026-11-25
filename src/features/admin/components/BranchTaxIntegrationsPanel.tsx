import { useState } from 'react';
import { AlertTriangle, Building2, FileCheck2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/PageHeader';
import { Select } from '@/components/Input';
import type { Branch } from '@/lib/types';
import { listTaxIntegrationsForBranch } from '@/features/invoicing/taxIntegrationCatalog';

/** Read-only integration catalog scoped to a selected authorized branch.
 * No credential entry or live connection switch exists until a secure
 * organization/branch-scoped backend integration is reviewed and deployed.
 */
export function BranchTaxIntegrationsPanel({
  branches, ar,
}: { branches: Branch[]; ar: boolean }) {
  const [branchId, setBranchId] = useState('');
  const selected = branches.find((branch) => branch.id === branchId) ?? null;
  const systems = listTaxIntegrationsForBranch(
    selected?.id ?? '', branches.map((branch) => branch.id),
  );

  return (
    <div className="space-y-5 max-w-5xl animate-fade-in" data-testid="branch-tax-integrations">
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-brand-600" />
          <div>
            <h2 className="text-lg font-black text-ui-text">
              {ar ? 'منظومات الربط الضريبي حسب الفرع' : 'Branch Tax Authority Integrations'}
            </h2>
            <p className="text-sm text-ui-muted">
              {ar
                ? 'اختر الفرع أولاً لعرض جميع منظومات الضرائب التي يدعم Premier أساسها البرمجي.'
                : 'Select a branch to view all tax authority workflows with a Premier policy foundation.'}
            </p>
          </div>
        </div>
        <div className="max-w-md">
          <Select
            label={ar ? 'الفرع المستهدف' : 'Target branch'}
            value={selected?.id ?? ''}
            onChange={(event) => setBranchId(event.target.value)}
            options={[
              { value: '', label: ar ? 'اختر فرعاً لعرض المنظومات' : 'Select a branch to view integrations' },
              ...branches.map((branch) => ({
                value: branch.id,
                label: ar ? branch.name : branch.name_en || branch.name,
              })),
            ]}
          />
        </div>
        {!branches.length && (
          <p className="text-sm text-ui-danger" role="status">
            {ar ? 'لا توجد فروع متاحة لهذا الحساب. تحقق من صلاحيات الوصول أو بيانات الفروع.' : 'No branches are available to this account.'}
          </p>
        )}
      </Card>

      {selected ? (
        <>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3" role="status">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-ui-text space-y-1">
              <p className="font-bold">
                {ar ? 'هذه منظومات متاحة للتجهيز وليست اتصالات فعّالة' : 'These integrations are foundations, not live connections'}
              </p>
              <p>
                {ar
                  ? 'لا يتضمن سجل الفرع حالياً بلداً قانونياً موثّقاً؛ لذلك تظهر جميع المنظومات مع بلدها، دون افتراض أهلية الفرع. لم يتم تفعيل الإرسال أو التوقيع أو ربط حساب ضرائب.'
                  : 'The branch record has no verified legal country; all available workflows appear with their countries. No tax account, signing, submission or activation is enabled.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ui-text">
            <Building2 className="h-4 w-4" />
            <span>{ar ? 'الفرع المحدد:' : 'Selected branch:'} {ar ? selected.name : selected.name_en || selected.name}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {systems.map((system) => (
              <Card className="p-5 space-y-3" key={system.id}>
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-2">
                    <FileCheck2 className="h-5 w-5 mt-0.5 text-brand-600" />
                    <div>
                      <h3 className="font-bold text-ui-text">{ar ? system.ar : system.en}</h3>
                      <p className="text-xs text-ui-subtle">{system.authority} · {system.countryCode === 'EG' ? (ar ? 'مصر' : 'Egypt') : (ar ? 'السعودية' : 'Saudi Arabia')}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-ui-page-alt border border-ui-border px-2 py-1 text-xs font-semibold text-ui-muted whitespace-nowrap">
                    {ar ? 'غير مهيأ' : 'Not configured'}
                  </span>
                </div>
                <p className="text-sm text-ui-muted">{ar ? system.purposeAr : system.purposeEn}</p>
                <div className="rounded-lg border border-ui-border p-3 text-xs text-ui-muted flex items-start gap-2">
                  <LockKeyhole className="h-4 w-4 shrink-0" />
                  {ar
                    ? 'يلزم أولاً إثبات البلد القانوني والتسجيل، وربط الفرع/الجهاز، وإعداد التوقيع والمفاتيح بالخادم، ثم اختبار التكامل والموافقات.'
                    : 'Requires verified jurisdiction and registration, branch/device mapping, secure server-side credentials and signing, integration testing and approvals.'}
                </div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {ar ? 'الإرسال الإلكتروني غير متاح حتى اكتمال التكامل الخلفي.' : 'Electronic submission is unavailable until secure backend integration is complete.'}
                </p>
              </Card>
            ))}
          </div>
        </>
      ) : branches.length > 0 ? (
        <div className="rounded-xl border border-dashed border-ui-border p-8 text-center text-sm text-ui-muted">
          {ar ? 'حدد فرعاً لعرض جميع منظومات الربط المتاحة.' : 'Choose a branch to view the available authority systems.'}
        </div>
      ) : null}
    </div>
  );
}
