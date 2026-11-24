/**
 * @file packages/verification/src/prompts.ts
 * Versioned prompts, strict JSON schemas, publisher logo normalizer,
 * and neutral bilingual notices for Jachaikori's Core Verification Pipeline.
 */

import type { EmptyStateNotice, OutletId } from '@jachaikori/schema';

export const PIPELINE_VERSION = 'verify-v2.0.0';
export const EXTRACT_PROMPT_VERSION = 'extract-v1.0.0';
export const RERANK_PROMPT_VERSION = 'rerank-v1.1.0';
export const DIFF_PROMPT_VERSION = 'diff-v1.0.0';
export const ARTICLE_CLAIM_PROMPT_VERSION = 'art-claim-v1.0.0';

export const NEUTRAL_EMPTY_STATE_NOTICE: EmptyStateNotice = {
  en: 'No matching coverage was found across the 8 indexed accredited Bangladeshi outlets. This does not mean the claim is false — it may be breaking news not yet indexed, reported by another outlet, or unverified social-media commentary.',
  bn: 'সূচিবদ্ধ ৮টি মূলধারার বাংলাদেশি সংবাদমাধ্যমে এই দাবির সঙ্গে মিল আছে এমন কোনো প্রতিবেদন পাওয়া যায়নি। এর অর্থ এই নয় যে দাবিটি মিথ্যা — এটি সদ্য প্রকাশিত খবর, অন্য কোনো সংবাদমাধ্যমের প্রতিবেদন, অথবা সামাজিক মাধ্যমের অযাচাইকৃত মন্তব্য হতে পারে।',
};

export const NON_CLAIM_NOTICE: EmptyStateNotice = {
  en: 'No specific verifiable news claim or quote was detected in this input. Upload a news photo card, headline screenshot, or paste a factual claim to search accredited coverage.',
  bn: 'এই ছবি বা লেখায় যাচাইযোগ্য কোনো নির্দিষ্ট সংবাদ দাবি বা উদ্ধৃতি পাওয়া যায়নি। সংবাদ ফটোকার্ড, শিরোনামের স্ক্রিনশট বা নির্দিষ্ট তথ্যভিত্তিক দাবি দিন।',
};

const PUBLISHER_LOGO_PATTERNS: Array<{ outlet: OutletId; patterns: RegExp[] }> = [
  { outlet: 'prothom-alo', patterns: [/prothom\s*alo/i, /প্রথম\s*আলো/] },
  { outlet: 'daily-star', patterns: [/the\s+daily\s+star/i, /daily\s+star/i, /ডেইলি\s*স্টার/] },
  { outlet: 'business-standard', patterns: [/business\s+standard/i, /\btbs\b/i, /বিজনেস\s*স্ট্যান্ডার্ড/] },
  { outlet: 'bdnews24', patterns: [/bdnews24/i, /বিডিনিউজ\s*২৪/i, /বিডিনিউজটোয়েন্টিফোর/] },
  { outlet: 'ittefaq', patterns: [/ittefaq/i, /ইত্তেফাক/] },
  { outlet: 'jugantor', patterns: [/jugantor/i, /যুগান্তর/] },
  { outlet: 'kaler-kantho', patterns: [/kaler\s*kantho/i, /কালের\s*কণ্ঠ/] },
  { outlet: 'bangladesh-protidin', patterns: [/bangladesh\s*pr[ao]tidin/i, /বাংলাদেশ\s*প্রতিদিন/] },
  { outlet: 'dhaka-tribune', patterns: [/dhaka\s*tribune/i, /ঢাকা\s*ট্রিবিউন/] },
];

export function normalizePublisherLogo(rawLogo: string | null | undefined): OutletId | null {
  if (!rawLogo || !rawLogo.trim()) return null;
  for (const entry of PUBLISHER_LOGO_PATTERNS) {
    if (entry.patterns.some((re) => re.test(rawLogo))) {
      return entry.outlet;
    }
  }
  return null;
}

