import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { outletScript, scriptRuns } from '../scripts';
import { Verbatim } from '../../ui/Verbatim';

describe('scripts & <Verbatim>', () => {
  it('maps outlets to their base publishing script', () => {
    expect(outletScript('daily-star')).toBe('en');
    expect(outletScript('business-standard')).toBe('en');
    expect(outletScript('prothom-alo')).toBe('bn');
    expect(outletScript('bdnews24')).toBe('bn');
  });

  it('keeps neutral punctuation attached to the preceding script run', () => {
    const runs = scriptRuns('বাংলাদেশ ব্যাংক (২০২৬) বলেছে, "ok".', 'bn');
    expect(runs[0]?.lang).toBe('bn');
    expect(runs.some((r) => r.lang === 'en' && r.text.includes('ok'))).toBe(true);
  });

  it('does not fragment markup for short English proper nouns inside Bangla text, but wraps >= 20 char opposite-script quotes', () => {
    const shortHtml = renderToStaticMarkup(
      <Verbatim text="বাংলাদেশ ব্যাংক IMF এর সাথে বৈঠক করেছে।" outlet="prothom-alo" />
    );
    expect(shortHtml).toContain('lang="bn"');
    expect(shortHtml).not.toContain('lang="en"');

    const longHtml = renderToStaticMarkup(
      <Verbatim
        text="প্রতিবেদনে বলা হয়েছে: Bangladesh Bank eased foreign borrowing rules for firms."
        outlet="prothom-alo"
      />
    );
    expect(longHtml).toContain('lang="bn"');
    expect(longHtml).toContain('<span lang="en">');
    expect(longHtml).toContain('Bangladesh Bank eased');
  });
});
