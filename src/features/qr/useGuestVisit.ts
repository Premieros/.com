import { useCallback, useEffect, useRef, useState } from 'react';
import { qrPublic } from '@/api/domains/qrPublic';
import type { GuestTracking } from './service';
import { qrError } from './errors';

const empty: GuestTracking = { requests: [], bills: [], calls: [] };
export function createVisitSecret() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

export function rememberVisit(token: string, secret: string) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { window[name].setItem(`premier_qr_visit_v1_${token}`, JSON.stringify({ secret, created: Date.now() })); }
    catch { /* Continue with the in-memory visit. */ }
  }
}

export function readVisit(token: string) {
  const key = `premier_qr_visit_v1_${token}`;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { const storage = window[name]; const stored = JSON.parse(storage.getItem(key) || 'null'); if (/^[a-f0-9]{64}$/.test(stored?.secret) && Date.now() - stored.created < 86400000) return stored.secret as string; } catch { /* Storage unavailable. */ }
  }
  const secret = createVisitSecret();
  rememberVisit(token, secret);
  return secret;
}
export function resetVisit(token: string) {
  for (const name of ['localStorage', 'sessionStorage'] as const) { try { window[name].removeItem(`premier_qr_visit_v1_${token}`); window[name].removeItem(`premier_qr_pending_v1_${token}`); } catch { /* Storage unavailable. */ } }
  return readVisit(token);
}
export function useGuestVisit(token: string, secure = false, providedSession?: string) {
  const [session, setSession] = useState(() => providedSession || readVisit(token));
  const [tracking, setTracking] = useState<GuestTracking>(empty);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const currentToken = useRef(token);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const scope = generation.current;
    const request = ++refreshSequence.current;
    const isCurrent = () => scope === generation.current && request === refreshSequence.current;
    try {
      const { data, error: failure } = await (secure ? qrPublic.guestTrack : qrPublic.track)({ p_token: token, p_session: session });
      if (failure) throw failure;
      if (isCurrent() && Array.isArray(data?.requests) && Array.isArray(data?.bills) && Array.isArray(data?.calls)) { setTracking(data); setError(''); }
    } catch (failure) { if (isCurrent()) setError(qrError(failure)); }
  }, [token, session, secure]);
  useEffect(() => {
    if (currentToken.current !== token) { currentToken.current = token; setSession(readVisit(token)); }
  }, [token]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    invalidate(); setTracking(empty); setError('');
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (alive) timer = setTimeout(() => void poll(), 6000); };
    void poll();
    return () => { alive = false; invalidate(); clearTimeout(timer); };
  }, [refresh, invalidate]);
  function newVisit() {
    for (const name of ['localStorage', 'sessionStorage'] as const) { try { const storage = window[name]; storage.removeItem(`premier_qr_visit_v1_${token}`); } catch { /* No storage. */ } }
    generation.current++; setTracking(empty); setSession(readVisit(token)); setError('');
  }
  return { session, tracking, error, refresh, newVisit };
}
