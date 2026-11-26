import { type ReactNode } from 'react';

export type LogoTone = 'navy' | 'white' | 'mono' | 'auto';
export type LogoVariant = 'mark' | 'horizontal' | 'vertical';

interface LogoProps {
  size?: number;
  variant?: LogoVariant;
  showTagline?: boolean;
  tone?: LogoTone;
  tagline?: string;
  className?: string;
}

/** Official Premier geometric P, rendered inside a Vessa-inspired circular gradient emblem or standalone mark. */
export function PremierMark({ size = 36, tone = 'navy' }: { size?: number; tone?: LogoTone }) {
  if (tone === 'white') {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path fill="#F7F5F1" fillRule="evenodd" d="M20 69V27C20 11.54 32.54 0 48 0H65C80.46 0 93 12.54 93 28V36C93 51.46 80.46 64 65 64H50C44.48 64 40 68.48 40 74V79C40 84.52 35.52 89 30 89C24.48 89 20 84.52 20 79V69ZM40 27V59C43.89 50.46 52.5 45 62 45H65C69.97 45 74 40.97 74 36V28C74 23.03 69.97 19 65 19H48C43.58 19 40 22.58 40 27Z"/>
        <circle cx="84" cy="77" r="9" fill="#ffa77a" />
      </svg>
    );
  }
  const badgeSize = Math.max(28, size);
  const iconSize = Math.round(badgeSize * 0.56);
  return (
    <span
      className="premier-refresh-brand-mark inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: badgeSize, height: badgeSize }}
      aria-hidden="true"
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill="currentColor" fillRule="evenodd" d="M20 69V27C20 11.54 32.54 0 48 0H65C80.46 0 93 12.54 93 28V36C93 51.46 80.46 64 65 64H50C44.48 64 40 68.48 40 74V79C40 84.52 35.52 89 30 89C24.48 89 20 84.52 20 79V69ZM40 27V59C43.89 50.46 52.5 45 62 45H65C69.97 45 74 40.97 74 36V28C74 23.03 69.97 19 65 19H48C43.58 19 40 22.58 40 27Z"/>
        <circle cx="84" cy="77" r="9" fill="currentColor" opacity="0.85" />
      </svg>
    </span>
  );
}

export function Logo({
  size = 38,
  variant = 'mark',
  showTagline = true,
  tone = 'navy',
  tagline = 'Business Management Platform',
  className = '',
}: LogoProps) {
  const mark = <PremierMark size={size} tone={tone} />;
  const textBlock = (
    <div className="flex min-w-0 flex-col" dir="ltr">
      <span className="whitespace-nowrap font-semibold leading-none tracking-[-0.02em]" style={{
        fontSize: Math.max(15, Math.round(size * 0.44)),
        color: tone === 'white' ? '#F7F5F1' : 'rgb(var(--ui-text))',
        fontFamily: 'Urbanist, sans-serif',
      }}>
        premier<span style={{ color: 'rgb(var(--ui-primary))' }}>.</span>os
      </span>
      {showTagline && (
        <span className={tone === 'white' ? 'mt-0.5 text-white/70 truncate' : 'mt-0.5 text-ui-muted truncate'} style={{ fontSize: Math.max(10, Math.round(size * 0.28)) }}>
          {tagline}
        </span>
      )}
    </div>
  );
  let content: ReactNode;
  if (variant === 'mark') {
    content = <div className={className}>{mark}</div>;
  } else if (variant === 'horizontal') {
    content = <div className={'flex items-center gap-3 ' + className} dir="ltr">{mark}{textBlock}</div>;
  } else {
    content = <div className={'flex flex-col items-center gap-2 ' + className} dir="ltr">{mark}{textBlock}</div>;
  }
  return <>{content}</>;
}
