/**
 * @file packages/entities/src/association.ts
 * Pointwise Mutual Information (PMI) association scoring between co-occurring entities.
 */

/**
 * Computes non-negative Pointwise Mutual Information (PPMI) between two entities.
 *
 * @param together Number of events/articles where both entities co-occur
 * @param totalOther Total events/articles containing the other entity
 * @param nMe Total events/articles containing the focal entity
 * @param nAll Total events/articles in the corpus
 * @returns Non-negative PMI score (`Math.max(0, pmi)`), or `0` on invalid/zero inputs
 */
export function associationScore(
  together: number,
  totalOther: number,
  nMe: number,
  nAll: number
): number {
  if (
    !Number.isFinite(together) ||
    !Number.isFinite(totalOther) ||
    !Number.isFinite(nMe) ||
    !Number.isFinite(nAll) ||
    together <= 0 ||
    totalOther <= 0 ||
    nMe <= 0 ||
    nAll <= 0
  ) {
    return 0;
  }

  const ratio = (together * nAll) / (nMe * totalOther);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }

  const pmi = Math.log2(ratio);
  if (!Number.isFinite(pmi)) {
    return 0;
  }

  return Math.max(0, pmi);
}
