import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { supportApi } from './supportApi';

export function CustomerSupportLink({ token }: { token: string }) {
  const [resolved, setResolved] = useState<{ token: string; branch: string } | null>(null);
  useEffect(() => {
    let active = true;
    void supportApi.qrBranch(token).then(({ data }) => {
      if (active && data) setResolved({ token, branch: data });
    });
    return () => { active = false; };
  }, [token]);
  if (resolved?.token !== token) return null;
  return <a href={`#/customer-support/${resolved.branch}`} target="_blank" rel="noopener noreferrer"
    className="fixed bottom-24 start-3 z-40 inline-flex items-center gap-2 rounded-full bg-ui-primary px-4 py-3 text-sm font-bold !text-white shadow-lg">
    <MessageCircle size={18} aria-hidden="true" /> الشكاوى والاستفسارات
  </a>;
}
