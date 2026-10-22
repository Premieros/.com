import { useEffect, useRef, useState } from 'react';
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
  super_admins_preserved?: number;
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
    OPERATIONAL_HISTORY_PRESENT: ['توجد معاملات تشغيلية قديمة، ولكنها لا تمنع الحذف الشامل.', 'Operational history exists, but it does not prohibit full tenant deletion.'],
    CROSS_ORGANIZATION_DEPENDENCIES: ['توجد بيانات متصلة بمؤسسة أخرى؛ الحذف موقوف لحمايتها.', 'Some records are linked to another organization. Deletion is stopped to protect them.'],
    CROSS_ORGANIZATION_MEMBERSHIP: ['توجد عضوية مستخدم في مؤسسة أخرى.', 'A user is also a member of another organization.'],
    CROSS_ORGANIZATION_USER_ACCESS: ['توجد صلاحيات وصول على فرع مؤسسة أخرى.', 'A user has access to a branch outside this organization.'],
    CROSS_ORGANIZATION_WAREHOUSE_TRANSFER: ['توجد تحويلات مخزنية مرتبطة بفروع خارج المؤسسة.', 'A warehouse transfer references a branch outside the organization.'],
    CROSS_ORGANIZATION_TREASURY_TRANSFER: ['توجد تحويلات مالية مرتبطة بفروع خارج المؤسسة.', 'A financial transfer references another organization.'],
    CROSS_OR_UNSCOPED_USER_REFERENCE: ['توجد سجلات مستخدم مرتبطة بجهة أخرى أو غير محددة النطاق.', 'A user has references outside this organization or with ambiguous scope.'],
    RESTRICTED_DEPENDENCY: ['توجد سجلات ذات علاقات محمية تمنع الحذف.', 'Protected dependent records prevent deletion.'],
  };
  const label = labels[code]?.[ar ? 0 : 1] ?? code;
  return typeof blocker === 'string' ? label :
    `${label}${blocker.table ? ` (${blocker.table}: ${blocker.count ?? '?'})` : ''}`;
};

