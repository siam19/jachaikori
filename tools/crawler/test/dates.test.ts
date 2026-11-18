/**
 * @file tools/crawler/test/dates.test.ts
 * Unit tests for Bangla numeral conversion and date parsing.
 */

import { describe, expect, it } from 'bun:test';
import { banglaToAsciiDigits, asciiToBanglaDigits } from '../src/dates/bangla-numerals';
import { parsePublishedDate } from '../src/dates/parser';

describe('Bangla Numerals', () => {
  it('converts Bangla digits to ASCII digits', () => {
    expect(banglaToAsciiDigits('১২৩৪৫৬৭৮৯০')).toBe('1234567890');
    expect(banglaToAsciiDigits('১৫ মে ২০২৪')).toBe('15 মে 2024');
  });

  it('converts ASCII digits to Bangla digits', () => {
    expect(asciiToBanglaDigits('1234567890')).toBe('১২৩৪৫৬৭৮৯০');
    expect(asciiToBanglaDigits(2026)).toBe('২০২৬');
  });
});

describe('Date Parsing', () => {
  it('parses ISO date strings', () => {
    const iso = '2026-10-30T14:30:00.000Z';
    expect(parsePublishedDate(iso)).toBe(iso);
  });

  it('parses relative Bangla times', () => {
    const fixedNow = new Date('2026-11-14T12:00:00.000Z');
    const result = parsePublishedDate('৩ ঘণ্টা আগে', fixedNow);
    expect(result).toBe('2026-11-14T09:00:00.000Z');
  });

  it('parses absolute Bangla date strings including জানুয়ারী and AM/PM', () => {
    const result = parsePublishedDate('১২ মে ২০২৪, ১০:৩০');
    expect(result).toBeDefined();
    expect(result).toContain('2024-05-12');

    const bdnewsJan = parsePublishedDate('প্রকাশিত :\n 31 জানুয়ারী 2026, 11:56\n PM');
    expect(bdnewsJan).toBe('2026-01-31T17:56:00.000Z');
  });

  it('parses English date strings', () => {
    const result = parsePublishedDate('12 May 2024');
    expect(result).toContain('2024-05-12');
  });
});