export const CARD_EXTRACTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    inputKind: {
      type: 'STRING',
      enum: ['photo_card', 'screenshot', 'text', 'non_news_image'],
    },
    language: {
      type: 'STRING',
      enum: ['bn', 'en', 'mixed'],
    },
    headline: { type: 'STRING', nullable: true },
    ocrText: { type: 'STRING' },
    quotedSpeaker: { type: 'STRING', nullable: true },
    attributedStatement: { type: 'STRING', nullable: true },
    isQuote: { type: 'BOOLEAN' },
    claimedNumbers: { type: 'ARRAY', items: { type: 'STRING' } },
    claimedDates: { type: 'ARRAY', items: { type: 'STRING' } },
    claimedEntities: { type: 'ARRAY', items: { type: 'STRING' } },
    publisherLogo: { type: 'STRING', nullable: true },
    hasVerifiableClaim: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
  },
  required: [
    'inputKind',
    'language',
    'ocrText',
    'isQuote',
    'claimedNumbers',
    'claimedDates',
    'claimedEntities',
    'hasVerifiableClaim',
    'confidence',
  ],
} as const;

export const RERANK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rankings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          articleId: { type: 'STRING' },
          relevanceScore: { type: 'NUMBER' },
          matchSummary: { type: 'STRING' },
        },
        required: ['articleId', 'relevanceScore', 'matchSummary'],
      },
    },
  },
  required: ['rankings'],
} as const;

export function buildImageExtractionPrompt(): string {
  return [
    'You are an expert bilingual (Bangla + English) news photo-card & screenshot OCR and claim extractor for Bangladesh.',
    'Analyze the uploaded image carefully and return ONLY valid JSON matching the exact schema.',
    'STRICT EXTRACTION RULES:',
    '1. Read ALL Bangla and English news text accurately, preserving exact Bangla matras, spelling, and original script.',
    '2. IGNORE social-media UI chrome (Facebook Like/Comment/Share buttons, reaction counts, timestamps like "2h", "See more", phone status bar).',
    '3. headline: the primary headline or pull-quote text shown on the card (keep in its original language).',
    '4. ocrText: clean verbatim news text extracted from the card (headline + subheadline + attribution + date caption).',
    '5. quotedSpeaker & attributedStatement: if the card attributes a quote or claim to a person or organization (e.g., "— তারেক রহমান" or "অর্থমন্ত্রী বললেন..."), put the speaker name in quotedSpeaker, the statement in attributedStatement, and isQuote=true.',
    '6. claimedNumbers: extract EVERY exact figure/amount/percentage with units (e.g., "৫০০ কোটি টাকা", "Tk 32,000", "১২%", "$4.7B").',
    '7. claimedDates: extract EVERY date or temporal marker printed on the card (e.g., "১৪ নভেম্বর ২০২৬", "17 Feb 2026", "গতকাল").',
    '8. claimedEntities: list key people, organizations, political parties, ministries, banks, or locations mentioned.',
    '9. publisherLogo: if a Bangladeshi news outlet logo/watermark is visible (e.g., Prothom Alo / প্রথম আলো, The Daily Star, TBS, bdnews24, Ittefaq, Jugantor, Kaler Kantho, Bangladesh Pratidin, Dhaka Tribune), put its name here; else null.',
    '10. hasVerifiableClaim: set false ONLY if the image has no news claim (e.g., greeting, meme with no factual claim, blank/unreadable image, product ad).',
    '11. Never judge whether the claim is true or false — only extract what the image says.',
    'Return ONLY a single JSON object with keys: inputKind, language, headline, ocrText, quotedSpeaker, attributedStatement, isQuote, claimedNumbers, claimedDates, claimedEntities, publisherLogo, hasVerifiableClaim, confidence.',
  ].join('\n');
}

