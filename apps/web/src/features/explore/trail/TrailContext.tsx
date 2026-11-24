import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface TrailStop {
  kind: 'entity' | 'event' | 'check' | 'search';
  id: string;
  label: { en: string; bn: string };
  at: number;
}

interface TrailContextValue {
  stops: TrailStop[];
  pushStop: (stop: Omit<TrailStop, 'at'>) => void;
  clearTrail: () => void;
  encodeTrailUrl: () => string;
}

const STORAGE_KEY = 'jachaikori:trail:v1';
const MAX_STOPS = 12;

const TrailContext = createContext<TrailContextValue | null>(null);

function readInitialStops(): TrailStop[] {
  if (typeof window === 'undefined') return [];
  try {
    const sp = new URLSearchParams(window.location.search);
    const shared = sp.get('trail');
    if (shared) {
      const parsed = JSON.parse(decodeURIComponent(atob(shared))) as TrailStop[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(-MAX_STOPS);
      }
    }
  } catch {
    // ignore malformed shared trail
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrailStop[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_STOPS) : [];
  } catch {
    return [];
  }
}

export function TrailProvider({ children }: { children: ReactNode }) {
  const [stops, setStops] = useState<TrailStop[]>(readInitialStops);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
    } catch {
      // ignore
    }
  }, [stops]);

  const pushStop = useCallback((stop: Omit<TrailStop, 'at'>) => {
    setStops((prev) => {
      const last = prev.at(-1);
      if (last && last.kind === stop.kind && last.id === stop.id) {
        return prev;
      }
      const deduped = prev.filter((s) => !(s.kind === stop.kind && s.id === stop.id));
      return [...deduped, { ...stop, at: Date.now() }].slice(-MAX_STOPS);
    });
  }, []);

  const clearTrail = useCallback(() => {
    setStops([]);
  }, []);

  const encodeTrailUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    try {
      const compact = stops.map(({ kind, id, label }) => ({ kind, id, label, at: 0 }));
      const encoded = btoa(encodeURIComponent(JSON.stringify(compact)));
      const url = new URL(window.location.href);
      url.searchParams.set('trail', encoded);
      return url.toString();
    } catch {
      return window.location.href;
    }
  }, [stops]);

  return (
    <TrailContext.Provider value={{ stops, pushStop, clearTrail, encodeTrailUrl }}>
      {children}
    </TrailContext.Provider>
  );
}

export function useTrail() {
  const ctx = useContext(TrailContext);
  if (!ctx) throw new Error('useTrail must be used inside TrailProvider');
  return ctx;
}

export function trailStopHref(stop: TrailStop): string {
  switch (stop.kind) {
    case 'entity':
      return `/entities/${encodeURIComponent(stop.id)}`;
    case 'event':
      return `/events/${encodeURIComponent(stop.id)}`;
    case 'check':
      return `/checks/${encodeURIComponent(stop.id)}`;
    case 'search':
      return `/search?q=${encodeURIComponent(stop.id)}`;
  }
}
