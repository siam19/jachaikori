import { get, set } from 'idb-keyval';

export type PinKind = 'check' | 'entity' | 'event';

export interface Pin {
  id: string;
  kind: PinKind;
  label: { en: string; bn: string };
  subtitle?: string;
  at: number;
}

export interface ScrapbookStore {
  list(): Promise<Pin[]>;
  add(pin: Pin): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

const IDB_KEY = 'jachaikori:scrapbook:v1';

export function createIdbScrapbook(): ScrapbookStore {
  return {
    async list(): Promise<Pin[]> {
      try {
        const items = await get<Pin[]>(IDB_KEY);
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    },
    async add(pin: Pin): Promise<void> {
      const current = await this.list();
      const next = [pin, ...current.filter((p) => !(p.id === pin.id && p.kind === pin.kind))];
      await set(IDB_KEY, next);
    },
    async remove(id: string): Promise<void> {
      const current = await this.list();
      await set(
        IDB_KEY,
        current.filter((p) => p.id !== id)
      );
    },
    async clear(): Promise<void> {
      await set(IDB_KEY, []);
    },
  };
}

// Single swap point when remote accounts arrive later
export const scrapbook: ScrapbookStore = createIdbScrapbook();
