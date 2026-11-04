import { useEffect, useState } from 'react';

/**
 * Mounts the public AGENT support widget without sending Premier auth tokens,
 * business data, or the Premier Supabase credentials to AGENT.
 * The public widget key identifies an approved website; it is not a secret.
 */
export function AgentSupportWidget({ onFailure }: { onFailure: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    const key = (import.meta.env.VITE_AGENT_SUPPORT_WIDGET_KEY || '').trim();
    const endpoint = (import.meta.env.VITE_AGENT_SUPPORT_ORIGIN || '').trim();

    let host: URL;
    try {
      host = new URL(endpoint);
      if (
        host.protocol !== 'https:' ||
        host.origin !== endpoint ||
        !/^[a-f0-9]{48}$/.test(key)
      ) {
        onFailure();
        return;
      }
    } catch {
      onFailure();
      return;
    }

    // The AGENT widget creates its own isolated Shadow DOM and floating button.
    // Existing Premier human-support UI remains a fallback on load failure.
    const script = document.createElement('script');
    script.src = host.origin + '/support/widget.js';
    script.dataset.widgetKey = key;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';

    let stopped = false;
    const failed = () => {
      if (!stopped) onFailure();
    };
    script.addEventListener('error', failed);
    script.addEventListener('load', () => {
      if (stopped) return;
      if (document.querySelector('[data-support-ai-root]')) {
        setStatus('ready');
      } else {
        failed();
      }
    });
    document.body.appendChild(script);

    return () => {
      stopped = true;
      script.removeEventListener('error', failed);
      script.remove();
      document.querySelector('[data-support-ai-root]')?.remove();
    };
  }, [onFailure]);

  // Avoid displaying two support launchers. Native support can resume on error.
  return status === 'loading' ? (
    <span className="sr-only" role="status">جارٍ تجهيز مساعد خدمة العملاء</span>
  ) : null;
}
