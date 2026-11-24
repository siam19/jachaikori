/**
 * @file packages/entities/src/association.ts
 * Damped Positive Pointwise Mutual Information (PPMI) association scoring
 * between co-occurring entities over an event window.
 */

/**
 * Computes damped non-negative Pointwise Mutual Information (PPMI * ln(1 + together))
 * between two entities so strong recurring co-occurrences outrank rare 1-event flukes.
 *
 * @param together Number of events where both entities co-occur
 * @param totalOther Total events containing the other entity
 * @param nMe Total events containing the focal entity
 * @param nAll Total events in the window
 * @returns Non-negative damped PPMI score, or `0` on invalid/zero inputs
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
  if (!Number.isFinite(pmi) || pmi <= 0) {
    return 0;
  }

  return pmi * Math.log(1 + together);
}
