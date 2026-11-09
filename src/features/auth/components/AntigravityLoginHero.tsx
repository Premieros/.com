import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

type Props = { isAr: boolean };

const particles = Array.from({ length: 46 }, (_, index) => ({
  left: `${(index * 61 + 13) % 100}%`,
  top: `${(index * 37 + 19) % 100}%`,
  delay: `${(index % 12) * -0.55}s`,
  duration: `${3 + (index % 6)}s`,
  size: index % 7 === 0 ? 3 : 1.5,
}));

export function AntigravityLoginHero({ isAr }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (!media) return;
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return (
    <section className="premier-cosmos relative hidden h-full min-h-0 overflow-hidden bg-[#02040b] text-white lg:block" dir={isAr ? 'rtl' : 'ltr'} aria-label={isAr ? 'عالم Premier المتكامل' : 'The Premier connected workspace'}>
      <style>{`
        @keyframes premier-drift { 0%,100% { transform: translate3d(0,0,0) rotate(-3deg) scale(.98); } 50% { transform: translate3d(0,-19px,0) rotate(3deg) scale(1.04); } }
        @keyframes premier-aura { 0%,100% { opacity:.55; transform:scale(.9); } 50% { opacity:.95; transform:scale(1.12); } }
        @keyframes premier-twinkle { 0%,100% { opacity:.12; transform:scale(.75); } 50% { opacity:.85; transform:scale(1.4); } }
        @keyframes premier-gradient-flow { from { transform: translateX(-12%) rotate(-8deg); } to { transform: translateX(12%) rotate(8deg); } }
        @media (prefers-reduced-motion: reduce) {
          .premier-cosmos .premier-moving { animation:none !important; }
        }
      `}</style>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_48%_49%,rgba(27,56,116,.20),transparent_54%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(rgba(130,174,238,.22) .65px, transparent .65px)', backgroundSize: '28px 28px', maskImage: 'linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)' }} />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {particles.map((particle, index) => (
          <span key={index} className="premier-moving absolute rounded-full bg-sky-200" style={{
            left: particle.left, top: particle.top, width: particle.size, height: particle.size,
            boxShadow: index % 5 === 0 ? '0 0 10px 2px rgba(77,156,255,.7)' : 'none',
            animation: reduceMotion ? 'none' : `premier-twinkle ${particle.duration} ease-in-out ${particle.delay} infinite`,
            opacity: reduceMotion ? .5 : undefined,
          }} />
        ))}
      </div>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 px-9 pt-9 xl:px-14">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.06] px-4 py-2 text-xs font-bold tracking-[.15em] backdrop-blur-xl">
          <Sparkles className="h-4 w-4 text-sky-300" /> PREMIER OS
        </span>
        <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-slate-300 backdrop-blur">
          {isAr ? 'مستقبل إدارة الأعمال' : 'The future of business'}
        </span>
      </div>

      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <div className="premier-moving absolute h-[min(55vw,600px)] w-[min(55vw,600px)] rounded-full bg-gradient-to-r from-cyan-500/20 via-indigo-500/15 to-rose-500/20 blur-[100px]" style={{ animation: reduceMotion ? 'none' : 'premier-aura 8s ease-in-out infinite' }} />
        <svg className="premier-moving relative z-10 h-[min(54vw,560px)] w-[min(54vw,560px)] max-h-[70vh] drop-shadow-[0_0_38px_rgba(50,105,240,.30)]" viewBox="0 0 480 480" role="img" aria-label="Premier luminous symbol" style={{ animation: reduceMotion ? 'none' : 'premier-drift 9s ease-in-out infinite' }}>
          <defs>
            <linearGradient id="premier-spectrum" x1="0%" y1="90%" x2="100%" y2="7%">
              <stop offset="0%" stopColor="#15c8fb" /><stop offset="27%" stopColor="#3778ff" />
              <stop offset="52%" stopColor="#8972fc" /><stop offset="73%" stopColor="#f07099" />
              <stop offset="87%" stopColor="#ffb654" /><stop offset="100%" stopColor="#7deb9e" />
            </linearGradient>
            <filter id="premier-glow" x="-55%" y="-55%" width="210%" height="210%">
              <feGaussianBlur stdDeviation="12" />
            </filter>
          </defs>
          <path d="M89 332 C145 295 152 150 226 137 C302 122 326 295 391 332" stroke="url(#premier-spectrum)" strokeWidth="63" strokeLinecap="round" fill="none" opacity=".65" filter="url(#premier-glow)" />
          <path d="M89 332 C145 295 152 150 226 137 C302 122 326 295 391 332" stroke="url(#premier-spectrum)" strokeWidth="52" strokeLinecap="round" fill="none" />
          <path d="M137 319 C180 264 178 188 226 184" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" opacity=".17" />
        </svg>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#02040b] via-[#02040b]/85 to-transparent px-9 pb-12 pt-32 xl:px-14">
        <div className="mb-4 inline-flex items-center gap-2 text-[11px] font-bold tracking-[.24em] text-cyan-300">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
          PREMIER INTELLIGENCE
        </div>
        <h2 className="max-w-xl text-3xl font-black leading-tight tracking-tight xl:text-5xl">
          {isAr ? 'كل أعمالك. في عالم واحد.' : 'Your entire business. One universe.'}
        </h2>
        <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300 xl:text-base">
          {isAr ? 'المبيعات والمخزون والإنتاج والمحاسبة، متصلة بسلاسة في منصة واحدة.' : 'Sales, inventory, production, and accounting — seamlessly connected in one platform.'}
        </p>
      </div>
    </section>
  );
}
