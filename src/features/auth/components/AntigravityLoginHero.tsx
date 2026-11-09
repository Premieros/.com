import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import './premier-login-motion.css';

type Props = { isAr: boolean };

const showcase = [
  { src: '/auth/hq/pos.webp', ar: 'شاشة البيع', en: 'Point of sale' },
  { src: '/auth/creative/dashboard.webp', ar: 'التقارير', en: 'Reports' },
  { src: '/auth/hq/dashboard.webp', ar: 'لوحة التحكم', en: 'Dashboard' },
];

/** Pixel coordinates approximate the official geometric P, including its separated violet dot. */
const pixels = Array.from({ length: 25 * 25 }, (_, index) => {
  const x = index % 25;
  const y = Math.floor(index / 25);
  const body = (x >= 4 && x <= 8 && y >= 3 && y <= 21)
    || (y >= 3 && y <= 7 && x >= 7 && x <= 17)
    || (x >= 17 && x <= 21 && y >= 7 && y <= 13)
    || (y >= 12 && y <= 16 && x >= 8 && x <= 17)
    || ((x - 10) ** 2 + (y - 20) ** 2 <= 45 && x >= 8 && y >= 15 && y <= 20);
  const dot = (x - 20) ** 2 + (y - 20) ** 2 <= 4;
  return body || dot ? { x, y, dot, delay: (index * 17) % 620, dx: (x * 41 + y * 17) % 300 - 150, dy: (y * 39 + x * 19) % 300 - 150 } : null;
}).filter((pixel): pixel is NonNullable<typeof pixel> => pixel !== null);

export function AntigravityLoginHero({ isAr }: Props) {
  const [videoReady, setVideoReady] = useState(false);
  const [active, setActive] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (reduceMotion || videoReady) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % showcase.length), 2400);
    return () => window.clearInterval(timer);
  }, [reduceMotion, videoReady]);

  return (
    <section className="premier-motion-scene absolute inset-0 overflow-hidden" aria-label={isAr ? 'مقدمة منصة Premier' : 'Premier platform introduction'}>
      <div className="premier-motion-grid" aria-hidden="true" />
      <div className="premier-motion-halo" aria-hidden="true" />
      {!reduceMotion && (
        <video
          className={'premier-motion-video ' + (videoReady ? 'premier-motion-video-ready' : '')}
          src="/auth/premier-login-motion.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
        />
      )}
      {!videoReady && (
        <div className="premier-motion-fallback" aria-hidden="true">
          <div className="premier-pixel-logo">
            {pixels.map((pixel) => (
              <i key={pixel.x + '-' + pixel.y} className={'premier-pixel ' + (pixel.dot ? 'premier-pixel-dot' : '')} style={{
                left: pixel.x * 4 + '%',
                top: pixel.y * 4 + '%',
                animationDelay: reduceMotion ? '0ms' : pixel.delay + 'ms',
                ['--pixel-x' as string]: pixel.dx + 'px',
                ['--pixel-y' as string]: pixel.dy + 'px',
              }} />
            ))}
            <span className="premier-pixel-wordmark"><Logo variant="horizontal" tone="white" size={0} showTagline={false} /></span>
          </div>
          <div className="premier-showcase-panels">
            {showcase.map((screen, index) => (
              <div key={screen.src} className={'premier-showcase-card ' + (active === index ? 'is-active' : '')}>
                <img src={screen.src} alt="" decoding="async" loading={index === 0 ? 'eager' : 'lazy'} />
                <span>{isAr ? screen.ar : screen.en}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="premier-motion-copy" dir={isAr ? 'rtl' : 'ltr'}>
        <p>PREMIER OS</p>
        <h1>{isAr ? 'كل أعمالك. في عالم واحد.' : 'Your entire business. One universe.'}</h1>
        <span>{isAr ? 'المبيعات والتقارير والإدارة، بتجربة واحدة متكاملة' : 'Sales, analytics and operations, seamlessly connected'}</span>
      </div>
    </section>
  );
}
