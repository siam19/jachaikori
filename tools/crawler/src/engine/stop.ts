/**
 * @file tools/crawler/src/engine/stop.ts
 * Evaluation rules to decide when a crawl source job should stop paging backwards in time.
 */

export interface StopEvaluatorOptions {
  cutoffDate: string; // e.g. "2026-01-01"
  consecutiveBeforeCutoffLimit?: number; // default: 30
  maxEmptyBatches?: number; // default: 2
  maxSafetyBatches?: number; // default: 1000
  maxConsecutiveDuplicateBatches?: number; // default: 2
}

export interface BatchEvaluation {
  shouldStop: boolean;
  reason?:
    | 'cutoff_reached'
    | 'empty_batches'
    | 'max_batches_exceeded'
    | 'source_exhausted'
    | 'pagination_loop_detected';
  consecutiveBeforeCutoff: number;
}

export class StopEvaluator {
  private cutoffTimestamp: number;
  private consecutiveBeforeCutoffLimit: number;
  private maxEmptyBatches: number;
  private maxSafetyBatches: number;
  private maxConsecutiveDuplicateBatches: number;

  private consecutiveBeforeCutoff = 0;
  private consecutiveEmptyBatches = 0;
  private consecutiveIdenticalBatches = 0;
  private lastBatchUrls = new Set<string>();
  private totalBatches = 0;

  constructor(options: StopEvaluatorOptions) {
    // Add 1-day safety margin before cutoff
    const cutoffDateObj = new Date(options.cutoffDate);
    cutoffDateObj.setDate(cutoffDateObj.getDate() - 1);
    this.cutoffTimestamp = cutoffDateObj.getTime();

    this.consecutiveBeforeCutoffLimit = options.consecutiveBeforeCutoffLimit ?? 30;
    this.maxEmptyBatches = options.maxEmptyBatches ?? 2;
    this.maxSafetyBatches = options.maxSafetyBatches ?? 1000;
    this.maxConsecutiveDuplicateBatches = options.maxConsecutiveDuplicateBatches ?? 2;
  }

  /**
   * Evaluates a batch of published ISO dates against cutoff, duplicate loops, and safety limits.
   */
  evaluateBatch(
    publishedIsoDates: Array<string | null>,
    nextCursor: string | null,
    batchUrls?: string[]
  ): BatchEvaluation {
    this.totalBatches++;

    // Check for pagination loops where a website server ignores ?page=N and returns the identical set of URLs
    if (batchUrls && batchUrls.length > 0) {
      if (this.lastBatchUrls.size > 0 && batchUrls.length === this.lastBatchUrls.size) {
        const allUrlsIdentical = batchUrls.every((url) => this.lastBatchUrls.has(url));
        if (allUrlsIdentical) {
          this.consecutiveIdenticalBatches++;
          if (this.consecutiveIdenticalBatches >= this.maxConsecutiveDuplicateBatches) {
            return {
              shouldStop: true,
              reason: 'pagination_loop_detected',
              consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
            };
          }
        } else {
          this.consecutiveIdenticalBatches = 0;
        }
      } else {
        this.consecutiveIdenticalBatches = 0;
      }
      this.lastBatchUrls = new Set(batchUrls);
    }

    if (publishedIsoDates.length === 0) {
      this.consecutiveEmptyBatches++;
      if (this.consecutiveEmptyBatches >= this.maxEmptyBatches || !nextCursor) {
        return {
          shouldStop: true,
          reason: 'empty_batches',
          consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
        };
      }
    } else {
      this.consecutiveEmptyBatches = 0;
    }

    if (this.totalBatches >= this.maxSafetyBatches) {
      return {
        shouldStop: true,
        reason: 'max_batches_exceeded',
        consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
      };
    }

    // Check each date
    for (const iso of publishedIsoDates) {
      if (!iso) continue;
      const time = new Date(iso).getTime();
      if (time < this.cutoffTimestamp) {
        this.consecutiveBeforeCutoff++;
        if (this.consecutiveBeforeCutoff >= this.consecutiveBeforeCutoffLimit) {
          return {
            shouldStop: true,
            reason: 'cutoff_reached',
            consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
          };
        }
      } else {
        // Reset counter when seeing an item strictly newer than cutoff
        this.consecutiveBeforeCutoff = 0;
      }
    }

    if (nextCursor === null) {
      return {
        shouldStop: true,
        reason: 'source_exhausted',
        consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
      };
    }

    return {
      shouldStop: false,
      consecutiveBeforeCutoff: this.consecutiveBeforeCutoff,
    };
  }
}
