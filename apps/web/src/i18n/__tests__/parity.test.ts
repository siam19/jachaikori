import { describe, expect, it } from 'vitest';
import { en, type StringKey } from '../en';
import { bn } from '../bn';
import { tt } from '../tt';

function extractPlaceholders(str: string): string[] {
  const names = new Set<string>();
  const pluralRe = /\{(\w+),\s*plural,/g;
  let m: RegExpExecArray | null;
  while ((m = pluralRe.exec(str))) names.add(m[1]!);

  const stripped = str.replace(/\{(\w+),\s*plural,\s*one\s*\{[^}]*\}\s*other\s*\{[^}]*\}\}/g, '');
  const simpleRe = /\{(\w+)\}/g;
  while ((m = simpleRe.exec(stripped))) names.add(m[1]!);

  return Array.from(names).sort();
}

describe('i18n EN ↔ বাংলা parity & formatting', () => {
  it('en.ts and bn.ts have identical key sets, non-empty values, and matching {placeholders}', () => {
    const enKeys = Object.keys(en).sort();
    const bnKeys = Object.keys(bn).sort();
    expect(bnKeys).toEqual(enKeys);

    for (const key of enKeys as StringKey[]) {
      const enVal = en[key];
      const bnVal = bn[key];
      expect(enVal.trim().length, `empty en value for ${key}`).toBeGreaterThan(0);
      expect(bnVal.trim().length, `empty bn value for ${key}`).toBeGreaterThan(0);
      expect(extractPlaceholders(bnVal), `placeholder mismatch for ${key}`).toEqual(
        extractPlaceholders(enVal)
      );
    }
  });

  it('handles English plurals and Bangla numeral localization', () => {
    expect(tt('res.tally.differ', 'en', { n: 1 })).toBe('1 detail differs');
    expect(tt('res.tally.differ', 'en', { n: 3 })).toBe('3 details differ');
    expect(tt('res.tally.differ', 'bn', { n: 3 })).toBe('৩টি বিষয়ে পার্থক্য');
    expect(tt('evt.outletsCount', 'bn', { n: 5 })).toBe('৮টির মধ্যে ৫টি সংবাদমাধ্যম');
  });
});
