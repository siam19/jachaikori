import { describe, expect, test } from 'bun:test';
import { buildSeedRegistry, compileRegistry } from '@jachaikori/entities';
import {
  analyzeCrossOutletDifferences,
  compareDateClaims,
  compareNumericClaims,
  compareSpeakerAndRoles,
  HeuristicVerificationAdapter,
  parseDateSpan,
  parseQuantities,
  runClaimDiffEngine,
} from '../src/index';
import type { CardExtraction, StoredArticleClaim, VerificationSourceMatch } from '@jachaikori/schema';

describe('Deterministic Bangla/English Numeric Comparator', () => {
  test('matches cross-script South Asian and international scale equivalents ("৫০০ কোটি টাকা" == "Tk 5 billion")', () => {
    const parsedBn = parseQuantities(['৫০০ কোটি টাকা']);
    const parsedEn = parseQuantities(['Tk 5 billion']);
    expect(parsedBn[0]?.canonicalValue).toBe(5_000_000_000);
    expect(parsedEn[0]?.canonicalValue).toBe(5_000_000_000);
    expect(parsedBn[0]?.unitFamily).toBe('currency_bdt');

    const diffs = compareNumericClaims(['৫০০ কোটি টাকা'], ['Tk 5 billion']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.flag).toBe('match');
    expect(diffs[0]?.deterministic).toBe(true);
  });

  test('flags 10x numeric distortion ("৫০০ কোটি টাকা" vs "৫০ কোটি টাকা") as major mismatch_number', () => {
    const diffs = compareNumericClaims(['৫০০ কোটি টাকা'], ['৫০ কোটি টাকা']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.flag).toBe('mismatch_number');
    expect(diffs[0]?.severity).toBe('major');
    expect(diffs[0]?.deterministic).toBe(true);
    expect(diffs[0]?.cardSpan).toContain('৫০০ কোটি টাকা');
    expect(diffs[0]?.articleSpan).toContain('৫০ কোটি টাকা');
  });

  test('ignores bare calendar years and day-of-month tokens inside dates ("১৮ নভেম্বর ২০২৬"), and applies 2% tolerance', () => {
    expect(parseQuantities(['2026', '১৯৭১', '১৮ নভেম্বর ২০২৬', '18 Nov 2026'])).toHaveLength(0);
    const tol = compareNumericClaims(['$4.7B'], ['$4.72 billion']);
    expect(tol[0]?.flag).toBe('match');

    const pctMismatch = compareNumericClaims(['১২%'], ['৮%']);
    expect(pctMismatch[0]?.flag).toBe('mismatch_number');
  });
});

describe('Deterministic Bangla/English Date Comparator', () => {
  test('parses Bangla/English dates and resolves relative Bangla markers in Asia/Dhaka', () => {
    expect(parseDateSpan('১৮ নভেম্বর ২০২৬')?.isoDate).toBe('2026-11-18');
    expect(parseDateSpan('18 Nov 2026')?.isoDate).toBe('2026-11-18');
    expect(parseDateSpan('গতকাল', '2026-11-18T12:00:00+06:00')?.isoDate).toBe('2026-11-17');
    expect(parseDateSpan('আগামীকাল', '2026-11-18T12:00:00+06:00')?.isoDate).toBe('2026-11-19');
  });

  test('flags altered dates and recycled old-news photo cards', () => {
    const ok = compareDateClaims({
      cardDates: ['১৮ নভেম্বর ২০২৬'],
      articleDates: ['18 November 2026'],
      articlePublishedAt: '2026-11-18T10:00:00+06:00',
    });
    expect(ok[0]?.flag).toBe('match');

    const recycled = compareDateClaims({
      cardDates: ['১৮ নভেম্বর ২০২৬'],
      articleDates: [],
      articlePublishedAt: '2024-05-12T10:00:00+06:00',
    });
    expect(recycled[0]?.flag).toBe('mismatch_date');
    expect(recycled[0]?.severity).toBe('major');

    const breakingOld = compareDateClaims({
      cardDates: [],
      cardText: 'এইমাত্র পাওয়া: বড় ঘোষণা',
      articleDates: [],
      articlePublishedAt: '2024-01-10T10:00:00+06:00',
      nowIso: '2026-11-24T12:00:00+06:00',
    });
    expect(breakingOld[0]?.flag).toBe('mismatch_date');
  });
});

