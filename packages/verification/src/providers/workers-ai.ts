/**
 * @file packages/verification/src/providers/workers-ai.ts
 * Cloudflare Workers AI VLM & Reranker adapter supporting BOTH:
 * 1. Native Cloudflare Workers `env.AI` binding (zero extra network/auth overhead)
 * 2. Cloudflare REST API (`CF_ACCOUNT_ID` + `CF_API_TOKEN`) for local dev & CLI probing
 *
 * Uses `@cf/meta/llama-3.2-11b-vision-instruct` (or configurable `WORKERS_AI_VISION_MODEL`)
 * for photo-card OCR/extraction and `@cf/baai/bge-reranker-base` (with LLM fallback) for reranking.
 */

import {
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
} from '../prompts';
import { extractJsonObject, parseCardExtraction } from './json-utils';
import type {
  ArticleClaimExtractInput,
  ArticleClaimExtractResult,
  CandidateReranker,
  ClaimDiffJudge,
  ClaimDiffJudgeInput,
  ClaimDiffJudgeResult,
  RerankCandidateInput,
  RerankCandidateScore,
  RerankResult,
  VlmExtractionResult,
  VlmExtractor,
  WorkersAiProviderConfig,
} from './types';

export const DEFAULT_WORKERS_AI_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const DEFAULT_WORKERS_AI_TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
export const DEFAULT_WORKERS_AI_RERANKER_MODEL = '@cf/baai/bge-reranker-base';

// Approximate Workers AI neuron cost (~$0.011 per 1k neurons; ~10k free/day included)
const EST_VISION_USD_PER_CALL = 0.0005;
const EST_TEXT_USD_PER_CALL = 0.0001;
const EST_RERANK_USD_PER_CALL = 0.00005;

function extractResponseText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  if (typeof obj.response === 'string') return obj.response;
  if (obj.response && typeof obj.response === 'object') {
    return JSON.stringify(obj.response);
  }
  const choices = obj.choices as Array<{ message?: { content?: string } }> | undefined;
  if (Array.isArray(choices) && typeof choices[0]?.message?.content === 'string') {
    return choices[0].message.content;
  }
  if (typeof obj.description === 'string') return obj.description;
  return JSON.stringify(raw);
}

export class WorkersAiAdapter implements VlmExtractor, CandidateReranker, ClaimDiffJudge {
  readonly providerId = 'workers-ai' as const;
  readonly modelVersion: string;
  private readonly visionModel: string;
  private readonly textModel: string;
  private readonly rerankerModel: string;
  private readonly cfg: WorkersAiProviderConfig;
  private readonly fetchFn: typeof fetch;

