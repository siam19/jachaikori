/**
 * @file packages/verification/src/diff/dates.ts
 * Deterministic Bangla & English date parser and comparator (anchored to Asia/Dhaka UTC+6).
 *
 * Detects:
 * - Exact date agreement (<= 1 day press-time/timezone tolerance)
 * - Altered dates (2–29 days off)
 * - Recycled old-news photo cards (>= 30 days difference from accredited article date)
 */

import type { ClaimDiffItem } from '@jachaikori/schema';
import { toAsciiDigits, toBanglaDigits } from './numbers';

export interface ParsedDateRef {
  raw: string;
  isoDate: string; // YYYY-MM-DD
  epochDay: number;
  inferredYear: boolean;
}

const MONTH_MAP: Record<string, number> = {
  // English
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
  // Bangla Gregorian month spellings (with nukta & vowel variants)
  'জানুয়ারি': 1, 'জানুয়ারি': 1, 'জানুয়ারী': 1, 'জানুয়ারী': 1,
  'ফেব্রুয়ারি': 2, 'ফেব্রুয়ারি': 2, 'ফেব্রুয়ারী': 2, 'ফেব্রুয়ারী': 2,
  'মার্চ': 3,
  'এপ্রিল': 4,
  'মে': 5,
  'জুন': 6,
  'জুলাই': 7,
  'আগস্ট': 8, 'আগষ্ট': 8,
  'সেপ্টেম্বর': 9,
  'অক্টোবর': 10,
  'নভেম্বর': 11,
  'ডিসেম্বর': 12,
};

const MS_PER_DAY = 86_400_000;
const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

function toDhakaDateParts(isoOrDate: string): { year: number; month: number; day: number; epochDay: number; isoDate: string } | null {
  const direct = isoOrDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    const y = Number(direct[1]);
    const m = Number(direct[2]);
    const d = Number(direct[3]);
    const epochDay = Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
    return { year: y, month: m, day: d, epochDay, isoDate: `${direct[1]}-${direct[2]}-${direct[3]}` };
  }
  const ms = Date.parse(isoOrDate);
  if (Number.isNaN(ms)) return null;
  const dt = new Date(ms + DHAKA_OFFSET_MS);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const epochDay = Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
  return { year: y, month: m, day: d, epochDay, isoDate };
}

function makeParsedDate(raw: string, year: number, month: number, day: number, inferredYear: boolean): ParsedDateRef | null {
  if (year < 1970 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { raw, isoDate, epochDay, inferredYear };
}

/**
 * Parses an absolute or relative Bangla/English date span into a canonical `YYYY-MM-DD`.
 */
export function parseDateSpan(raw: string, anchorIso?: string | null): ParsedDateRef | null {
  const clean = toAsciiDigits(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  const anchor = anchorIso ? toDhakaDateParts(anchorIso) : null;

  // 1. ISO YYYY-MM-DD
  const isoM = clean.match(/\b(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoM) {
    return makeParsedDate(raw, Number(isoM[1]), Number(isoM[2]), Number(isoM[3]), false);
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmyM = clean.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|19\d{2})\b/);
  if (dmyM) {
    return makeParsedDate(raw, Number(dmyM[3]), Number(dmyM[2]), Number(dmyM[1]), false);
  }

  // 3. Relative Bangla/English markers anchored to publication date
  if (anchor) {
    if (/(?:গত\s*পরশু|day before yesterday)/i.test(clean)) {
      const dt = new Date((anchor.epochDay - 2) * MS_PER_DAY);
      return makeParsedDate(raw, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), false);
    }
    if (/(?:গতকাল|yesterday)/i.test(clean)) {
      const dt = new Date((anchor.epochDay - 1) * MS_PER_DAY);
      return makeParsedDate(raw, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), false);
    }
    if (/(?:আজ|today)/i.test(clean) && !/(?:আজকের\s+পত্রিকা)/i.test(clean)) {
      return makeParsedDate(raw, anchor.year, anchor.month, anchor.day, false);
    }
    if (/(?:আগামীকাল|tomorrow)/i.test(clean)) {
      const dt = new Date((anchor.epochDay + 1) * MS_PER_DAY);
      return makeParsedDate(raw, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), false);
    }
  }

  // 4. Token-based "DD Month [YYYY]" or "Month DD[,] [YYYY]" (Bangla or English)
  const tokens = clean
    .replace(/[,।]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const tLow = tokens[i]!.toLowerCase();
    const monthNum = MONTH_MAP[tLow];
    if (!monthNum) continue;

    // Pattern A: DD Month [YYYY]  (e.g., "18 November 2026", "১৪ নভেম্বর ২০২৬", "১৪ নভেম্বর")
    const prevNum = i > 0 ? Number(tokens[i - 1]) : NaN;
    const nextNum = i + 1 < tokens.length ? Number(tokens[i + 1]) : NaN;
    const next2Num = i + 2 < tokens.length ? Number(tokens[i + 2]) : NaN;

    if (Number.isInteger(prevNum) && prevNum >= 1 && prevNum <= 31) {
      if (Number.isInteger(nextNum) && nextNum >= 1970 && nextNum <= 2099) {
        return makeParsedDate(raw, nextNum, monthNum, prevNum, false);
      }
      if (anchor) {
        return makeParsedDate(raw, anchor.year, monthNum, prevNum, true);
      }
    }

    // Pattern B: Month DD [YYYY] (e.g., "November 18, 2026")
    if (Number.isInteger(nextNum) && nextNum >= 1 && nextNum <= 31) {
      if (Number.isInteger(next2Num) && next2Num >= 1970 && next2Num <= 2099) {
        return makeParsedDate(raw, next2Num, monthNum, nextNum, false);
      }
      if (anchor) {
        return makeParsedDate(raw, anchor.year, monthNum, nextNum, true);
      }
    }
  }

  return null;
}

