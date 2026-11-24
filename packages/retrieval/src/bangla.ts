/**
 * @file packages/retrieval/src/bangla.ts
 * Bangla Unicode normalization and SQLite/D1 FTS5 tokenizer helpers.
 *
 * SQLite's default `unicode61` tokenizer treats Bangla vowel signs (matras),
 * hasanta (virama), anusvara, visarga, chandrabindu, and nukta as separators.
 * Explicitly declaring them in `tokenchars` preserves full Bangla words.
 */

const BANGLA_MARK_CODEPOINTS = [
  0x0981, // ঁ CHANDRABINDU
  0x0982, // ং ANUSVARA
  0x0983, // ঃ VISARGA
  0x09bc, // ় NUKTA
  0x09be, // া AA
  0x09bf, // ি I
  0x09c0, // ী II
  0x09c1, // ু U
  0x09c2, // ূ UU
  0x09c3, // ৃ VOCALIC R
  0x09c4, // ৄ VOCALIC RR
  0x09c7, // ে E
  0x09c8, // ৈ AI
  0x09cb, // ো O
  0x09cc, // ৌ AU
  0x09cd, // ্ HASANTA (VIRAMA)
  0x09d7, // ৗ AU LENGTH MARK
  0x09e2, // ৢ VOCALIC L
  0x09e3, // ৣ VOCALIC LL
];

export const BANGLA_FTS_TOKENCHARS = BANGLA_MARK_CODEPOINTS.map((cp) =>
  String.fromCodePoint(cp)
).join('');

export const BANGLA_FTS_TOKENIZE_CLAUSE = `unicode61 remove_diacritics 0 tokenchars '${BANGLA_FTS_TOKENCHARS}'`;

/**
 * Normalizes Bangla and English text before FTS5 indexing or querying:
 * - NFC normalization (e.g. য + ় -> য়)
 * - Strips zero-width joiners/non-joiners (e.g. র‍্যাব -> র্যাব) so conjunct variants match
 * - Collapses whitespace
 */
export function normalizeBanglaForFts(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits normalized Bangla/English text into clean lowercase lexical tokens,
 * preserving Bangla matras, hasanta, and nukta while stripping punctuation.
 */
export function tokenizeBangla(text: string): string[] {
  const normalized = normalizeBanglaForFts(text);
  return normalized
    .split(/[\s।,;:!?()[\]{}"“”‘’/\\|+*=<>~^@#$%&]+/)
    .map((t) => t.replace(/^[-'.]+|[-'.]+$/g, '').trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Tokenizes a user search string into safe quoted FTS5 MATCH tokens.
 * Wrapping every term in double quotes prevents FTS5 syntax errors on Bangla combining marks
 * or punctuation (e.g. দাঁড়ি `।`, hyphens, colons).
 */
export function buildFtsMatchQuery(
  rawQuery: string,
  operator: 'AND' | 'OR' = 'AND'
): string {
  const normalized = normalizeBanglaForFts(rawQuery);
  const terms = normalized
    .split(/[\s।,;:!?()[\]{}"“”‘’/\\|+*=<>~^@#$%&]+/)
    .map((t) => t.replace(/^[-'.]+|[-'.]+$/g, '').trim())
    .filter((t) => t.length > 0);

  if (terms.length === 0) return '';

  const uniqueTerms = [...new Set(terms)].slice(0, 16);
  const quoted = uniqueTerms.map((t) => `"${t.replace(/"/g, '')}"`);

  return operator === 'OR' ? quoted.join(' OR ') : quoted.join(' ');
}
