/**
 * @file packages/schema/src/claim.ts
 * Schemas for extracted structured claims from cards or articles.
 */

import { z } from 'zod';

/**
 * Structured claim atom extracted by VLM or LLM from a card or article snippet.
 */
export const ClaimSchema = z.object({
  id: z.string().describe('Unique claim ID'),
  sourceType: z.enum(['card', 'article']),
  sourceId: z.string().describe('Article ID or Card image hash'),
  subject: z.string().describe('Main entity or subject the claim is about'),
  predicate: z.string().describe('Action, event, or relation'),
  object: z.string().optional().describe('Object, receiver, or complement of relation'),
  attributedSpeaker: z.string().nullable().optional().describe('Person or organization speaking if a quote'),
  isQuote: z.boolean().default(false),
  claimedNumbers: z.array(z.string()).default([]).describe('Exact numeric values extracted (e.g. 500 কোটি, 12%)'),
  claimedDates: z.array(z.string()).default([]).describe('Exact dates or temporal markers extracted'),
  confidence: z.number().min(0).max(1).default(1.0),
});
export type Claim = z.infer<typeof ClaimSchema>;
