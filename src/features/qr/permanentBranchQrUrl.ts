/**
 * The restaurant owns its QR token for the lifetime of the branch.
 * Never generate a code from window.location: a local development server,
 * Vercel preview or branch-owned domain would print different physical codes.
 *
 * This platform landing host remains live independently of branch websites.
 * Future custom domain changes must redirect at the platform landing route,
 * rather than requiring venue QR stickers to be reprinted.
 */
const PERMANENT_QR_ORIGIN = 'https://premieros-sage.vercel.app';

export function getPermanentBranchQrUrl(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('QR_LINK_INVALID');
  return `${PERMANENT_QR_ORIGIN}/#/qr/${token}`;
}
