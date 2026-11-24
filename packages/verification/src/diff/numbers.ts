/**
 * @file packages/verification/src/diff/numbers.ts
 * Deterministic Bangla & English numeric claim normalizer and comparator.
 *
 * Handles:
 * - Bangla digits (০-৯) -> ASCII (0-9)
 * - South Asian scales: হাজার (1e3), লাখ/লক্ষ/lakh/lac (1e5), কোটি/crore/cr (1e7)
 * - International scales: K (1e3), M/million (1e6), B/bn/billion (1e9)
 * - Unit families: currency_bdt (টাকা/Tk/BDT/৳), currency_usd ($/ডলার/USD), percent (%/শতাংশ), count
 * - Cross-script equivalence: "৫০০ কোটি টাকা" == "Tk 500 crore" == "Tk 5 billion"
 */

import type { ClaimDiffItem } from '@jachaikori/schema';

export type NumericUnitFamily = 'currency_bdt' | 'currency_usd' | 'percent' | 'count';

export interface ParsedQuantity {
  raw: string;
  baseNumber: number;
  multiplier: number;
  canonicalValue: number;
  unitFamily: NumericUnitFamily;
}

const BANGLA_DIGIT_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (ch) => BANGLA_DIGIT_MAP[ch] ?? ch);
}

function detectUnitFamily(rawNorm: string): NumericUnitFamily {
  if (/(?:%|শতাংশ|পার্সেন্ট|percent|pct)/i.test(rawNorm)) return 'percent';
  if (/(?:\$|us\$|usd|ডলার|dollar)/i.test(rawNorm)) return 'currency_usd';
  if (/(?:৳|টাকা|টাকার|tk\.?|taka|bdt)/i.test(rawNorm)) return 'currency_bdt';
  return 'count';
}

function detectScaleMultiplier(rawNorm: string): number {
  if (/(?:বিলিয়ন|বিলিয়ন|billion|\bbn\b|(?<=\d)b\b)/i.test(rawNorm)) return 1e9;
  if (/(?:কোটি|crores?|\bcr\b|(?<=\d)cr\b)/i.test(rawNorm)) return 1e7;
  if (/(?:মিলিয়ন|মিলিয়ন|million|\bmn\b|(?<=\d)m\b)/i.test(rawNorm)) return 1e6;
  if (/(?:লাখ|লক্ষ|lakhs?|lacs?)/i.test(rawNorm)) return 1e5;
  if (/(?:হাজার|thousand|(?<=\d)k\b)/i.test(rawNorm)) return 1e3;
  return 1;
}

