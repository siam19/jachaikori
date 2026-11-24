import { describe, expect, it } from 'vitest';
import type { ClaimDiffItem } from '@jachaikori/schema';
import { partitionDiffs } from '../partition';

const makeDiff = (overrides: Partial<ClaimDiffItem>): ClaimDiffItem => ({
  flag: 'mismatch_number',
  severity: 'major',
  deterministic: true,
  cardSpan: '৩০ কোটি টাকা',
  articleSpan: '৩ কোটি টাকা',
  explanationEn: 'diff en',
  explanationBn: 'diff bn',
  confidence: 0.95,
  ...overrides,
});

describe('partitionDiffs', () => {
  it('places inline-matchable spans in inline and non-span flags in rack without dropping any diff', () => {
    const headline = 'বড়দিন উপলক্ষে ৩০ কোটি টাকার অনুদান দিয়েছেন তারেক রহমান';
    const diffs: ClaimDiffItem[] = [
      makeDiff({ flag: 'mismatch_number', cardSpan: '৩০ কোটি টাকা', articleSpan: '৩ কোটি টাকা' }),
      makeDiff({ flag: 'hedging_shift', severity: 'notable', cardSpan: null, articleSpan: 'সম্ভাব্য' }),
      makeDiff({ flag: 'missing_context', severity: 'major', cardSpan: null, articleSpan: 'গুজব' }),
      makeDiff({ flag: 'match', severity: 'info', cardSpan: 'তারেক রহমান', articleSpan: 'Tarique Rahman' }),
    ];

    const res = partitionDiffs(headline, diffs);
    expect(res.inline).toHaveLength(1);
    expect(res.rack).toHaveLength(2);
    expect(res.matches).toHaveLength(1);
    expect(res.inline.length + res.rack.length).toBe(3); // nothing-dropped invariant
    expect(res.rack[0]!.d.severity).toBe('major'); // major sorted ahead of notable
    expect(res.inline[0]!.marker).toBe(1);
    expect(res.rack[0]!.marker).toBe(2);
    expect(res.rack[1]!.marker).toBe(3);
  });

  it('demotes overlapping spans to rack instead of dropping them', () => {
    const headline = 'প্রধানমন্ত্রী তারেক রহমান ৩০ কোটি টাকা অনুদান দিয়েছেন';
    const diffs: ClaimDiffItem[] = [
      makeDiff({ flag: 'mismatch_quote', cardSpan: 'প্রধানমন্ত্রী তারেক রহমান', articleSpan: 'সাবেক মন্ত্রী' }),
      makeDiff({ flag: 'mismatch_speaker', cardSpan: 'তারেক রহমান', articleSpan: 'অন্য বক্তা' }),
    ];

    const res = partitionDiffs(headline, diffs);
    expect(res.inline).toHaveLength(1);
    expect(res.rack).toHaveLength(1);
    expect(res.inline.length + res.rack.length).toBe(2);
  });

  it('handles empty headline and match-only arrays cleanly', () => {
    const res = partitionDiffs('', [
      makeDiff({ flag: 'match', severity: 'info' }),
      makeDiff({ flag: 'mismatch_date', cardSpan: '2026-11-18', articleSpan: '2024-05-12' }),
    ]);
    expect(res.inline).toHaveLength(0);
    expect(res.rack).toHaveLength(1);
    expect(res.matches).toHaveLength(1);
  });
});
