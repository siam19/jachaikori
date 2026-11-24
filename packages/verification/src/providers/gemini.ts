/**
 * @file packages/verification/src/providers/gemini.ts
 * Gemini Flash VLM & Reranker adapter supporting BOTH:
 * 1. GCP Vertex AI REST (`gemini-3.5-flash` @ `global`, OAuth Bearer token)
 * 2. Google AI Studio Gemini API (`GEMINI_API_KEY`)
 *
 * Pure Web Standard (`fetch`), zero Node-only deps — runs on Cloudflare Workers & Bun.
 */

import {
  CardExtractionSchema,
  ClaimDiffItemSchema,
  type CardExtraction,
  type ClaimDiffItem,
} from '@jachaikori/schema';
import { bytesToBase64, type SupportedImageMime } from '../image-hash';
import {
  buildArticleClaimsPrompt,
  buildClaimDiffPrompt,
  buildImageExtractionPrompt,
  buildRerankPrompt,
  buildTextExtractionPrompt,
  CARD_EXTRACTION_RESPONSE_SCHEMA,
  CLAIM_DIFF_RESPONSE_SCHEMA,
  ON_DEMAND_ARTICLE_CLAIMS_SCHEMA,
  RERANK_RESPONSE_SCHEMA,
} from '../prompts';
import { extractJsonObject, parseCardExtraction } from './json-utils';
import type {
  ArticleClaimExtractInput,
  ArticleClaimExtractResult,
  CandidateReranker,
  ClaimDiffJudge,
  ClaimDiffJudgeInput,
  ClaimDiffJudgeResult,
  GeminiProviderConfig,
  RerankCandidateInput,
  RerankCandidateScore,
  RerankResult,
  VlmExtractionResult,
  VlmExtractor,
} from './types';

// Standard online Gemini Flash pricing (USD per 1M tokens)
const ONLINE_INPUT_USD_PER_M = 0.3;
const ONLINE_OUTPUT_USD_PER_M = 2.5;

