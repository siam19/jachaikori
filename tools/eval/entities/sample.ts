#!/usr/bin/env bun
/**
 * @file tools/eval/entities/sample.ts
 * Stratified sampler that reads data/index/index.sqlite (read-only) and selects
 * 128 articles stratified across all outlets, Bangla + English, and ~15-20
 * সাবেক/ক্ষমতাচ্যুত প্রধানমন্ত্রী or foreign-PM edge cases.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface EvalArticleRecord {
  id: string;
  outlet: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  lead: string | null;
  clean_text: string | null;
  lang: 'bn' | 'en';
  stratum: 'edge_pm' | 'stratified';
}

interface RawArticleRow {
  id: string;
  outlet: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  lead: string | null;
  clean_text: string | null;
}

function resolveDbPath(): string {
  const candidates = [
    process.env.INDEX_DB_PATH,
    resolve(process.cwd(), 'data/index/index.sqlite'),
    '/home/bast0k/projects/jachaikori/data/index/index.sqlite',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Could not locate index.sqlite. Tried: ${candidates.join(', ')}`);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function detectLang(text: string): 'bn' | 'en' {
  const bnChars = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  return bnChars >= 10 ? 'bn' : 'en';
}

function main(): void {
  const TOTAL_TARGET = 128;
  const EDGE_TARGET = 18;
  const SEED = 20261118;
  const rng = mulberry32(SEED);

  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });

  const outlets = db
    .query<{ outlet: string }, []>('SELECT DISTINCT outlet FROM article ORDER BY outlet')
    .all()
    .map((r) => r.outlet);

  const edgeRows = db
    .query<RawArticleRow, []>(
      `SELECT id, outlet, canonical_url, title, published_at, lead, clean_text
       FROM article
       WHERE (
         title LIKE '%সাবেক প্রধানমন্ত্রী%'
         OR title LIKE '%ক্ষমতাচ্যুত প্রধানমন্ত্রী%'
         OR title LIKE '%ভারতের প্রধানমন্ত্রী%'
         OR title LIKE '%পাকিস্তানের প্রধানমন্ত্রী%'
         OR title LIKE '%ব্রিটিশ প্রধানমন্ত্রী%'
         OR title LIKE '%চীনের প্রধানমন্ত্রী%'
         OR title LIKE '%প্রধানমন্ত্রী মোদি%'
         OR title LIKE '%former prime minister%'
         OR title LIKE '%ex-pm%'
         OR lead LIKE '%সাবেক প্রধানমন্ত্রী%'
         OR lead LIKE '%ক্ষমতাচ্যুত প্রধানমন্ত্রী%'
         OR lead LIKE '%former prime minister%'
       )
       ORDER BY id`
    )
    .all();

  const selectedIds = new Set<string>();
  const selected: EvalArticleRecord[] = [];

  // Pick up to EDGE_TARGET edge cases, spread across outlets
  const shuffledEdge = shuffleDeterministic(edgeRows, rng);
  const edgeByOutlet = new Map<string, RawArticleRow[]>();
  for (const row of shuffledEdge) {
    const list = edgeByOutlet.get(row.outlet) ?? [];
    list.push(row);
    edgeByOutlet.set(row.outlet, list);
  }

  let edgeAdded = true;
  while (selected.length < EDGE_TARGET && edgeAdded) {
    edgeAdded = false;
    for (const outlet of outlets) {
      if (selected.length >= EDGE_TARGET) break;
      const bucket = edgeByOutlet.get(outlet);
      if (bucket && bucket.length > 0) {
        const row = bucket.pop()!;
        if (!selectedIds.has(row.id)) {
          selectedIds.add(row.id);
          selected.push({
            ...row,
            lang: detectLang(`${row.title} ${row.lead ?? ''}`),
            stratum: 'edge_pm',
          });
          edgeAdded = true;
        }
      }
    }
  }

  // Fill remaining slots stratified evenly across all outlets
  const remaining = TOTAL_TARGET - selected.length;
  const perOutlet = Math.floor(remaining / outlets.length);
  let extra = remaining % outlets.length;

  for (const outlet of outlets) {
    const quota = perOutlet + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;

    const rows = db
      .query<RawArticleRow, [string]>(
        `SELECT id, outlet, canonical_url, title, published_at, lead, clean_text
         FROM article
         WHERE outlet = ?
         ORDER BY id`
      )
      .all(outlet);

    const shuffled = shuffleDeterministic(rows, rng);
    let taken = 0;
    for (const row of shuffled) {
      if (taken >= quota) break;
      if (selectedIds.has(row.id)) continue;
      selectedIds.add(row.id);
      selected.push({
        ...row,
        lang: detectLang(`${row.title} ${row.lead ?? ''}`),
        stratum: 'stratified',
      });
      taken++;
    }
  }

  db.close();

  const outPath = resolve(dirname(import.meta.path), 'eval_128.jsonl');
  mkdirSync(dirname(outPath), { recursive: true });
  const lines = selected.map((rec) => JSON.stringify(rec)).join('\n') + '\n';
  writeFileSync(outPath, lines, 'utf8');

  const outletCounts: Record<string, number> = {};
  const langCounts: Record<string, number> = { bn: 0, en: 0 };
  const stratumCounts: Record<string, number> = { edge_pm: 0, stratified: 0 };
  for (const rec of selected) {
    outletCounts[rec.outlet] = (outletCounts[rec.outlet] ?? 0) + 1;
    langCounts[rec.lang] = (langCounts[rec.lang] ?? 0) + 1;
    stratumCounts[rec.stratum] = (stratumCounts[rec.stratum] ?? 0) + 1;
  }

  console.log(`Wrote ${selected.length} articles to ${outPath}`);
  console.log('Outlets:', JSON.stringify(outletCounts));
  console.log('Languages:', JSON.stringify(langCounts));
  console.log('Strata:', JSON.stringify(stratumCounts));
}

main();
