export const EN_OUTLETS = new Set(['daily-star', 'business-standard', 'dhaka-tribune']);

export type Script = 'bn' | 'en';

export const outletScript = (outlet?: string | null): Script =>
  EN_OUTLETS.has(outlet ?? '') ? 'en' : 'bn';

const isBangla = (ch: string): boolean => {
  const c = ch.codePointAt(0);
  return c !== undefined && c >= 0x0980 && c <= 0x09ff;
};

const NEUTRAL = '0123456789.,;:!?()-–—%/’“”‘\'৳$€£+•·|[]{}@#&*_=<>~`\\';

const isNeutral = (ch: string): boolean =>
  ch.trim() === '' || NEUTRAL.includes(ch) || ch.charCodeAt(0) === 34;

export interface ScriptRun {
  text: string;
  lang: Script;
}

/**
 * Split mixed text into script runs so long opposite-script quotes (>= 20 chars)
 * get the proper `lang` attribute without fragmenting single proper nouns.
 */
export function scriptRuns(text: string, base: Script): ScriptRun[] {
  const runs: ScriptRun[] = [];
  for (const ch of text) {
    const last = runs.at(-1);
    const lang: Script = isBangla(ch) ? 'bn' : isNeutral(ch) ? (last?.lang ?? base) : 'en';
    if (last && last.lang === lang) {
      last.text += ch;
    } else {
      runs.push({ text: ch, lang });
    }
  }
  return runs;
}

export function inferScript(text: string, fallback: Script = 'bn'): Script {
  let bnCount = 0;
  let enCount = 0;
  for (const ch of text) {
    if (isBangla(ch)) bnCount++;
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) enCount++;
  }
  if (bnCount === 0 && enCount === 0) return fallback;
  return bnCount >= enCount ? 'bn' : 'en';
}
