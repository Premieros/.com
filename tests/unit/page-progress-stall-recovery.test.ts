import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAGE_LOADING_STALL_MS } from '@/components/PageProgressLoader';

const source = readFileSync('src/components/PageProgressLoader.tsx', 'utf8');

describe('route loading stall recovery', () => {
  it('provides a bounded wait with explicit user-controlled recovery', () => {
    expect(PAGE_LOADING_STALL_MS).toBe(15_000);
    expect(source).toContain('setStalled(true)');
    expect(source).toContain('onClick={() => window.location.reload()}');
    expect(source).toContain('role="alert"');
    expect(source).toContain("setStalled(false)");
  });

  it('clears watchdog and animation timers when loading ends or provider unmounts', () => {
    expect(source).toContain('window.clearTimeout(stallTimer.current)');
    expect(source).toContain('window.clearInterval(tickTimer.current)');
    expect(source).toContain('clearTick();\n    setProgress(100)');
    expect(source).toContain('useEffect(() => () => {\n    clearTick();');
  });

  it('never implicitly retries or submits a business operation on the watchdog', () => {
    const watchdog = source.slice(source.indexOf('stallTimer.current = window.setTimeout('),
      source.indexOf('window.requestAnimationFrame(', source.indexOf('stallTimer.current = window.setTimeout(')));
    expect(watchdog).toContain('setStalled(true)');
    expect(watchdog).not.toContain('window.location.reload()');
    expect(watchdog).not.toMatch(/supabase|checkout|payment|sale/i);
  });
});
