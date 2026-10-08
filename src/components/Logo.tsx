import { type ReactNode } from 'react';

const BLUE = '#2563EB';
const BLUE_DARK = '#1D4ED8';
const GOLD = '#F6C344';
const WHITE = '#FFFFFF';

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

function Mark({ tone, size }: { tone: LogoTone; size: number }) {
  const primary = tone === 'white' ? WHITE : BLUE;
  const accent = tone === 'white' ? WHITE : GOLD;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 5.5A3.5 3.5 0 0 1 11.5 2H16c7.18 0 12 4.38 12 10.75 0 5.87-4.05 10.02-10.35 10.63L14 23.7V27a3 3 0 0 1-6 0V5.5Z"
        fill={primary}
      />
      <path
        d="M14 7.4h2.2c3.4 0 5.8 2.02 5.8 5.2 0 3.1-2.18 5-5.45 5.25L14 18.05V7.4Z"
        fill={tone === 'white' ? BLUE_DARK : WHITE}
      />
      <path d="M20.2 7.2 23 5.35l1.25 3.05-2.95 1.35-1.1-2.55Z" fill={accent} />
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
  const textCls =
    tone === 'white'
      ? 'text-white'
      : 'text-blue-600';

  const mark = <Mark tone={tone} size={size} />;

  const textBlock = (
    <div className="flex flex-col" dir="ltr">
      <span
        className={`font-extrabold tracking-tight leading-none ${textCls}`}
        style={{ fontSize: Math.round(size * 0.42) }}
      >
        Premier
      </span>
      {showTagline && (
        <span
          className={tone === 'white' ? 'mt-1 uppercase tracking-[0.14em] text-blue-100 leading-none' : 'mt-1 uppercase tracking-[0.14em] text-ui-subtle leading-none'}
          style={{ fontSize: Math.max(8, Math.round(size * 0.125)) }}
        >
          {tagline}
        </span>
      )}
    </div>
  );

  let content: ReactNode;
  if (variant === 'mark') {
    content = <div className={className}>{mark}</div>;
  } else if (variant === 'horizontal') {
    content = (
      <div className={`flex items-center gap-3 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  } else {
    content = (
      <div className={`flex flex-col items-center gap-2 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  }

  return <>{content}</>;
}
