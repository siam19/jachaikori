/**
 * @file packages/schema/src/verification.ts
 * Zod contracts for Sprint 6 Core Verification Pipeline & Dual-Provider VLM:
 * - Structured photo-card / screenshot / pasted-text claim extraction (`CardExtractionSchema`)
 * - Ranked accredited source matches (`VerificationSourceMatchSchema`)
 * - Full verification check record & API responses (`VerificationCheckSchema`, `VerifyResponseSchema`)
 * - Anonymous popular-checks feed (`PopularCheckSummarySchema`)
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';
import { EntityTypeSchema } from './entity';

export const VlmProviderIdSchema = z.enum(['gemini', 'workers-ai', 'heuristic']);
export type VlmProviderId = z.infer<typeof VlmProviderIdSchema>;

export const VlmProviderPreferenceSchema = z.enum(['gemini', 'workers-ai', 'auto']);
export type VlmProviderPreference = z.infer<typeof VlmProviderPreferenceSchema>;

export const VerificationInputTypeSchema = z.enum(['image', 'text']);
export type VerificationInputType = z.infer<typeof VerificationInputTypeSchema>;

export const VerificationInputKindSchema = z.enum([
  'photo_card',
  'screenshot',
  'text',
  'non_news_image',
]);
export type VerificationInputKind = z.infer<typeof VerificationInputKindSchema>;

export const VerificationStatusSchema = z.enum([
  'matched',
  'no_coverage',
  'non_claim',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const CacheHitKindSchema = z.enum(['none', 'exact', 'perceptual']);
export type CacheHitKind = z.infer<typeof CacheHitKindSchema>;

export const CardExtractionSchema = z.object({
  inputKind: VerificationInputKindSchema.default('photo_card'),
  language: z.enum(['bn', 'en', 'mixed']).default('bn'),
  headline: z.string().nullable().default(null).describe('Primary headline or main claim sentence'),
  ocrText: z.string().default('').describe('Clean verbatim text read from the card/input, excluding UI chrome'),
  quotedSpeaker: z.string().nullable().default(null).describe('Attributed speaker if the card contains a quote'),
  attributedStatement: z.string().nullable().default(null).describe('Core factual or quoted statement to verify'),
  isQuote: z.boolean().default(false),
  claimedNumbers: z.array(z.string()).default([]).describe('Exact numbers/amounts/percentages with units'),
  claimedDates: z.array(z.string()).default([]).describe('Exact dates or temporal markers printed on the card'),
  claimedEntities: z.array(z.string()).default([]).describe('Key people, organizations, or locations named'),
  publisherLogo: z.string().nullable().default(null).describe('News outlet name/logo visible on card, if any'),
  publisherLogoOutletId: OutletIdSchema.nullable().optional().describe('Normalized OutletId if logo matches an accredited outlet'),
  hasVerifiableClaim: z.boolean().default(true).describe('False for memes, greetings, ads, or unreadable images'),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type CardExtraction = z.infer<typeof CardExtractionSchema>;

export const ResolvedCardEntitySchema = z.object({
  entityId: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  isHub: z.boolean().default(false),
  surfaceForm: z.string(),
  linkMethod: z.string(),
});
export type ResolvedCardEntity = z.infer<typeof ResolvedCardEntitySchema>;

/**
 * Reserved per-source diff status slot populated in Sprint 7 (Claim-Level Diff Engine).
 */
export const ClaimDiffFlagSchema = z.enum([
  'match',
  'mismatch_number',
  'mismatch_date',
  'mismatch_speaker',
  'mismatch_quote',
  'hedging_shift',
  'missing_context',
]);
export type ClaimDiffFlag = z.infer<typeof ClaimDiffFlagSchema>;

export const VerificationSourceMatchSchema = z.object({
  articleId: z.string(),
  chunkId: z.string().nullable().optional(),
  outlet: OutletIdSchema,
  title: z.string(),
  canonicalUrl: z.string(),
  publishedAt: z.string().nullable(),
  snippet: z.string(),
  clusterId: z.string().nullable().default(null),
  clusterOutletCount: z.number().int().min(1).nullable().default(null),
  rrfScore: z.number().min(0).default(0),
  rerankScore: z.number().min(0).max(1),
  matchSummary: z.string().nullable().default(null).describe('Brief neutral explanation of how this article relates to the claim'),
  matchedEntityIds: z.array(z.string()).default([]),
  diffFlags: z.array(ClaimDiffFlagSchema).optional(),
});
export type VerificationSourceMatch = z.infer<typeof VerificationSourceMatchSchema>;

export const EmptyStateNoticeSchema = z.object({
  en: z.string(),
  bn: z.string(),
});
export type EmptyStateNotice = z.infer<typeof EmptyStateNoticeSchema>;

export const StageTimingsSchema = z.object({
  cacheLookupMs: z.number().min(0).default(0),
  extractMs: z.number().min(0).default(0),
  entityResolveMs: z.number().min(0).default(0),
  retrievalMs: z.number().min(0).default(0),
  rerankMs: z.number().min(0).default(0),
  persistMs: z.number().min(0).default(0),
});
export type StageTimings = z.infer<typeof StageTimingsSchema>;

export const VerificationCheckSchema = z.object({
  id: z.string(),
  status: VerificationStatusSchema,
  cacheHit: CacheHitKindSchema.default('none'),
  provider: VlmProviderIdSchema,
  modelVersion: z.string(),
  pipelineVersion: z.string(),
  inputType: VerificationInputTypeSchema,
  imageHash: z.string().nullable().default(null),
  perceptualHash: z.string().nullable().default(null),
  r2Key: z.string().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  extraction: CardExtractionSchema,
  resolvedEntities: z.array(ResolvedCardEntitySchema).default([]),
  queryTerms: z.array(z.string()).default([]),
  sources: z.array(VerificationSourceMatchSchema).default([]),
  emptyStateNotice: EmptyStateNoticeSchema.nullable().default(null),
  hitCount: z.number().int().min(1).default(1),
  latencyMs: z.number().int().min(0),
  stageTimingsMs: StageTimingsSchema,
  costUsd: z.number().min(0).default(0),
  createdAt: z.string(),
  lastHitAt: z.string().nullable().optional(),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerifyResponseSchema = VerificationCheckSchema;
export type VerifyResponse = VerificationCheck;

export const PopularCheckSummarySchema = z.object({
  id: z.string(),
  status: VerificationStatusSchema,
  inputType: VerificationInputTypeSchema,
  headline: z.string().nullable(),
  quotedSpeaker: z.string().nullable(),
  publisherLogo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sourceCount: z.number().int().min(0),
  topOutlet: OutletIdSchema.nullable(),
  hitCount: z.number().int().min(1),
  createdAt: z.string(),
  lastHitAt: z.string().nullable(),
});
export type PopularCheckSummary = z.infer<typeof PopularCheckSummarySchema>;
