/**
 * @file packages/verification/src/providers/factory.ts
 * Dual-provider factory (`VLM_PROVIDER=gemini|workers-ai|auto`) with automatic
 * failover between GeminiFlashAdapter, WorkersAiAdapter, and HeuristicVerificationAdapter.
 */

import type { CardExtraction, VlmProviderId } from '@jachaikori/schema';
import type { SupportedImageMime } from '../image-hash';
import { GeminiFlashAdapter } from './gemini';
import { HeuristicVerificationAdapter } from './heuristic';
import type {
  CandidateReranker,
  RerankCandidateInput,
  RerankResult,
  VerificationProviderConfig,
  VlmExtractionResult,
  VlmExtractor,
} from './types';
import { WorkersAiAdapter } from './workers-ai';

class FallbackVlmExtractor implements VlmExtractor {
  readonly providerId: VlmProviderId;
  readonly modelVersion: string;

  constructor(private readonly chain: VlmExtractor[]) {
    this.providerId = chain[0]!.providerId;
    this.modelVersion = chain[0]!.modelVersion;
  }

  async extractFromImage(bytes: Uint8Array, mimeType: SupportedImageMime): Promise<VlmExtractionResult> {
    let lastError: unknown;
    for (const provider of this.chain) {
      if (provider.providerId === 'heuristic') continue;
      try {
        return await provider.extractFromImage(bytes, mimeType);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('No image-capable VLM provider succeeded.');
  }

  async extractFromText(rawText: string): Promise<VlmExtractionResult> {
    let lastError: unknown;
    for (const provider of this.chain) {
      try {
        return await provider.extractFromText(rawText);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No text extraction provider succeeded.');
  }
}

class FallbackCandidateReranker implements CandidateReranker {
  readonly providerId: VlmProviderId;
  readonly modelVersion: string;

  constructor(private readonly chain: CandidateReranker[]) {
    this.providerId = chain[0]!.providerId;
    this.modelVersion = chain[0]!.modelVersion;
  }

  async rerank(extraction: CardExtraction, candidates: RerankCandidateInput[]): Promise<RerankResult> {
    let lastError: unknown;
    for (const provider of this.chain) {
      try {
        return await provider.rerank(extraction, candidates);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No reranker provider succeeded.');
  }
}

export function createVerificationProviders(config: VerificationProviderConfig): {
  extractor: VlmExtractor;
  reranker: CandidateReranker;
  activeProviders: VlmProviderId[];
} {
  const preference = config.preference ?? 'auto';
  const hasGemini = Boolean(
    config.gemini &&
      (config.gemini.apiKey ||
        (config.gemini.vertexProjectId &&
          (config.gemini.vertexAccessToken || config.gemini.getVertexAccessToken)))
  );
  const hasWorkersAi = Boolean(
    config.workersAi &&
      (config.workersAi.aiBinding || (config.workersAi.accountId && config.workersAi.apiToken))
  );

  const gemini = hasGemini ? new GeminiFlashAdapter(config.gemini!) : null;
  const workersAi = hasWorkersAi ? new WorkersAiAdapter(config.workersAi!) : null;
  const heuristic = new HeuristicVerificationAdapter();

  const chain: Array<VlmExtractor & CandidateReranker> = [];
  if (preference === 'gemini') {
    if (gemini) chain.push(gemini);
    if (workersAi) chain.push(workersAi);
  } else if (preference === 'workers-ai') {
    if (workersAi) chain.push(workersAi);
    if (gemini) chain.push(gemini);
  } else {
    // 'auto': prefer Gemini while GCP credits last, cleanly fall back to Cloudflare Workers AI
    if (gemini) chain.push(gemini);
    if (workersAi) chain.push(workersAi);
  }
  chain.push(heuristic);

  return {
    extractor: chain.length === 1 ? chain[0]! : new FallbackVlmExtractor(chain),
    reranker: chain.length === 1 ? chain[0]! : new FallbackCandidateReranker(chain),
    activeProviders: chain.map((p) => p.providerId),
  };
}