  constructor(config: WorkersAiProviderConfig) {
    this.cfg = config;
    this.visionModel = config.visionModel || DEFAULT_WORKERS_AI_VISION_MODEL;
    this.textModel = config.textModel || DEFAULT_WORKERS_AI_TEXT_MODEL;
    this.rerankerModel = config.rerankerModel || DEFAULT_WORKERS_AI_RERANKER_MODEL;
    this.modelVersion = this.visionModel;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  private async runModel(model: string, input: Record<string, unknown>): Promise<unknown> {
    if (this.cfg.aiBinding) {
      return this.cfg.aiBinding.run(model, input);
    }

    if (this.cfg.accountId && this.cfg.apiToken) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.cfg.accountId)}/ai/run/${model}`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Workers AI HTTP ${res.status} (${model}): ${errText.slice(0, 350)}`);
      }
      const envelope = (await res.json()) as { success?: boolean; result?: unknown; errors?: unknown[] };
      if (envelope.success === false) {
        throw new Error(`Workers AI error (${model}): ${JSON.stringify(envelope.errors ?? [])}`);
      }
      return envelope.result ?? envelope;
    }

    throw new Error('WorkersAiAdapter requires either env.AI binding or (accountId + apiToken).');
  }

  async extractFromImage(
    bytes: Uint8Array,
    mimeType: SupportedImageMime
  ): Promise<VlmExtractionResult> {
    const prompt = buildImageExtractionPrompt();
    const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;

    let rawResult: unknown;
    try {
      // OpenAI-compatible multimodal chat format (supported by Llama 3.2 Vision / Gemma 3 / Mistral Small 3.1)
      rawResult = await this.runModel(this.visionModel, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 900,
        temperature: 0.0,
      });
    } catch (firstErr) {
      // Fallback to Cloudflare's legacy byte-array image format (LLaVA / older Llama 3.2 Vision endpoints)
      rawResult = await this.runModel(this.visionModel, {
        prompt,
        image: Array.from(bytes),
        max_tokens: 900,
        temperature: 0.0,
      }).catch(() => {
        throw firstErr;
      });
    }

    const text = extractResponseText(rawResult);
    const parsed = extractJsonObject(text);
    return {
      extraction: parseCardExtraction(parsed, 'photo_card'),
      usage: {
        provider: this.providerId,
        modelVersion: this.visionModel,
        inputTokens: Math.ceil(prompt.length / 4) + 512,
        outputTokens: Math.ceil(text.length / 4),
        costUsd: EST_VISION_USD_PER_CALL,
      },
    };
  }

  async extractFromText(rawText: string): Promise<VlmExtractionResult> {
    const prompt = buildTextExtractionPrompt(rawText);
    const rawResult = await this.runModel(this.textModel, {
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON matching the requested schema.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 700,
      temperature: 0.0,
    });

    const text = extractResponseText(rawResult);
    const parsed = extractJsonObject(text);
    return {
      extraction: parseCardExtraction(parsed, 'text', rawText),
      usage: {
        provider: this.providerId,
        modelVersion: this.textModel,
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: EST_TEXT_USD_PER_CALL,
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
          modelVersion: this.rerankerModel,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      };
    }

    const queryText = [extraction.headline, extraction.attributedStatement, extraction.quotedSpeaker]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(' — ')
      .slice(0, 500);

    // 1. Primary path: native fast cross-encoder `@cf/baai/bge-reranker-base`
    try {
      const contexts = candidates.map((c) => ({
        text: `${c.title}\n${c.snippet.slice(0, 320)}`,
      }));
      const raw = (await this.runModel(this.rerankerModel, {
        query: queryText || extraction.ocrText.slice(0, 400),
        contexts,
        top_k: candidates.length,
      })) as { response?: Array<{ id?: number; score?: number }> } | Array<{ id?: number; score?: number }>;

      const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.response) ? raw.response : [];
      if (rows.length > 0) {
        const byIndex = new Map<number, number>();
        for (const r of rows) {
          if (typeof r.id === 'number' && typeof r.score === 'number') {
            byIndex.set(r.id, Math.max(0, Math.min(1, r.score)));
          }
        }
        const scores: RerankCandidateScore[] = candidates.map((c, idx) => ({
          articleId: c.articleId,
          relevanceScore: byIndex.get(idx) ?? 0,
          matchSummary: null,
        }));
        return {
          scores,
          usage: {
            provider: this.providerId,
            modelVersion: this.rerankerModel,
            inputTokens: Math.ceil((queryText.length + contexts.reduce((a, b) => a + b.text.length, 0)) / 4),
            outputTokens: candidates.length * 4,
            costUsd: EST_RERANK_USD_PER_CALL,
          },
        };
      }
    } catch {
      // Fall through to Workers AI LLM JSON reranking
    }

    // 2. Fallback path: LLM listwise reranker via `this.textModel`
    const prompt = buildRerankPrompt({
      claimText: queryText || extraction.ocrText.slice(0, 500),
      quotedSpeaker: extraction.quotedSpeaker,
      claimedNumbers: extraction.claimedNumbers,
      claimedDates: extraction.claimedDates,
      candidates: candidates.map((c) => ({
        articleId: c.articleId,
        outlet: c.outlet,
        publishedAt: c.publishedAt,
        title: c.title,
        snippet: c.snippet.slice(0, 260),
      })),
    });

    const rawResult = await this.runModel(this.textModel, {
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.0,
    });

    const text = extractResponseText(rawResult);
    const parsed = extractJsonObject(text) as {
      rankings?: Array<{ articleId?: string; relevanceScore?: number; matchSummary?: string }>;
    };
    const scoreMap = new Map<string, RerankCandidateScore>();
    for (const r of parsed?.rankings ?? []) {
      if (!r?.articleId) continue;
      const sc = Number(r.relevanceScore ?? 0);
      scoreMap.set(r.articleId, {
        articleId: r.articleId,
        relevanceScore: Number.isFinite(sc) ? Math.max(0, Math.min(1, sc)) : 0,
        matchSummary: typeof r.matchSummary === 'string' ? r.matchSummary.trim().slice(0, 200) : null,
      });
    }

    return {
      scores: candidates.map(
        (c) =>
          scoreMap.get(c.articleId) ?? {
            articleId: c.articleId,
            relevanceScore: 0,
            matchSummary: null,
          }
      ),
      usage: {
        provider: this.providerId,
        modelVersion: this.textModel,
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: EST_TEXT_USD_PER_CALL,
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
    const rawResult = await this.runModel(this.textModel, {
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.0,
    });
    const text = extractResponseText(rawResult);
    const parsed = extractJsonObject(text) as { claims?: any[] };
    const claims = (parsed?.claims ?? [])
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
        modelVersion: this.textModel,
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: EST_TEXT_USD_PER_CALL,
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
    const rawResult = await this.runModel(this.textModel, {
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.0,
    });
    const text = extractResponseText(rawResult);
    const parsed = extractJsonObject(text) as {
      diffs?: unknown[];
      summaryEn?: string;
      summaryBn?: string;
    };
    const diffs: ClaimDiffItem[] = [];
    for (const raw of parsed?.diffs ?? []) {
      const check = ClaimDiffItemSchema.safeParse({
        ...(typeof raw === 'object' && raw !== null ? raw : {}),
        deterministic: false,
      });
      if (check.success) diffs.push(check.data);
    }

    const summary =
      typeof parsed?.summaryEn === 'string' && parsed.summaryEn.trim()
        ? {
            en: parsed.summaryEn.trim().slice(0, 260),
            bn:
              typeof parsed.summaryBn === 'string' && parsed.summaryBn.trim()
                ? parsed.summaryBn.trim().slice(0, 260)
                : parsed.summaryEn.trim().slice(0, 260),
          }
        : null;

    return {
      diffs: diffs.slice(0, 5),
      summary,
      usage: {
        provider: this.providerId,
        modelVersion: this.textModel,
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: EST_TEXT_USD_PER_CALL,
      },
    };
  }
}
