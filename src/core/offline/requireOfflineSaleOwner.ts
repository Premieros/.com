/** Never queue a financial offline operation without its originating auth identity.
 * A shared POS terminal may be used by different cashiers between capture and replay.
 */
export function requireOfflineSaleOwner(session: { user?: { id?: string | null } | null } | null | undefined): string {
  const id = session?.user?.id?.trim() || '';
  if (!id) throw new Error('AUTH_REQUIRED_OFFLINE_SALE_OWNER');
  return id;
}
