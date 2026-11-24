/**
 * @file packages/verification/src/providers/json-utils.ts
 * Resilient JSON parsing and Zod normalization for VLM & LLM responses.
 */

import { CardExtractionSchema, type CardExtraction } from '@jachaikori/schema';
import { normalizePublisherLogo } from '../prompts';

/**
 * Extracts a JSON object from raw model output, handling markdown ```json fences
 * and leading/trailing prose robustly.
 */
export function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Model returned empty text');
  }

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // 2. Fenced code block ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. First balanced {...} block
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error(`Unable to extract JSON object from model output: ${trimmed.slice(0, 180)}`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''))
    .filter((v) => v.length > 0);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes and validates raw model JSON into a strict `CardExtraction` object.
 */
export function parseCardExtraction(
  raw: unknown,
  fallbackInputKind: CardExtraction['inputKind'] = 'photo_card',
  fallbackOcrText = ''
): CardExtraction {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const ocrText = asNullableString(obj.ocrText) ?? fallbackOcrText;
  const headline = asNullableString(obj.headline);
  const attributedStatement = asNullableString(obj.attributedStatement);
  const quotedSpeaker = asNullableString(obj.quotedSpeaker);
  const publisherLogo = asNullableString(obj.publisherLogo);
  const publisherLogoOutletId = normalizePublisherLogo(publisherLogo);

  const rawLang = typeof obj.language === 'string' ? obj.language.toLowerCase() : '';
  const hasBangla = /[\u0980-\u09FF]/.test(`${headline ?? ''} ${ocrText} ${attributedStatement ?? ''}`);
  const hasLatin = /[A-Za-z]{3,}/.test(`${headline ?? ''} ${ocrText} ${attributedStatement ?? ''}`);
  const language: CardExtraction['language'] =
    rawLang === 'bn' || rawLang === 'en' || rawLang === 'mixed'
      ? rawLang
      : hasBangla && hasLatin
      ? 'mixed'
      : hasBangla
      ? 'bn'
      : 'en';

  const rawKind = typeof obj.inputKind === 'string' ? obj.inputKind : fallbackInputKind;
  const inputKind: CardExtraction['inputKind'] =
    rawKind === 'photo_card' ||
    rawKind === 'screenshot' ||
    rawKind === 'text' ||
    rawKind === 'non_news_image'
      ? rawKind
      : fallbackInputKind;

  const hasText = Boolean(headline || ocrText.trim() || attributedStatement);
  const hasVerifiableClaim =
    typeof obj.hasVerifiableClaim === 'boolean' ? obj.hasVerifiableClaim && hasText : hasText;

  const confidenceRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.8;

  return CardExtractionSchema.parse({
    inputKind,
    language,
    headline: headline ?? (ocrText ? ocrText.split(/\r?\n/)[0]?.slice(0, 220) ?? null : null),
    ocrText,
    quotedSpeaker,
    attributedStatement: attributedStatement ?? headline,
    isQuote: typeof obj.isQuote === 'boolean' ? obj.isQuote : Boolean(quotedSpeaker),
    claimedNumbers: asStringArray(obj.claimedNumbers),
    claimedDates: asStringArray(obj.claimedDates),
    claimedEntities: asStringArray(obj.claimedEntities),
    publisherLogo,
    publisherLogoOutletId,
    hasVerifiableClaim,
    confidence,
  });
}
