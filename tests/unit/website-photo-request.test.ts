import { expect, it } from 'vitest';
import { websitePhotoRequestUrl } from '@/lib/websitePhotoRequest';

const premier = 'https://premieros-sage.vercel.app';
const project = 'https://hvqlkapynjfjikqithvd.supabase.co';
const save = '/rest/v1/rpc/branch_website_photo_save_one';
const image = 'd56aae83-f1b3-4153-9224-87594500368d/gallery1/a20a4590-8236-4b94-bec3-111d08a402b0.png';
const post = { method: 'POST' };

it('routes the two photo writes through Premier in production', () => {
  expect(websitePhotoRequestUrl(project + save, post, premier)).toBe('/_website-photo/save');
  expect(websitePhotoRequestUrl(project + '/storage/v1/object/branch-website-photos/' + image, post, premier))
    .toBe('/_website-photo/upload/' + image);
});

it('keeps other projects, deployments, operations and buckets on their original transport', () => {
  expect(websitePhotoRequestUrl(project + save, post, 'http://localhost:5173')).toBeUndefined();
  expect(websitePhotoRequestUrl('https://other.supabase.co' + save, post, premier)).toBeUndefined();
  expect(websitePhotoRequestUrl(project + save, undefined, premier)).toBeUndefined();
  expect(websitePhotoRequestUrl(project + '/rest/v1/rpc/branch_website_photos_settings', post, premier)).toBeUndefined();
  expect(websitePhotoRequestUrl(project + '/storage/v1/object/other-bucket/' + image, post, premier)).toBeUndefined();
});
