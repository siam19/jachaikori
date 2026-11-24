/**
 * @file packages/entities/src/normalize.ts
 * Runtime-agnostic, single-pass Bangla & English surface normalization,
 * hyphenated & conservative Bangla inflection stripping, orthographic folding,
 * newspaper dateline stripping, sentence segmentation, and token span helpers.
 */

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const EDGE_PUNCT_RE = /^[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+|[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+$/g;
const BANGLA_CHAR_RE = /[\u0980-\u09FF]/;
const UPPERCASE_RE = /[A-Z]/;

// Longest-first Bangla case/plural suffixes stripped conservatively when stem >= minStemLen
const BANGLA_SUFFIXES = [
  'দেরকে',
  'গুলোর',
  'গুলো',
  'য়ের',
  'দের',
  'কে',
  'তে',
  'য়ে',
  'ের',
  'রা',
  'য়',
  'র',
  'ে',
  'এ',
];

// Hyphenated Bangla case/possessive suffixes (e.g., "বিএনপি-র", "বিজিএমইএ-এর", "ইউনূস-কে")
const HYPHENATED_BN_SUFFIX_RE = /^([\u0980-\u09FF]{2,})[-–](?:এর|দেরকে|দের|গুলোর|গুলো|কে|তে|য়ে|য়|র|রা|এ)$/;

// Common Bangla orthographic variant pairs mapped symmetrically into match variants
const BANGLA_ORTHO_VARIANTS: Record<string, string[]> = {
  হোসাইন: ['হোসেন'],
  হোসেন: ['হোসাইন'],
  আব্দুল: ['আবদুল'],
  আবদুল: ['আব্দুল'],
  আব্দুল্লাহ: ['আবদুল্লাহ'],
  আবদুল্লাহ: ['আব্দুল্লাহ'],
  আহমদ: ['আহমেদ'],
  আহমেদ: ['আহমদ'],
  মোহাম্মদ: ['মুহাম্মদ', 'মোহাম্মাদ'],
  মুহাম্মদ: ['মোহাম্মদ'],
  নিম্নতম: ['ন্যূনতম'],
  ন্যূনতম: ['নিম্নতম'],
  খাঁন: ['খান'],
  খান: ['খাঁন'],
  জামাত: ['জামায়াত'],
  জামায়াত: ['জামাত'],
  আওয়ামী: ['আওয়ামী'],
  আওয়ামী: ['আওয়ামী'],
  রাঙ্গামাটি: ['রাঙামাটি'],
  রাঙামাটি: ['রাঙ্গামাটি'],
  চাটগাঁ: ['চট্টগ্রাম'],
  মাহ্দী: ['মাহদী'],
  মাহদী: ['মাহ্দী'],
  শফিকুর: ['শফিক'],
  আক্তার: ['আখতার'],
  আখতার: ['আক্তার'],
};

/**
 * Leading Bangla & English newspaper dateline / bureau prefix patterns.
 * Anchored to start of lead/body (< 90 chars) so real news sentences are never clipped.
 */
const BN_DATELINE_RE =
  /^(?:(?:নিজস্ব\s+প্রতিবেদক|স্টাফ\s+রিপোর্টার|বিশেষ\s+প্রতিনিধি|অনলাইন\s+ডেস্ক|নিউজ\s+ডেস্ক|প্রতিবেদক|প্রতিনিধি)(?:,\s*[\u0980-\u09FF\s-]{2,28})?|[\u0980-\u09FF]{2,22}(?:,\s*[\u0980-\u09FF০-৯0-9\s]{3,28})?)\s*[:|—–\-]\s+/;

const EN_DATELINE_RE =
  /^(?:(?:Staff\s+Correspondent|Special\s+Correspondent|Tribune\s+Desk|TBS\s+Report|Star\s+Business\s+Report|UNB|BSS|BDNews24)(?:,\s*[A-Za-z\s'-]{2,28})?|(?:Dhaka|Chattogram|Chittagong|Sylhet|Rajshahi|Khulna|Barishal|Rangpur|Mymensingh|Gazipur|Savar|Narayanganj|Cumilla|Cox's\s+Bazar|Bangladesh)(?:,\s*[A-Za-z0-9\s,]{2,26})?(?:\s*\((?:UNB|BSS|Reuters|AFP|AP)\))?)\s*(?:[:—–]|--|-)\s+/i;

/**
 * Normalizes Bangla/English text (Unicode NFC, strips zero-width chars, normalizes quotes & whitespace).
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips routine newspaper datelines / correspondent prefixes at the start of lead/body text
 * (e.g., "ঢাকা, ১৪ নভেম্বর: ...", "নিজস্ব প্রতিবেদক, ঢাকা: ...", "Dhaka, Nov 14 — ...").
 */
export function stripDateline(text: string): string {
  const clean = normalizeText(text);
  if (!clean) return '';

  // Only inspect leading 95 chars so we never accidentally match deep colons in headlines/quotes
  const head = clean.slice(0, 95);
  const bnMatch = BN_DATELINE_RE.exec(head);
  if (bnMatch && bnMatch[0].length < clean.length - 12) {
    return clean.slice(bnMatch[0].length).trimStart();
  }
  const enMatch = EN_DATELINE_RE.exec(head);
  if (enMatch && enMatch[0].length < clean.length - 12) {
    return clean.slice(enMatch[0].length).trimStart();
  }
  return clean;
}

/**
 * Fast inner token normalizer assuming the input string is ALREADY Unicode-NFC normalized.
 */
function normalizePreNormalizedToken(raw: string): string {
  let clean = raw.replace(EDGE_PUNCT_RE, '');
  if (!clean) return '';
  if (clean.endsWith("'s") && clean.length > 2) {
    clean = clean.slice(0, -2);
  }
  return clean.toLowerCase();
}

/**
 * Normalizes a single surface token for alias matching:
 * - Lowercases English, strips `'s` / `’s`
 * - Preserves Bangla NFC characters without splitting matras/hasanta
 */
export function normalizeToken(raw: string): string {
  return normalizePreNormalizedToken(normalizeText(raw));
}

/**
 * Fast variant generator assuming `norm` is already normalized via `normalizePreNormalizedToken`.
 */
function buildVariantsFromNorm(norm: string): string[] {
  if (!norm) return [];
  if (!BANGLA_CHAR_RE.test(norm)) {
    return [norm];
  }

  const variants: string[] = [norm];
  const seen = new Set<string>(variants);
  const addVariant = (v: string) => {
    if (v && !seen.has(v)) {
      seen.add(v);
      variants.push(v);
    }
  };

  // 1) Hyphenated Bangla case suffixes ("বিএনপি-র" -> "বিএনপি", "বিজিএমইএ-এর" -> "বিজিএমইএ")
  const hyphMatch = HYPHENATED_BN_SUFFIX_RE.exec(norm);
  if (hyphMatch && hyphMatch[1]) {
    addVariant(hyphMatch[1]);
  }

  // 2) Conservative suffix stripping on both exact token and hyphen-stripped stem
  const bases = hyphMatch && hyphMatch[1] ? [norm, hyphMatch[1]] : [norm];
  for (const base of bases) {
    for (const suffix of BANGLA_SUFFIXES) {
      const minStemLen = suffix.length === 1 ? 4 : 3;
      if (base.endsWith(suffix) && base.length - suffix.length >= minStemLen) {
        addVariant(base.slice(0, -suffix.length));
      }
    }
  }

  // 3) Common Bangla orthographic variants across generated stems
  const snapshotLen = variants.length;
  for (let i = 0; i < snapshotLen; i++) {
    const alts = BANGLA_ORTHO_VARIANTS[variants[i]!];
    if (alts) {
      for (const alt of alts) addVariant(alt);
    }
  }

  return variants;
}

/**
 * Produces stem & orthographic variants for a Bangla or English token
 * (exact token first, then hyphenated/inflected Bangla stems and common spelling variants).
 */
export function getTokenMatchVariants(rawToken: string): string[] {
  const norm = normalizeToken(rawToken);
  return buildVariantsFromNorm(norm);
}

/**
 * Canonicalizes a phrase for dictionary/candidate indexing (NFC, lowercased English, edge punct stripped).
 */
export function normalizePhrase(raw: string): string {
  const clean = normalizeText(raw);
  if (!clean) return '';
  return clean
    .split(/\s+/)
    .map(normalizePreNormalizedToken)
    .filter(Boolean)
    .join(' ');
}

export interface TokenSpan {
  raw: string;
  norm: string;
  variants: string[];
  hasUppercase: boolean;
  isBangla: boolean;
  startIndex: number;
  endIndex: number;
  precededByClauseBreak: boolean;
}

const CLAUSE_BREAK_CHAR_RE = /[,;:—–()[\]{}|]/;

/**
 * Single-pass tokenizer preserving character offsets, case, clause boundaries, and Bangla stem variants.
 */
export function tokenizeWithSpans(text: string, alreadyNormalized = false): TokenSpan[] {
  const normalized = alreadyNormalized ? text : normalizeText(text);
  const tokens: TokenSpan[] = [];
  const re = /[^\s"'‘’“”()[\]{},;!?।॥/\\]+/g;
  let m: RegExpExecArray | null;
  let prevEnd = 0;

  while ((m = re.exec(normalized)) !== null) {
    const raw = m[0]!;
    let startIndex = m.index;
    const gap = normalized.slice(prevEnd, startIndex);
    const precededByClauseBreak = tokens.length > 0 && CLAUSE_BREAK_CHAR_RE.test(gap);

    const trimmed = raw.replace(EDGE_PUNCT_RE, '');
    prevEnd = startIndex + raw.length;
    if (!trimmed) continue;

    const leadDiff = raw.indexOf(trimmed);
    startIndex += Math.max(0, leadDiff);
    const endIndex = startIndex + trimmed.length;

    const norm = normalizePreNormalizedToken(trimmed);
    if (!norm) continue;

    tokens.push({
      raw: trimmed,
      norm,
      variants: buildVariantsFromNorm(norm),
      hasUppercase: UPPERCASE_RE.test(trimmed),
      isBangla: BANGLA_CHAR_RE.test(norm),
      startIndex,
      endIndex,
      precededByClauseBreak,
    });
  }

  return tokens;
}

/**
 * Splits headline + body text into clean sentences for hypergraph relation extraction.
 */
export function splitSentences(text: string, alreadyNormalized = false): string[] {
  const normalized = alreadyNormalized ? text : normalizeText(text);
  if (!normalized) return [];

  // Split on Bangla dari (।), newline breaks, or English sentence boundary [.!?] followed by space/end
  return normalized
    .split(/(?:[।॥\n]+|(?<![0-9A-Z])[.!?](?=\s|$))/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}