type DeletionJob = {
  success?: boolean;
  job_id?: string;
  status?: 'none' | 'queued' | 'claimed' | 'succeeded' | 'failed';
  error?: string;
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
  const [job, setJob] = useState<DeletionJob | null>(null);
  const completedJobRef = useRef<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setJob(null);
    completedJobRef.current = null;
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
    void admin.organizationDeletionStatus({ p_organization_id: target.organization_id })
      .then(({ data, error }) => {
        if (!cancelled && !error && data?.success) setJob(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [target?.organization_id]);

  // Cron runs on the server. Closing/reopening the dialog does not stop it.
  // Polling provides the current queued / running / complete state.
  useEffect(() => {
    if (!target?.organization_id || (job?.status !== 'queued' && job?.status !== 'claimed')) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const { data, error } = await admin.organizationDeletionStatus({
          p_organization_id: target.organization_id,
        });
        if (cancelled || error || !data?.success) return;
        setJob(data);
        if (data.status === 'succeeded' && data.job_id && completedJobRef.current !== data.job_id) {
          completedJobRef.current = data.job_id;
          show(lang === 'ar' ? 'اكتمل حذف المؤسسة وبياناتها بنجاح.' : 'The organization and its records have been deleted.', 'success');
          onDeleted();
        }
      } catch {
        // Keep the last known job state and poll again; never infer deletion.
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [target?.organization_id, job?.status, lang, onDeleted, show]);

  if (!target) return null;

  const jobPending = job?.status === 'queued' || job?.status === 'claimed';
  const permitted = preview?.success && preview.eligible && !jobPending &&
    name === target.organization_name && phrase === 'DELETE' && acknowledged && !loading && !deleting;

  const deleteOrganization = async () => {
    if (!permitted) return;
    setDeleting(true);
    try {
      const { data, error } = await admin.queueOrganizationDeletion({
        p_organization_id: target.organization_id,
        p_confirm_name: name,
        p_confirm_phrase: phrase,
      });
      if (error || !data?.success) {
        if (data?.preview) setPreview(data.preview);
        throw error || new Error(data?.error || 'DELETE_BLOCKED');
      }
      setJob(data);
      show(ar ? 'تم استلام طلب الحذف. ستُنفَّذ العملية على الخادم ويمكنك متابعة حالتها هنا.' : 'Deletion was queued. The server will process it and this dialog will show the result.', 'success');
    } catch (cause) {
      const error = cause && typeof cause === 'object'
        ? cause as { code?: string; message?: string }
        : null;
      const timedOut = error?.code === '57014' ||
        /statement timeout|canceling statement due to statement timeout/i.test(error?.message ?? '');
      show(timedOut
        ? (ar
            ? 'انتهت مهلة تنفيذ الحذف في قاعدة البيانات. لم يُؤكَّد حذف المؤسسة؛ تحقق من حالتها قبل إعادة المحاولة.'
            : 'Database deletion timed out. The organization was not confirmed deleted; verify its status before retrying.')
        : (ar
            ? 'تعذر الحذف. لم يتم تأكيد أي حذف؛ راجع التبعيات وأعد الفحص.'
            : 'Deletion was blocked. Review dependencies and run the preview again.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={() => { if (!deleting) onClose(); }}
      title={ar ? 'حذف المؤسسة وجميع بياناتها' : 'Permanently delete organization and all data'}
      size="md"
    >
      <div className="space-y-4" data-testid="organization-delete-dialog">
        <div className="flex gap-3 rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-3 text-ui-text">
          <AlertTriangle className="h-5 w-5 shrink-0 text-ui-danger" />
          <div className="text-xs leading-6">
            <p className="font-black text-ui-danger">{ar ? 'حذف نهائي لا يمكن التراجع عنه' : 'Permanent and irreversible deletion'}</p>
            <p>{ar
              ? 'سيحذف هذا الإجراء جميع بيانات المؤسسة المختارة، حتى لو كانت نشطة: الفروع، المستخدمين، المبيعات، المخزون، القيود والمحادثات. حسابات Super Admin المستقلة وبيانات المؤسسات الأخرى محمية. لا يمكن التراجع عن الحذف.'
              : 'This deletes ALL data in the selected organization, even if active: branches, users, sales, inventory, accounts and chats. Global Super Admins and other tenants are protected. This cannot be undone.'}</p>
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
              <span>{ar ? 'مديرو النظام المحميون' : 'Protected platform admins'}: {preview.super_admins_preserved ?? '-'}</span>
            </div>
          )}
        </div>

        {job && job.status !== 'none' && (
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs" role="status" data-testid="organization-delete-job-status">
            <p className="font-bold text-ui-text">
              {job.status === 'queued'
                ? (ar ? 'طلب الحذف في قائمة الانتظار' : 'Deletion queued')
                : job.status === 'claimed'
                  ? (ar ? 'جارٍ تنفيذ الحذف في قاعدة البيانات' : 'Server is deleting the organization')
                  : job.status === 'succeeded'
                    ? (ar ? 'اكتمل الحذف بنجاح' : 'Deletion completed')
                    : (ar ? 'فشلت عملية الحذف' : 'Deletion failed')}
            </p>
            {(job.status === 'queued' || job.status === 'claimed') && (
              <p className="mt-1 text-ui-muted">
                {ar ? 'يمكنك إغلاق النافذة والعودة لاحقًا. لا تُعد إرسال طلب الحذف.' : 'You can close this dialog and return later. Do not submit a duplicate deletion.'}
              </p>
            )}
            {job.status === 'failed' && (
              <p className="mt-1 text-ui-danger">
                {ar ? 'سبب الفشل' : 'Error'}: {job.error || (ar ? 'لم يكتمل الحذف' : 'Deletion did not complete')}
              </p>
            )}
          </div>
        )}

        {preview && (!preview.success || !preview.eligible) && (
          <div className="rounded-xl border border-ui-danger/30 p-3 text-xs text-ui-danger" role="alert">
            <p className="font-bold">{ar ? 'الحذف موقوف لحماية بيانات مشتركة مع مؤسسة أخرى:' : 'Deletion is blocked to protect shared records:'}</p>
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
              <span>{ar ? 'أؤكد أنني اخترت المؤسسة الصحيحة، وأن حذف جميع فروعها ومستخدميها ومبيعاتها ومحاسبتها نهائي ولا يمكن التراجع عنه.' : 'I confirm the selected organization and accept permanent deletion of all its branches, users, sales and accounting data.'}</span>
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
            {jobPending ? (ar ? 'الحذف قيد التنفيذ' : 'Deletion in progress') : (ar ? 'طلب الحذف النهائي' : 'Request permanent deletion')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