const DATE_PHRASE_RE =
  /(?:\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|(?:[\d০-৯]{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|জানুয়া?রি|জানুয়া?রী|ফেব্রুয়া?রি|ফেব্রুয়া?রী|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|আগষ্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)(?:[,\s]+[\d০-৯]{1,4}){0,2})/gi;

/**
 * Extracts structured numeric quantities from a string or array of claim number spans.
 * Strips calendar date phrases first and skips bare 4-digit years (1900–2099) without
 * units/scales so date numbers (e.g. "১৮" in "১৮ নভেম্বর ২০২৬") are never compared as counts.
 */
export function parseQuantities(inputs: string[]): ParsedQuantity[] {
  const results: ParsedQuantity[] = [];
  const seen = new Set<string>();

  // Match optional currency prefix + digits + optional scale + optional currency/percent suffix
  const spanRe =
    /(?:(?:us\$|\$|৳|tk\.?|bdt)\s*)?[\d০-৯]+(?:[,][\d০-৯]+)*(?:\.[\d০-৯]+)?(?:\s*(?:কোটি|লাখ|লক্ষ|হাজার|মিলিয়ন|মিলিয়ন|বিলিয়ন|বিলিয়ন|crores?|cr|lakhs?|lacs?|million|mn|m|billion|bn|b|thousand|k))?(?:\s*(?:টাকা|টাকার|ডলার|ডলারের|শতাংশ|পার্সেন্ট|%|percent|pct|tk\.?|taka|bdt|usd|dollars?))?/gi;

  for (const rawInput of inputs) {
    if (!rawInput || !rawInput.trim()) continue;
    const withoutDates = rawInput.normalize('NFC').replace(DATE_PHRASE_RE, ' ');
    const matches = withoutDates.match(spanRe) ?? [];
    for (const m of matches) {
      const raw = m.trim();
      if (!raw || !/[\d০-৯]/.test(raw)) continue;

      const ascii = toAsciiDigits(raw);
      const numMatch = ascii.match(/\d+(?:,\d+)*(?:\.\d+)?/);
      if (!numMatch) continue;
      const baseNumber = Number(numMatch[0].replace(/,/g, ''));
      if (!Number.isFinite(baseNumber)) continue;

      const multiplier = detectScaleMultiplier(ascii);
      const unitFamily = detectUnitFamily(ascii);

      // Ignore bare calendar years (e.g., "2026", "1971") with no scale or unit
      if (
        unitFamily === 'count' &&
        multiplier === 1 &&
        Number.isInteger(baseNumber) &&
        baseNumber >= 1900 &&
        baseNumber <= 2099
      ) {
        continue;
      }

      const canonicalValue = baseNumber * multiplier;
      const dedupeKey = `${unitFamily}|${canonicalValue}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({
        raw,
        baseNumber,
        multiplier,
        canonicalValue,
        unitFamily,
      });
    }
  }

  return results;
}

export function formatCanonicalQuantity(q: ParsedQuantity): string {
  const val = q.canonicalValue;
  if (q.unitFamily === 'percent') return `${val}%`;
  const prefix = q.unitFamily === 'currency_usd' ? '$' : q.unitFamily === 'currency_bdt' ? 'Tk ' : '';
  if (val >= 1e9) return `${prefix}${(val / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (val >= 1e7 && q.unitFamily === 'currency_bdt') {
    return `${prefix}${(val / 1e7).toFixed(2).replace(/\.00$/, '')} crore`;
  }
  if (val >= 1e6) return `${prefix}${(val / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  return `${prefix}${val.toLocaleString('en-US')}`;
}

export interface NumericComparisonOptions {
  /** Relative difference tolerance considered an exact match (default: 0.02 = 2%). */
  tolerance?: number;
}

/**
 * Deterministically compares card numeric claims against an accredited article's numbers.
 */
export function compareNumericClaims(
  cardNumberSpans: string[],
  articleNumberSpans: string[],
  opts: NumericComparisonOptions = {}
): ClaimDiffItem[] {
  const tolerance = opts.tolerance ?? 0.02;
  const cardNums = parseQuantities(cardNumberSpans);
  const artNums = parseQuantities(articleNumberSpans);
  if (cardNums.length === 0 || artNums.length === 0) return [];

  const diffs: ClaimDiffItem[] = [];

  for (const c of cardNums) {
    // Prefer candidates in the exact same unit family; fall back to count only if one side is count
    const sameUnit = artNums.filter((a) => a.unitFamily === c.unitFamily);
    const pool =
      sameUnit.length > 0
        ? sameUnit
        : c.unitFamily === 'count'
        ? artNums
        : artNums.filter((a) => a.unitFamily === 'count');

    if (pool.length === 0) continue;

    // Pick closest candidate by log-scale ratio
    let best = pool[0]!;
    let bestRelDiff = Infinity;
    for (const a of pool) {
      const denom = Math.max(Math.abs(a.canonicalValue), Math.abs(c.canonicalValue), 1e-9);
      const rel = Math.abs(c.canonicalValue - a.canonicalValue) / denom;
      if (rel < bestRelDiff) {
        bestRelDiff = rel;
        best = a;
      }
    }

    if (bestRelDiff <= tolerance) {
      diffs.push({
        flag: 'match',
        severity: 'info',
        deterministic: true,
        cardSpan: c.raw,
        articleSpan: best.raw,
        explanationEn: `Figure matches accredited reporting (${c.raw} ≈ ${best.raw}).`,
        explanationBn: `সংখ্যাটি মূলধারার প্রতিবেদনের সঙ্গে মিলেছে (${c.raw} ≈ ${best.raw})।`,
        confidence: 0.98,
      });
    } else if (sameUnit.length > 0 && c.unitFamily !== 'count') {
      // High-precision mismatch inside explicit currency or percentage family
      const ratio =
        best.canonicalValue !== 0 ? c.canonicalValue / best.canonicalValue : Number.POSITIVE_INFINITY;
      const major = ratio >= 1.5 || ratio <= 0.67 || Math.abs(c.canonicalValue - best.canonicalValue) >= 5;
      diffs.push({
        flag: 'mismatch_number',
        severity: major ? 'major' : 'notable',
        deterministic: true,
        cardSpan: c.raw,
        articleSpan: best.raw,
        explanationEn: `Card states "${c.raw}" (${formatCanonicalQuantity(c)}), whereas the accredited article reports "${best.raw}" (${formatCanonicalQuantity(best)}).`,
        explanationBn: `কার্ডে উল্লেখ করা হয়েছে "${c.raw}", তবে মূলধারার প্রতিবেদনে রয়েছে "${best.raw}"।`,
        confidence: 0.96,
      });
    } else if (c.unitFamily === 'count' && best.unitFamily === 'count' && sameUnit.length <= 2) {
      // Only flag unitless count mismatches when the article has a small unambiguous set of counts
      const ratio =
        best.canonicalValue !== 0 ? c.canonicalValue / best.canonicalValue : Number.POSITIVE_INFINITY;
      if (ratio <= 20 && ratio >= 0.05) {
        diffs.push({
          flag: 'mismatch_number',
          severity: ratio >= 1.5 || ratio <= 0.67 ? 'major' : 'notable',
          deterministic: true,
          cardSpan: c.raw,
          articleSpan: best.raw,
          explanationEn: `Card cites "${c.raw}", whereas the accredited article cites "${best.raw}".`,
          explanationBn: `কার্ডে "${c.raw}" উল্লেখ রয়েছে, কিন্তু প্রতিবেদনে "${best.raw}" উল্লেখ রয়েছে।`,
          confidence: 0.85,
        });
      }
    }
  }

  return diffs;
}
