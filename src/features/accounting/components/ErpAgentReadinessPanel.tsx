import { useCallback,useEffect,useState } from 'react';
import { Activity,RefreshCw,ShieldAlert } from 'lucide-react';
import { accounting,type ErpAgentReadinessContext } from '@/api/domains/accounting';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import { DesignPanel } from '@/components/design/DesignPanel';
import { Button } from '@/components/Button';

export function ErpAgentReadinessPanel() {
  const can=useCan();
  const {lang}=useLanguage();
  const ar=lang==='ar';
  const {actionBranchId}=useBranchScope();
  const [result,setResult]=useState<ErpAgentReadinessContext|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const allowed=can('accounts.view')&&can('reports.view');

  const load=useCallback(async()=>{
    if(!allowed||!actionBranchId)return;
    setBusy(true);setError('');
    const response=await accounting.getErpAgentReadinessContext({p_branch_id:actionBranchId});
    if(response.error||!response.data?.success){
      setError(response.error?.message||response.data?.error||'Readiness unavailable');
      setResult(null);
    }else setResult(response.data);
    setBusy(false);
  },[allowed,actionBranchId]);
  useEffect(()=>{void load();},[load]);
  if(!allowed)return null;
  const metrics=[
    {key:'journal_lines_with_identity_evidence',ar:'سطور القيود الموثّقة',en:'Journal lines with identity evidence'},
    {key:'unmapped_journal_lines_at_posting',ar:'قيود بلا رابط مؤسسي وقت الترحيل',en:'Unmapped lines at posting'},
    {key:'procurement_receipt_discrepancies',ar:'فروق مستندات استلام المشتريات',en:'Purchase receipt discrepancies'},
    {key:'pending_or_failed_domain_events',ar:'أحداث تحتاج معالجة',en:'Events awaiting processing'},
  ] as const;

  return <DesignPanel
    title={ar?'جاهزية مراقبة ERP والوكلاء':'ERP & Agent Readiness'}
    description={ar
      ?'تشخيص موثّق للقيود والمشتريات والأحداث. القراءة فقط؛ تنفيذ أوامر الوكلاء غير مفعّل.'
      :'Verified accounting, procurement and event diagnostics. Read-only: autonomous agent actions are disabled.'}
    icon={<Activity className="h-5 w-5 text-ui-primary"/>}
    actions={<Button variant="outline" size="sm" disabled={busy||!actionBranchId} onClick={()=>void load()}>
      <RefreshCw className="h-4 w-4"/>{ar?'تحديث':'Refresh'}
    </Button>}
  >
    {error&&<p role="alert" className="mb-3 text-sm text-ui-danger">{error}</p>}
    {!actionBranchId&&<p className="text-sm text-ui-muted">{ar?'اختر فرعًا لعرض التشخيص':'Select a branch to view readiness'}</p>}
    {busy&&<p role="status" className="text-sm text-ui-muted">{ar?'تحميل التشخيص...':'Loading diagnostics...'}</p>}
    {result&&<div className="space-y-3" data-testid="erp-readiness-metrics">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(item=><div key={item.key} className="rounded-lg border border-ui-border bg-ui-page-alt p-4">
          <p className="text-xs text-ui-muted">{ar?item.ar:item.en}</p>
          <p className="mt-2 text-2xl font-bold text-ui-text">{Number(result[item.key]??0).toLocaleString(ar?'ar-EG':'en-US')}</p>
        </div>)}
      </div>
      <div className="flex items-start gap-2 text-xs text-ui-muted">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0"/>
        <span>{ar?'الأولوية المقترحة للمراجعة':'Suggested review priority'}: {result.next_review||'—'}.
          {' '}{ar?'هذا عرض بيانات محكوم وليس وكيلًا ينفذ تغييرات مالية.':'This is a governed data view, not an agent executing financial changes.'}</span>
      </div>
    </div>}
  </DesignPanel>;
}
