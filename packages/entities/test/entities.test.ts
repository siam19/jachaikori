/**
 * @file packages/entities/test/entities.test.ts
 * Tests for Bangla suffix normalization, temporal role disambiguation, quote speaker
 * discovery, and sentence-level hypergraph relation extraction.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildSeedRegistry,
  discoverRecurringHeadlineEntities,
  EntityHypergraphResolver,
  getTokenMatchVariants,
} from '../src';

describe('Entity Normalization & Temporal Role Resolution', () => {
  it('strips Bangla case suffixes conservatively without breaking stems', () => {
    expect(getTokenMatchVariants('ভারতের')).toContain('ভারত');
    expect(getTokenMatchVariants('হাসিনাকে')).toContain('হাসিনা');
    expect(getTokenMatchVariants('বিএনপির')).toContain('বিএনপি');
    expect(getTokenMatchVariants('ঢাকায়')).toContain('ঢাকা');
  });

  it('resolves temporal role aliases PM / প্রধানমন্ত্রী to the right leader by publication date', () => {
    const { entities, aliases } = buildSeedRegistry();
    const resolver = new EntityHypergraphResolver(entities, aliases);

    const res2026 = resolver.resolveArticle({
      id: 'art-2026',
      title: 'বিশ্ব জলবায়ু সম্মেলনে যোগ দিতে আজ তুরস্ক যাচ্ছেন প্রধানমন্ত্রী',
      publishedAt: '2026-11-02T12:00:00Z',
    });

    const ids2026 = new Set(res2026.mentions.map((m) => m.entityId));
    expect(ids2026.has('ent_tareque_rahman')).toBe(true);
    expect(ids2026.has('ent_sheikh_hasina')).toBe(false);
    expect(ids2026.has('ent_turkey')).toBe(true);
    expect(ids2026.has('ent_topic_cop31')).toBe(true);

    const res2023 = resolver.resolveArticle({
      id: 'art-2023',
      title: 'PM holds bilateral talks with India in Dhaka',
      publishedAt: '2023-09-08T10:00:00Z',
    });
    const ids2023 = new Set(res2023.mentions.map((m) => m.entityId));
    expect(ids2023.has('ent_sheikh_hasina')).toBe(true);
    expect(ids2023.has('ent_tareque_rahman')).toBe(false);
    expect(ids2023.has('ent_india')).toBe(true);
    expect(ids2023.has('ent_dhaka')).toBe(true);
    expect(res2023.relations.some((r) => r.relationType === 'met_with')).toBe(true);
  });

  it('ignores lowercase "pm" in timestamps like "2 PM"', () => {
    const { entities, aliases } = buildSeedRegistry();
    const resolver = new EntityHypergraphResolver(entities, aliases);

    const res = resolver.resolveArticle({
      id: 'art-time',
      title: 'Press briefing scheduled at 2 PM in Dhaka',
      publishedAt: '2026-11-10T10:00:00Z',
    });
    const ids = new Set(res.mentions.map((m) => m.entityId));
    expect(ids.has('ent_tareque_rahman')).toBe(false);
    expect(ids.has('ent_dhaka')).toBe(true);
  });

  it('extracts quoted_about and resigned_from hypergraph edges across Bangla & English', () => {
    const { entities, aliases } = buildSeedRegistry();
    const resolver = new EntityHypergraphResolver(entities, aliases);

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
    expect(resignArt.relations.some((r) => r.relationType === 'resigned_from')).toBe(true);
  });

  it('discovers recurring quoted speakers from titles without duplicating curated entities', () => {
    const { aliases } = buildSeedRegistry();
    const titles = [
      'বিদ্যুৎ খাতে সংস্কার প্রয়োজন: আনিসুজ্জামান চৌধুরী',
      'আর্থিক খাতের শৃঙ্খলা ফিরিয়ে আনা হবে: আনিসুজ্জামান চৌধুরী',
      'বাজেট বাস্তবায়নে নজরদারি বাড়ছে: আনিসুজ্জামান চৌধুরী',
      'নতুন প্রকল্প অনুমোদন হলো: মাহদী আমিন',
    ];
    const discovered = discoverRecurringHeadlineEntities(titles, {
      minMentions: 3,
      existingAliases: aliases,
    });
    expect(discovered.entities.length).toBe(1);
    expect(discovered.entities[0]!.canonicalBn).toBe('আনিসুজ্জামান চৌধুরী');
  });

  it('blocks bare PM / প্রধানমন্ত্রী when preceded by former/ousted/acting or foreign qualifiers', () => {
    const { entities, aliases } = buildSeedRegistry();
    const resolver = new EntityHypergraphResolver(entities, aliases);

    const blockedCases = [
      'সাবেক প্রধানমন্ত্রী ঢাকায় এসেছেন',
      'ভারতের প্রধানমন্ত্রী আজ বক্তব্য দেবেন',
      'ইসরায়েলের প্রধানমন্ত্রী নতুন ঘোষণা দিয়েছেন',
      'Former PM criticizes new policy',
      'Indian Prime Minister arrives for summit',
      'Ousted PM faces new charges',
    ];

    for (const [idx, title] of blockedCases.entries()) {
      const out = resolver.resolveArticle({
        id: `art-guard-${idx}`,
        title,
        publishedAt: '2026-11-17T10:00:00Z',
      });
      expect(out.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(false);
    }

    // Bare PM without guard should still resolve to Tarique Rahman in 2026
    const allowed = resolver.resolveArticle({
      id: 'art-guard-ok',
      title: 'প্রধানমন্ত্রী আজ নতুন প্রকল্প উদ্বোধন করবেন',
      publishedAt: '2026-11-17T10:00:00Z',
    });
    expect(allowed.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(true);
  });

  it('resolves Tarique Zia / তারেক জিয়া aliases to ent_tareque_rahman', () => {
    const { entities, aliases } = buildSeedRegistry();
    const resolver = new EntityHypergraphResolver(entities, aliases);

    const bnOut = resolver.resolveArticle({
      id: 'art-tz-bn',
      title: 'তারেক জিয়া আজ সমাবেশে বক্তব্য রাখবেন',
      publishedAt: '2026-11-17T10:00:00Z',
    });
    expect(bnOut.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(true);

    const enOut = resolver.resolveArticle({
      id: 'art-tz-en',
      title: 'Tarique Zia addresses rally in Dhaka',
      publishedAt: '2026-11-17T10:00:00Z',
    });
    expect(enOut.mentions.some((m) => m.entityId === 'ent_tareque_rahman')).toBe(true);
  });
});
