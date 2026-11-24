import type { ClaimDiffFlag, ClaimDiffItem, VerificationSourceMatch } from '@jachaikori/schema';
import { tt } from '../../i18n/tt';
import { useLang } from '../../lib/useLang';
import { useTheme } from '../../lib/useTheme';
import { Clipping } from '../../ui/Clipping';
import { FlagChip } from '../../ui/Chip';
import { ProofStrip } from '../../diff/ProofStrip';
import { Lineup } from '../../diff/Lineup';
import { Receipt } from '../../diff/Receipt';

const ALL_FLAGS: ClaimDiffFlag[] = [
  'match',
  'mismatch_number',
  'mismatch_date',
  'mismatch_speaker',
  'mismatch_quote',
  'hedging_shift',
  'missing_context',
];

const DEMO_HEADLINE =
  'বড়দিন উপলক্ষে খ্রিস্টান সম্প্রদায়ের জন্য ৩০ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান';

const DEMO_DIFFS: ClaimDiffItem[] = [
  {
    flag: 'mismatch_number',
    severity: 'major',
    deterministic: true,
    cardSpan: '৩০ কোটি টাকার',
    articleSpan: '৩ কোটি টাকার',
    explanationEn: 'Card states "৩০ কোটি টাকার" (Tk 30 crore), whereas the accredited article reports "৩ কোটি টাকার" (Tk 3 crore).',
    explanationBn: 'কার্ডে উল্লেখ করা হয়েছে "৩০ কোটি টাকার", তবে মূলধারার প্রতিবেদনে রয়েছে "৩ কোটি টাকার"।',
    confidence: 0.96,
  },
  {
    flag: 'hedging_shift',
    severity: 'notable',
    deterministic: true,
    cardSpan: null,
    articleSpan: 'সম্ভাব্য',
    explanationEn: 'Accredited reporting uses cautious framing ("সম্ভাব্য"), whereas the card states it definitively.',
    explanationBn: 'মূলধারার প্রতিবেদনে সতর্ক ভাষা ("সম্ভাব্য") ব্যবহার করা হলেও কার্ডে তা নিশ্চিতভাবে বলা হয়েছে।',
    confidence: 0.85,
  },
  {
    flag: 'missing_context',
    severity: 'major',
    deterministic: true,
    cardSpan: null,
    articleSpan: 'গুজব',
    explanationEn: 'Accredited reporting includes a denial qualification ("গুজব") absent from the card.',
    explanationBn: 'মূলধারার প্রতিবেদনে "গুজব" হিসেবে উল্লেখ থাকলেও তা কার্ডে নেই।',
    confidence: 0.9,
  },
  {
    flag: 'match',
    severity: 'info',
    deterministic: true,
    cardSpan: 'তারেক রহমান',
    articleSpan: 'Tarique Rahman',
    explanationEn: 'Attributed speaker aligns with accredited reporting.',
    explanationBn: 'বক্তার নাম মূলধারার প্রতিবেদনের সঙ্গে মিলেছে।',
    confidence: 0.95,
  },
];

const DEMO_SOURCE: VerificationSourceMatch = {
  articleId: 'demo-art-1',
  outlet: 'bangladesh-protidin',
  title: 'খ্রিস্টান সম্প্রদায়ের বড়দিন উদযাপনে ৩ কোটি টাকার অনুদান হস্তান্তর',
  canonicalUrl: 'https://www.bd-pratidin.com/',
  publishedAt: '2026-11-18T14:20:00+06:00',
  snippet:
    'বড়দিন উদযাপনে খ্রিস্টান সম্প্রদায়ের প্রতিনিধিদের হাতে ৩ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান।',
  clusterId: null,
  clusterOutletCount: 4,
  rrfScore: 0.03,
  rerankScore: 0.89,
  matchSummary: null,
  matchedEntityIds: [],
  diffFlags: ['mismatch_number', 'hedging_shift', 'missing_context'],
  diffs: DEMO_DIFFS,
};

export function GalleryPage() {
  const [lang, , toggleLang] = useLang();
  const [theme, setTheme] = useTheme();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink m-0">
            The Morning Edition · Flag Vocabulary &amp; Diff Gallery
          </h1>
          <p className="text-sm text-pencil m-0">
            Full 7-flag palette, underline styles, Proof Strip + Rack, Lineup, and Receipt in Morning &amp; Evening and EN ↔ বাংলা.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            className="rounded-xl border border-rule-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink cursor-pointer"
          >
            {tt('lang.toggle', lang)}
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-xl border border-rule-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink cursor-pointer"
          >
            {theme === 'dark' ? tt('theme.morning', lang) : tt('theme.evening', lang)}
          </button>
        </div>
      </header>

      <Clipping className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pencil m-0">
          7-Flag Vocabulary (colour + underline + glyph)
        </h2>
        <div className="flex flex-wrap gap-2">
          {ALL_FLAGS.map((flag) => (
            <FlagChip key={flag} flag={flag} lang={lang} />
          ))}
        </div>
      </Clipping>

      <Lineup sources={[DEMO_SOURCE]} lang={lang} />

      <Clipping className="space-y-3">
        <ProofStrip
          headline={DEMO_HEADLINE}
          diffs={DEMO_DIFFS}
          cardScript="bn"
          articleScript="bn"
          lang={lang}
        />
        <Receipt source={DEMO_SOURCE} lang={lang} defaultOpen />
      </Clipping>
    </div>
  );
}
