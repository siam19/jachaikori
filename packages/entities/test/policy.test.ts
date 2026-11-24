/**
 * @file packages/entities/test/policy.test.ts
 * Unit tests for Entity Resolution v2 governance policies, seed validation, and cluster redirects.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildRedirects,
  buildSeedRegistry,
  evaluateAutoMerge,
  evaluateCandidatePromotion,
  isSafeAutoAlias,
  validateSeedRegistry,
  type ExistingAliasRef,
} from '../src';

describe('Seed Registry Validation', () => {
  it('validates the built-in curated seed registry with zero errors', () => {
    const seed = buildSeedRegistry();
    const errors = validateSeedRegistry(seed);
    expect(errors).toEqual([]);
  });

  it('catches overlapping role_term windows and alias collisions', () => {
    const errors = validateSeedRegistry({
      entities: [
        { id: 'ent_role_pm', canonicalBn: 'প্রধানমন্ত্রী', canonicalEn: 'PM', entityType: 'role' },
        { id: 'ent_a', canonicalBn: 'ক', canonicalEn: 'Person A', entityType: 'person' },
        { id: 'ent_b', canonicalBn: 'খ', canonicalEn: 'Person B', entityType: 'person' },
      ],
      aliases: [
        { aliasNorm: 'shared alias', aliasRaw: 'Shared Alias', entityId: 'ent_a' },
        { aliasNorm: 'shared alias', aliasRaw: 'Shared Alias', entityId: 'ent_b' },
      ],
      roleTerms: [
        { id: 'rt1', roleEntityId: 'ent_role_pm', holderEntityId: 'ent_a', validFrom: '2020-01-01', validTo: '2025-01-01' },
        { id: 'rt2', roleEntityId: 'ent_role_pm', holderEntityId: 'ent_b', validFrom: '2024-06-01', validTo: null },
      ],
    });
    expect(errors.some((e) => e.code === 'ALIAS_COLLISION')).toBe(true);
    expect(errors.some((e) => e.code === 'OVERLAPPING_ROLE_TERM')).toBe(true);
  });
});

describe('Auto-Promotion & Auto-Merge Policies', () => {
  const existingAliases = new Map<string, string>([
    ['তারেক রহমান', 'ent_tareque_rahman'],
    ['বিজিএমইএ', 'ent_bgmea'],
  ]);
  const denylist = new Set<string>(['অজ্ঞাতনামা']);

  it('promotes high-frequency verified multi-token persons and blocks single-token persons', () => {
    const ok = evaluateCandidatePromotion(
      {
        aliasNorm: 'মাহমুদ হাসান খান',
        surfaceRaw: 'মাহমুদ হাসান খান',
        guessedType: 'person',
        docFreq: 20,
        outletCount: 5,
        distinctDays: 10,
      },
      {
        aliasNorm: 'মাহমুদ হাসান খান',
        isNamedEntity: true,
        entityType: 'person',
        canonicalBn: 'মাহমুদ হাসান খান',
        canonicalEn: 'Mahmud Hasan Khan',
        aliases: [],
        confidence: 0.92,
      },
      existingAliases,
      denylist
    );
    expect(ok.decision).toBe('promote');

    const singleTok = evaluateCandidatePromotion(
      {
        aliasNorm: 'মাহমুদ',
        surfaceRaw: 'মাহমুদ',
        guessedType: 'person',
        docFreq: 50,
        outletCount: 6,
        distinctDays: 20,
      },
      {
        aliasNorm: 'মাহমুদ',
        isNamedEntity: true,
        entityType: 'person',
        canonicalBn: 'মাহমুদ',
        canonicalEn: null,
        aliases: [],
        confidence: 0.95,
      },
      existingAliases,
      denylist
    );
    expect(singleTok.decision).toBe('defer');
  });

  it('blocks cross-type merges (e.g. person Ziaur Rahman vs hospital org) and filters Bangla homograph/generic aliases', () => {
    const typedExisting = new Map<string, ExistingAliasRef>([
      ['শহীদ জিয়াউর রহমান মেডিকেল কলেজ হাসপাতাল', { entityId: 'ent_hospital', entityType: 'org' }],
      ['ঢাকা বিশ্ববিদ্যালয় কেন্দ্রীয় ছাত্র সংসদ', { entityId: 'ent_ducsu', entityType: 'org' }],
      ['তারেক রহমান', { entityId: 'ent_tareque_rahman', entityType: 'person' }],
    ]);

    // Person "জিয়াউর রহমান" must promote cleanly as person, NOT merge into the hospital org!
    const zia = evaluateCandidatePromotion(
      {
        aliasNorm: 'জিয়াউর রহমান',
        surfaceRaw: 'জিয়াউর রহমান',
        guessedType: 'person',
        docFreq: 1389,
        outletCount: 6,
        distinctDays: 90,
      },
      {
        aliasNorm: 'জিয়াউর রহমান',
        isNamedEntity: true,
        entityType: 'person',
        canonicalBn: 'জিয়াউর রহমান',
        canonicalEn: 'Ziaur Rahman',
        aliases: [],
        confidence: 0.99,
      },
      typedExisting,
      denylist
    );
    expect(zia.decision).toBe('promote');

    // Exact same-type canonical match merges cleanly
    const exactSame = evaluateCandidatePromotion(
      {
        aliasNorm: 'তারেক রহমানের',
        surfaceRaw: 'তারেক রহমানের',
        guessedType: 'person',
        docFreq: 50,
        outletCount: 5,
        distinctDays: 15,
      },
      {
        aliasNorm: 'তারেক রহমানের',
        isNamedEntity: true,
        entityType: 'person',
        canonicalBn: 'তারেক রহমান',
        canonicalEn: 'Tarique Rahman',
        aliases: [],
        confidence: 0.95,
      },
      typedExisting,
      denylist
    );
    expect(exactSame.decision).toBe('merge_proposal');
    expect(exactSame.targetEntityId).toBe('ent_tareque_rahman');

    // Alias hygiene checks
    expect(isSafeAutoAlias('বেলা', 'org').safe).toBe(false);
    expect(isSafeAutoAlias('বিনা', 'org').safe).toBe(false);
    expect(isSafeAutoAlias('নগদ', 'org').safe).toBe(false);
    expect(isSafeAutoAlias('ইউপি', 'org').safe).toBe(false);
    expect(isSafeAutoAlias('রফিক', 'person').safe).toBe(false);
    expect(isSafeAutoAlias('শেখ মোহাম্মদ', 'person').safe).toBe(false);
    expect(isSafeAutoAlias('BELA', 'org')).toMatchObject({ safe: true, requireUppercase: true });
    expect(isSafeAutoAlias('DGHS', 'org')).toMatchObject({ safe: true, requireUppercase: true });
    expect(isSafeAutoAlias('ঢাকা মেডিকেল কলেজ হাসপাতাল', 'org').safe).toBe(true);
  });

  it('enforces strict auto-merge criteria including conflicting-surname guard', () => {
    const merged = evaluateAutoMerge(
      { id: 'e1', entityType: 'person', canonicalBn: 'আনোয়ার হোসেন', canonicalEn: 'Anwar Hossain' },
      { id: 'e2', entityType: 'person', canonicalBn: 'আনোয়ার হোসাইন', canonicalEn: 'Anwar Hossain' },
      { sharedClusters: 4, nameCosine: 0.91, llmSameEntity: true, llmConfidence: 0.94 }
    );
    expect(merged.shouldMerge).toBe(true);

    const blockedSurname = evaluateAutoMerge(
      { id: 'e3', entityType: 'person', canonicalBn: 'তারেক রহমান', canonicalEn: 'Tarique Rahman' },
      { id: 'e4', entityType: 'person', canonicalBn: 'তারেক আহমেদ', canonicalEn: 'Tarique Ahmed' },
      { sharedClusters: 4, nameCosine: 0.85, llmSameEntity: true, llmConfidence: 0.88 }
    );
    expect(blockedSurname.shouldMerge).toBe(false);
    expect(blockedSurname.reason).toContain('conflicting_en_surnames');
  });
});

describe('Cluster Redirects', () => {
  it('computes old -> new cluster redirects when >= 50% of articles move to a new cluster ID', () => {
    const prev = new Map([
      ['a1', 'clu_old'],
      ['a2', 'clu_old'],
      ['a3', 'clu_old'],
      ['a4', 'clu_same'],
      ['a5', 'clu_same'],
    ]);
    const next = new Map([
      ['a1', 'clu_new'],
      ['a2', 'clu_new'],
      ['a3', 'clu_other'],
      ['a4', 'clu_same'],
      ['a5', 'clu_same'],
    ]);
    expect(buildRedirects(prev, next, 0.5)).toEqual([{ oldId: 'clu_old', newId: 'clu_new' }]);
  });
});
