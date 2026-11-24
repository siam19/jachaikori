/**
 * @file packages/verification/src/providers/heuristic.ts
 * Zero-LLM deterministic extractor (for text inputs) & lexical/entity overlap reranker
 * used for offline tests, zero-cost text fallback, and deterministic calibration.
 */

import { tokenizeBangla } from '@jachaikori/retrieval';
import type { CardExtraction, ClaimDiffItem } from '@jachaikori/schema';
import { normalizePublisherLogo } from '../prompts';
import type { SupportedImageMime } from '../image-hash';
import type {
  ArticleClaimExtractInput,
  ArticleClaimExtractResult,
  CandidateReranker,
  ClaimDiffJudge,
  ClaimDiffJudgeInput,
  ClaimDiffJudgeResult,
  RerankCandidateInput,
  RerankResult,
  VlmExtractionResult,
  VlmExtractor,
} from './types';

const HEDGING_RE =
  /(?:সম্ভাব্য|হতে\s+পারে|আশঙ্কা|গুঞ্জন|অভিযোগ|জানা\s+গেছে|সূত্রে\s+জানা|শোনা\s+যাচ্ছে|যদি|\bmay\b|\bmight\b|\bcould\b|\blikely\b|\bpossibly\b|\breportedly\b|\ballegedly\b|\balleged\b|\brumou?red\b|\bif\b)/i;

const DENIAL_CONTEXT_RE =
  /(?:গুজব|ভিত্তিহীন|অস্বীকার|সত্য\s*ন[য়য়]|ভু[য়য়]া|নাকচ|প্রত্যাখ্যান|\brumou?r\b|\bbaseless\b|\bdenies\b|\bdenied\b|\brefuted\b|\bdismissed\b|\bnot true\b|\bfake news\b)/i;

const NUMBER_RE =
  /(?:[৳$€£]?\s*[\d০-৯]+(?:[.,][\d০-৯]+)*\s*(?:কোটি|লাখ|লক্ষ|হাজার|শতাংশ|%|টাকা|ডলার|crore|lakh|million|billion|thousand|tk|bdt|usd)?)/gi;

const DATE_RE =
  /(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|[\d০-৯]{1,2}\s+(?:জানুয়ারি|জানুয়ারি|ফেব্রুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)\s*[\d০-৯]{0,4}|\d{4}-\d{2}-\d{2})/gi;

export class HeuristicVerificationAdapter implements VlmExtractor, CandidateReranker, ClaimDiffJudge {
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

  async extractArticleClaims(input: ArticleClaimExtractInput): Promise<ArticleClaimExtractResult> {
    const combined = `${input.title}. ${input.text}`.trim();
    const numbers = Array.from(
      new Set((combined.match(NUMBER_RE) ?? []).map((m) => m.trim()).filter((m) => /[\d০-৯]/.test(m)))
    ).slice(0, 8);
    const dates = Array.from(
      new Set((combined.match(DATE_RE) ?? []).map((m) => m.trim()).filter(Boolean))
    ).slice(0, 5);
    const hedgingLevel: 'certain' | 'reported' | 'hedged' | 'conditional' = HEDGING_RE.test(combined)
      ? 'hedged'
      : 'reported';

    return {
      claims: input.title.trim()
        ? [
            {
              claimText: input.title.trim(),
              claimType: 'factual',
              speakerName: null,
              subjectName: null,
              objectName: null,
              numbers,
              dates,
              hedgingLevel,
              evidenceSnippet: input.text.slice(0, 260) || input.title.trim(),
            },
          ]
        : [],
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    };
  }

  async compareClaims(input: ClaimDiffJudgeInput): Promise<ClaimDiffJudgeResult> {
    const diffs: ClaimDiffItem[] = [];
    const cardText = [
      input.extraction.headline,
      input.extraction.attributedStatement,
      input.extraction.ocrText,
    ]
      .filter(Boolean)
      .join(' ');
    const articleText = [
      input.article.title,
      input.article.snippet,
      ...input.articleClaims.map((c) => c.claimText),
    ].join(' ');

    // 1. Omitted denial / rumor context check
    const artDenialMatch = articleText.match(DENIAL_CONTEXT_RE);
    const cardHasDenial = DENIAL_CONTEXT_RE.test(cardText);
    if (artDenialMatch && !cardHasDenial) {
      diffs.push({
        flag: 'missing_context',
        severity: 'major',
        deterministic: true,
        cardSpan: input.extraction.headline ?? cardText.slice(0, 120),
        articleSpan: artDenialMatch[0],
        explanationEn: `Accredited reporting explicitly includes a denial or rumor qualification ("${artDenialMatch[0]}") that is absent from the card.`,
        explanationBn: `মূলধারার প্রতিবেদনে "${artDenialMatch[0]}" জাতীয় স্পষ্টীকরণ বা অস্বীকৃতির উল্লেখ রয়েছে, যা কার্ডটিতে নেই।`,
        confidence: 0.9,
      });
    }

    // 2. Hedging escalation check (hedged/conditional article stated as categorical certainty on card)
    const artHedgingMatch = articleText.match(HEDGING_RE);
    const artClaimHedged = input.articleClaims.some(
      (c) => c.hedgingLevel === 'hedged' || c.hedgingLevel === 'conditional'
    );
    const cardHedged = HEDGING_RE.test(cardText);
    if ((artHedgingMatch || artClaimHedged) && !cardHedged) {
      const marker = artHedgingMatch?.[0] ?? 'hedged/conditional';
      diffs.push({
        flag: 'hedging_shift',
        severity: 'notable',
        deterministic: true,
        cardSpan: input.extraction.headline ?? cardText.slice(0, 120),
        articleSpan: marker,
        explanationEn: `Accredited reporting uses cautious or conditional framing ("${marker}"), whereas the card presents the claim without that qualification.`,
        explanationBn: `মূলধারার প্রতিবেদনে শর্তসাপেক্ষ বা সম্ভাব্যতা সূচক ভাষা ("${marker}") ব্যবহার করা হলেও কার্ডটিতে তা নিশ্চিতভাবে উপস্থাপন করা হয়েছে।`,
        confidence: 0.84,
      });
    }

    return {
      diffs,
      summary: null,
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
