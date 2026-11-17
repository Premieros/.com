/**
 * Private EGS signature proof for an OFFLINE CONFORMANCE HARNESS only.
 *
 * This is NOT the ZATCA UBL XAdES XMLDSig signature algorithm. It does NOT
 * canonicalize XML, insert XMLDSig, compute the invoice hash/PIH, create QR
 * cryptographic tags, issue CSIDs or produce a submittable invoice.
 *
 * All key material must arrive from a private, authenticated vault adapter.
 * Never import this module in React/browser code and never serialize the key.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';

export type EgsEnvironment = 'sandbox' | 'production';

export interface EgsSigningScope {
  organizationId: string;
  branchId: string;
  egsDeviceId: string;
  environment: EgsEnvironment;
}

export interface EgsVaultSigningMaterial {
  scope: EgsSigningScope;
  /** P-256 SEC1 or PKCS#8 PEM, server-side only. */
  privateKeyPem: string;
  /** Matching P-256 public key PEM (SPKI), server-side only. */
  publicKeyPem: string;
  /** True only after authoritative cert binding + EGS onboarding verification. */
  certificateVerified: boolean;
}

export interface EgsSigningVault {
  /** Vault must independently authorize the caller and record access. */
  getSigningMaterial(scope: EgsSigningScope): Promise<EgsVaultSigningMaterial>;
}

export interface EgsOfflineSignatureProof {
  readonly kind: 'offline_signature_proof';
  readonly submittable: false;
  readonly digestBase64: string;
  readonly signatureBase64: string;
  readonly publicKeyFingerprintHex: string;
}

function validScope(scope: EgsSigningScope): boolean {
  return Boolean(scope &&
    typeof scope.organizationId === 'string' && scope.organizationId.trim() &&
    typeof scope.branchId === 'string' && scope.branchId.trim() &&
    typeof scope.egsDeviceId === 'string' && scope.egsDeviceId.trim() &&
    scope.environment === 'sandbox');
}

function sameScope(a: EgsSigningScope, b: EgsSigningScope): boolean {
  return a.organizationId === b.organizationId &&
    a.branchId === b.branchId &&
    a.egsDeviceId === b.egsDeviceId &&
    a.environment === b.environment;
}

/**
 * Prove P-256 ECDSA signing with a vault-bound EGS identity, using a strict
 * 32-byte test digest. This proof must NEVER be passed to zatcaGateway.
 *
 * The vault validates EGS entitlement and certificate provenance out of band.
 * No attempt is made to interpret a raw arbitrary digest as a compliant
 * invoice hash or to convert this proof into an XML signature.
 */
export async function signEgsOfflineDigestProof(
  scope: EgsSigningScope,
  digest: Uint8Array,
  vault: EgsSigningVault,
): Promise<EgsOfflineSignatureProof> {
  if (!validScope(scope)) throw new Error('ZATCA_EGS_SANDBOX_SCOPE_REQUIRED');
  // Buffer may originate in a different JS realm under test runners.
  // ArrayBuffer.isView accepts byte views across realms; exclude DataView.
  if (!ArrayBuffer.isView(digest) || digest.BYTES_PER_ELEMENT !== 1 ||
      digest.byteLength !== 32) {
    throw new Error('ZATCA_EGS_INVALID_TEST_DIGEST');
  }
  const material = await vault.getSigningMaterial(scope);
  if (!material || !sameScope(scope, material.scope)) {
    throw new Error('ZATCA_EGS_VAULT_SCOPE_MISMATCH');
  }
  if (!material.certificateVerified) {
    throw new Error('ZATCA_EGS_CERTIFICATE_NOT_VERIFIED');
  }

  let privateKey: ReturnType<typeof createPrivateKey>;
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    privateKey = createPrivateKey(material.privateKeyPem);
    publicKey = createPublicKey(material.publicKeyPem);
  } catch {
    throw new Error('ZATCA_EGS_INVALID_KEY_MATERIAL');
  }
  if (privateKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('ZATCA_EGS_UNSUPPORTED_KEY_CURVE');
  }
  const privatePublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const verifiedPublic = publicKey.export({ type: 'spki', format: 'der' });
  if (!Buffer.from(privatePublic).equals(Buffer.from(verifiedPublic))) {
    throw new Error('ZATCA_EGS_KEYPAIR_MISMATCH');
  }

  const message = Buffer.from(digest);
  const signature = sign('sha256', message, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  if (!verify('sha256', message, {
    key: publicKey, dsaEncoding: 'ieee-p1363',
  }, signature)) {
    throw new Error('ZATCA_EGS_SIGNATURE_VERIFICATION_FAILED');
  }
  const fingerprint = createHash('sha256').update(verifiedPublic).digest('hex');
  return {
    kind: 'offline_signature_proof',
    submittable: false,
    digestBase64: message.toString('base64'),
    signatureBase64: signature.toString('base64'),
    publicKeyFingerprintHex: fingerprint,
  };
}
