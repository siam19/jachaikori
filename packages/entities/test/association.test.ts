/**
 * @file packages/entities/test/association.test.ts
 * Unit tests for associationScore (PPMI) with zero/NaN/negative-PMI guards.
 */

import { describe, expect, it } from 'bun:test';
import { associationScore } from '../src/index';

describe('associationScore', () => {
  it('computes positive PMI for strong co-occurrence', () => {
    // together=10, totalOther=20, nMe=20, nAll=1000 => ratio = (10*1000)/(20*20) = 25 => log2(25) ≈ 4.643856
    const score = associationScore(10, 20, 20, 1000);
    expect(score).toBeCloseTo(Math.log2(25), 5);
  });

  it('clamps negative PMI to 0', () => {
    // together=1, totalOther=50, nMe=50, nAll=100 => ratio = 100/2500 = 0.04 => log2 < 0
    expect(associationScore(1, 50, 50, 100)).toBe(0);
  });

  it('returns 0 when any input is zero or negative', () => {
    expect(associationScore(0, 10, 10, 100)).toBe(0);
    expect(associationScore(5, 0, 10, 100)).toBe(0);
    expect(associationScore(5, 10, 0, 100)).toBe(0);
    expect(associationScore(5, 10, 10, 0)).toBe(0);
    expect(associationScore(-1, 10, 10, 100)).toBe(0);
  });

  it('returns 0 when any input is NaN or Infinity', () => {
    expect(associationScore(NaN, 10, 10, 100)).toBe(0);
    expect(associationScore(5, NaN, 10, 100)).toBe(0);
    expect(associationScore(5, 10, NaN, 100)).toBe(0);
    expect(associationScore(5, 10, 10, NaN)).toBe(0);
    expect(associationScore(Infinity, 10, 10, 100)).toBe(0);
  });
});
