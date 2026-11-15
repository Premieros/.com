import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { qrPublic } from '@/api/domains/qrPublic';
import { qrError } from './errors';
import type { GuestRating } from './service';

const criteria = [
  { key: 'overall', label: 'تجربتك بشكل عام' },
  { key: 'food', label: 'جودة الطعام والمشروبات' },
  { key: 'service', label: 'جودة الخدمة' },
] as const;

export function GuestRatingPanel({ token, session }: { token: string; session: string }) {
  const [saved, setSaved] = useState<GuestRating | null>(null);
  const [scores, setScores] = useState({ overall: 0, food: 0, service: 0 });
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setSaved(null); setError(''); setScores({ overall: 0, food: 0, service: 0 }); setNote('');
    void qrPublic.rating({ p_token: token, p_session: session })
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) throw failure;
        setSaved((data || { eligible: false, submitted: false }) as GuestRating);
      })
      .catch(failure => { if (active) setError(qrError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, session]);

  const submit = async () => {
    if (locked.current || !scores.overall || !scores.food || !scores.service || saved?.submitted) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { data, error: failure } = await qrPublic.rate({
        p_token: token, p_session: session,
        p_overall: scores.overall, p_food: scores.food, p_service: scores.service,
        p_note: note.trim(),
      });
      if (failure) throw failure;
      const response = data as GuestRating | null;
      if (!response?.submitted) throw new Error('QR_RATING_NOT_AVAILABLE');
      setSaved(response);
    } catch (failure) {
      setError(qrError(failure));
    } finally { locked.current = false; setBusy(false); }
  };

  return <section className="customer-service" aria-label="تقييم تجربة العميل" data-testid="guest-rating-panel">
    <h3>قيّم تجربتك معنا</h3>
    <p className="customer-table-hint">رأيك يساعد الفرع على التحسين. التقييم اختياري ولا يؤثر على طلبك أو فاتورتك.</p>
    {loading && <p role="status">جارٍ تحميل التقييم…</p>}
    {error && <p role="alert" className="customer-alert">{error}</p>}
    {!loading && saved?.submitted && <div role="status" className="customer-receipt">
      <strong>شكرًا لتقييمك!</strong>
      <p>تم تسجيل تقييم هذه الزيارة: {saved.overall} من 5 نجوم.</p>
    </div>}
    {!loading && saved?.eligible && !saved.submitted && <>
      {criteria.map(({ key, label }) => <fieldset key={key} className="customer-rating-field">
        <legend>{label}</legend>
        <div className="customer-rating-stars">
          {[1, 2, 3, 4, 5].map(value => <button type="button" key={value}
            disabled={busy} aria-label={`${label}: ${value} من 5`}
            aria-pressed={scores[key] === value}
            className={value <= scores[key] ? 'is-selected' : ''}
            onClick={() => setScores(previous => ({ ...previous, [key]: value }))}>
            <Star size={26} fill={value <= scores[key] ? 'currentColor' : 'none'} />
          </button>)}
        </div>
      </fieldset>)}
      <label>تعليقك (اختياري)
        <textarea maxLength={300} value={note} disabled={busy}
          placeholder="ما الذي أعجبك، وما الذي يمكن تحسينه؟"
          onChange={event => setNote(event.target.value)} />
      </label>
      <button type="button" className="customer-primary"
        disabled={busy || !scores.overall || !scores.food || !scores.service}
        onClick={() => void submit()}>
        {busy ? 'جارٍ حفظ التقييم…' : 'إرسال التقييم'}
      </button>
    </>}
    {!loading && saved && !saved.eligible && !saved.submitted &&
      <p className="customer-table-hint">يمكنك تقييم تجربتك بعد اعتماد طلبك من الموظف.</p>}
  </section>;
}
