import { useCallback, useEffect, useRef, useState } from 'react';

// Browsers require a user gesture before audio may play. Never claim audio is active until resume succeeds.
export function useQrNotificationTone(count: number, enabled: boolean) {
  const context = useRef<AudioContext | null>(null);
  const pending = useRef(count); pending.current = count;
  const [ready, setReady] = useState(false);
  const pulse = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running' || pending.current < 1) return;
    [880, 1175].forEach((frequency, index) => {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      const start = audio.currentTime + index * 0.25;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.08, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.21);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + 0.23);
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
    window.addEventListener('pointerdown', activate); window.addEventListener('keydown', activate);
    return () => { window.removeEventListener('pointerdown', activate); window.removeEventListener('keydown', activate); };
  }, [enabled, unlock]);
  useEffect(() => {
    if (!enabled || !ready || count < 1) return;
    pulse(); const timer = setInterval(pulse, 10000);
    return () => clearInterval(timer);
  }, [enabled, ready, count, pulse]);
  useEffect(() => () => { const audio = context.current; context.current = null; if (audio) void audio.close().catch(() => {}); }, []);
  return { ready, unlock };
}
