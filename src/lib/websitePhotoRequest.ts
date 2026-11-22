// Keep the database session and Storage authorization on the existing Supabase project.
// These two writes use Premier's origin to avoid browser cross-origin upload failures.
const PROJECT_ORIGIN = 'https://hvqlkapynjfjikqithvd.supabase.co';
const PREMIER_ORIGIN = 'https://premieros-sage.vercel.app';
const SAVE_PATH = '/rest/v1/rpc/branch_website_photo_save_one';
const UPLOAD_PATH = /^\/storage\/v1\/object\/branch-website-photos\/[0-9a-f-]{36}\/[a-zA-Z0-9]+\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;

export function websitePhotoRequestUrl(input: RequestInfo | URL, init: RequestInit | undefined, origin: string) {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (origin !== PREMIER_ORIGIN || method.toUpperCase() !== 'POST' || input instanceof Request) return;

  const url = new URL(input, origin);
  if (url.origin !== PROJECT_ORIGIN || url.search || url.hash) return;
  if (url.pathname === SAVE_PATH) return '/_website-photo/save';
  if (UPLOAD_PATH.test(url.pathname)) {
    return url.pathname.replace('/storage/v1/object/branch-website-photos/', '/_website-photo/upload/');
  }
}