export function buildTextExtractionPrompt(rawText: string): string {
  return [
    'You are an expert bilingual (Bangla + English) news claim extractor for Bangladesh.',
    'Extract structured claim fields from the user-pasted text below and return ONLY valid JSON.',
    'RULES:',
    '- Keep headline, ocrText, and attributedStatement in their original language (Bangla or English).',
    '- Set inputKind="text" and publisherLogo to any outlet explicitly named as source (or null).',
    '- Preserve ALL exact numbers with units in claimedNumbers and dates in claimedDates.',
    '- Extract quotedSpeaker and attributedStatement when a quote or attribution is present.',
    '- Set hasVerifiableClaim=false if the input is just a greeting, random characters, or contains no factual/news claim.',
    '- Never declare the claim true or false.',
    'Return ONLY a JSON object with keys: inputKind, language, headline, ocrText, quotedSpeaker, attributedStatement, isQuote, claimedNumbers, claimedDates, claimedEntities, publisherLogo, hasVerifiableClaim, confidence.',
    `TEXT:\n${rawText.slice(0, 4000)}`,
  ].join('\n');
}

export function buildRerankPrompt(params: {
  claimText: string;
  quotedSpeaker: string | null;
  claimedNumbers: string[];
  claimedDates: string[];
  candidates: Array<{
    articleId: string;
    outlet: string;
    publishedAt: string | null;
    title: string;
    snippet: string;
  }>;
}): string {
  return [
    'You are a neutral news retrieval reranker for Bangladeshi journalism (Bangla & English).',
    'Score each candidate accredited article from 0.0 to 1.0 on whether it covers the SAME specific news event, announcement, quote, or claim as the user card.',
    'SCORING CALIBRATION:',
    '- 0.85–1.00: Direct coverage of the exact same event, quote, policy, or incident — INCLUDING accredited articles that directly address, deny, clarify, or call this exact claim/rumor "গুজব" / baseless (those are critical verification matches!).',
    '- 0.60–0.84: Closely related coverage of the same ongoing event/story by an accredited outlet (even if a number, date, speaker, or polarity differs!).',
    '- 0.40–0.59: Tangentially related context on the same person/topic, different specific event.',
    '- 0.00–0.39: Unrelated article that merely shares a common entity or keyword.',
    'RULES:',
    '- NEVER label the claim true, false, or fake.',
    '- Write a concise 1-sentence neutral matchSummary (in English, <= 140 chars) explaining how the article relates to the claim.',
    '- Score EVERY candidate articleId provided.',
    `CARD_CLAIM: ${params.claimText}`,
    `QUOTED_SPEAKER: ${params.quotedSpeaker ?? 'none'}`,
    `CLAIMED_NUMBERS: ${JSON.stringify(params.claimedNumbers)}`,
    `CLAIMED_DATES: ${JSON.stringify(params.claimedDates)}`,
    `CANDIDATES: ${JSON.stringify(params.candidates)}`,
    'Return ONLY JSON: { "rankings": [ { "articleId": "...", "relevanceScore": 0.0, "matchSummary": "..." } ] }',
  ].join('\n');
}

export const ON_DEMAND_ARTICLE_CLAIMS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claimText: { type: 'STRING' },
          claimType: { type: 'STRING' },
          speakerName: { type: 'STRING', nullable: true },
          subjectName: { type: 'STRING', nullable: true },
          objectName: { type: 'STRING', nullable: true },
          numbers: { type: 'ARRAY', items: { type: 'STRING' } },
          dates: { type: 'ARRAY', items: { type: 'STRING' } },
          hedgingLevel: {
            type: 'STRING',
            enum: ['certain', 'reported', 'hedged', 'conditional'],
          },
          evidenceSnippet: { type: 'STRING' },
        },
        required: ['claimText', 'hedgingLevel', 'evidenceSnippet'],
      },
    },
  },
  required: ['claims'],
} as const;

export const CLAIM_DIFF_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    diffs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          flag: {
            type: 'STRING',
            enum: [
              'match',
              'mismatch_number',
              'mismatch_date',
              'mismatch_speaker',
              'mismatch_quote',
              'hedging_shift',
              'missing_context',
            ],
          },
          severity: { type: 'STRING', enum: ['info', 'notable', 'major'] },
          cardSpan: { type: 'STRING', nullable: true },
          articleSpan: { type: 'STRING', nullable: true },
          explanationEn: { type: 'STRING' },
          explanationBn: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['flag', 'severity', 'explanationEn', 'explanationBn', 'confidence'],
      },
    },
    summaryEn: { type: 'STRING' },
    summaryBn: { type: 'STRING' },
  },
  required: ['diffs', 'summaryEn', 'summaryBn'],
} as const;

