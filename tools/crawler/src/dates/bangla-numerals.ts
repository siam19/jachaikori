/**
 * @file tools/crawler/src/dates/bangla-numerals.ts
 * Utility to convert between Bangla numerals (০-৯) and standard Arabic numerals (0-9).
 */

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BANGLA_TO_ARABIC_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

/**
 * Replaces all Bangla numeral characters in a string with standard ASCII digits (0-9).
 * Preserves all other text.
 */
export function banglaToAsciiDigits(str: string): string {
  return str.replace(/[০-৯]/g, (digit) => BANGLA_TO_ARABIC_MAP[digit] ?? digit);
}

/**
 * Converts standard ASCII digits in a string to Bangla numerals.
 */
export function asciiToBanglaDigits(str: string | number): string {
  return String(str).replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number.parseInt(digit, 10)] ?? digit);
}
