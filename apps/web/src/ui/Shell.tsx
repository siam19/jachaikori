import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import {
  Bookmark,
  Home,
  Newspaper,
  Search,
  Users,
} from 'lucide-react';
import { tt } from '../i18n/tt';
import { formatNumber } from '../i18n/format';
import { useLang } from '../lib/useLang';
import { useScrapbook } from '../features/scrapbook/useScrapbook';
import { Omnibox } from '../features/search/Omnibox';
import { PeekProvider } from '../features/explore/peek/PeekContext';
import { TrailProvider } from '../features/explore/trail/TrailContext';
import { TrailBar } from '../features/explore/trail/TrailBar';
import { ACCREDITED_OUTLETS } from '../features/events/Lanes';
import { OutletName } from './OutletName';

export function Shell() {
  const [lang, , toggleLang] = useLang();
  const { pins } = useScrapbook();
  const [omniboxOpen, setOmniboxOpen] = useState(false);

  // Quiet global `/` and Cmd/Ctrl+K shortcut for power users
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOmniboxOpen((v) => !v);
      } else if (!inInput && e.key === '/') {
        e.preventDefault();
        setOmniboxOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3.5 py-1.5 text-sm rounded-full transition-colors ${
      isActive
        ? 'bg-ink/8 font-medium text-ink'
        : 'text-pencil hover:text-ink hover:bg-paper-sunk/70'
    }`;

  return (
    <TrailProvider>
      <PeekProvider>
        <div className="min-h-dvh flex flex-col">
          {/* Skip to content link */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:text-paper focus:px-4 focus:py-2 focus:text-sm"
          >
            {tt('nav.skip', lang)}
          </a>

          {/* Clean, soft top navigation — no wordmark, no double border, no clutter */}
          <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur-md border-b border-rule/50">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
              <div className="flex items-center justify-between gap-3 h-14">
                <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
                  <NavLink to="/" end className={navLinkClass}>
                    {tt('nav.home', lang)}
                  </NavLink>
                  <NavLink to="/events" className={navLinkClass}>
                    {tt('nav.events', lang)}
                  </NavLink>
                  <NavLink to="/entities" className={navLinkClass}>
                    {tt('nav.people', lang)}
                  </NavLink>
                </nav>

                {/* Mobile spacer so utilities stay right-aligned */}
                <div className="md:hidden" />

                {/* Minimal right-side utilities: Scrapbook + EN/বাংলা */}
                <div className="flex items-center gap-2">
                  <Link
                    to="/scrapbook"
                    title={tt('nav.scrapbook', lang)}
                    aria-label={tt('nav.scrapbook', lang)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rule/80 bg-paper-raised/90 px-3 py-1.5 text-xs text-ink hover:bg-paper-sunk transition-colors min-h-[36px]"
                  >
                    <Bookmark className="h-3.5 w-3.5 text-pencil" strokeWidth={1.6} />
                    {pins.length > 0 ? (
                      <span className="font-mono-data text-[11px]">
                        {formatNumber(pins.length, lang)}
                      </span>
                    ) : null}
                  </Link>

                  <button
                    type="button"
                    onClick={toggleLang}
                    aria-label={tt('lang.label', lang)}
                    className="inline-flex items-center rounded-full border border-rule/80 bg-paper-raised/90 px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunk transition-colors cursor-pointer min-h-[36px]"
                  >
                    <span className={lang === 'en' ? 'font-semibold text-ink' : 'text-pencil'}>
                      EN
                    </span>
                    <span className="mx-1.5 text-rule-strong">/</span>
                    <span className={lang === 'bn' ? 'font-semibold text-ink' : 'text-pencil'}>
                      বাংলা
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Main content */}
          <main
            id="main-content"
            className="flex-1 mx-auto w-full max-w-[1200px] px-4 sm:px-6 pt-6 pb-24 md:pb-16"
          >
            <Outlet />
          </main>

          {/* Soft minimal footer */}
          <footer className="border-t border-rule/50 bg-paper-raised/40 pb-20 md:pb-8">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-3 text-xs text-pencil">
              <p className="m-0 max-w-[70ch] leading-relaxed">{tt('app.about', lang)}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="uppercase tracking-wider text-[10px] font-semibold">
                  {tt('outlets.indexed', lang)}:
                </span>
                {ACCREDITED_OUTLETS.map((o) => (
                  <OutletName key={o} id={o} lang={lang} className="text-[11px] text-pencil" />
                ))}
              </div>
            </div>
          </footer>

          {/* Reading Trail floating pill */}
          <TrailBar lang={lang} />

          {/* Mobile bottom navigation bar */}
          <nav
            aria-label="Mobile navigation"
            className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-rule/70 bg-paper-raised/95 backdrop-blur-md"
          >
            <div className="grid grid-cols-4 text-[11px]">
              {(
                [
                  { to: '/', label: tt('nav.home', lang), Icon: Home, end: true },
                  { to: '/events', label: tt('nav.events', lang), Icon: Newspaper, end: false },
                  { to: '/entities', label: tt('nav.people.short', lang), Icon: Users, end: false },
                  { to: '/search', label: tt('nav.search', lang), Icon: Search, end: false },
                ] as const
              ).map(({ to, label, Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center gap-0.5 py-2 min-h-[54px] ${
                      isActive ? 'text-ink font-semibold' : 'text-pencil'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          </nav>

          {/* Global Omnibox */}
          <Omnibox open={omniboxOpen} onClose={() => setOmniboxOpen(false)} lang={lang} />
        </div>
      </PeekProvider>
    </TrailProvider>
  );
}
