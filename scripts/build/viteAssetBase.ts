/**
 * Resolve frontend build asset paths by hosting environment.
 * Vercel rewrites nested SPA URLs to index.html and therefore needs
 * origin-root assets. GitHub Pages intentionally uses './' under /.com/.
 */
export function resolveViteAssetBase(
  override: string | undefined,
  vercel: string | undefined,
): string {
  return override || (vercel ? '/' : './');
}
