import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';

export function useRecordFocus(parameter = 'record') {
  const [params, setParams] = useSearchParams();
  return {
    id: params.get(parameter) || '',
    clear: () => {
      const next = new URLSearchParams(params);
      next.delete(parameter);
      setParams(next, { replace: true });
    },
  };
}

export function RecordFocus({ onClear }: { onClear: () => void }) {
  const { lang } = useLanguage();
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-ui-border p-2 text-sm">
      <span>{lang === 'ar' ? 'عرض السجل المحدد' : 'Showing the selected record'}</span>
      <button type="button" onClick={onClear} className="font-bold text-ui-primary">
        {lang === 'ar' ? 'عرض كل السجلات' : 'Show all records'}
      </button>
    </div>
  );
}