describe('Speaker Attribution, Role-Term & Full Hybrid Diff Engine', () => {
  const seed = buildSeedRegistry();
  const compiled = compileRegistry({
    version: 1,
    entities: seed.entities,
    aliases: seed.aliases,
    roleTerms: seed.roleTerms,
  });

  test('detects misattributed quote speaker and outdated office title via role_term', () => {
    const extraction: CardExtraction = {
      inputKind: 'photo_card',
      language: 'bn',
      headline: 'নতুন শুল্ক নীতি বাতিল করা হবে — তারেক রহমান',
      ocrText: 'প্রধানমন্ত্রী শেখ হাসিনা বলেছেন নতুন শুল্ক নীতি বাতিল করা হবে — তারেক রহমান',
      quotedSpeaker: 'তারেক রহমান',
      attributedStatement: 'নতুন শুল্ক নীতি বাতিল করা হবে',
      isQuote: true,
      claimedNumbers: [],
      claimedDates: ['2026-11-18'],
      claimedEntities: ['তারেক রহমান'],
      publisherLogo: null,
      hasVerifiableClaim: true,
      confidence: 0.9,
    };

    const artClaims: StoredArticleClaim[] = [
      {
        id: 'clm_1',
        articleId: 'art_1',
        claimText: 'নতুন শুল্ক নীতি পর্যালোচনা করা হবে বলে জানিয়েছেন সালাহউদ্দিন আহমেদ।',
        claimType: 'quote',
        speakerEntityId: 'ent_salahuddin_ahmed',
        speakerName: 'Salahuddin Ahmed',
        subjectEntityId: null,
        objectEntityId: null,
        numbers: [],
        dates: ['2026-11-18'],
        hedgingLevel: 'reported',
        evidenceSnippet: null,
        confidence: 0.9,
        extractorVersion: 'v2',
      },
    ];

    const diffs = compareSpeakerAndRoles({
      extraction,
      articleClaims: artClaims,
      articleTitle: 'শুল্ক নীতি পর্যালোচনা হবে: সালাহউদ্দিন আহমেদ',
      articleSnippet: 'সালাহউদ্দিন আহমেদ বলেন, নতুন শুল্ক নীতি পর্যালোচনা করা হবে।',
      articlePublishedAt: '2026-11-18T10:00:00Z',
      compiled,
      referenceDateIso: '2026-11-18T10:00:00Z',
    });

    expect(diffs.some((d) => d.flag === 'mismatch_speaker')).toBe(true);
    expect(diffs.some((d) => d.flag === 'missing_context' && d.cardSpan?.includes('Sheikh Hasina'))).toBe(true);
  });

  test('runClaimDiffEngine catches omitted denial ("গুজব"), hedging shift, and numeric alteration deterministically', async () => {
    const extraction: CardExtraction = {
      inputKind: 'photo_card',
      language: 'bn',
      headline: 'বিএনপির ১০ নেতার পদত্যাগ নিশ্চিত, ৫০ কোটি টাকা জরিমানা',
      ocrText: 'বিএনপির ১০ নেতার পদত্যাগ নিশ্চিত, ৫০ কোটি টাকা জরিমানা',
      quotedSpeaker: null,
      attributedStatement: 'বিএনপির ১০ নেতার পদত্যাগ নিশ্চিত, ৫০ কোটি টাকা জরিমানা',
      isQuote: false,
      claimedNumbers: ['৫০ কোটি টাকা'],
      claimedDates: [],
      claimedEntities: ['বিএনপি'],
      publisherLogo: null,
      hasVerifiableClaim: true,
      confidence: 0.92,
    };

    const sources: VerificationSourceMatch[] = [
      {
        articleId: 'art_rumor',
        outlet: 'prothom-alo',
        title: 'আরও একাধিক নেতার পদত্যাগের খবর ‘গুজব’: বিএনপি',
        canonicalUrl: 'https://www.prothomalo.com/politics/rumor',
        publishedAt: '2026-11-18T10:00:00Z',
        snippet: 'পদত্যাগের খবর ভিত্তিহীন ও গুজব বলে জানিয়েছে বিএনপি; সম্ভাব্য জরিমানা ৫ কোটি টাকা হতে পারে।',
        clusterId: null,
        clusterOutletCount: null,
        rrfScore: 0.03,
        rerankScore: 0.9,
        matchSummary: null,
        matchedEntityIds: ['ent_bnp'],
      },
    ];

    const res = await runClaimDiffEngine({
      extraction,
      sources,
      compiledRegistry: compiled,
      referenceDateIso: '2026-11-18T10:00:00Z',
      nowIso: '2026-11-24T10:00:00Z',
      diffJudge: new HeuristicVerificationAdapter(),
      inputHash: 'hash_test_1',
    });

    expect(res.overallDiffStatus).toBe('significant_differences');
    const flags = res.sources[0]?.diffFlags ?? [];
    expect(flags).toContain('mismatch_number');
    expect(flags).toContain('missing_context');
    expect(flags).toContain('hedging_shift');
  });

  test('analyzeCrossOutletDifferences finds consensus numbers, divergent figures, and hedging differences', () => {
    const diffs = analyzeCrossOutletDifferences([
      {
        outlet: 'prothom-alo',
        articleId: 'a1',
        title: 'জলবায়ু খাতে ৪১৫ কোটি টাকা অনুদান পাচ্ছে বাংলাদেশ',
        claims: [
          {
            id: 'c1',
            articleId: 'a1',
            claimText: 'বাংলাদেশ ৪১৫ কোটি টাকা অনুদান পাবে।',
            claimType: 'factual',
            speakerEntityId: null,
            subjectEntityId: null,
            objectEntityId: null,
            numbers: ['৪১৫ কোটি টাকা'],
            dates: [],
            hedgingLevel: 'certain',
            evidenceSnippet: null,
            confidence: 0.9,
            extractorVersion: 'v2',
          },
        ],
      },
      {
        outlet: 'daily-star',
        articleId: 'a2',
        title: 'Bangladesh to receive Tk415cr in Global Shield grants',
        claims: [
          {
            id: 'c2',
            articleId: 'a2',
            claimText: 'Bangladesh may receive Tk 415 crore in grants.',
            claimType: 'factual',
            speakerEntityId: null,
            subjectEntityId: null,
            objectEntityId: null,
            numbers: ['Tk 415 crore'],
            dates: [],
            hedgingLevel: 'hedged',
            evidenceSnippet: null,
            confidence: 0.9,
            extractorVersion: 'v2',
          },
        ],
      },
      {
        outlet: 'jugantor',
        articleId: 'a3',
        title: '৫০০ কোটি টাকা অনুদানের আশা',
        claims: [
          {
            id: 'c3',
            articleId: 'a3',
            claimText: '৫০০ কোটি টাকা অনুদান মিলতে পারে।',
            claimType: 'factual',
            speakerEntityId: null,
            subjectEntityId: null,
            objectEntityId: null,
            numbers: ['৫০০ কোটি টাকা'],
            dates: [],
            hedgingLevel: 'hedged',
            evidenceSnippet: null,
            confidence: 0.85,
            extractorVersion: 'v2',
          },
        ],
      },
    ]);

    expect(diffs.some((d) => d.kind === 'consensus_number')).toBe(true);
    expect(diffs.some((d) => d.kind === 'number_difference')).toBe(true);
    expect(diffs.some((d) => d.kind === 'hedging_difference')).toBe(true);
  });
});
