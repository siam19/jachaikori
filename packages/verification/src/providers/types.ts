/**
 * @file packages/verification/src/providers/types.ts
 * Provider-agnostic interfaces for Jachaikori's Dual-Provider VLM & Reranker stack.
 */

import type {
  CardExtraction,
  ClaimDiffItem,
  EmptyStateNotice,
  OutletId,
  StoredArticleClaim,
  VlmProviderId,
  VlmProviderPreference,
} from '@jachaikori/schema';
import type { SupportedImageMime } from '../image-hash';

export interface ProviderUsage {
  provider: VlmProviderId;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  fromCache?: boolean;
}

export interface VlmExtractionResult {
  extraction: CardExtraction;
  usage: ProviderUsage;
}

export interface RerankCandidateInput {
  articleId: string;
  chunkId?: string | null;
  outlet: OutletId;
  title: string;
  canonicalUrl: string;
  publishedAt: string | null;
  snippet: string;
  clusterId?: string | null;
  clusterOutletCount?: number | null;
  rrfScore: number;
  matchedEntityIds?: string[];
}

export interface RerankCandidateScore {
  articleId: string;
  relevanceScore: number;
  matchSummary: string | null;
}

export interface RerankResult {
  scores: RerankCandidateScore[];
  usage: ProviderUsage;
}

export interface ArticleClaimExtractInput {
  articleId: string;
  outlet: OutletId;
  title: string;
  publishedAt: string | null;
  text: string;
}

export interface ArticleClaimExtractResult {
  claims: Array<{
    claimText: string;
    claimType: string;
    speakerName: string | null;
    subjectName: string | null;
    objectName: string | null;
    numbers: string[];
    dates: string[];
    hedgingLevel: 'certain' | 'reported' | 'hedged' | 'conditional';
    evidenceSnippet: string | null;
  }>;
  usage: ProviderUsage;
}

export interface ClaimDiffJudgeInput {
  extraction: CardExtraction;
  article: {
    articleId: string;
    outlet: OutletId;
    title: string;
    publishedAt: string | null;
    snippet: string;
  };
  articleClaims: StoredArticleClaim[];
}

export interface ClaimDiffJudgeResult {
  diffs: ClaimDiffItem[];
  summary: EmptyStateNotice | null;
  usage: ProviderUsage;
}

export interface ClaimDiffJudge {
  readonly providerId: VlmProviderId;
  readonly modelVersion: string;
  extractArticleClaims(input: ArticleClaimExtractInput): Promise<ArticleClaimExtractResult>;
  compareClaims(input: ClaimDiffJudgeInput): Promise<ClaimDiffJudgeResult>;
}

export interface VlmExtractor {
  readonly providerId: VlmProviderId;
  readonly modelVersion: string;
  extractFromImage(bytes: Uint8Array, mimeType: SupportedImageMime): Promise<VlmExtractionResult>;
  extractFromText(rawText: string): Promise<VlmExtractionResult>;
}

export interface CandidateReranker {
  readonly providerId: VlmProviderId;
  readonly modelVersion: string;
  rerank(
    extraction: CardExtraction,
    candidates: RerankCandidateInput[]
  ): Promise<RerankResult>;
}

/**
 * Minimal Cloudflare Workers AI binding interface (no `@cloudflare/workers-types` hard dependency).
 */
export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface GeminiProviderConfig {
  /** Google AI Studio API key (optional if Vertex AI OAuth is configured). */
  apiKey?: string;
  /** GCP Vertex AI project ID (e.g. "ugstar"). */
  vertexProjectId?: string;
  /** GCP Vertex AI location (defaults to "global" for gemini-3.5-flash). */
  vertexLocation?: string;
  /** Static OAuth Bearer token or async token fetcher for Vertex AI REST. */
  vertexAccessToken?: string;
  getVertexAccessToken?: () => Promise<string>;
  /** Model ID (defaults to "gemini-3.5-flash" on Vertex, or "gemini-2.5-flash" / configured override). */
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface WorkersAiProviderConfig {
  /** Native Cloudflare Workers `env.AI` binding (preferred inside Workers). */
  aiBinding?: WorkersAiBinding;
  /** Cloudflare REST fallback for local dev / CLI probing. */
  accountId?: string;
  apiToken?: string;
  /** Multimodal vision model (default: "@cf/meta/llama-3.2-11b-vision-instruct"). */
  visionModel?: string;
  /** Fast text extraction/rerank model (default: "@cf/meta/llama-3.1-8b-instruct-fast"). */
  textModel?: string;
  /** Dedicated cross-encoder reranker (default: "@cf/baai/bge-reranker-base"). */
  rerankerModel?: string;
  fetchImpl?: typeof fetch;
}

export interface VerificationProviderConfig {
  preference?: VlmProviderPreference;
  gemini?: GeminiProviderConfig;
  workersAi?: WorkersAiProviderConfig;
}
