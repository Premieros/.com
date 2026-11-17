import { describe, expect, it } from 'vitest';
import {
  evaluateZatcaOnboarding,
  type ZatcaOnboardingStatus,
} from '@/features/invoicing/saudi/zatcaOnboardingReadiness';

const sandboxReady: ZatcaOnboardingStatus = {
  countryCode: 'SA',
  organizationId: 'org-sa',
  branchId: 'branch-sa',
  egsDeviceId: 'egs-01',
  vatRegistrationNumber: 'registered-tax-identifier',
  environment: 'sandbox',
  onboardingComplete: true,
  serverCredentialsReady: true,
  serverSigningReady: true,
  complianceTestsPassed: true,
  productionApproved: false,
};

describe('ZATCA onboarding readiness (not a live connection)', () => {
  it('accepts a complete sandbox prerequisite set without claiming production approval', () => {
    expect(evaluateZatcaOnboarding(sandboxReady)).toEqual({
      ready: true, environment: 'sandbox', blockers: [],
    });
  });

  it('requires explicit production approval even after sandbox prerequisites pass', () => {
    expect(evaluateZatcaOnboarding({ ...sandboxReady, environment: 'production' }))
      .toMatchObject({ ready: false, blockers: ['production_approval_missing'] });
    expect(evaluateZatcaOnboarding({
      ...sandboxReady, environment: 'production', productionApproved: true,
    }).ready).toBe(true);
  });

  it('fails closed for non-Saudi legal jurisdiction and missing tenant boundaries', () => {
    expect(evaluateZatcaOnboarding({
      ...sandboxReady, countryCode: 'EG', organizationId: '', branchId: '', egsDeviceId: '',
    }).blockers).toEqual([
      'invalid_jurisdiction', 'organization_missing', 'branch_missing', 'device_missing',
    ]);
  });

  it('does not allow submission readiness without signed-server capabilities', () => {
    expect(evaluateZatcaOnboarding({
      ...sandboxReady, vatRegistrationNumber: '',
      onboardingComplete: false, serverCredentialsReady: false,
      serverSigningReady: false, complianceTestsPassed: false,
    }).blockers).toEqual([
      'vat_registration_missing', 'onboarding_incomplete',
      'server_credentials_missing', 'signing_not_ready',
      'compliance_testing_incomplete',
    ]);
  });

  it('rejects an unrecognized environment instead of falling back to production', () => {
    expect(evaluateZatcaOnboarding({
      ...sandboxReady, environment: 'live' as ZatcaOnboardingStatus['environment'],
    })).toEqual({
      ready: false, environment: null, blockers: ['invalid_environment'],
    });
  });
});
