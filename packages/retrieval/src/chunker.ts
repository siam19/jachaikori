/**
 * @file packages/retrieval/src/chunker.ts
 * Paragraph-aware chunker for Bangla and English news articles.
 */

import type { ArticleChunk, OutletId } from '@jachaikori/schema';
import { normalizeBanglaForFts } from './bangla';

export interface ChunkerInput {
  id: string;
  outlet: OutletId;
  title: string;
  lead?: string | null;
  cleanText: string;
  publishedAt?: string | null;
}

export interface ChunkerOptions {
  maxChars?: number;
  overlapChars?: number;
  embeddingVersion?: string;
}

const DEFAULT_MAX_CHARS = 1600;
const DEFAULT_OVERLAP_CHARS = 200;

function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  // Split at Bangla dari (।) or ASCII sentence end
  const sentences = paragraph
    .split(/(?<=[।.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      // Hard slice fallback for unbroken text
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) pieces.push(current);
      current = sentence;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Splits an article into paragraph-aligned chunks.
 * Prepends the headline to chunk 0 so headline-only photo card queries rank strongly.
 */
export function chunkArticle(
  article: ChunkerInput,
  options: ChunkerOptions = {}
): ArticleChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const embeddingVersion = options.embeddingVersion ?? 'bge-m3-v1';

  const cleanTitle = normalizeBanglaForFts(article.title);
  const rawParagraphs = article.cleanText
    .split(/\r?\n{2,}|\r?\n/)
    .map((p) => normalizeBanglaForFts(p))
    .filter((p) => p.length > 0);

  if (rawParagraphs.length === 0 && !cleanTitle) {
    return [];
  }

  const units: string[] = [];
  for (const para of rawParagraphs) {
    units.push(...splitOversizedParagraph(para, maxChars));
  }

  // If cleanText was empty, still index the headline
  if (units.length === 0 && cleanTitle) {
    return [
      {
        id: `${article.id}:0`,
        articleId: article.id,
        outlet: article.outlet,
        position: 0,
        text: cleanTitle,
        publishedAt: article.publishedAt ?? null,
        embeddingVersion,
      },
    ];
  }

  const chunks: ArticleChunk[] = [];
  let currentText = cleanTitle ? `${cleanTitle}\n\n` : '';
  let position = 0;

  for (const unit of units) {
    const separator = currentText && !currentText.endsWith('\n\n') ? '\n\n' : '';
    const candidate = `${currentText}${separator}${unit}`;

    if (candidate.length <= maxChars || currentText === `${cleanTitle}\n\n` || currentText === '') {
      currentText = candidate;
      continue;
    }

    chunks.push({
      id: `${article.id}:${position}`,
      articleId: article.id,
      outlet: article.outlet,
      position,
      text: currentText.trim(),
      publishedAt: article.publishedAt ?? null,
      embeddingVersion,
    });
    position++;

    // Carry trailing overlap into next chunk
    const tail =
      overlapChars > 0 && currentText.length > overlapChars
        ? currentText.slice(-overlapChars).trim()
        : '';
    currentText = tail ? `${tail}\n\n${unit}` : unit;
  }

  if (currentText.trim()) {
    chunks.push({
      id: `${article.id}:${position}`,
      articleId: article.id,
      outlet: article.outlet,
      position,
      text: currentText.trim(),
      publishedAt: article.publishedAt ?? null,
      embeddingVersion,
    });
  }

  return chunks;
}
