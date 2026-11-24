/**
 * @file packages/verification/src/providers/heuristic.ts
 * Zero-LLM deterministic extractor (for text inputs) & lexical/entity overlap reranker
 * used for offline tests, zero-cost text fallback, and deterministic calibration.
 */

import { tokenizeBangla } from '@jachaikori/retrieval';
import type { CardExtraction } from '@jachaikori/schema';
import { normalizePublisherLogo } from '../prompts';
import type { SupportedImageMime } from '../image-hash';
import type {
  CandidateReranker,
  RerankCandidateInput,
  RerankResult,
  VlmExtractionResult,
  VlmExtractor,
} from './types';

const NUMBER_RE =
  /(?:[৳$€£]?\s*[\d০-৯]+(?:[.,][\d০-৯]+)*\s*(?:কোটি|লাখ|লক্ষ|হাজার|শতাংশ|%|টাকা|ডলার|crore|lakh|million|billion|thousand|tk|bdt|usd)?)/gi;

const DATE_RE =
  /(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|[\d০-৯]{1,2}\s+(?:জানুয়ারি|জানুয়ারি|ফেব্রুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)\s*[\d০-৯]{0,4}|\d{4}-\d{2}-\d{2})/gi;

export class HeuristicVerificationAdapter implements VlmExtractor, CandidateReranker {
  readonly providerId = 'heuristic' as const;
  readonly modelVersion = 'heuristic-v1';

  async extractFromImage(_bytes: Uint8Array, _mimeType: SupportedImageMime): Promise<VlmExtractionResult> {
    throw new Error(
      'Image verification requires an active VLM provider (configure Gemini Vertex/API or Cloudflare Workers AI).'
    );
  }

  async extractFromText(rawText: string): Promise<VlmExtractionResult> {
    const clean = rawText.replace(/\s+/g, ' ').trim();
    const hasBangla = /[\u0980-\u09FF]/.test(clean);
    const hasLatin = /[A-Za-z]{3,}/.test(clean);
    const language: CardExtraction['language'] =
      hasBangla && hasLatin ? 'mixed' : hasBangla ? 'bn' : 'en';

    // Detect "Headline: Speaker" or "“Quote” — Speaker" pattern
    let quotedSpeaker: string | null = null;
    let attributedStatement: string | null = clean || null;
    let isQuote = false;

    const dashQuote = clean.match(/^[“"‘']?(.+?)[”"’']?\s*[—–-]\s*([^\n]{2,60})$/);
    const colonTail = clean.match(/^(.{12,}?)\s*[:：]\s*([^\n:：]{2,45})$/);
    if (dashQuote?.[1] && dashQuote[2]) {
      attributedStatement = dashQuote[1].trim();
      quotedSpeaker = dashQuote[2].trim();
      isQuote = true;
    } else if (colonTail?.[1] && colonTail[2] && colonTail[2].split(/\s+/).length <= 5) {
      attributedStatement = colonTail[1].trim();
      quotedSpeaker = colonTail[2].trim();
      isQuote = true;
    }

    const numbers = Array.from(
      new Set(
        (clean.match(NUMBER_RE) ?? [])
          .map((m) => m.trim())
          .filter((m) => /[\d০-৯]/.test(m) && m.length >= 1)
      )
    ).slice(0, 10);

    const dates = Array.from(
      new Set((clean.match(DATE_RE) ?? []).map((m) => m.trim()).filter(Boolean))
    ).slice(0, 6);

    const logoOutlet = normalizePublisherLogo(clean);
    const tokens = tokenizeBangla(clean);
    const hasVerifiableClaim = tokens.length >= 3;

    return {
      extraction: {
        inputKind: 'text',
        language,
        headline: clean.slice(0, 220) || null,
        ocrText: clean,
        quotedSpeaker,
        attributedStatement,
        isQuote,
        claimedNumbers: numbers,
        claimedDates: dates,
        claimedEntities: quotedSpeaker ? [quotedSpeaker] : [],
        publisherLogo: logoOutlet,
        publisherLogoOutletId: logoOutlet,
        hasVerifiableClaim,
        confidence: hasVerifiableClaim ? 0.72 : 0.25,
      },
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    };
  }

  async rerank(
    extraction: CardExtraction,
    candidates: RerankCandidateInput[]
  ): Promise<RerankResult> {
    const queryStr = [extraction.headline, extraction.attributedStatement, extraction.quotedSpeaker, extraction.ocrText]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(' ');
    const queryTokens = new Set(tokenizeBangla(queryStr).filter((t) => t.length >= 2));

    const maxRrf = Math.max(...candidates.map((c) => c.rrfScore), 0.0001);

    const scores = candidates.map((c) => {
      const docTokens = new Set(tokenizeBangla(`${c.title} ${c.snippet}`).filter((t) => t.length >= 2));
      let overlap = 0;
      for (const qt of queryTokens) {
        if (docTokens.has(qt)) overlap++;
      }
      const tokenRecall = queryTokens.size > 0 ? overlap / Math.min(queryTokens.size, 10) : 0;
      const entityBoost = Math.min(0.25, (c.matchedEntityIds?.length ?? 0) * 0.1);
      const rrfNorm = c.rrfScore / maxRrf;

      // Calibrated [0..1] blend: requires genuine lexical or entity overlap to clear 0.42 floor
      const raw = tokenRecall * 0.68 + entityBoost + (tokenRecall > 0.15 ? rrfNorm * 0.22 : 0);
      const relevanceScore = Number(Math.max(0, Math.min(1, raw)).toFixed(4));
      return {
        articleId: c.articleId,
        relevanceScore,
        matchSummary:
          overlap > 0
            ? `Matched ${overlap} key claim terms${c.matchedEntityIds?.length ? ` and ${c.matchedEntityIds.length} entity reference(s)` : ''}.`
            : null,
      };
    });

    return {
      scores,
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    };
  }
}
