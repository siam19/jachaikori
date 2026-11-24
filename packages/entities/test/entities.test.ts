/**
 * @file packages/entities/test/entities.test.ts
 * Tests for Entity Resolution v2:
 * - Bangla inflection, hyphenated suffix, orthographic variant & dateline stripping
 * - Temporal role_term resolution + multi-token role guards + apposition lookahead + headline-topic guard
 * - Article-local unambiguous coreference & deduplicated (articleId, entityId) mentions
 * - 17-type high-precision relations (dropping co_occurred/located_in)
 * - UnlinkedMention candidate emission for offline long-tail mining
 */

import { describe, expect, it } from 'bun:test';
import {
  buildSeedRegistry,
  compileRegistry,
  discoverRecurringHeadlineEntities,
  EntityHypergraphResolver,
  getTokenMatchVariants,
  resolveArticle,
  RESOLVER_VERSION,
  stripDateline,
} from '../src';

describe('Entity Normalization & Dateline Stripping', () => {
  it('strips Bangla case suffixes, hyphenated suffixes, and orthographic variants', () => {
    expect(getTokenMatchVariants('ভারতের')).toContain('ভারত');
    expect(getTokenMatchVariants('হাসিনাকে')).toContain('হাসিনা');
    expect(getTokenMatchVariants('বিএনপির')).toContain('বিএনপি');
    expect(getTokenMatchVariants('বিএনপি-র')).toContain('বিএনপি');
    expect(getTokenMatchVariants('বিজিএমইএ-এর')).toContain('বিজিএমইএ');
    expect(getTokenMatchVariants('ঢাকায়')).toContain('ঢাকা');
    expect(getTokenMatchVariants('হোসেন')).toContain('হোসাইন');
    expect(getTokenMatchVariants('নিম্নতম')).toContain('ন্যূনতম');
  });

  it('strips Bangla and English newspaper datelines without clipping real headlines', () => {
    expect(stripDateline('ঢাকা, ১৪ নভেম্বর: নতুন বাজেট নিয়ে বৈঠক হয়েছে।')).toBe(
      'নতুন বাজেট নিয়ে বৈঠক হয়েছে।'
    );
    expect(stripDateline('নিজস্ব প্রতিবেদক, ঢাকা: আদালতে শুনানি শেষ হয়েছে।')).toBe(
      'আদালতে শুনানি শেষ হয়েছে।'
    );
    expect(stripDateline('Dhaka, Nov 14 (UNB) — Central bank announced new policy.')).toBe(
      'Central bank announced new policy.'
    );
    // Real headline with colon should NOT be stripped
    expect(stripDateline('বিদ্যুৎ খাতে সংস্কার প্রয়োজন: আনিসুজ্জামান চৌধুরী')).toBe(
      'বিদ্যুৎ খাতে সংস্কার প্রয়োজন: আনিসুজ্জামান চৌধুরী'
    );
  });
});