export function buildArticleClaimsPrompt(params: {
  outlet: string;
  publishedAt: string | null;
  title: string;
  text: string;
}): string {
  return [
    'Extract up to 5 concise, verifiable factual or quoted claims from this accredited Bangladeshi news article.',
    'RULES:',
    '- Preserve exact numbers with units in `numbers` (e.g., "৫০০ কোটি টাকা", "$4.7B", "12%").',
    '- Preserve exact dates in `dates`.',
    '- Set `hedgingLevel`: "certain" (confirmed fact), "reported" (attributed/alleged), "hedged" (may/likely/সম্ভাব্য), or "conditional".',
    '- Keep `claimText` and `evidenceSnippet` faithful to the article.',
    `OUTLET: ${params.outlet} | PUBLISHED_AT: ${params.publishedAt ?? 'unknown'}`,
    `TITLE: ${params.title}`,
    `TEXT: ${params.text.slice(0, 2200)}`,
    'Return ONLY valid JSON: { "claims": [...] }',
  ].join('\n');
}

export function buildClaimDiffPrompt(params: {
  cardHeadline: string | null;
  cardStatement: string | null;
  cardSpeaker: string | null;
  cardNumbers: string[];
  cardDates: string[];
  cardOcrText: string;
  articleOutlet: string;
  articleTitle: string;
  articlePublishedAt: string | null;
  articleSnippet: string;
  articleClaims: Array<{
    claimText: string;
    speakerName: string | null;
    numbers: string[];
    dates: string[];
    hedgingLevel: string;
    evidenceSnippet: string | null;
  }>;
}): string {
  return [
    'You are a neutral journalistic claim-comparison engine for Bangladeshi news (Bangla & English).',
    'Compare the USER_CARD claim strictly against the ACCREDITED_ARTICLE reporting and list concrete alignments or differences.',
    'STRICT NEUTRALITY RULES:',
    '- NEVER declare the card "true", "false", or "fake". Only describe how the card compares with what this accredited outlet reported.',
    '- Look specifically for:',
    '  * `match`: core claim/quote aligns closely with the accredited article.',
    '  * `mismatch_number`: figure/amount/percentage differs from what the article reports.',
    '  * `mismatch_date`: date or timeline differs from the article.',
    '  * `mismatch_speaker`: quote is attributed to a different person/organization than in the article.',
    '  * `mismatch_quote`: attributed wording substantially distorts or alters what the speaker actually said.',
    '  * `hedging_shift`: article uses cautious/reported/conditional framing ("may", "alleged", "সম্ভাব্য", "গুঞ্জন") while the card presents it as settled certainty.',
    '  * `missing_context`: card omits a crucial denial ("গুজব", "ভিত্তিহীন", "denied"), condition, or clarifying context present in the article.',
    '- Provide crisp, neutral `explanationEn` (English) and `explanationBn` (Bangla) for each diff item and a 1-sentence overall `summaryEn` / `summaryBn`.',
    '- Emit at most 4 most salient diff items.',
    `USER_CARD: ${JSON.stringify({
      headline: params.cardHeadline,
      attributedStatement: params.cardStatement,
      quotedSpeaker: params.cardSpeaker,
      claimedNumbers: params.cardNumbers,
      claimedDates: params.cardDates,
      ocrText: params.cardOcrText.slice(0, 500),
    })}`,
    `ACCREDITED_ARTICLE: ${JSON.stringify({
      outlet: params.articleOutlet,
      title: params.articleTitle,
      publishedAt: params.articlePublishedAt,
      snippet: params.articleSnippet.slice(0, 500),
      extractedClaims: params.articleClaims.slice(0, 6),
    })}`,
    'Return ONLY JSON matching: { "diffs": [...], "summaryEn": "...", "summaryBn": "..." }',
  ].join('\n');
}
