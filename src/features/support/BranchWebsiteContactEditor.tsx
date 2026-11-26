import { useParams } from 'react-router-dom';
import { WebsiteTextSettings } from '@/features/qr/WebsiteTextSettings';
import { BUNKER_BRANCH } from '@/features/qr/websiteInlineEditor';
import { WebsiteSocialSettings } from '@/features/qr/WebsiteSocialSettings';

export function BranchWebsiteContactEditor() {
  const { branchId = '' } = useParams();
  return <main dir="rtl" className="mx-auto max-w-3xl space-y-4 bg-ui-page p-4 text-ui-text">
    <h1 className="text-xl font-bold">تعديل موقع الفرع</h1>
    {branchId === BUNKER_BRANCH && <WebsiteTextSettings key={branchId} branchId={branchId} />}
    <WebsiteSocialSettings key={branchId} branchId={branchId} />
  </main>;
}
