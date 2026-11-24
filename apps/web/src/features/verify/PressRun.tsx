import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { tt, type Lang, type StringKey } from '../../i18n/tt';

const STAGES: Array<{ key: StringKey; eta: number }> = [
  { key: 'run.stage.read', eta: 3200 },
  { key: 'run.stage.who', eta: 400 },
  { key: 'run.stage.search', eta: 900 },
  { key: 'run.stage.rank', eta: 2800 },
  { key: 'run.stage.compare', eta: 2200 },
];

export function usePressRun(done: boolean): number {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (done) {
      const id = setInterval(() => setStep((s) => Math.min(s + 1, STAGES.length)), 120);
      return () => clearInterval(id);
    }
    if (step >= STAGES.length - 1) return;
    const id = setTimeout(() => setStep((s) => s + 1), STAGES[step]!.eta);
    return () => clearTimeout(id);
  }, [step, done]);

  return step;
}

interface PressRunProps {
  previewUrl?: string | null;
  previewText?: string | null;
  retryAttempt?: number;
  lang: Lang;
  onCancel?: () => void;
}

export function PressRun({
  previewUrl,
  previewText,
  retryAttempt = 0,
  lang,
  onCancel,
}: PressRunProps) {
  const step = usePressRun(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="clipping-surface p-5 sm:p-6 space-y-5"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-ink" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-medium text-ink m-0">
            {tt('run.title', lang)}
          </h2>
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-rule-strong px-3 py-1 text-xs text-ink hover:bg-paper-sunk cursor-pointer"
          >
            {tt('run.cancel', lang)}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
        {previewUrl ? (
          <div className="sm:col-span-5 relative overflow-hidden rounded-xl border border-rule bg-paper-sunk">
            <img
              src={previewUrl}
              alt={tt('cap.preview.alt', lang)}
              className="w-full max-h-60 object-contain block"
            />
            <div
              className="press-scan-line pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-ink/50"
              aria-hidden="true"
            />
          </div>
        ) : previewText ? (
          <div className="sm:col-span-5 rounded-xl border border-rule bg-paper p-3.5 clipping-ink-rule">
            <p className="ink-text text-sm m-0 line-clamp-5">{previewText}</p>
          </div>
        ) : null}

        <ol className={`${previewUrl || previewText ? 'sm:col-span-7' : 'sm:col-span-12'} space-y-2.5 m-0 p-0 list-none`}>
          {STAGES.map((stage, idx) => {
            const complete = idx < step;
            const current = idx === step;
            return (
              <li
                key={stage.key}
                className={`flex items-center gap-2.5 text-sm transition-opacity ${
                  complete || current ? 'opacity-100' : 'opacity-45'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    complete
                      ? 'border-sage bg-sage/15 text-sage'
                      : current
                      ? 'border-ink text-ink'
                      : 'border-rule-strong text-pencil'
                  }`}
                >
                  {complete ? (
                    <Check className="h-3 w-3" strokeWidth={2} />
                  ) : current ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                  ) : null}
                </span>
                <span className={current ? 'font-medium text-ink' : 'text-pencil'}>
                  {tt(stage.key, lang)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {retryAttempt > 0 ? (
        <p className="text-xs text-pencil m-0">
          {tt('err.retrying', lang, { attempt: retryAttempt + 1 })}
        </p>
      ) : slow ? (
        <p className="text-xs text-pencil m-0">{tt('run.slow', lang)}</p>
      ) : null}
    </div>
  );
}
