import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { admin } from '@/api';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';

export interface DeletableOrganization {
  organization_id: string;
  organization_name: string;
  is_active: boolean;
}

type DeletionPreview = {
  success?: boolean;
  eligible?: boolean;
  error?: string;
  organization_name?: string;
  branches?: number;
  users?: number;
  operational_documents?: number;
  blockers?: Array<string | { code: string; table?: string; count?: number }>;
};

const displayBlocker = (blocker: string | { code: string; table?: string; count?: number }, ar: boolean) => {
  const code = typeof blocker === 'string' ? blocker : blocker.code;
  const labels: Record<string, [string, string]> = {
    ORGANIZATION_ACTIVE: ['المؤسسة نشطة. يجب تعطيلها أولًا.', 'Organization is active. Disable it first.'],
    LAST_ORGANIZATION: ['لا يمكن حذف آخر مؤسسة في النظام.', 'Cannot delete the last organization.'],
    CURRENT_USER_BELONGS_TO_ORGANIZATION: ['حسابك داخل المؤسسة المحددة.', 'Your own account belongs to this organization.'],
    PROTECTED_SUPER_ADMIN_USER: ['تحتوي على مستخدم مدير عام محمي.', 'Contains a protected Super Admin account.'],
    SHARED_ORGANIZATION_MEMBER: ['يوجد مستخدمون مرتبطون بمؤسسة أخرى.', 'Some users belong to another organization.'],
    USER_WITH_CROSS_ORGANIZATION_BRANCH_ACCESS: ['توجد صلاحيات مستخدمين على فروع أخرى.', 'Some users have access to other organizations.'],
    CROSS_ORGANIZATION_STOCK_TRANSFER: ['توجد تحويلات مرتبطة بمؤسسة أخرى.', 'Cross-organization transfer detected.'],
    OPERATIONAL_HISTORY_PRESENT: ['تحتوي على معاملات تشغيلية أو مالية ويُمنع حذفها تلقائيًا.', 'Has financial or operational history and cannot be automatically deleted.'],
    RESTRICTED_DEPENDENCY: ['توجد سجلات ذات علاقات محمية تمنع الحذف.', 'Protected dependent records prevent deletion.'],
  };
  const label = labels[code]?.[ar ? 0 : 1] ?? code;
  return typeof blocker === 'string' ? label :
    `${label}${blocker.table ? ` (${blocker.table}: ${blocker.count ?? '?'})` : ''}`;
};

