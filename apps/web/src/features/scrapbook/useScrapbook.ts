import { useCallback, useEffect, useState } from 'react';
import { scrapbook, type Pin } from './store';

const listeners = new Set<() => void>();
let cachedPins: Pin[] = [];
let loaded = false;

async function refreshPins(): Promise<void> {
  cachedPins = await scrapbook.list();
  loaded = true;
  for (const fn of listeners) fn();
}

export function useScrapbook() {
  const [pins, setPins] = useState<Pin[]>(cachedPins);

  useEffect(() => {
    const sync = () => setPins([...cachedPins]);
    listeners.add(sync);
    if (!loaded) {
      void refreshPins();
    } else {
      sync();
    }
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const isPinned = useCallback(
    (id: string, kind: Pin['kind']) => pins.some((p) => p.id === id && p.kind === kind),
    [pins]
  );

  const togglePin = useCallback(async (pin: Omit<Pin, 'at'>) => {
    const exists = cachedPins.some((p) => p.id === pin.id && p.kind === pin.kind);
    if (exists) {
      await scrapbook.remove(pin.id);
    } else {
      await scrapbook.add({ ...pin, at: Date.now() });
    }
    await refreshPins();
  }, []);

  const removePin = useCallback(async (id: string) => {
    await scrapbook.remove(id);
    await refreshPins();
  }, []);

  const clearAll = useCallback(async () => {
    await scrapbook.clear();
    await refreshPins();
  }, []);

  return { pins, isPinned, togglePin, removePin, clearAll };
}