/**
 * Deterministically compares card date claims against article dates & publication timestamp.
 */
export function compareDateClaims(params: {
  cardDates: string[];
  cardText?: string;
  articleDates: string[];
  articlePublishedAt: string | null;
  nowIso?: string;
}): ClaimDiffItem[] {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const artPub = params.articlePublishedAt ? toDhakaDateParts(params.articlePublishedAt) : null;

  const parsedCardDates: ParsedDateRef[] = [];
  for (const d of params.cardDates) {
    const p = parseDateSpan(d, nowIso);
    if (p) parsedCardDates.push(p);
  }

  const parsedArtDates: ParsedDateRef[] = [];
  for (const d of params.articleDates) {
    const p = parseDateSpan(d, params.articlePublishedAt ?? nowIso);
    if (p) parsedArtDates.push(p);
  }
  if (artPub) {
    parsedArtDates.push({
      raw: artPub.isoDate,
      isoDate: artPub.isoDate,
      epochDay: artPub.epochDay,
      inferredYear: false,
    });
  }

  const diffs: ClaimDiffItem[] = [];

  if (parsedCardDates.length > 0 && parsedArtDates.length > 0) {
    for (const c of parsedCardDates) {
      let best = parsedArtDates[0]!;
      let bestGap = Infinity;
      for (const a of parsedArtDates) {
        const gap = Math.abs(c.epochDay - a.epochDay);
        if (gap < bestGap) {
          bestGap = gap;
          best = a;
        }
      }

      if (bestGap <= 1) {
        diffs.push({
          flag: 'match',
          severity: 'info',
          deterministic: true,
          cardSpan: c.raw,
          articleSpan: best.isoDate,
          explanationEn: `Date aligns with accredited reporting (${c.isoDate}).`,
          explanationBn: `তারিখটি মূলধারার প্রতিবেদনের সঙ্গে সামঞ্জস্যপূর্ণ (${toBanglaDigits(c.isoDate)})।`,
          confidence: 0.96,
        });
      } else if (bestGap >= 30) {
        diffs.push({
          flag: 'mismatch_date',
          severity: 'major',
          deterministic: true,
          cardSpan: c.raw,
          articleSpan: best.isoDate,
          explanationEn: `Card displays "${c.raw}" (${c.isoDate}), while the matched accredited report is dated ${best.isoDate} (${bestGap} days apart).`,
          explanationBn: `কার্ডে তারিখ "${c.raw}" (${toBanglaDigits(c.isoDate)}) দেখালেও মূলধারার প্রতিবেদনটি ${toBanglaDigits(best.isoDate)} তারিখের (${toBanglaDigits(String(bestGap))} দিনের ব্যবধান)।`,
          confidence: 0.95,
        });
      } else {
        diffs.push({
          flag: 'mismatch_date',
          severity: 'notable',
          deterministic: true,
          cardSpan: c.raw,
          articleSpan: best.isoDate,
          explanationEn: `Card cites "${c.raw}" (${c.isoDate}), whereas the accredited article cites ${best.isoDate} (${bestGap} days apart).`,
          explanationBn: `কার্ডে "${c.raw}" (${toBanglaDigits(c.isoDate)}) উল্লেখ থাকলেও প্রতিবেদনে ${toBanglaDigits(best.isoDate)} উল্লেখ রয়েছে (${toBanglaDigits(String(bestGap))} দিনের ব্যবধান)।`,
          confidence: 0.92,
        });
      }
    }
    return diffs;
  }

  // Recycled old-news check: card has breaking/today framing with no date, while article is > 180 days old
  if (parsedCardDates.length === 0 && artPub && params.cardText) {
    const nowParts = toDhakaDateParts(nowIso);
    const hasBreakingFraming = /(?:এইমাত্র|আজ|ব্রেকিং|breaking|just in|today)/i.test(params.cardText);
    if (nowParts && hasBreakingFraming) {
      const ageDays = nowParts.epochDay - artPub.epochDay;
      if (ageDays >= 180) {
        diffs.push({
          flag: 'mismatch_date',
          severity: 'notable',
          deterministic: true,
          cardSpan: 'breaking / today framing',
          articleSpan: artPub.isoDate,
          explanationEn: `Card uses recent/breaking framing, while the matched accredited article was published on ${artPub.isoDate} (${ageDays} days earlier).`,
          explanationBn: `কার্ডটিতে সাম্প্রতিক ঘটনার ইঙ্গিত থাকলেও মূলধারার প্রতিবেদনটি ${toBanglaDigits(artPub.isoDate)} তারিখে প্রকাশিত (${toBanglaDigits(String(ageDays))} দিন আগের)।`,
          confidence: 0.86,
        });
      }
    }
  }

  return diffs;
}
