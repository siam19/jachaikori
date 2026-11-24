import { outletLabel, type Lang } from '../i18n/tt';

export const OUTLET_FAVICONS: Record<string, string> = {
  'prothom-alo': '/favicons/prothom-alo.svg',
  'daily-star': '/favicons/daily-star.ico',
  'business-standard': '/favicons/business-standard.ico',
  bdnews24: '/favicons/bdnews24.png',
  ittefaq: '/favicons/ittefaq.png',
  jugantor: '/favicons/jugantor.ico',
  'kaler-kantho': '/favicons/kaler-kantho.png',
  'bangladesh-protidin': '/favicons/bangladesh-protidin.png',
};

interface OutletNameProps {
  id: string;
  lang: Lang;
  className?: string;
}

/**
 * Accredited outlet nameplate in plain ink small caps with the outlet's official favicon.
 */
export function OutletName({ id, lang, className = '' }: OutletNameProps) {
  const favicon = OUTLET_FAVICONS[id];

  return (
    <span className={`outlet-plate inline-flex items-center gap-1.5 text-xs ${className}`.trim()}>
      {favicon ? (
        <img
          src={favicon}
          alt=""
          aria-hidden="true"
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          className="h-3.5 w-3.5 rounded-[3px] object-contain shrink-0 bg-white/85 p-[1px]"
        />
      ) : null}
      <span>{outletLabel(id, lang)}</span>
    </span>
  );
}
