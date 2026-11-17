import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  signEgsOfflineDigestProof,
  type EgsSigningScope,
  type EgsSigningVault,
} from '../../server/zatca/egsOfflineSigning';

const scope: EgsSigningScope = {
  organizationId: 'org-test',
  branchId: 'branch-test',
  egsDeviceId: 'egs-test',
  environment: 'sandbox',
};
const digest = createHash('sha256').update('test-vector-not-an-invoice').digest();
const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
function vault(overrides: Record<string, unknown> = {}): EgsSigningVault {
  return {
    getSigningMaterial: vi.fn(async () => ({
      scope, privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey,
      certificateVerified: true, ...overrides,
    })),
  };
}

describe('ZATCA offline EGS signing proof (not official XMLDSig or CSID)', () => {
  it('signs with P256, verifies signature and never includes a private key', async () => {
    const proof = await signEgsOfflineDigestProof(scope, digest, vault());
    expect(proof).toMatchObject({
      kind: 'offline_signature_proof',
      submittable: false,
      digestBase64: digest.toString('base64'),
    });
    expect(proof.signatureBase64).not.toBe('');
    expect(proof.publicKeyFingerprintHex).toMatch(/^[0-9a-f]{64}$/);
    expect(verify('sha256', digest, {
      key: createPublicKey(keys.publicKey), dsaEncoding: 'ieee-p1363',
    }, Buffer.from(proof.signatureBase64, 'base64'))).toBe(true);
    expect(JSON.stringify(proof)).not.toContain('PRIVATE KEY');
  });

  it('refuses production before requesting a key', async () => {
    const secretVault = vault();
    await expect(signEgsOfflineDigestProof({
      ...scope, environment: 'production',
    }, digest, secretVault)).rejects.toThrow('ZATCA_EGS_SANDBOX_SCOPE_REQUIRED');
    expect(secretVault.getSigningMaterial).not.toHaveBeenCalled();
  });

  it('rejects incorrect digest lengths before requesting a key', async () => {
    const secretVault = vault();
    await expect(signEgsOfflineDigestProof(scope, new Uint8Array(3), secretVault))
      .rejects.toThrow('ZATCA_EGS_INVALID_TEST_DIGEST');
    expect(secretVault.getSigningMaterial).not.toHaveBeenCalled();
  });

  it('rejects cross-organization, cross-branch and cross-device vault records', async () => {
    for (const changed of [
      { organizationId: 'org-attacker' },
      { branchId: 'other-branch' },
      { egsDeviceId: 'other-egs' },
      { environment: 'production' as const },
    ]) {
      const secretVault = vault({ scope: { ...scope, ...changed } });
      await expect(signEgsOfflineDigestProof(scope, digest, secretVault))
        .rejects.toThrow('ZATCA_EGS_VAULT_SCOPE_MISMATCH');
    }
  });

  it('requires independently verified certificate binding from trusted vault', async () => {
    await expect(signEgsOfflineDigestProof(scope, digest,
      vault({ certificateVerified: false })))
      .rejects.toThrow('ZATCA_EGS_CERTIFICATE_NOT_VERIFIED');
  });

  it('rejects an unrelated private/public key pair', async () => {
    const other = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await expect(signEgsOfflineDigestProof(scope, digest,
      vault({ publicKeyPem: other.publicKey })))
      .rejects.toThrow('ZATCA_EGS_KEYPAIR_MISMATCH');
  });

  it('rejects wrong EC curves even with matching keys', async () => {
    const other = generateKeyPairSync('ec', {
      namedCurve: 'secp384r1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await expect(signEgsOfflineDigestProof(scope, digest,
      vault({ publicKeyPem: other.publicKey, privateKeyPem: other.privateKey })))
      .rejects.toThrow('ZATCA_EGS_UNSUPPORTED_KEY_CURVE');
  });

  it('rejects malformed key material without leaking it in errors', async () => {
    const malformed = 'PRIVATE KEY secret-not-for-logs';
    await expect(signEgsOfflineDigestProof(scope, digest,
      vault({ privateKeyPem: malformed })))
      .rejects.toThrow('ZATCA_EGS_INVALID_KEY_MATERIAL');
  });
});
