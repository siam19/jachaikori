/**
 * @file packages/schema/src/chunk.ts
 * Schemas for chunked article passages stored in D1 and Vectorize.
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';

export const ArticleChunkSchema = z.object({
  id: z.string().describe('Deterministic chunk ID: <articleId>:<position>'),
  articleId: z.string(),
  outlet: OutletIdSchema,
  position: z.number().int().min(0),
  text: z.string().min(1),
  publishedAt: z.string().nullable(),
  embeddingVersion: z.string().default('bge-m3-v1'),
});

export type ArticleChunk = z.infer<typeof ArticleChunkSchema>;
