import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Link2, CheckCircle2 } from 'lucide-react';
import { accounting, type OrgAccountSyncFields, type OrgAccountSyncCandidate, type OrgAccountSyncRequest, type OrgAccountSyncWorkbench } from '@/api/domains/accounting';
import { DesignPanel } from '@/components/design/DesignPanel';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';

const FIELDS: Array<keyof OrgAccountSyncFields> = [
  'code','name','name_en','account_type','is_system','is_active',
];
const FIELD_AR: Record<keyof OrgAccountSyncFields,string> = {
  code:'الرمز',name:'الاسم',name_en:'الاسم الإنجليزي',
  account_type:'النوع',is_system:'حساب نظام',is_active:'نشط',
};
const FIELD_EN: Record<keyof OrgAccountSyncFields,string> = {
  code:'Code',name:'Name',name_en:'English name',
  account_type:'Type',is_system:'System account',is_active:'Active',
};
const pretty = (value: unknown, ar: boolean): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (value === true) return ar ? 'نعم' : 'Yes';
  if (value === false) return ar ? 'لا' : 'No';
  return String(value);
};
function AccountComparison({ proposed, current, master, ar }: {
  proposed: OrgAccountSyncFields | null;
  current: OrgAccountSyncFields | null;
  master: OrgAccountSyncFields | null;
  ar: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ui-border" data-testid="organization-account-compare">
      <table className="w-full min-w-[540px] text-sm">
        <thead className="bg-ui-page-alt text-ui-muted">
          <tr>
            <th className="p-3 text-start">{ar ? 'الحقل' : 'Field'}</th>
            <th className="p-3 text-start">{ar ? 'وقت الطلب' : 'Proposed snapshot'}</th>
            <th className="p-3 text-start">{ar ? 'الحساب الحالي بالفرع' : 'Live branch account'}</th>
            <th className="p-3 text-start">{ar ? 'الحساب المؤسسي' : 'Organization shadow'}</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(field => {
            const changed = proposed?.[field] !== current?.[field];
            const differsFromMaster = current?.[field] !== master?.[field];
            return (
              <tr key={field} className="border-t border-ui-border">
                <th className="p-3 text-start font-medium text-ui-text">{(ar ? FIELD_AR : FIELD_EN)[field]}</th>
                <td className="p-3 text-ui-muted">{pretty(proposed?.[field],ar)}</td>
                <td className={`p-3 ${changed ? 'font-semibold text-ui-danger' : 'text-ui-text'}`}>
                  {pretty(current?.[field],ar)}
                </td>
                <td className={`p-3 ${differsFromMaster ? 'font-semibold text-ui-warning' : 'text-ui-text'}`}>
                  {pretty(master?.[field],ar)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** UI is informational; all permissions, tenant isolation and source revalidation are enforced by database RPCs. */
export function OrganizationAccountSyncWorkbench() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const { user } = useAuth();
  const { show } = useToast();
  const [workbench,setWorkbench] = useState<OrgAccountSyncWorkbench | null>(null);
  const [organization,setOrganization] = useState('');
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [loadError,setLoadError] = useState('');
  const [candidate,setCandidate] = useState<OrgAccountSyncCandidate | null>(null);
  const [selectedId,setSelectedId] = useState<string | null>(null);
  const [reason,setReason] = useState('');
  const [reviewNote,setReviewNote] = useState('');
  const [statusFilter,setStatusFilter] = useState('ALL');

  const canManage = can('accounts.manage');
  const canReview = canManage && can('approvals.review') && Boolean(workbench?.can_review);
  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setLoadError('');
    const { data,error } = await accounting.getOrganizationAccountSyncWorkbench({
      p_organization_id:organization || null,p_limit:100,
    });
    if (error || !data?.success) {
      const message = error?.message || data?.error || 'Unable to load organization account review';
      setLoadError(message);
      setWorkbench(null);
    } else {
      setWorkbench(data);
    }
    setLoading(false);
  },[canManage,organization]);

  useEffect(() => { void load(); },[load]);

  const selected = workbench?.requests?.find(r => r.id === selectedId) ?? null;
  const requests = (workbench?.requests ?? []).filter(r => statusFilter === 'ALL' || r.status === statusFilter);
  const candidates = workbench?.candidates ?? [];
  const existingPending = candidate && workbench?.requests?.some(
    r => r.branch_account_id===candidate.branch_account_id && r.status==='PENDING'
  );

  const submitRequest = async () => {
    if (!candidate || busy || candidate.plan_status!=='READY' || reason.trim().length<3) return;
    setBusy(true);
    try {
      const { data,error } = await accounting.requestOrganizationAccountSync({
        p_branch_account_id:candidate.branch_account_id,p_reason:reason.trim(),
      });
      if (error || !data?.success) show(error?.message || data?.error || 'Request failed','error');
      else {
        show(ar ? 'تم تقديم طلب المزامنة للمراجعة' : 'Sync request sent for review','success');
        setCandidate(null);setReason('');
        await load();
      }
    } finally { setBusy(false); }
  };

  const decide = async (item: OrgAccountSyncRequest, approve: boolean) => {
    if (busy || !canReview || item.requester_id===user?.id ||
      (approve && item.stale) || reviewNote.trim().length<3) return;
    const confirmed = window.confirm(approve
      ? (ar ? 'تأكيد اعتماد مزامنة الحساب المؤسسي بعد مراجعة الفروق؟' : 'Approve organization shadow sync after reviewing the differences?')
      : (ar ? 'تأكيد رفض طلب المزامنة؟' : 'Reject this synchronization request?'));
    if (!confirmed) return;
    setBusy(true);
    try {
      const { data,error } = await accounting.decideOrganizationAccountSync({
        p_request_id:item.id,p_approve:approve,p_note:reviewNote.trim(),
      });
      if (error || !data?.success) show(error?.message || data?.error || 'Decision failed','error');
      else {
        show(approve ? (ar ? 'تم اعتماد المزامنة' : 'Synchronization approved')
          : (ar ? 'تم رفض المزامنة' : 'Synchronization rejected'),'success');
        setReviewNote('');
        await load();
      }
    } finally {setBusy(false);}
  };

  if (!canManage) return null;
  return (
    <div className="space-y-4" data-testid="organization-account-sync-workbench">
      <DesignPanel
        title={ar ? 'مراجعة مزامنة الحسابات المؤسسية' : 'Organization Account Sync Review'}
        description={ar
          ? 'طلبات منفصلة للمزامنة بموافقة شخصين. لا تُغيّر أي قيود مُرحّلة أو حسابات الفروع الأصلية.'
          : 'Two-person approved shadow chart synchronization. Posted journals and original branch accounts are unchanged.'}
        icon={<ShieldCheck className="h-5 w-5 text-ui-primary" />}
        actions={<Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />{ar ? 'تحديث' : 'Refresh'}
        </Button>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="coa-sync-organization" className="text-sm font-medium text-ui-text">
            {ar ? 'المؤسسة' : 'Organization'}
          </label>
          <select id="coa-sync-organization" value={organization}
            onChange={e => {setOrganization(e.target.value);setSelectedId(null);setCandidate(null);}}
            className="min-h-10 rounded-lg border border-ui-border bg-ui-surface p-2 text-sm text-ui-text">
            <option value="">{ar ? 'المؤسسات المصرّح بها' : 'Authorized organizations'}</option>
            {(workbench?.organizations ?? []).map(o =>
              <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="ms-auto text-xs text-ui-muted">
            {ar ? 'عرض أول 100 نتيجة لكل قسم' : 'Showing up to 100 per section'}
          </span>
        </div>
        {loading && <p role="status" className="mt-3 text-sm text-ui-muted">{ar ? 'جارِ التحميل...' : 'Loading...'}</p>}
        {loadError && <p role="alert" className="mt-3 text-sm text-ui-danger">{loadError}</p>}
        {!loading && !loadError && <p className="mt-3 text-xs text-ui-muted">
          {ar
            ? 'يعرض النظام فقط المؤسسات التي تملك صلاحية الوصول إلى جميع فروعها؛ يُعاد التحقق من جميع البيانات عند الاعتماد.'
            : 'Only fully authorized organizations are shown. All source data and permissions are rechecked during approval.'}
        </p>}
      </DesignPanel>

      <DesignPanel title={ar ? 'الحسابات التي تحتاج مراجعة' : 'Account Changes Requiring Review'}
        description={ar ? 'الحسابات الجديدة والفروق في تعريف الحسابات المؤسسية.' : 'New accounts and definition differences in the organization shadow.'}>
        {candidates.length===0 ? <p className="p-4 text-sm text-ui-muted" data-testid="coa-no-candidates">
          {ar ? 'لا توجد حسابات تحتاج مزامنة حالياً.' : 'No accounts currently require synchronization.'}
        </p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ui-border text-ui-muted">
                <th className="p-3 text-start">{ar ? 'المؤسسة / الفرع' : 'Organization / Branch'}</th>
                <th className="p-3 text-start">{ar ? 'الحساب' : 'Account'}</th>
                <th className="p-3 text-start">{ar ? 'الحالة' : 'Status'}</th>
                <th className="p-3 text-start">{ar ? 'المراجعة' : 'Review'}</th>
              </tr></thead>
              <tbody>{candidates.map(row => <tr key={row.branch_account_id} className="border-b border-ui-border">
                <td className="p-3 text-ui-text">{row.organization_name}<span className="block text-xs text-ui-muted">{row.branch_name}</span></td>
                <td className="p-3 text-ui-text"><span className="font-mono">{row.code}</span><span className="block text-xs">{row.source.name}</span></td>
                <td className="p-3 text-ui-muted">{row.mapping_status}<span className="block">{row.plan_status}</span></td>
                <td className="p-3"><Button size="sm" variant="outline" onClick={() => {
                  setCandidate(row);setSelectedId(null);setReason('');
                }}>{ar ? 'عرض الفروق' : 'Compare'}</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {candidate && <div className="mt-5 space-y-3 rounded-xl border border-ui-border bg-ui-page-alt p-4" data-testid="coa-candidate-detail">
          <h3 className="font-semibold text-ui-text">{candidate.code} — {candidate.branch_name}</h3>
          <AccountComparison ar={ar} proposed={null} current={candidate.source} master={candidate.master}/>
          {candidate.plan_status !== 'READY' && <p role="alert" className="flex items-center gap-2 text-sm text-ui-danger">
            <AlertTriangle className="h-4 w-4"/>{ar ? 'هذا التغيير يتطلب مراجعة تقنية؛ لا يمكن إرساله تلقائياً.' : 'This change requires manual technical review and cannot be submitted.'}
          </p>}
          {existingPending && <p className="text-sm text-ui-muted">{ar ? 'لهذا الحساب طلب معلق بالفعل.' : 'An approval request is already pending for this account.'}</p>}
          <label className="block text-sm font-medium text-ui-text" htmlFor="coa-request-reason">
            {ar ? 'سبب طلب المزامنة (ثلاثة أحرف على الأقل)' : 'Reason for synchronization (at least 3 characters)'}
          </label>
          <textarea id="coa-request-reason" className="w-full rounded-lg border border-ui-border bg-ui-surface p-2 text-ui-text"
            rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={() => void submitRequest()} disabled={busy || loading || !!existingPending ||
              candidate.plan_status !== 'READY' || reason.trim().length<3}>
              <Link2 className="h-4 w-4" />{ar ? 'إرسال للموافقة' : 'Submit for approval'}
            </Button>
            <Button variant="ghost" onClick={() => setCandidate(null)}>{ar ? 'إغلاق' : 'Close'}</Button>
          </div>
        </div>}
      </DesignPanel>

      <DesignPanel title={ar ? 'طلبات الاعتماد وسجل القرارات' : 'Approval Queue and Decision History'}
        description={ar ? 'كل طلب يتضمن نسخة وقت التقديم والحالة الحالية ونتيجة المراجعة.' : 'Each request contains its frozen proposal, live state and decision outcome.'}>
        <div className="mb-3 flex items-center gap-3">
          <label htmlFor="coa-sync-status" className="text-sm text-ui-text">{ar ? 'الحالة' : 'Status'}</label>
          <select id="coa-sync-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-ui-border bg-ui-surface p-2 text-sm text-ui-text">
            <option value="ALL">{ar ? 'الكل' : 'All'}</option>
            {['PENDING','APPLIED','REJECTED','STALE','EXPIRED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {requests.length===0 ? <p className="p-4 text-sm text-ui-muted" data-testid="coa-no-requests">
          {ar ? 'لا توجد طلبات في هذه الحالة.' : 'No requests in this status.'}
        </p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ui-border text-ui-muted">
                <th className="p-3 text-start">{ar ? 'الطلب' : 'Request'}</th>
                <th className="p-3 text-start">{ar ? 'مقدم الطلب' : 'Requester'}</th>
                <th className="p-3 text-start">{ar ? 'الحالة' : 'Status'}</th>
                <th className="p-3 text-start">{ar ? 'التفاصيل' : 'Details'}</th>
              </tr></thead>
              <tbody>{requests.map(r => <tr key={r.id} className="border-b border-ui-border">
                <td className="p-3 text-ui-text">{r.proposed?.code || '—'}
                  <span className="block text-xs text-ui-muted">{r.branch_name} · {r.operation}</span></td>
                <td className="p-3 text-ui-text">{r.requester_name || '—'}
                  <span className="block text-xs text-ui-muted">{new Date(r.created_at).toLocaleString(ar ? 'ar-EG' : 'en-US')}</span></td>
                <td className="p-3 text-ui-text">{r.status}
                  {r.status==='PENDING' && r.stale && <span className="block text-xs text-ui-danger">
                    {ar ? 'انتهت الصلاحية أو تغيرت البيانات' : 'Expired or source changed'}</span>}
                </td>
                <td className="p-3"><Button variant="outline" size="sm" onClick={() => {
                  setSelectedId(r.id);setCandidate(null);setReviewNote('');
                }}>{ar ? 'مراجعة' : 'Review'}</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {selected && <div className="mt-5 space-y-3 rounded-xl border border-ui-border bg-ui-page-alt p-4" data-testid="coa-review-detail">
          <div className="flex items-center gap-2 text-ui-text">
            <CheckCircle2 className="h-4 w-4 text-ui-primary"/>
            <h3 className="font-semibold">{selected.proposed.code} — {selected.organization_name} / {selected.branch_name}</h3>
          </div>
          <p className="text-sm text-ui-muted">{ar ? 'سبب الطلب:' : 'Request reason:'} {selected.request_reason}</p>
          <AccountComparison ar={ar} proposed={selected.proposed} current={selected.source} master={selected.master}/>
          {selected.status==='PENDING' && <p className={`text-sm ${selected.stale ? 'text-ui-danger' : 'text-ui-muted'}`}>
            {selected.stale ? (ar ? 'بيانات الطلب غير صالحة للاعتماد ويجب تقديم طلب جديد.' : 'The source has changed or the request has expired. Do not approve.')
              : (ar ? 'سيعيد الخادم فحص الحساب والصلاحيات لحظة الاعتماد.' : 'The server will revalidate the account and permissions at approval.')}
          </p>}
          {selected.status!=='PENDING' && <p className="text-sm text-ui-muted">
            {ar ? 'القرار:' : 'Decision:'} {selected.status} · {selected.reviewer_name || '—'}
            {selected.review_note ? ` — ${selected.review_note}` : ''}
          </p>}
          {selected.status==='PENDING' && canReview && user?.id!==selected.requester_id && <>
            <label htmlFor="coa-review-note" className="block text-sm font-medium text-ui-text">
              {ar ? 'ملاحظة الاعتماد أو الرفض (ثلاثة أحرف على الأقل)' : 'Review note (at least 3 characters)'}
            </label>
            <textarea id="coa-review-note" className="w-full rounded-lg border border-ui-border bg-ui-surface p-2 text-ui-text"
              value={reviewNote} rows={2} maxLength={500} onChange={e=>setReviewNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="success" disabled={busy || loading || selected.stale || reviewNote.trim().length<3}
                onClick={() => void decide(selected,true)}>
                {ar ? 'اعتماد وتنفيذ المزامنة' : 'Approve and apply'}
              </Button>
              <Button variant="danger" disabled={busy || loading || reviewNote.trim().length<3}
                onClick={() => void decide(selected,false)}>
                {ar ? 'رفض الطلب' : 'Reject request'}
              </Button>
            </div>
          </>}
          {selected.status==='PENDING' && user?.id===selected.requester_id && <p className="text-sm text-ui-muted">
            {ar ? 'لا يمكنك اعتماد طلب قدمته بنفسك.' : 'You cannot approve your own request.'}
          </p>}
          <Button variant="ghost" onClick={() => setSelectedId(null)}>{ar ? 'إغلاق' : 'Close'}</Button>
        </div>}
      </DesignPanel>
    </div>
  );
}
