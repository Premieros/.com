import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
import { rpc } from '../rpc';

export const admin = {
  createUser(p: { p_email: string; p_password: string; p_full_name: string; p_role: string; p_branch_id: string | null; p_is_active: boolean; p_username: string }): ApiResult<RpcResult> { return rpc('create_user', p); },
  updateUserPassword(p: { p_user_id: string; p_new_password: string }): ApiResult<null> { return rpc('update_user_password', p); },
  deleteUser(p: { p_user_id: string }): ApiResult<null> { return rpc('delete_user', p); },
  getLoginEmail(p: { p_username: string }): ApiResult<{ success?: boolean; email?: string; error?: string }> { return rpc('get_login_email', p); },
  recordLoginFailure(p: { p_username: string }): ApiResult<{ success?: boolean }> { return rpc('record_login_failure', p); },
  recordLoginSuccess(p: { p_user_id: string }): ApiResult<{ success?: boolean; error?: string }> { return rpc('record_login_success', p); },
  seedDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { seeded?: number; existing?: boolean; products?: number; customers?: number; tables?: number }> { return rpc('seed_demo_data', p); },
  deleteDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { orders?: number; sales?: number; customers?: number; products?: number; tables?: number }> { return rpc('delete_demo_data', p); },
  deleteDataSection(p: { p_branch_id: string; p_section: string }): ApiResult<RpcResult & { affected?: number; section?: string }> { return rpc('admin_data_delete_section', p); },
  seedAllDemoData(p: { p_branch_id: string }): ApiResult<RpcResult & { seeded?: boolean; section_count?: number }> { return rpc('admin_data_seed_all', p); },
  canCreateNewUser(): ApiResult<{ allowed: boolean; message?: string; is_super_admin?: boolean }> { return rpc('can_create_new_user', {}); },
  toggleUserCreationSetting(p_allowed: boolean): ApiResult<{ success: boolean; allow_new_user_creation?: boolean; error?: string; message?: string }> { return rpc('toggle_user_creation_setting', { p_allowed }); },
  getFinancialVisibilitySettings(): ApiResult<{ success: boolean; recent_days?: number; historical_percent?: number; error?: string }> { return rpc('get_financial_visibility_settings', {}); },
  updateFinancialVisibilitySettings(p: { p_recent_days: number; p_historical_percent: number }): ApiResult<{ success: boolean; recent_days?: number; historical_percent?: number; error?: string }> { return rpc('update_financial_visibility_settings', p); },
  bootstrapInitialSuperAdmin(p: { p_email: string; p_password: string; p_full_name?: string; p_username?: string }): ApiResult<{ success: boolean; user_id?: string; email?: string; error?: string; message?: string }> { return rpc('bootstrap_initial_super_admin', p); },
  getSuperAdminTenantStats(): ApiResult<Array<{ organization_id: string; organization_name: string; organization_slug: string; is_active: boolean; created_at: string; branch_count: number; user_count: number; total_branches: number; active_branches: number; has_active_subscription?: boolean }>> { return rpc('get_super_admin_tenant_stats', {}); },
  createOrganizationFromProfile(p: {
    p_name: string;
    p_business_type: string;
    p_branch_name: string;
    p_enabled_modules: string[];
    p_business_profile: Record<string, unknown>;
    p_owner_name: string;
    p_owner_email: string;
    p_owner_password: string;
    p_phone?: string | null;
    p_address?: string | null;
    p_currency?: string;
    p_tax_enabled?: boolean;
    p_tax_rate?: number;
  }): ApiResult<{ success?: boolean; error?: string; detail?: string; organization_id?: string; branch_id?: string; warehouse_id?: string; owner_user_id?: string; business_type?: string; trial_days?: number }> { return rpc('super_admin_create_organization_from_profile', p); },
  toggleOrganizationStatus(p: { p_org_id: string; p_is_active: boolean }): ApiResult<{ success?: boolean; error?: string }> { return rpc('toggle_organization_status', p); },
  getOrganizationModuleCatalog(p: { p_organization_id: string }): ApiResult<Array<{ feature_key: string; feature_name: string; category: string; enabled: boolean; source: string }>> { return rpc('get_organization_module_catalog', p); },
  setOrganizationModule(p: { p_organization_id: string; p_feature_key: string; p_enabled: boolean; p_reason?: string | null }): ApiResult<{ success?: boolean; error?: string; organization_id?: string; feature_key?: string; enabled?: boolean }> { return rpc('super_admin_set_organization_module', p); },
  getSystemHealthSnapshot(p: { p_branch_id: string | null }): ApiResult<Record<string, unknown>> { return rpc('get_system_health_snapshot', p); },
  getSubscriptionSettings(): ApiResult<{
    id: boolean;
    instapay_id: string | null;
    beneficiary_name: string | null;
    qr_code_url: string | null;
    instructions_ar: string | null;
    instructions_en: string | null;
    trial_days: number;
    warning_days: number;
    grace_days: number;
    require_receipt: boolean;
    allow_monthly: boolean;
    allow_yearly: boolean;
    updated_at: string;
  }> { return rpc('subscription_settings_get', {}); },
  updateSubscriptionSettings(p: {
    p_instapay_id: string;
    p_beneficiary_name: string;
    p_qr_code_url: string;
    p_instructions_ar: string;
    p_instructions_en: string;
    p_trial_days: number;
    p_warning_days: number;
    p_grace_days: number;
    p_require_receipt: boolean;
    p_allow_monthly: boolean;
    p_allow_yearly: boolean;
  }): ApiResult<RpcResult> { return rpc('subscription_settings_update', p); },
  changeTenantSubscription(p: {
    p_tenant_id: string;
    p_plan_id: string;
    p_status: string;
    p_current_period_end: string | null;
    p_trial_ends_at: string | null;
  }): ApiResult<RpcResult> { return rpc('super_admin_change_subscription', p); },
};