export function OrganizationDeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: DeletableOrganization | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { lang } = useLanguage();
  const { show } = useToast();
  const ar = lang === 'ar';
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setPreview(null);
    setName('');
    setPhrase('');
    setAcknowledged(false);
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    void admin.previewOrganizationDeletion({ p_organization_id: target.organization_id })
      .then(({ data, error }) => {
        if (cancelled) return;
        setPreview(error ? { success: false, error: 'PREVIEW_FAILED' } : data);
      })
      .catch(() => { if (!cancelled) setPreview({ success: false, error: 'PREVIEW_FAILED' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target?.organization_id]);

  if (!target) return null;

  const permitted = !target.is_active && preview?.success && preview.eligible &&
    name === target.organization_name && phrase === 'DELETE' && acknowledged && !loading && !deleting;

  const deleteOrganization = async () => {
    if (!permitted) return;
    setDeleting(true);
    try {
      const { data, error } = await admin.deleteEmptyOrganization({
        p_organization_id: target.organization_id,
        p_confirm_name: name,
        p_confirm_phrase: phrase,
      });
      if (error || !data?.success) {
        if (data?.preview) setPreview(data.preview);
        throw error || new Error(data?.error || 'DELETE_BLOCKED');
      }
      show(ar ? 'تم حذف المؤسسة التجريبية وبياناتها المؤهلة بنجاح' : 'The eligible test organization was permanently deleted', 'success');
      onDeleted();
    } catch {
      show(ar ? 'تعذر الحذف. لم يتم تأكيد أي حذف؛ راجع التبعيات وأعد الفحص.' : 'Deletion was blocked. Review dependencies and run the preview again.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={() => { if (!deleting) onClose(); }}
      title={ar ? 'حذف مؤسسة تجريبية وبياناتها نهائيًا' : 'Permanently delete test organization'}
      size="md"
    >
      <div className="space-y-4" data-testid="organization-delete-dialog">
        <div className="flex gap-3 rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-3 text-ui-text">
          <AlertTriangle className="h-5 w-5 shrink-0 text-ui-danger" />
          <div className="text-xs leading-6">
            <p className="font-black text-ui-danger">{ar ? 'حذف نهائي لا يمكن التراجع عنه' : 'Permanent and irreversible deletion'}</p>
            <p>{ar
              ? 'يُسمح فقط للمؤسسات غير النشطة التي لا تحتوي على معاملات مالية أو تشغيلية. سيُحذف سجل المؤسسة وفروعها وإعداداتها وحسابات مستخدميها المخصصة.'
              : 'Only inactive organizations without operational or financial transactions are eligible. Their organization, branches, setup data and dedicated user accounts will be removed.'}</p>
          </div>
        </div>

        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm">
          <p className="font-bold">{target.organization_name}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-ui-subtle">{target.organization_id}</p>
          {loading && <p className="mt-2 flex items-center gap-2 text-xs text-ui-muted"><Loader2 className="h-4 w-4 animate-spin" />{ar ? 'فحص البيانات والعلاقات...' : 'Checking records and dependencies...'}</p>}
          {preview?.success && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ui-muted">
              <span>{ar ? 'الفروع' : 'Branches'}: {preview.branches ?? '-'}</span>
              <span>{ar ? 'المستخدمون' : 'Users'}: {preview.users ?? '-'}</span>
              <span>{ar ? 'المعاملات' : 'Transactions'}: {preview.operational_documents ?? '-'}</span>
            </div>
          )}
        </div>

        {preview && (!preview.success || !preview.eligible) && (
          <div className="rounded-xl border border-ui-danger/30 p-3 text-xs text-ui-danger" role="alert">
            <p className="font-bold">{ar ? 'الحذف محظور حاليًا للأسباب التالية:' : 'Deletion is blocked for the following reasons:'}</p>
            {preview.blockers?.map((b, i) => <p key={i} className="mt-1">• {displayBlocker(b, ar)}</p>)}
            {!preview.success && <p className="mt-1">{preview.error || 'PREVIEW_FAILED'}</p>}
          </div>
        )}

        {preview?.eligible && (
          <>
            <label className="block text-xs font-bold text-ui-text">
              {ar ? 'اكتب اسم المؤسسة كما يظهر حرفيًا' : 'Type the exact organization name'}
              <input
                data-testid="organization-delete-confirm-name"
                className="mt-1 min-h-11 w-full rounded-lg border border-ui-border bg-ui-page px-3 text-sm text-ui-text"
                value={name} onChange={(e) => setName(e.target.value)}
                autoComplete="off" disabled={deleting}
              />
            </label>
            <label className="block text-xs font-bold text-ui-text">
              {ar ? 'اكتب DELETE للتأكيد' : 'Type DELETE to confirm'}
              <input
                data-testid="organization-delete-confirm-phrase"
                className="mt-1 min-h-11 w-full rounded-lg border border-ui-border bg-ui-page px-3 font-mono text-sm text-ui-text"
                value={phrase} onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off" disabled={deleting}
              />
            </label>
            <label className="flex items-start gap-2 text-xs text-ui-text">
              <input type="checkbox" checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                disabled={deleting} className="mt-0.5" />
              <span>{ar ? 'أقر أن حذف هذه المؤسسة وبياناتها نهائي وغير قابل للاستعادة من داخل التطبيق.' : 'I understand this is permanent and cannot be undone in the app.'}</span>
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-ui-border pt-3">
          <Button variant="outline" disabled={deleting} onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</Button>
          <Button
            variant="danger"
            data-testid="organization-delete-confirm"
            disabled={!permitted}
            onClick={() => void deleteOrganization()}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {ar ? 'حذف المؤسسة نهائيًا' : 'Permanently delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
