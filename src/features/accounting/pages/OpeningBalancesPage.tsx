import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpenText, CheckCircle2, Coins, Loader2, Warehouse } from 'lucide-react';
import * as api from '@/api';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useSettings } from '@/context/SettingsContext';
import { APP_ROUTES } from '@/core/navigation/routes';
import { formatCurrency } from '@/lib/format';

type Preview = {
  success: boolean;
  error?: string;
  branch_id?: string;
  finished?: number;
  raw?: number;
  total?: number;
  has_opening?: boolean;
  can_post?: boolean;
  opening_entry?: { id: string; entry_number: string; entry_date: string } | null;
};

/** Inventory opening JOURNAL, not a screen to overwrite historical stock quantities. */
export function OpeningBalancesPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchId = useBranchFilter();
  const { branches, loading: branchesLoading } = useBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchId)?.currency || 'EGP';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const selectedBranch = branches.find((branch) => branch.id === branchId);

  const load = useCallback(async () => {
    if (!branchId || !branches.some((branch) => branch.id === branchId)) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await api.accounting.previewOpeningBalances({ p_branch_id: branchId });
      setPreview(error ? { success: false, error: error.message } : (data as Preview | null));
    } catch {
      setPreview({ success: false, error: 'PREVIEW_FAILED' });
    } finally {
      setLoading(false);
    }
  }, [branchId, branches]);

  useEffect(() => {
    setConfirmed(false);
    void load();
  }, [load]);

  const post = async () => {
    if (!branchId || posting || !confirmed || !can('accounts.manage')
      || !preview?.success || !preview.can_post || preview.branch_id !== branchId) return;
    setPosting(true);
    try {
      const { data, error } = await api.accounting.seedOpeningBalances({ p_branch_id: branchId });
      if (error) {
        show(error.message, 'error');
      } else {
        const response = data as { success?: boolean; error?: string; detail?: string; skipped?: boolean } | null;
        if (response?.success && !response.skipped) {
          show(ar ? 'تم إنشاء قيد الأرصدة الافتتاحية للفرع بنجاح.' : 'The branch opening inventory journal was posted.', 'success');
        } else if (response?.skipped || response?.error === 'OPENING_ALREADY_EXISTS') {
          show(ar ? 'لا توجد قيمة افتتاحية قابلة للترحيل أو يوجد قيد افتتاحي سابق.' : 'No opening value to post, or an opening entry already exists.', 'warning');
        } else {
          show(response?.detail || response?.error || (ar ? 'تعذر ترحيل القيد.' : 'Posting failed.'), 'error');
        }
      }
      setConfirmed(false);
      await load();
    } finally {
      setPosting(false);
    }
  };

  const amount = (value: number | undefined) => formatCurrency(Number(value ?? 0), currency, lang);
  const hasAccess = !!branchId && branches.some((branch) => branch.id === branchId);

  return (
    <DesignSurface testId="opening-balances-page">
      <DesignPageHeader
        title={ar ? 'الأرصدة الافتتاحية' : 'Opening Balances'}
        subtitle={ar
          ? 'مراجعة قيد افتتاح المخزون والمواد الخام لكل فرع، ثم ترحيله مرة واحدة مع الحفاظ على الأرصدة السابقة.'
          : 'Review and post the one-time inventory opening journal by branch without overwriting historical balances.'}
      />

      <DesignPanel testId="opening-balances-branch">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ui-muted">{ar ? 'الفرع الحالي' : 'Active branch'}</p>
            <p className="font-bold text-ui-text">{selectedBranch?.name || (branchesLoading ? (ar ? 'جارٍ التحميل' : 'Loading') : (ar ? 'يرجى اختيار فرع' : 'Select a branch'))}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={APP_ROUTES.accounts} className="rounded-lg border border-ui-border px-3 py-2 text-sm font-semibold text-ui-primary hover:bg-ui-page-alt">
              {ar ? 'دليل الحسابات' : 'Chart of Accounts'}
            </Link>
            <Link to={APP_ROUTES.journal} className="rounded-lg border border-ui-border px-3 py-2 text-sm font-semibold text-ui-primary hover:bg-ui-page-alt">
              {ar ? 'القيود اليومية' : 'Journal'}
            </Link>
          </div>
        </div>
      </DesignPanel>

      {!hasAccess && !branchesLoading && (
        <p role="alert" className="rounded-lg border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
          {ar ? 'اختر فرعًا متاحًا لك من محدد الفروع أعلى التطبيق.' : 'Choose an accessible branch using the selector in the app header.'}
        </p>
      )}

      {loading && <p role="status" className="text-sm text-ui-muted">{ar ? 'جاري قراءة الأرصدة...' : 'Reading opening balances...'}</p>}
      {preview && !preview.success && (
        <p role="alert" className="rounded-lg border border-ui-danger/30 p-4 text-sm text-ui-danger">
          {ar ? 'تعذر قراءة الأرصدة: ' : 'Cannot read balances: '}{preview.error}
        </p>
      )}
      {preview?.success && preview.branch_id === branchId && (
        <>
          <div className="grid gap-4 sm:grid-cols-3" data-testid="opening-balances-values">
            {[
              { title: ar ? 'مخزون المنتجات' : 'Finished goods', value: preview.finished },
              { title: ar ? 'مخزون المواد الخام' : 'Raw materials', value: preview.raw },
              { title: ar ? 'إجمالي القيد المتوقع' : 'Expected journal total', value: preview.total },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
                <p className="text-sm text-ui-muted">{item.title}</p>
                <p className="mt-2 text-xl font-extrabold text-ui-text">{amount(item.value)}</p>
              </div>
            ))}
          </div>

          <DesignPanel testId="opening-balances-posting">
            <div className="flex items-start gap-3">
              {preview.has_opening
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ui-success" />
                : <Warehouse className="mt-0.5 h-5 w-5 shrink-0 text-ui-primary" />}
              <div className="min-w-0 flex-1 space-y-2">
                <h2 className="font-bold text-ui-text">
                  {preview.has_opening
                    ? (ar ? 'تم ترحيل الأرصدة الافتتاحية مسبقًا' : 'Opening journal already posted')
                    : (ar ? 'الأرصدة الافتتاحية لم تُرحّل بعد' : 'Opening journal not yet posted')}
                </h2>
                {preview.opening_entry && (
                  <p className="text-sm text-ui-muted">
                    {ar ? 'القيد: ' : 'Entry: '}{preview.opening_entry.entry_number || preview.opening_entry.id}
                    {' · '}{preview.opening_entry.entry_date}
                  </p>
                )}
                <p className="text-sm leading-6 text-ui-muted">
                  {ar
                    ? 'تعتمد هذه القيم على كميات وتكاليف تشغيلات المخزون الحالية، ويُنشأ قيد مدين للمخزون ودائن لرأس المال. لا تغيّر هذه العملية كميات المخزون، ولا تُستخدم لإدخال أرصدة نقدية أو ذمم افتتاحية.'
                    : 'Amounts are based on current inventory batch quantities and costs. Posting debits inventory and credits capital. It does not change stock quantities or create opening cash or receivables.'}
                </p>
                {!preview.has_opening && !preview.can_post && (
                  <p className="text-sm text-ui-muted">
                    {ar ? 'لا توجد قيمة موجبة قابلة للترحيل. راجع كميات وتكاليف المخزون قبل المتابعة.' : 'There is no positive amount to post. Check inventory quantities and costs first.'}
                  </p>
                )}
                {can('accounts.manage') && preview.can_post && (
                  <div className="space-y-3 pt-2">
                    <label className="flex items-start gap-2 text-sm text-ui-text">
                      <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={posting} />
                      <span>{ar ? 'أؤكد مراجعة قيم الفرع وأوافق على إنشاء القيد الافتتاحي مرة واحدة.' : 'I have reviewed this branch and approve the one-time opening journal.'}</span>
                    </label>
                    <Button onClick={() => void post()} disabled={!confirmed || posting || loading}>
                      {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                      {ar ? 'ترحيل الأرصدة الافتتاحية' : 'Post Opening Balances'}
                    </Button>
                  </div>
                )}
                {!can('accounts.manage') && !preview.has_opening && (
                  <p className="text-sm text-ui-muted">{ar ? 'الترحيل يتطلب صلاحية إدارة الحسابات.' : 'Posting requires accounts management permission.'}</p>
                )}
              </div>
            </div>
          </DesignPanel>
        </>
      )}
      <div className="flex items-start gap-2 text-xs text-ui-muted">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{ar
          ? 'تنبيه: قيد الأرصدة الافتتاحية عملية محاسبية فعلية. راجع الأرقام قبل الترحيل، ولا تستخدمها لتصحيح جرد سابق.'
          : 'Opening entries are real accounting transactions. Review amounts before posting; use the stock count workflow for inventory corrections.'}</span>
      </div>
      <Link to={APP_ROUTES.stockCounts} className="inline-flex items-center gap-2 text-sm font-bold text-ui-primary hover:underline">
        <BookOpenText className="h-4 w-4" /> {ar ? 'انتقل إلى الجرد والتسويات' : 'Go to Stock Counts'}
      </Link>
    </DesignSurface>
  );
}