interface GeminiRawResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GeminiFlashAdapter implements VlmExtractor, CandidateReranker, ClaimDiffJudge {
  readonly providerId = 'gemini' as const;
  readonly modelVersion: string;
  private readonly cfg: GeminiProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(config: GeminiProviderConfig) {
    this.cfg = config;
    this.modelVersion = config.model || 'gemini-3.5-flash';
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  private async resolveEndpointAndHeaders(): Promise<{ url: string; headers: Record<string, string> }> {
    const hasVertex = Boolean(
      this.cfg.vertexProjectId && (this.cfg.vertexAccessToken || this.cfg.getVertexAccessToken)
    );
    if (hasVertex) {
      const location = this.cfg.vertexLocation || 'global';
      const host =
        location === 'global'
          ? 'https://aiplatform.googleapis.com'
          : `https://${location}-aiplatform.googleapis.com`;
      const token = this.cfg.getVertexAccessToken
        ? await this.cfg.getVertexAccessToken()
        : this.cfg.vertexAccessToken!;
      const url = `${host}/v1/projects/${encodeURIComponent(this.cfg.vertexProjectId!)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(this.modelVersion)}:generateContent`;
      return {
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };
    }

    if (this.cfg.apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelVersion)}:generateContent?key=${encodeURIComponent(this.cfg.apiKey)}`;
      return {
        url,
        headers: {
          'Content-Type': 'application/json',
        },
      };
    }

    throw new Error(
      'GeminiFlashAdapter requires either (vertexProjectId + vertexAccessToken/getVertexAccessToken) or apiKey.'
    );
  }

  private async generateStructuredJson(
    parts: Array<Record<string, unknown>>,
    responseSchema: Record<string, unknown>,
    temperature = 0.0
  ): Promise<{ parsed: unknown; inputTokens: number; outputTokens: number; costUsd: number }> {
    const { url, headers } = await this.resolveEndpointAndHeaders();
    const isGemini3 = /^gemini-3/i.test(this.modelVersion);
    const isGemini25 = /^gemini-2\.5/i.test(this.modelVersion);
    const defaultThinkingConfig = isGemini3
      ? { thinkingLevel: 'MINIMAL' }
      : isGemini25
      ? { thinkingBudget: 0 }
      : undefined;

    const buildBody = (thinkingConfig: Record<string, unknown> | undefined) => ({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    let res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(defaultThinkingConfig)),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok && defaultThinkingConfig && res.status === 400) {
      const errPeek = await res.text().catch(() => '');
      if (/thinking/i.test(errPeek)) {
        res = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(undefined)),
          signal: AbortSignal.timeout(30_000),
        });
      } else {
        throw new Error(`Gemini HTTP ${res.status}: ${errPeek.slice(0, 350)}`);
      }
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 350)}`);
    }

    const data = (await res.json()) as GeminiRawResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    const parsed = extractJsonObject(text);
    const inputTokens = Number(data.usageMetadata?.promptTokenCount ?? 0);
    const outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? 0);
    const costUsd =
      (inputTokens / 1_000_000) * ONLINE_INPUT_USD_PER_M +
      (outputTokens / 1_000_000) * ONLINE_OUTPUT_USD_PER_M;

    return { parsed, inputTokens, outputTokens, costUsd };
  }

  async extractFromImage(
    bytes: Uint8Array,
    mimeType: SupportedImageMime
  ): Promise<VlmExtractionResult> {
    const b64 = bytesToBase64(bytes);
    const { parsed, inputTokens, outputTokens, costUsd } = await this.generateStructuredJson(
      [
        {
          inlineData: {
            mimeType,
            data: b64,
          },
        },
        { text: buildImageExtractionPrompt() },
      ],
      CARD_EXTRACTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      0.0
    );

    return {
      extraction: parseCardExtraction(parsed, 'photo_card'),
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }

  async extractFromText(rawText: string): Promise<VlmExtractionResult> {
    const { parsed, inputTokens, outputTokens, costUsd } = await this.generateStructuredJson(
      [{ text: buildTextExtractionPrompt(rawText) }],
      CARD_EXTRACTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      0.0
    );

    return {
      extraction: parseCardExtraction(parsed, 'text', rawText),
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }

  async rerank(
    extraction: CardExtraction,
    candidates: RerankCandidateInput[]
  ): Promise<RerankResult> {
    if (candidates.length === 0) {
      return {
        scores: [],
        usage: {
          provider: this.providerId,
          modelVersion: this.modelVersion,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      };
    }

    const claimText =
      [extraction.headline, extraction.attributedStatement, extraction.ocrText]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(' | ')
        .slice(0, 600) || '';

    const prompt = buildRerankPrompt({
      claimText,
      quotedSpeaker: extraction.quotedSpeaker,
      claimedNumbers: extraction.claimedNumbers,
      claimedDates: extraction.claimedDates,
      candidates: candidates.map((c) => ({
        articleId: c.articleId,
        outlet: c.outlet,
        publishedAt: c.publishedAt,
        title: c.title,
        snippet: c.snippet.slice(0, 320),
      })),
    });

    const { parsed, inputTokens, outputTokens, costUsd } = await this.generateStructuredJson(
      [{ text: prompt }],
      RERANK_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      0.0
    );

    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
      rankings?: Array<{ articleId?: string; relevanceScore?: number; matchSummary?: string }>;
    };
    const scoreMap = new Map<string, RerankCandidateScore>();
    for (const r of obj.rankings ?? []) {
      if (!r?.articleId) continue;
      const rawScore = Number(r.relevanceScore ?? 0);
      scoreMap.set(r.articleId, {
        articleId: r.articleId,
        relevanceScore: Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : 0,
        matchSummary: typeof r.matchSummary === 'string' && r.matchSummary.trim()
          ? r.matchSummary.trim().slice(0, 200)
          : null,
      });
    }

    const scores: RerankCandidateScore[] = candidates.map(
      (c) =>
        scoreMap.get(c.articleId) ?? {
          articleId: c.articleId,
          relevanceScore: 0,
          matchSummary: null,
        }
    );

    return {
      scores,
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }

  async extractArticleClaims(input: ArticleClaimExtractInput): Promise<ArticleClaimExtractResult> {
    const prompt = buildArticleClaimsPrompt({
      outlet: input.outlet,
      publishedAt: input.publishedAt,
      title: input.title,
      text: input.text,
    });
    const { parsed, inputTokens, outputTokens, costUsd } = await this.generateStructuredJson(
      [{ text: prompt }],
      ON_DEMAND_ARTICLE_CLAIMS_SCHEMA as unknown as Record<string, unknown>,
      0.0
    );
    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { claims?: any[] };
    const claims = (obj.claims ?? [])
      .filter((c) => c && typeof c.claimText === 'string' && c.claimText.trim())
      .slice(0, 6)
      .map((c) => {
        const hl = String(c.hedgingLevel ?? 'reported');
        const hedgingLevel: 'certain' | 'reported' | 'hedged' | 'conditional' =
          hl === 'certain' || hl === 'reported' || hl === 'hedged' || hl === 'conditional'
            ? hl
            : 'reported';
        return {
          claimText: String(c.claimText).trim(),
          claimType: typeof c.claimType === 'string' && c.claimType.trim() ? c.claimType.trim() : 'factual',
          speakerName: typeof c.speakerName === 'string' && c.speakerName.trim() ? c.speakerName.trim() : null,
          subjectName: typeof c.subjectName === 'string' && c.subjectName.trim() ? c.subjectName.trim() : null,
          objectName: typeof c.objectName === 'string' && c.objectName.trim() ? c.objectName.trim() : null,
          numbers: Array.isArray(c.numbers) ? c.numbers.map(String).filter(Boolean) : [],
          dates: Array.isArray(c.dates) ? c.dates.map(String).filter(Boolean) : [],
          hedgingLevel,
          evidenceSnippet:
            typeof c.evidenceSnippet === 'string' && c.evidenceSnippet.trim()
              ? c.evidenceSnippet.trim().slice(0, 350)
              : null,
        };
      });

    return {
      claims,
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }

  async compareClaims(input: ClaimDiffJudgeInput): Promise<ClaimDiffJudgeResult> {
    const prompt = buildClaimDiffPrompt({
      cardHeadline: input.extraction.headline,
      cardStatement: input.extraction.attributedStatement,
      cardSpeaker: input.extraction.quotedSpeaker,
      cardNumbers: input.extraction.claimedNumbers,
      cardDates: input.extraction.claimedDates,
      cardOcrText: input.extraction.ocrText,
      articleOutlet: input.article.outlet,
      articleTitle: input.article.title,
      articlePublishedAt: input.article.publishedAt,
      articleSnippet: input.article.snippet,
      articleClaims: input.articleClaims.map((c) => ({
        claimText: c.claimText,
        speakerName: c.speakerName ?? null,
        numbers: c.numbers,
        dates: c.dates,
        hedgingLevel: c.hedgingLevel,
        evidenceSnippet: c.evidenceSnippet,
      })),
    });

    const { parsed, inputTokens, outputTokens, costUsd } = await this.generateStructuredJson(
      [{ text: prompt }],
      CLAIM_DIFF_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      0.0
    );

    const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as {
      diffs?: unknown[];
      summaryEn?: string;
      summaryBn?: string;
    };

    const diffs: ClaimDiffItem[] = [];
    for (const raw of obj.diffs ?? []) {
      const check = ClaimDiffItemSchema.safeParse({
        ...(typeof raw === 'object' && raw !== null ? raw : {}),
        deterministic: false,
      });
      if (check.success) diffs.push(check.data);
    }

    const summary =
      typeof obj.summaryEn === 'string' && obj.summaryEn.trim()
        ? {
            en: obj.summaryEn.trim().slice(0, 260),
            bn:
              typeof obj.summaryBn === 'string' && obj.summaryBn.trim()
                ? obj.summaryBn.trim().slice(0, 260)
                : obj.summaryEn.trim().slice(0, 260),
          }
        : null;

    return {
      diffs: diffs.slice(0, 5),
      summary,
      usage: {
        provider: this.providerId,
        modelVersion: this.modelVersion,
        inputTokens,
        outputTokens,
        costUsd,
      },
    };
  }
}
