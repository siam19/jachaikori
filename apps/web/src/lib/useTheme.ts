import { useSyncExternalStore } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'jachaikori:theme';
const listeners = new Set<() => void>();

function readTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  } catch {
    // ignore
  }
  return 'auto';
}

let currentTheme: ThemeMode = readTheme();

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
}

applyTheme(currentTheme);

export function setThemeMode(next: ThemeMode): void {
  if (next === currentTheme) return;
  currentTheme = next;
  applyTheme(next);
  try {
    if (next === 'auto') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [ThemeMode, (next: ThemeMode) => void] {
  const mode = useSyncExternalStore(subscribe, () => currentTheme, () => 'auto' as ThemeMode);
  return [mode, setThemeMode];
}
