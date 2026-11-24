import { describe, expect, it } from 'vitest';
import { parseAmount, rulerX } from '../amount';

describe('parseAmount & rulerX', () => {
  it('parses Bangla digits and South Asian scales', () => {
    expect(parseAmount('৩০ কোটি টাকা')).toBe(300_000_000);
    expect(parseAmount('৩ কোটি টাকা')).toBe(30_000_000);
    expect(parseAmount('৫ লাখ')).toBe(500_000);
    expect(parseAmount('১২ হাজার')).toBe(12_000);
  });

  it('parses English digits and international/South Asian scales', () => {
    expect(parseAmount('Tk 500 crore')).toBe(5_000_000_000);
    expect(parseAmount('$4.7B')).toBe(4_700_000_000);
    expect(parseAmount('26%')).toBe(26);
    expect(parseAmount('1,250')).toBe(1250);
  });

  it('returns null gracefully on non-numeric strings', () => {
    expect(parseAmount('গুজব')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('no numbers here')).toBeNull();
  });

  it('computes monotonic log-scale positions in [0, 1]', () => {
    const x1 = rulerX(30_000_000, 20_000_000, 400_000_000);
    const x2 = rulerX(300_000_000, 20_000_000, 400_000_000);
    expect(x1).toBeGreaterThan(0);
    expect(x2).toBeLessThan(1);
    expect(x2).toBeGreaterThan(x1);
  });
});
