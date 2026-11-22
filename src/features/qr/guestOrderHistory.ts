import { useEffect, useState } from 'react';
import type { GuestOrderType } from './service';

export interface GuestOrderSummary {
  id: string;
  number: string;
  type: GuestOrderType;
  status: string;
  recordedAt: number;
}

const historyKey = (token: string) => `premier:guest-order-history:${token}`;
const updateEvent = 'premier:guest-order-history-updated';

function readHistory(token: string): GuestOrderSummary[] {
  try {
    const records: unknown = JSON.parse(localStorage.getItem(historyKey(token)) ?? '[]');
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export function useGuestOrderHistory(token: string) {
  const [history, setHistory] = useState(() => readHistory(token));
  useEffect(() => {
    const reload = () => setHistory(readHistory(token));
    reload();
    window.addEventListener(updateEvent, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(updateEvent, reload);
      window.removeEventListener('storage', reload);
    };
  }, [token]);
  return history;
}

export function rememberGuestOrders(token: string, records: GuestOrderSummary[]) {
  if (!records.length) return;
  const previous = readHistory(token);
  const merged = new Map(previous.map(record => [record.id, record]));
  let changed = false;
  for (const record of records) {
    const saved = merged.get(record.id);
    if (saved?.status === record.status && saved.number === record.number) continue;
    merged.set(record.id, record);
    changed = true;
  }
  if (!changed) return;

  try {
    const recent = [...merged.values()].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 30);
    localStorage.setItem(historyKey(token), JSON.stringify(recent));
    window.dispatchEvent(new Event(updateEvent));
  } catch {
    // The live visit remains available when the browser cannot save history.
  }
}
