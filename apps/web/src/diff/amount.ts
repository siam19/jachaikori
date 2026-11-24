const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

const SCALE_ENTRIES: Array<[string, number]> = [
  ['বিলিয়ন', 1e9],
  ['বিলিয়ন', 1e9],
  ['billion', 1e9],
  ['মিলিয়ন', 1e6],
  ['মিলিয়ন', 1e6],
  ['million', 1e6],
  ['thousand', 1e3],
  ['কোটি', 1e7],
  ['crores', 1e7],
  ['crore', 1e7],
  ['লাখ', 1e5],
  ['লক্ষ', 1e5],
  ['lakhs', 1e5],
  ['lakh', 1e5],
  ['lacs', 1e5],
  ['lac', 1e5],
  ['হাজার', 1e3],
  ['bn', 1e9],
  ['cr', 1e7],
  ['mn', 1e6],
  ['b', 1e9],
  ['m', 1e6],
  ['k', 1e3],
];

/**
 * Parses a Bangla or English numeric span (including South Asian scales like
 * হাজার/লাখ/কোটি and international K/M/B) for drawing the Lineup log-scale ruler.
 * Drawing-only: the backend remains the authoritative diff comparator.
 */
export function parseAmount(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const ascii = [...raw.replace(/,/g, '')]
    .map((c) => {
      const idx = BN_DIGITS.indexOf(c);
      return idx >= 0 ? String(idx) : c;
    })
    .join('');

  const match = ascii.match(/(\d+(?:\.\d+)?)\s*([^\d]*)/);
  if (!match) return null;

  const base = Number.parseFloat(match[1]!);
  if (!Number.isFinite(base)) return null;

  const tail = (match[2] ?? '').trim().toLowerCase();
  let multiplier = 1;
  for (const [key, scale] of SCALE_ENTRIES) {
    if (tail === key || tail.startsWith(`${key} `) || tail.startsWith(key)) {
      // Avoid matching 'm' in 'may' or 'b' in 'bdt'
      if (key.length === 1 && tail.length > 1 && /^[a-z]/.test(tail[1]!)) {
        continue;
      }
      multiplier = scale;
      break;
    }
  }

  const val = base * multiplier;
  return Number.isFinite(val) ? val : null;
}

/**
 * Computes a 0..1 x position on a log10 ruler for positive numbers.
 */
export function rulerX(v: number, lo: number, hi: number): number {
  if (v <= 0 || lo <= 0 || hi <= 0) return 0.5;
  const logLo = Math.log10(lo);
  const logHi = Math.log10(hi);
  const span = logHi - logLo;
  if (span <= 0) return 0.5;
  return Math.max(0, Math.min(1, (Math.log10(v) - logLo) / span));
}

/**
 * Attempts to parse an ISO/English date string into epoch days for the date-gap bar.
 */
export function parseIsoDateDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}
