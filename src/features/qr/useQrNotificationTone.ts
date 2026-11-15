import { useCallback, useEffect, useRef, useState } from 'react';

export type KitchenBellMode = 'repeat' | 'once';

/** A resonant double-stroke kitchen bell. Respects browser audio gesture rules.
 * Repeat: POS/customer order alert until requests are handled.
 * Once: KDS chime once for each newly detected batch of kitchen orders.
 */
export function useQrNotificationTone(count: number, enabled: boolean, mode: KitchenBellMode = 'repeat') {
  const context = useRef<AudioContext | null>(null);
  const pending = useRef(count); pending.current = count;
  const lastPlayed = useRef(0);
  const [ready, setReady] = useState(false);
  const pulse = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running' || pending.current < 1) return;
    [940, 1250].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + index * 0.32;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(start); oscillator.stop(start + 0.56);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }, []);
  const unlock = useCallback(async () => {
    if (!enabled) return;
    try {
      if (!context.current) context.current = new AudioContext();
      await context.current.resume();
      if (context.current.state === 'running') setReady(true);
    } catch { setReady(false); }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const activate = () => { if (context.current?.state !== 'running') void unlock(); };
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => {
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
  }, [enabled, unlock]);
  useEffect(() => {
    if (!enabled || !ready) return;
    if (mode === 'once') {
      if (count > lastPlayed.current) {
        lastPlayed.current = count;
        pulse();
      }
      return;
    }
    if (count < 1) return;
    pulse();
    const timer = setInterval(pulse, 7000);
    return () => clearInterval(timer);
  }, [count, enabled, mode, pulse, ready]);
  useEffect(() => () => {
    const audio = context.current;
    context.current = null;
    if (audio) void audio.close().catch(() => {});
  }, []);
  return { ready, unlock };
}
