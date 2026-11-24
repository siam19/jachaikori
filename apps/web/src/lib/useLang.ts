import { useSyncExternalStore } from 'react';
import type { Lang } from '../i18n/tt';

const STORAGE_KEY = 'jachaikori:lang';
const listeners = new Set<() => void>();

function readLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'bn' || saved === 'en') return saved;
  } catch {
    // ignore storage errors
  }
  return 'en';
}

let currentLang: Lang = readLang();

function syncDocumentLang(lang: Lang): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
}

syncDocumentLang(currentLang);

export function setLang(next: Lang): void {
  if (next === currentLang) return;
  currentLang = next;
  syncDocumentLang(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(currentLang === 'en' ? 'bn' : 'en');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLang(): [Lang, (next: Lang) => void, () => void] {
  const lang = useSyncExternalStore(subscribe, () => currentLang, () => 'en' as Lang);
  return [lang, setLang, toggleLang];
}
