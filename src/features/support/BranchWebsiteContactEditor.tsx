import { useParams } from 'react-router-dom';
import { WebsiteSocialSettings } from '@/features/qr/WebsiteSocialSettings';

export function BranchWebsiteContactEditor() {
  const { branchId = '' } = useParams();
  return <main dir="rtl" className="mx-auto max-w-3xl space-y-4 bg-ui-page p-4 text-ui-text">
    <h1 className="text-xl font-bold">تعديل روابط التواصل لموقع الفرع</h1>
    <WebsiteSocialSettings key={branchId} branchId={branchId} />
  </main>;
}
