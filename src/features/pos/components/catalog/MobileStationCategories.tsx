import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Grid2X2, RefreshCw } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import type { Category } from '@/lib/types';

interface StationRow {
  id: string;
  code?: string;
  branch_id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}

interface CategoryAssignment {
  id: string;
  kitchen_station_id: string | null;
}

interface Props {
  branchId: string | null;
  userId: string | null;
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
}

const button = 'min-h-11 rounded-xl border px-3 py-2 text-xs font-black transition active:scale-[.98]';

export function MobileStationCategories({
  branchId,
  userId,
  categories,
  selectedCategory,
  onSelectCategory,
}: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { isOnline } = useOffline();
  const [selection, setSelection] = useState<string | null>(null);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [assignments, setAssignments] = useState<CategoryAssignment[]>([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelection(null);
    onSelectCategory('');
  }, [branchId, userId, onSelectCategory]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!branchId || !userId || !isOnline) {
        if (!cancelled) {
          setStations([]);
          setAssignments([]);
          setError('');
        }
        return;
      }

      try {
        const [stationResult, assignmentResult] = await Promise.all([
          supabase.rpc('get_my_kitchen_stations', { p_branch_id: branchId }),
          supabase
            .from('categories')
            .select('id,kitchen_station_id')
            .eq('branch_id', branchId),
        ]);

        if (stationResult.error) throw stationResult.error;
        if (assignmentResult.error) throw assignmentResult.error;

        if (cancelled) return;

        const stationRows = (Array.isArray(stationResult.data) ? stationResult.data : []) as StationRow[];
        setStations(
          stationRows.filter(
            (station) =>
              station.branch_id === branchId
              && station.is_active
              && station.code?.trim().toLowerCase() !== 'cashier',
          ),
        );
        setAssignments((assignmentResult.data || []) as CategoryAssignment[]);
        setError('');
      } catch (loadError) {
        if (cancelled) return;
        console.error('[POS] station category navigation unavailable', loadError);
        setStations([]);
        setAssignments([]);
        setError(isAr ? 'تعذر تحميل المحطات؛ الفئات متاحة' : 'Stations unavailable; categories remain available');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [branchId, userId, isOnline, isAr, reloadKey]);

  const branchCategories = useMemo(
    () => categories.filter((category) => category.branch_id === branchId),
    [categories, branchId],
  );

  const categoryStationMap = useMemo(
    () => new Map(assignments.map((row) => [row.id, row.kitchen_station_id])),
    [assignments],
  );

  const selectedStation = stations.find((station) => station.id === selection);
  const allCategories = selection === 'all';
  const showCategories = allCategories || !!selectedStation || stations.length === 0;
  const visibleCategories = selectedStation
    ? branchCategories.filter((category) => categoryStationMap.get(category.id) === selectedStation.id)
    : branchCategories;

  const reset = () => {
    setSelection(null);
    onSelectCategory('');
  };

  return (
    <div data-testid="pos-mobile-station-navigation" className="space-y-2 sm:hidden">
      {error && (
        <div role="status" className="flex items-center justify-between gap-2 text-xs text-ui-muted">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className={`${button} flex shrink-0 items-center gap-1 border-ui-border`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {!showCategories ? (
        <div data-testid="pos-station-cards" className="grid grid-cols-3 gap-2">
          <button
            type="button"
            data-testid="pos-station-all"
            onClick={() => {
              setSelection('all');
              onSelectCategory('');
            }}
            className={`${button} border-ui-primary bg-ui-primary-soft text-ui-accent`}
          >
            <Grid2X2 className="mx-auto mb-1 h-4 w-4" />
            {isAr ? 'الكل' : 'All'}
          </button>

          {stations.map((station) => (
            <button
              key={station.id}
              type="button"
              data-testid={`pos-station-${station.id}`}
              onClick={() => {
                setSelection(station.id);
                onSelectCategory('');
              }}
              className={`${button} border-ui-border bg-ui-surface text-ui-text`}
            >
              {isAr ? station.name_ar : station.name_en || station.name_ar}
            </button>
          ))}
        </div>
      ) : (
        <>
          {stations.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="pos-station-back"
                onClick={reset}
                className={`${button} flex shrink-0 items-center gap-1 border-ui-border bg-ui-page-alt text-ui-text`}
              >
                <ArrowLeft className={`h-4 w-4 ${isAr ? 'rotate-180' : ''}`} />
                {isAr ? 'المحطات' : 'Stations'}
              </button>
              <span className="truncate text-xs font-black text-ui-muted">
                {selectedStation
                  ? (isAr ? selectedStation.name_ar : selectedStation.name_en || selectedStation.name_ar)
                  : (isAr ? 'كل الفئات' : 'All categories')}
              </span>
            </div>
          )}

          <div data-testid="pos-mobile-station-categories" className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              data-testid="pos-station-category-all"
              onClick={() => {
                setSelection('all');
                onSelectCategory('');
              }}
              className={`${button} shrink-0 ${!selectedCategory ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-surface text-ui-muted'}`}
            >
              {isAr ? 'الكل' : 'All'}
            </button>

            {visibleCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                data-testid={`pos-station-category-${category.id}`}
                onClick={() => onSelectCategory(selectedCategory === category.id ? '' : category.id)}
                className={`${button} shrink-0 ${selectedCategory === category.id ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-surface text-ui-muted'}`}
              >
                {isAr ? category.name : category.name_en || category.name}
              </button>
            ))}
          </div>

          {selectedStation && visibleCategories.length === 0 && (
            <p className="text-xs text-ui-muted">
              {isAr ? 'لا توجد فئات مرتبطة بهذه المحطة' : 'No categories assigned to this station'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