describe('Entity Resolution v2 — Temporal Role Terms & Multi-Token Guards', () => {
  const seed = buildSeedRegistry();
  const compiled = compileRegistry({
    version: 1,
    entities: seed.entities,
    aliases: seed.aliases,
    roleTerms: seed.roleTerms,
  });

  it('resolves temporal role_term PM / প্রধানমন্ত্রী to the right leader by date', () => {
    const res2026 = resolveArticle(
      {
        id: 'art-2026',
        title: 'বিশ্ব জলবায়ু সম্মেলনে যোগ দিতে আজ তুরস্ক যাচ্ছেন প্রধানমন্ত্রী',
        publishedAt: '2026-11-02T12:00:00Z',
      },
      compiled
    );

    expect(res2026.resolverVersion).toBe(RESOLVER_VERSION);
    const pm2026 = res2026.mentions.find((m) => m.entityId === 'ent_tareque_rahman');
    expect(pm2026).toBeDefined();
    expect(pm2026!.linkMethod).toBe('role_dated');
    expect(pm2026!.inHeadline).toBe(true);
    expect(res2026.mentions.some((m) => m.entityId === 'ent_sheikh_hasina')).toBe(false);
    expect(res2026.mentions.some((m) => m.entityId === 'ent_turkey')).toBe(true);
    expect(res2026.mentions.some((m) => m.entityId === 'ent_topic_cop31')).toBe(true);

    const res2023 = resolveArticle(
      {
        id: 'art-2023',
        title: 'PM holds bilateral talks with India in Dhaka',
        publishedAt: '2023-09-08T10:00:00Z',
      },
      compiled
    );
    const ids2023 = new Set(res2023.mentions.map((m) => m.entityId));
    expect(ids2023.has('ent_sheikh_hasina')).toBe(true);
    expect(ids2023.has('ent_tareque_rahman')).toBe(false);
    expect(ids2023.has('ent_india')).toBe(true);
    expect(ids2023.has('ent_dhaka')).toBe(true);
    expect(
      res2023.relations.some(
        (r) => r.relationType === 'met_with' || r.relationType === 'diplomatic_action'
      )
    ).toBe(true);
  });

  it('ignores PM in timestamps like "2 PM"', () => {
    const res = resolveArticle(
      {
        id: 'art-time',
        title: 'Press briefing scheduled at 2 PM in Dhaka',
        publishedAt: '2026-11-10T10:00:00Z',
      },
      compiled
    );
    const ids = new Set(res.mentions.map((m) => m.entityId));
    expect(ids.has('ent_tareque_rahman')).toBe(false);
    expect(ids.has('ent_dhaka')).toBe(true);
  });

  it('blocks bare PM across 1–3 token former/foreign qualifiers, appositions, and historical headlines', () => {
    const blockedCases = [
      'সাবেক প্রধানমন্ত্রী ঢাকায় এসেছেন',
      'ভারতের প্রধানমন্ত্রী আজ বক্তব্য দেবেন',
      'পাকিস্তানের কারাবন্দী সাবেক প্রধানমন্ত্রী ইমরান খানের মুক্তি দাবি',
      'ইসরায়েলের প্রধানমন্ত্রী নতুন ঘোষণা দিয়েছেন',
      'Former PM criticizes new policy',
      'Three-time Prime Minister Khaleda Zia receives wishes',
      'Indian Prime Minister arrives for summit',
      'Ousted PM faces new charges',
      'Prime Minister Shehbaz Sharif arrives in Islamabad',
    ];

    for (const [idx, title] of blockedCases.entries()) {
      const out = resolveArticle(
        {
          id: `art-guard-${idx}`,
          title,
          publishedAt: '2026-11-17T10:00:00Z',
        },
        compiled
      );
      expect(out.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(false);
    }

    // Headline about Hasina + bare body reference to PM should NOT falsely bind to Tarique Rahman
    const histBody = resolveArticle(
      {
        id: 'art-hist-body',
        title: 'Hasina names Selim to lead AL in her absence',
        cleanText: 'Party leaders recalled when the Prime Minister addressed the rally years ago.',
        publishedAt: '2026-11-17T10:00:00Z',
      },
      compiled
    );
    expect(histBody.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(false);

    // Unknown foreign apposition should emit an UnlinkedMention (`Shehbaz Sharif`)
    const appRes = resolveArticle(
      {
        id: 'art-apposition',
        title: 'Prime Minister Shehbaz Sharif meets delegation',
        publishedAt: '2026-11-17T10:00:00Z',
      },
      compiled
    );
    expect(appRes.unlinked.some((u) => u.surface === 'Shehbaz Sharif' && u.triggerPattern === 'role_apposition')).toBe(
      true
    );

    // Bare PM without guard still resolves cleanly to Tarique Rahman in 2026
    const allowed = resolveArticle(
      {
        id: 'art-guard-ok',
        title: 'প্রধানমন্ত্রী আজ নতুন প্রকল্প উদ্বোধন করবেন',
        publishedAt: '2026-11-17T10:00:00Z',
      },
      compiled
    );
    expect(allowed.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(true);
  });

  it('deduplicates mentions per (articleId, entityId) with mentionCount and strips datelines', () => {
    const res = resolveArticle(
      {
        id: 'art-dedup',
        title: 'প্রথম দিনে ১০ কর্মসূচিতে প্রধানমন্ত্রীর অংশগ্রহণ',
        lead: 'ঢাকা, ১৭ নভেম্বর: প্রধানমন্ত্রী আজ নতুন কর্মসূচি উদ্বোধন করেন।',
        cleanText: 'অনুষ্ঠানে প্রধানমন্ত্রীকে স্বাগত জানানো হয়।',
        publishedAt: '2026-11-17T10:00:00Z',
      },
      compiled
    );
    const pmMentions = res.mentions.filter((m) => m.entityId === 'ent_tareque_rahman');
    expect(pmMentions.length).toBe(1);
    expect(pmMentions[0]!.mentionCount).toBe(3);
    expect(pmMentions[0]!.inHeadline).toBe(true);
    // "ঢাকা, ১৭ নভেম্বর:" dateline should be stripped so ent_dhaka is NOT falsely emitted
    expect(res.mentions.some((m) => m.entityId === 'ent_dhaka')).toBe(false);
  });

  it('extracts 17-type directional relations (quoted_about, resigned_or_removed, affiliated_with) without co_occurred noise', () => {
    const resolver = new EntityHypergraphResolver(seed.entities, seed.aliases, seed.roleTerms);

    const quoteArt = resolver.resolveArticle({
      id: 'art-quote',
      title: 'শেখ হাসিনার বিষয়ে শর্ত নিয়ে ভারতের সঙ্গে কথাই হয়নি: শামা ওবায়েদ',
      publishedAt: '2026-11-17T10:00:00Z',
    });
    expect(quoteArt.mentions.find((m) => m.entityId === 'ent_shama_obaed')?.role).toBe('quoted_speaker');
    expect(quoteArt.relations.some((r) => r.relationType === 'quoted_about')).toBe(true);

    const resignArt = resolver.resolveArticle({
      id: 'art-resign',
      title: 'এনসিপি থেকে সামান্তা শারমিনের পদত্যাগ',
      publishedAt: '2026-11-05T10:00:00Z',
    });
    expect(resignArt.relations.some((r) => r.relationType === 'resigned_or_removed')).toBe(true);

    const affArt = resolver.resolveArticle({
      id: 'art-aff',
      title: 'বিএনপি মহাসচিব মির্জা ফখরুল ইসলাম আলমগীর বৈঠকে অংশ নেন',
      publishedAt: '2026-11-10T10:00:00Z',
    });
    expect(
      affArt.relations.some(
        (r) =>
          r.relationType === 'affiliated_with' &&
          r.sourceEntityId === 'ent_mirza_fakhrul' &&
          r.targetEntityId === 'ent_bnp'
      )
    ).toBe(true);

    // No noisy `co_occurred` edges on neutral mentions
    const neutralArt = resolver.resolveArticle({
      id: 'art-neutral',
      title: 'ঢাকায় আজ বাংলাদেশ ও ভারতের প্রতিনিধিরা উপস্থিত ছিলেন।',
      publishedAt: '2026-11-10T10:00:00Z',
    });
    expect(neutralArt.relations.length).toBe(0);
  });

  it('performs unambiguous article-local name coreference and emits unlinked long-tail candidates', () => {
    const out = resolveArticle(
      {
        id: 'art-coref-unlinked',
        title: 'বিদ্যুৎ খাতে সংস্কার প্রয়োজন: আনিসুজ্জামান চৌধুরী',
        cleanText:
          'বৈঠকে ববি হাজ্জাজ বক্তব্য রাখেন। পরে হাজ্জাজ নতুন প্রস্তাব তুলে ধরেন। এ সময় বিজিএমইএ সভাপতি মাহমুদ হাসান খান এবং Bangladesh Knitwear Association প্রতিনিধিরা উপস্থিত ছিলেন।',
        publishedAt: '2026-11-15T10:00:00Z',
      },
      compiled
    );

    const bobby = out.mentions.find((m) => m.entityId === 'ent_bobby_hajjaj');
    expect(bobby).toBeDefined();
    expect(bobby!.mentionCount).toBe(2);

    const unlinkedSurfaces = out.unlinked.map((u) => u.surface);
    expect(unlinkedSurfaces).toContain('আনিসুজ্জামান চৌধুরী');
    expect(unlinkedSurfaces).toContain('মাহমুদ হাসান খান');
    expect(unlinkedSurfaces).toContain('Bangladesh Knitwear Association');
  });

  it('follows mergedInto redirects in compiled registry and preserves hub flags', () => {
    const mergedCompiled = compileRegistry({
      version: 2,
      entities: [
        ...seed.entities,
        {
          id: 'ent_old_dup',
          canonicalBn: 'তারেক জিয়া',
          canonicalEn: 'Tareque Zia',
          entityType: 'person',
          status: 'merged',
          mergedInto: 'ent_tareque_rahman',
        },
      ],
      aliases: [
        ...seed.aliases,
        { aliasNorm: 'তারেক জিয়া', aliasRaw: 'তারেক জিয়া', entityId: 'ent_old_dup' },
      ],
      roleTerms: seed.roleTerms,
    });

    const out = resolveArticle(
      {
        id: 'art-merge',
        title: 'তারেক জিয়া আজ সমাবেশে বক্তব্য রাখবেন',
        publishedAt: '2026-11-17T10:00:00Z',
      },
      mergedCompiled
    );
    expect(out.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(true);
    expect(mergedCompiled.entityMap.get('ent_bangladesh')?.isHub).toBe(true);
  });

  it('discovers recurring quoted speakers from titles without duplicating curated entities', () => {
    const titles = [
      'বিদ্যুৎ খাতে সংস্কার প্রয়োজন: আনিসুজ্জামান চৌধুরী',
      'আর্থিক খাতের শৃঙ্খলা ফিরিয়ে আনা হবে: আনিসুজ্জামান চৌধুরী',
      'বাজেট বাস্তবায়নে নজরদারি বাড়ছে: আনিসুজ্জামান চৌধুরী',
      'নতুন প্রকল্প অনুমোদন হলো: মাহদী আমিন',
    ];
    const discovered = discoverRecurringHeadlineEntities(titles, {
      minMentions: 3,
      existingAliases: seed.aliases,
    });
    expect(discovered.entities.length).toBe(1);
    expect(discovered.entities[0]!.canonicalBn).toBe('আনিসুজ্জামান চৌধুরী');
  });
});
