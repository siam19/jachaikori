import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number]; // 0..1 linear or sRGB

function parseHex(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(srgbToLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Accurate CSS Color 4 `color-mix(in oklab, fg 12%, bg)` for wash verification
function linearSrgbToOklab([r, g, b]: RGB): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToLinearSrgb([L, a, b]: [number, number, number]): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function mixOklab(fg: RGB, bg: RGB, fgWeight = 0.12): RGB {
  const lab1 = linearSrgbToOklab(fg.map(srgbToLinear) as RGB);
  const lab2 = linearSrgbToOklab(bg.map(srgbToLinear) as RGB);
  const mixed: [number, number, number] = [
    lab1[0] * fgWeight + lab2[0] * (1 - fgWeight),
    lab1[1] * fgWeight + lab2[1] * (1 - fgWeight),
    lab1[2] * fgWeight + lab2[2] * (1 - fgWeight),
  ];
  return oklabToLinearSrgb(mixed).map(linearToSrgb) as RGB;
}

function extractTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe('WCAG 2.x contrast verification on tokens.css', () => {
  const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8');
  const morningBlock = css.match(/@theme\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const eveningBlock = css.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  const morning = extractTokens(morningBlock);
  const evening = extractTokens(eveningBlock);

  for (const [name, tokens] of [
    ['Morning', morning],
    ['Evening', evening],
  ] as const) {
    it(`${name} palette meets >= 4.5:1 for all text/wash pairs and >= 3:1 for rule-strong`, () => {
      const surfaces = ['paper', 'paper-raised', 'paper-sunk'] as const;
      const textColors = ['ink', 'pencil', 'sage', 'rust', 'ochre', 'violet'] as const;
      const diffColors = ['sage', 'rust', 'ochre', 'violet'] as const;

      for (const fgKey of textColors) {
        for (const bgKey of surfaces) {
          const ratio = contrastRatio(parseHex(tokens[fgKey]!), parseHex(tokens[bgKey]!));
          expect(ratio, `${name} ${fgKey} on ${bgKey}`).toBeGreaterThanOrEqual(4.5);
        }
      }

      // Diff hues on their own 12% oklab wash over paper and paper-raised
      for (const hue of diffColors) {
        for (const base of ['paper', 'paper-raised'] as const) {
          const wash = mixOklab(parseHex(tokens[hue]!), parseHex(tokens[base]!), 0.12);
          const ratio = contrastRatio(parseHex(tokens[hue]!), wash);
          expect(ratio, `${name} ${hue} on 12% wash over ${base}`).toBeGreaterThanOrEqual(4.5);
        }
      }

      // Interactive border token rule-strong >= 3.0:1 on paper and paper-raised
      for (const base of ['paper', 'paper-raised'] as const) {
        const ratio = contrastRatio(parseHex(tokens['rule-strong']!), parseHex(tokens[base]!));
        expect(ratio, `${name} rule-strong on ${base}`).toBeGreaterThanOrEqual(3.0);
      }
    });
  }
});
