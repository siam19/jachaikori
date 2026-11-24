import { Link, useRouteError } from 'react-router';
import { tt } from '../i18n/tt';
import { useLang } from '../lib/useLang';
import { StateCard } from './StateCard';

export function RouteErrorBoundary() {
  const [lang] = useLang();
  const err = useRouteError();
  const detail = err instanceof Error ? err.message : undefined;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <StateCard
        title={tt('err.unknown.title', lang)}
        body={detail ? `${tt('err.unknown.body', lang)} (${detail})` : tt('err.unknown.body', lang)}
        action={
          <Link
            to="/"
            className="inline-flex items-center rounded-xl bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90"
          >
            {tt('nav.home', lang)}
          </Link>
        }
        secondaryAction={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-xl border border-rule-strong bg-paper-raised px-3.5 py-2 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer"
          >
            {tt('err.upstream.action', lang)}
          </button>
        }
      />
    </div>
  );
}
