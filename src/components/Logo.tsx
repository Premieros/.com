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

/** Official Premier geometric P, recreated as resolution-independent vector artwork. */
export function PremierMark({ size = 36, tone = 'navy' }: { size?: number; tone?: LogoTone }) {
  const ink = tone === 'white' ? '#F7F5F1' : tone === 'mono' ? 'currentColor' : '#1C1230';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path fill={ink} fillRule="evenodd" d="M20 69V27C20 11.54 32.54 0 48 0H65C80.46 0 93 12.54 93 28V36C93 51.46 80.46 64 65 64H50C44.48 64 40 68.48 40 74V79C40 84.52 35.52 89 30 89C24.48 89 20 84.52 20 79V69ZM40 27V59C43.89 50.46 52.5 45 62 45H65C69.97 45 74 40.97 74 36V28C74 23.03 69.97 19 65 19H48C43.58 19 40 22.58 40 27Z"/>
      <circle cx="84" cy="77" r="9" fill="#8054F6" />
    </svg>
  );
}

export function Logo({
  size = 32,
  variant = 'mark',
  showTagline = true,
  tone = 'navy',
  tagline = 'Business Management Platform',
  className = '',
}: LogoProps) {
  const mark = <PremierMark size={size} tone={tone} />;
  const textBlock = (
    <div className="flex min-w-0 flex-col" dir="ltr">
      <span className="whitespace-nowrap font-light leading-none tracking-tight" style={{
        fontSize: Math.round(size * 0.50),
        color: tone === 'white' ? '#F7F5F1' : tone === 'mono' ? 'currentColor' : '#1C1230',
        fontFamily: 'Inter, sans-serif',
      }}>
        premier<span style={{ color: '#8054F6' }}>.</span>os
      </span>
      {showTagline && (
        <span className={tone === 'white' ? 'mt-1 uppercase tracking-wider text-violet-200' : 'mt-1 uppercase tracking-wider text-ui-subtle'} style={{ fontSize: Math.max(8, Math.round(size * 0.125)) }}>
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
