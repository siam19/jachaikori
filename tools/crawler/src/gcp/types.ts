/**
 * @file tools/crawler/src/gcp/types.ts
 * Shared types for coordinated GCP Cloud Run Jobs article scraping via GCS.
 */

import type { OutletId } from '@jachaikori/schema';

export type ScrapePool = 'http' | 'browser' | 'all';

export interface ScrapeChunkItem {
  id: string;
  outlet: OutletId;
  canonicalUrl: string;
  title: string;
  publishedAt: string | null;
}

export interface ScrapeChunkMeta {
  chunkId: string;
  outlet: OutletId;
  count: number;
  objectPath: string;
}

export interface ScrapeJobRef {
  jobName: string;
  executionName: string | null;
  tasks: number;
}

export interface ScrapeRunManifest {
  runId: string;
  createdAt: string;
  bucket: string;
  chunkSize: number;
  totalArticles: number;
  totalChunks: number;
  excludedSkipped: number;
  excludedExtracted: number;
  retryFailed: boolean;
  chunks: ScrapeChunkMeta[];
  jobs?: {
    http?: ScrapeJobRef;
    browser?: ScrapeJobRef;
  };
}

export interface LatestRunPointer {
  runId: string;
  bucket: string;
  createdAt: string;
  imported: boolean;
  importedAt?: string;
}

export interface ScrapeResultRecord {
  id: string;
  outlet: OutletId;
  status: 'extracted' | 'failed' | 'blocked';
  title?: string;
  publishedAtIso?: string | null;
  publishedAtRaw?: string;
  byline?: string | null;
  lead?: string | null;
  cleanText?: string;
  errorMessage?: string;
  scrapedAt: string;
}

export interface LeaseLock {
  chunkId: string;
  outlet: OutletId;
  workerId: string;
  jobName: string;
  taskIndex: number;
  claimedAt: string;
  heartbeatAt: string;
}

export interface DoneMarker {
  chunkId: string;
  outlet: OutletId;
  workerId: string;
  scraped: number;
  failed: number;
  blocked?: number;
  completedAt: string;
}

export interface TaskHeartbeat {
  workerId: string;
  jobName: string;
  taskIndex: number;
  pool: ScrapePool;
  status: 'running' | 'idle' | 'stopped' | 'done';
  currentChunkId: string | null;
  currentOutlet: OutletId | null;
  chunkDone: number;
  chunkTotal: number;
  totalScraped: number;
  totalFailed: number;
  chunksCompleted: number;
  updatedAt: string;
}
