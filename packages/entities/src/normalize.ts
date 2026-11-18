/**
 * @file packages/entities/src/normalize.ts
 * Runtime-agnostic Bangla & English surface normalization, conservative Bangla
 * inflection stripping, sentence segmentation, and token helpers.
 */

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const EDGE_PUNCT_RE = /^[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+|[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+$/g;

// Longest-first Bangla case/plural suffixes stripped conservatively when stem >= 3 chars
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

const BANGLA_CHAR_RE = /[\u0980-\u09FF]/;

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
 * Normalizes a single surface token for alias matching:
 * - Lowercases English, strips `'s` / `’s`
 * - Preserves Bangla NFC characters without splitting matras/hasanta
 */
export function normalizeToken(raw: string): string {
  let clean = normalizeText(raw).replace(EDGE_PUNCT_RE, '');
  if (!clean) return '';
  if (clean.endsWith("'s") && clean.length > 2) {
    clean = clean.slice(0, -2);
  }
  return clean.toLowerCase();
}

/**
 * Produces stem candidates for a Bangla or English normalized token (exact token first,
 * then conservative Bangla suffix-stripped variants for inflected nouns like "ভারতের" -> "ভারত").
 */
export function getTokenMatchVariants(rawToken: string): string[] {
  const norm = normalizeToken(rawToken);
  if (!norm) return [];

  const variants = new Set<string>([norm]);
  if (BANGLA_CHAR_RE.test(norm)) {
    for (const suffix of BANGLA_SUFFIXES) {
      const minStemLen = suffix.length === 1 ? 4 : 3;
      if (norm.endsWith(suffix) && norm.length - suffix.length >= minStemLen) {
        variants.add(norm.slice(0, -suffix.length));
      }
    }
  }
  return Array.from(variants);
}

export interface TokenSpan {
  raw: string;
  norm: string;
  variants: string[];
  hasUppercase: boolean;
  startIndex: number;
  endIndex: number;
}

/**
 * Tokenizes text into word spans preserving exact character offsets and case info
 * (used to prevent matching lowercase "pm" inside times like "2 pm" as Prime Minister).
 */
export function tokenizeWithSpans(text: string): TokenSpan[] {
  const normalized = normalizeText(text);
  const tokens: TokenSpan[] = [];
  const re = /[^\s"'‘’“”()[\]{},;!?।॥/\\]+/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(normalized)) !== null) {
    let raw = m[0]!;
    let startIndex = m.index;
    let endIndex = startIndex + raw.length;

    // Trim leading/trailing punctuation such as ':' or '.'
    const trimmed = raw.replace(EDGE_PUNCT_RE, '');
    if (!trimmed) continue;

    const leadDiff = raw.indexOf(trimmed);
    startIndex += Math.max(0, leadDiff);
    endIndex = startIndex + trimmed.length;

    const norm = normalizeToken(trimmed);
    if (!norm) continue;

    tokens.push({
      raw: trimmed,
      norm,
      variants: getTokenMatchVariants(trimmed),
      hasUppercase: /[A-Z]/.test(trimmed),
      startIndex,
      endIndex,
    });
  }

  return tokens;
}

/**
 * Splits headline + body text into clean sentences for hypergraph relation extraction.
 */
export function splitSentences(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  // Split on Bangla dari (।), newline breaks, or English sentence boundary [.!?] followed by space/end
  return normalized
    .split(/(?:[।॥\n]+|(?<![0-9A-Z])[.!?](?=\s|$))/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}
