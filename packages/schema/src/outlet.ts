/**
 * @file packages/schema/src/outlet.ts
 * Defines accredited news outlet identifiers, category topics, and outlet metadata schemas.
 */

import { z } from 'zod';

/**
 * The nine accredited Bangladeshi news outlets in scope for Jachaikori.
 */
export const OutletIdSchema = z.enum([
  'prothom-alo',
  'bangladesh-protidin',
  'jugantor',
  'kaler-kantho',
  'ittefaq',
  'daily-star',
  'dhaka-tribune',
  'business-standard',
  'bdnews24',
]);
export type OutletId = z.infer<typeof OutletIdSchema>;

/**
 * Normalized topics across all outlets.
 * Outlets name categories differently, but all sources map to one of these topics.
 */
export const TopicSchema = z.enum([
  'national',
  'politics',
  'economy',
  'world',
  'opinion',
  'law-courts',
  'investigation',
  'general',
]);
export type Topic = z.infer<typeof TopicSchema>;

/**
 * Outlet metadata and crawling policy definition.
 */
export const OutletPolicySchema = z.object({
  robotsReviewedOn: z.string().describe('ISO date string when robots.txt was verified'),
  crawlDelayMs: z.number().nonnegative().default(1000).describe('Polite delay between requests in milliseconds'),
  notes: z.string().default(''),
});
export type OutletPolicy = z.infer<typeof OutletPolicySchema>;
