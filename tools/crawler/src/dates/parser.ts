/**
 * @file tools/crawler/src/dates/parser.ts
 * Robust parser for Bangladeshi news publication dates (Bangla & English, relative & absolute).
 * Outputs standard ISO-8601 strings in Asia/Dhaka timezone (+06:00).
 */

import { banglaToAsciiDigits } from './bangla-numerals';

const BANGLA_MONTHS: Record<string, number> = {
  'জানুয়ারি': 0, 'জানুয়ারি': 0, 'জানুয়ারী': 0, 'জানুয়ারী': 0,
  'ফেব্রুয়ারি': 1, 'ফেব্রুয়ারি': 1, 'ফেব্রুয়ারী': 1, 'ফেব্রুয়ারী': 1,
  'মার্চ': 2,
  'এপ্রিল': 3,
  'মে': 4,
  'জুন': 5,
  'জুলাই': 6,
  'আগস্ট': 7, 'আগষ্ট': 7,
  'সেপ্টেম্বর': 8,
  'অক্টোবর': 9,
  'নভেম্বর': 10,
  'ডিসেম্বর': 11,
};

function extractDhakaTime(asciiStr: string): { hours: number; minutes: number } {
  const timeMatch = asciiStr.match(/(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (!timeMatch) return { hours: 12, minutes: 0 };

  let hours = Number.parseInt(timeMatch[1], 10);
  const minutes = Number.parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3]?.toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return { hours, minutes };
}

const ENGLISH_MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Parses a raw publication date string (Bangla or English) into an ISO string in Asia/Dhaka (+06:00).
 * Returns null if the string cannot be parsed reliably.
 */
export function parsePublishedDate(raw: string, referenceTime: Date = new Date()): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Direct ISO check
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?([+-]\d{2}:?\d{2}|Z)?$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // Convert all digits to ASCII
  const asciiStr = banglaToAsciiDigits(trimmed).toLowerCase();

  // 1. Relative time parsing (e.g. "৩ ঘণ্টা আগে" / "3 hours ago")
  const relativeMatch = asciiStr.match(/(\d+)\s*(মিনিট|ঘণ্টা|ঘন্টা|দিন|সপ্তাহ|মাস|minute|min|hour|hr|day|week|month)s?\s*(আগে|ago)/i);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const target = new Date(referenceTime.getTime());

    if (unit.startsWith('মিনিট') || unit.startsWith('min')) {
      target.setMinutes(target.getMinutes() - amount);
    } else if (unit.startsWith('ঘণ্টা') || unit.startsWith('ঘন্টা') || unit.startsWith('hour') || unit.startsWith('hr')) {
      target.setHours(target.getHours() - amount);
    } else if (unit.startsWith('দিন') || unit.startsWith('day')) {
      target.setDate(target.getDate() - amount);
    } else if (unit.startsWith('সপ্তাহ') || unit.startsWith('week')) {
      target.setDate(target.getDate() - amount * 7);
    } else if (unit.startsWith('মাস') || unit.startsWith('month')) {
      target.setMonth(target.getMonth() - amount);
    }
    return target.toISOString();
  }

  // 2. Bangla month pattern: e.g. "১২ মে ২০২৪" or "১২ মে ২০২৪, ১০:৩০"
  for (const [monthName, monthIndex] of Object.entries(BANGLA_MONTHS)) {
    if (trimmed.includes(monthName)) {
      // Find day and year
      const dayYearMatch = asciiStr.match(/(\d{1,2})\s+[^\d]+\s+(\d{4})/);
      if (dayYearMatch) {
        const day = Number.parseInt(dayYearMatch[1], 10);
        const year = Number.parseInt(dayYearMatch[2], 10);
        
        // Check for time: "১০:৩০" or "11:56 PM"
        const { hours, minutes } = extractDhakaTime(asciiStr);

        // Construct date in Asia/Dhaka (+06:00)
        const dateObj = new Date(Date.UTC(year, monthIndex, day, hours - 6, minutes, 0));
        if (!Number.isNaN(dateObj.getTime())) {
          return dateObj.toISOString();
        }
      }
    }
  }

  // 3. English month pattern: e.g. "12 May 2024" or "May 12, 2024"
  for (const [monthName, monthIndex] of Object.entries(ENGLISH_MONTHS)) {
    if (asciiStr.includes(monthName)) {
      const match1 = asciiStr.match(new RegExp(`(\\d{1,2})\\s+${monthName}\\s+(\\d{4})`));
      const match2 = asciiStr.match(new RegExp(`${monthName}\\s+(\\d{1,2}),?\\s+(\\d{4})`));
      const match = match1 || match2;
      if (match) {
        const day = Number.parseInt(match[1], 10);
        const year = Number.parseInt(match[2], 10);
        const { hours, minutes } = extractDhakaTime(asciiStr);

        const dateObj = new Date(Date.UTC(year, monthIndex, day, hours - 6, minutes, 0));
        if (!Number.isNaN(dateObj.getTime())) {
          return dateObj.toISOString();
        }
      }
    }
  }

  // 4. Standard Date.parse fallback
  const parsed = Date.parse(asciiStr);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return null;
}
