import type { ApiResult, JournalLineInput } from '../types';
import type { RpcResult, TreasuryBalance, TreasurySource, TrialBalanceRow, JournalDto, ArAgingRow, ApAgingRow, ReconciliationDetail } from '@/lib/types';
import { rpc } from '../rpc';

export type AccountingPeriodStatus = 'OPEN' | 'SOFT_CLOSED' | 'CLOSED';

export type AccountingPeriodStatusResult = RpcResult & {
  period_id?: string;
  previous_status?: AccountingPeriodStatus;
  status?: AccountingPeriodStatus;
  already_set?: boolean;
};

export type ReverseJournalResult = RpcResult & {
  entry_id?: string;
  entry_number?: string;
  reversal_entry_id?: string;
  reversal_entry_number?: string;
  reversal_date?: string;
  already_reversed?: boolean;
};

export type OrgAccountSyncFields = {
  code: string;
  name: string;
  name_en: string | null;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

export type OrgAccountSyncRequest = {
  id: string;
  organization_id: string;
  organization_name: string;
  branch_id: string;
  branch_name: string;
  branch_account_id: string;
  operation: 'LINK_NEW' | 'REFRESH_LABELS';
  status: 'PENDING' | 'APPLIED' | 'REJECTED' | 'STALE' | 'EXPIRED';
  request_reason: string;
  requester_id: string;
  requester_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_note: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  applied_at: string | null;
  proposed: OrgAccountSyncFields & { master_id?: string | null; operation?: string };
  source: OrgAccountSyncFields | null;
  master: OrgAccountSyncFields | null;
  live_plan_status: string | null;
  stale: boolean;
};
export type OrgAccountSyncCandidate = {
  branch_account_id: string;
  branch_id: string;
  branch_name: string;
  organization_id: string;
  organization_name: string;
  code: string;
  mapping_status: string;
  plan_status: string;
  operation: 'LINK_NEW' | 'REFRESH_LABELS' | null;
  source: OrgAccountSyncFields;
  master: OrgAccountSyncFields | null;
};
export type OrgAccountSyncWorkbench = {
  success: boolean;
  error?: string;
  organizations?: Array<{ id: string; name: string }>;
  requests?: OrgAccountSyncRequest[];
  candidates?: OrgAccountSyncCandidate[];
  limit?: number;
  can_review?: boolean;
  shadow_only?: boolean;
};
export type OrgAccountSyncActionResult = {
  success: boolean;
  error?: string;
  request_id?: string;
  status?: string;
  operation?: string;
  organization_account_id?: string;
};

export type ErpAgentReadinessContext = {
  success: boolean;
  error?: string;
  organization_id?: string;
  branch_id?: string;
  read_only?: boolean;
  agent_execution_enabled?: boolean;
  journal_lines_with_identity_evidence?: number;
  unmapped_journal_lines_at_posting?: number;
  procurement_receipt_discrepancies?: number;
  pending_or_failed_domain_events?: number;
  domain_events_created_since_activation?: number;
  next_review?: 'ACCOUNT_MAPPING_REVIEW' | 'PURCHASE_RECEIPT_REVIEW' | 'EVENT_PROCESSING_REVIEW' | 'NO_BLOCKING_ISSUES';
};

export const accounting = {
  getErpAgentReadinessContext(p: { p_branch_id: string }): ApiResult<ErpAgentReadinessContext> {
    return rpc('get_erp_agent_readiness_context_v2', p);
  },
  getOrganizationAccountSyncWorkbench(p: { p_organization_id: string | null; p_limit: number }): ApiResult<OrgAccountSyncWorkbench> {
    return rpc('get_organization_account_sync_workbench_v2',p);
  },
  requestOrganizationAccountSync(p: { p_branch_account_id: string; p_reason: string }): ApiResult<OrgAccountSyncActionResult> {
    return rpc('request_organization_account_sync_v2',p);
  },
  decideOrganizationAccountSync(p: { p_request_id: string; p_approve: boolean; p_note: string | null }): ApiResult<OrgAccountSyncActionResult> {
    return rpc('decide_organization_account_sync_v2',p);
  },
  postShiftExpense(p: {
    p_idempotency_key: string;
    p_branch_id: string;
    p_shift_id: string;
    p_category: string;
    p_description: string | null;
    p_amount: number;
    p_payment_method: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_expense_date: string;
    p_notes: string | null;
  }): ApiResult<RpcResult & { expense_id?: string; journal_entry_id?: string; already_posted?: boolean }> {
    return rpc('post_shift_expense', p);
  },
  reverseShiftExpense(p: { p_expense_id: string; p_reason: string }): ApiResult<RpcResult & { journal_entry_id?: string; already_reversed?: boolean }> {
    return rpc('reverse_shift_expense', p);
  },
  editShiftExpense(p: {
    p_expense_id: string;
    p_idempotency_key: string;
    p_category: string;
    p_description: string | null;
    p_amount: number;
    p_payment_method: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_expense_date: string;
    p_notes: string | null;
    p_reason: string;
  }): ApiResult<RpcResult & { old_expense_id?: string; replacement_expense_id?: string; journal_entry_id?: string }> {
    return rpc('edit_shift_expense', p);
  },
  getExpenseRoutingRules(p: { p_branch_id: string }): ApiResult<Array<{
    id: string;
    category: string;
    expense_account_id: string;
    expense_account_code: string;
    expense_account_name: string;
    treasury_account_id: string;
    treasury_account_name: string;
    treasury_account_type: string;
    payment_method: string;
    is_active: boolean;
  }>> {
    return rpc('get_expense_routing_rules', p);
  },
  upsertExpenseRoutingRule(p: {
    p_branch_id: string;
    p_category: string;
    p_expense_account_id: string;
    p_treasury_account_id: string;
    p_payment_method: string;
    p_is_active: boolean;
  }): ApiResult<RpcResult & { id?: string }> {
    return rpc('upsert_expense_routing_rule', p);
  },
  getTrialBalance(p: { p_branch_id: string | null; p_to_date: string }): ApiResult<TrialBalanceRow[]> { return rpc('get_trial_balance', p); },
  previewOpeningBalances(p: { p_branch_id: string }): ApiResult<{ success: boolean; error?: string; branch_id?: string; finished?: number; raw?: number; total?: number; has_opening?: boolean; can_post?: boolean; opening_entry?: { id: string; entry_number: string; entry_date: string } | null }> { return rpc('preview_opening_balances', p); },
  seedOpeningBalances(p: { p_branch_id: string | null }): ApiResult<RpcResult> { return rpc('seed_opening_balances', p); },
  getJournals(p: { p_branch_id: string | null; p_from_date: string | null; p_to_date: string | null; p_reference_type: string | null; p_search: string | null }): ApiResult<JournalDto[]> { return rpc('get_journals', p); },
  postManualJournal(p: { p_branch_id: string | null; p_description: string; p_lines: JournalLineInput[] }): ApiResult<RpcResult> { return rpc('post_manual_journal', p); },
  reverseJournalEntry(p: { p_entry_id: string; p_reason: string; p_reversal_date?: string | null }): ApiResult<ReverseJournalResult> {
    const args: Record<string, unknown> = {
      p_entry_id: p.p_entry_id,
      p_reason: p.p_reason,
    };
    if (p.p_reversal_date) args.p_reversal_date = p.p_reversal_date;
    return rpc('reverse_journal_entry', args);
  },
  setAccountingPeriodStatus(p: { p_period_id: string; p_status: AccountingPeriodStatus; p_reason: string }): ApiResult<AccountingPeriodStatusResult> {
    return rpc('set_accounting_period_status', p);
  },
  getArAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ArAgingRow[]> { return rpc('get_ar_aging', p); },
  getApAging(p: { p_branch_id: string | null; p_as_of: string }): ApiResult<ApAgingRow[]> { return rpc('get_ap_aging', p); },
  getSupplierStatement(p: { p_supplier_id: string; p_branch_id: string }): ApiResult<unknown> { return rpc('get_supplier_statement', p); },
  linkEmployeeCreditAccount(p: { p_customer_id: string; p_employee_id: string; p_branch_id: string }): ApiResult<RpcResult> { return rpc('link_employee_credit_account', p); },
  getEmployeeCreditBalances(p: { p_branch_id: string }): ApiResult<unknown> { return rpc('get_employee_credit_balances', p); },
  receivePayment(p: { p_customer_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_sale_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('receive_payment', p); },
  receiveEmployeeCreditPayment(p: { p_employee_id: string; p_branch_id: string; p_amount: number; p_payment_method: string; p_sale_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('receive_employee_credit_payment', p); },
  paySupplier(p: { p_supplier_id: string; p_branch_id: string | null; p_amount: number; p_payment_method: string; p_purchase_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('pay_supplier', p); },
  paySupplierFromTreasury(p: { p_supplier_id: string; p_branch_id: string; p_amount: number; p_treasury_account_id: string; p_purchase_id: string | null; p_notes: string | null }): ApiResult<RpcResult> { return rpc('pay_supplier_from_treasury', p); },
  getTreasuryBalances(p: { p_branch_id: string | null }): ApiResult<TreasuryBalance[]> { return rpc('get_treasury_balances', p); },
  getAccessibleTreasuryAccounts(p: { p_branch_id: string }): ApiResult<TreasurySource[]> { return rpc('get_accessible_treasury_accounts', p); },
  getBranchTreasuryDayCloseReconciliation(p: { p_branch_id: string; p_limit: number }): ApiResult<{
    success: boolean;
    branch_id?: string;
    error?: string;
    rows?: Array<{
      daily_close_id: string;
      business_date: string;
      closed_at: string;
      movement_until: string;
      is_latest: boolean;
      cash_sales: number;
      bank_sales: number;
      credit_sales: number;
      net_sales: number;
      expenses: number;
      cash_purchases: number;
      cash_balance_after_close: number;
      bank_balance_after_close: number;
      total_balance_after_close: number;
      cash_movement_after_close: number;
      bank_movement_after_close: number;
      total_movement_after_close: number;
      cash_balance_after_movement: number;
      bank_balance_after_movement: number;
      total_balance_after_movement: number;
      movement_details: Array<{
        journal_entry_id: string;
        created_at: string;
        reference_type: string;
        reference_id: string | null;
        reference_number: string | null;
        description: string | null;
        cash_effect: number;
        bank_effect: number;
        total_effect: number;
      }>;
    }>;
  }> { return rpc('get_branch_treasury_day_close_reconciliation', p); },
  processTransfer(p: { p_branch_id: string | null; p_from_account_id: string; p_to_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_transfer', p); },
  processTreasuryTransferV2(p: { p_from_account_id: string; p_to_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_transfer_v2', p); },
  processTreasuryDeposit(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_deposit', p); },
  processTreasuryWithdrawal(p: { p_branch_id: string | null; p_account_id: string; p_amount: number; p_notes: string | null }): ApiResult<RpcResult> { return rpc('process_treasury_withdrawal', p); },
  getBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<ReconciliationDetail> { return rpc('get_bank_reconciliation', p); },
  createBankReconciliation(p: { p_branch_id: string | null; p_treasury_account_id: string; p_statement_date: string; p_statement_balance: number }): ApiResult<RpcResult> { return rpc('create_bank_reconciliation', p); },
  addStatementLine(p: { p_reconciliation_id: string; p_statement_date: string; p_description: string | null; p_amount: number; p_reference: string | null }): ApiResult<RpcResult> { return rpc('add_statement_line', p); },
  matchBankLine(p: { p_line_id: string; p_journal_entry_id: string }): ApiResult<RpcResult> { return rpc('match_bank_line', p); },
  completeBankReconciliation(p: { p_reconciliation_id: string }): ApiResult<RpcResult> { return rpc('complete_bank_reconciliation', p); },
};
