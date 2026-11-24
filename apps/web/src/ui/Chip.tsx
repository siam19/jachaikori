import type { ReactNode } from 'react';
import type { ClaimDiffFlag } from '@jachaikori/schema';
import {
  Check,
  Hash,
  Calendar,
  UserRound,
  Quote,
  Gauge,
  EyeOff,
} from 'lucide-react';
import { tt, type Lang, type StringKey } from '../i18n/tt';

const FLAG_META: Record<
  ClaimDiffFlag,
  { key: StringKey; tipKey: StringKey; Icon: typeof Check }
> = {
  match: { key: 'flag.match', tipKey: 'flag.match.tip', Icon: Check },
  mismatch_number: { key: 'flag.number', tipKey: 'flag.number.tip', Icon: Hash },
  mismatch_date: { key: 'flag.date', tipKey: 'flag.date.tip', Icon: Calendar },
  mismatch_speaker: { key: 'flag.speaker', tipKey: 'flag.speaker.tip', Icon: UserRound },
  mismatch_quote: { key: 'flag.quote', tipKey: 'flag.quote.tip', Icon: Quote },
  hedging_shift: { key: 'flag.hedge', tipKey: 'flag.hedge.tip', Icon: Gauge },
  missing_context: { key: 'flag.context', tipKey: 'flag.context.tip', Icon: EyeOff },
};

export function FlagChip({
  flag,
  lang,
  detail,
  className = '',
}: {
  flag: ClaimDiffFlag;
  lang: Lang;
  detail?: ReactNode;
  className?: string;
}) {
  const { key, tipKey, Icon } = FLAG_META[flag];
  return (
    <span
      data-flag={flag}
      title={tt(tipKey, lang)}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${className}`.trim()}
      style={{
        color: 'var(--flag)',
        backgroundColor: 'var(--flag-wash)',
        borderColor: 'color-mix(in oklab, var(--flag) 25%, transparent)',
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
      <span>{tt(key, lang)}</span>
      {detail ? <span className="font-mono-data opacity-90">{detail}</span> : null}
    </span>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
  onRemove,
  title,
  className = '',
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  title?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors';
  const style = active
    ? 'bg-ink text-paper border-ink'
    : 'bg-paper-raised text-ink border-rule/90 hover:bg-paper-sunk';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${base} ${style} cursor-pointer min-h-[34px] ${className}`.trim()}
      >
        {children}
      </button>
    );
  }

  return (
    <span title={title} className={`${base} ${style} ${className}`.trim()}>
      <span>{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="ml-0.5 cursor-pointer opacity-75 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
