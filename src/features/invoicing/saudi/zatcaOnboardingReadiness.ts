/**
 * Saudi ZATCA integration readiness gate (foundation only).
 *
 * This module NEVER handles CSIDs, OTPs, private keys, signed invoice XML,
 * cryptography, HTTP requests or invoice persistence. All flags here must be
 * resolved from an authenticated, tenant-scoped backend, never trusted from
 * browser input. "ready" means only that the prerequisite checklist is
 * satisfied; it is not proof of ZATCA conformance, clearance or acceptance.
 */
export type ZatcaEnvironment = 'sandbox' | 'production';

export type ZatcaReadinessBlocker =
  | 'invalid_jurisdiction'
  | 'organization_missing'
  | 'branch_missing'
  | 'device_missing'
  | 'vat_registration_missing'
  | 'invalid_environment'
  | 'onboarding_incomplete'
  | 'server_credentials_missing'
  | 'signing_not_ready'
  | 'compliance_testing_incomplete'
  | 'production_approval_missing';

export interface ZatcaOnboardingStatus {
  /** Source: verified legal organization registration, not the UI locale. */
  countryCode: string;
  organizationId: string;
  branchId: string;
  egsDeviceId: string;
  /** Verified by the authorized onboarding process; not a secret. */
  vatRegistrationNumber: string;
  environment: ZatcaEnvironment;
  onboardingComplete: boolean;
  /** Presence of server-side credentials only; never include their values. */
  serverCredentialsReady: boolean;
  serverSigningReady: boolean;
  complianceTestsPassed: boolean;
  /** Separate explicit approval for production activation. */
  productionApproved: boolean;
}

export interface ZatcaOnboardingReadiness {
  ready: boolean;
  environment: ZatcaEnvironment | null;
  blockers: ZatcaReadinessBlocker[];
}

/**
 * Check configuration prerequisites without contacting ZATCA.
 * A secure backend must additionally authorize the tenant/branch/EGS,
 * inspect certificate validity, verify regulation-specific invoice content,
 * and manage any actual submission workflow before live use.
 */
export function evaluateZatcaOnboarding(status: ZatcaOnboardingStatus): ZatcaOnboardingReadiness {
  const blockers: ZatcaReadinessBlocker[] = [];
  if (status.countryCode?.trim().toUpperCase() !== 'SA') blockers.push('invalid_jurisdiction');
  if (!status.organizationId?.trim()) blockers.push('organization_missing');
  if (!status.branchId?.trim()) blockers.push('branch_missing');
  if (!status.egsDeviceId?.trim()) blockers.push('device_missing');
  if (!status.vatRegistrationNumber?.trim()) blockers.push('vat_registration_missing');

  const environment = status.environment === 'sandbox' || status.environment === 'production'
    ? status.environment : null;
  if (!environment) blockers.push('invalid_environment');
  if (!status.onboardingComplete) blockers.push('onboarding_incomplete');
  if (!status.serverCredentialsReady) blockers.push('server_credentials_missing');
  if (!status.serverSigningReady) blockers.push('signing_not_ready');
  if (!status.complianceTestsPassed) blockers.push('compliance_testing_incomplete');
  if (environment === 'production' && !status.productionApproved) {
    blockers.push('production_approval_missing');
  }

  return { ready: blockers.length === 0, environment, blockers };
}
