/**
 * @file packages/entities/src/policy.ts
 * Pure, unit-tested governance policies for Entity Resolution v2:
 * - Auto-promotion thresholds & same-type exact collision guards (prefer splitting over wrong merges)
 * - Strict Bangla/English alias hygiene (blocks common Bangla homographs, generic titles, single-token persons)
 * - Auto-merge policy with surname conflict protection
 * - Seed registry & role_term validation (no overlapping terms, no broken FKs)
 */

import type {
  Entity,
  EntityAlias,
  EntityCandidate,
  EntityType,
  LlmCandidateVerdictItem,
  RoleTerm,
} from '@jachaikori/schema';
import { getTokenMatchVariants, normalizePhrase } from './normalize';

export interface PromotionPolicyConfig {
  person: {
    minArticles: number;
    minOutlets: number;
    minDays: number;
    minTokens: number;
    minLlmConfidence: number;
  };
  other: {
    minArticles: number;
    minOutlets: number;
    minDays: number;
    minLlmConfidence: number;
  };
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicyConfig = {
  person: {
    minArticles: 12,
    minOutlets: 3,
    minDays: 6,
    minTokens: 2,
    minLlmConfidence: 0.8,
  },
  other: {
    minArticles: 8,
    minOutlets: 2,
    minDays: 4,
    minLlmConfidence: 0.8,
  },
};

export interface AutoMergePolicyConfig {
  minSharedClusters: number;
  minNameCosine: number;
  minLlmConfidence: number;
}

export const DEFAULT_MERGE_POLICY: AutoMergePolicyConfig = {
  minSharedClusters: 3,
  minNameCosine: 0.82,
  minLlmConfidence: 0.8,
};

export interface PromotionDecision {
  decision: 'promote' | 'merge_proposal' | 'reject' | 'defer';
  reason: string;
  targetEntityId?: string | null;
  resolvedType?: EntityType;
}

/**
 * Generic nouns, titles, and administrative types that must NEVER become standalone entities or aliases.
 */
export const GENERIC_BLOCKED_TERMS = new Set([
  'সরকার', 'পুলিশ', 'আদালত', 'বিচারক', 'মন্ত্রী', 'প্রতিমন্ত্রী', 'উপদেষ্টা', 'সচিব', 'চেয়ারম্যান', 'সভাপতি',
  'পরিচালক', 'মহাপরিচালক', 'কমিশনার', 'কর্মকর্তা', 'নেতা', 'সদস্য', 'প্রতিনিধি', 'প্রতিবেদক', 'বিশেষজ্ঞ',
  'ইউনিয়ন পরিষদ', 'ইউপি', 'জেলা পরিষদ', 'উপজেলা পরিষদ', 'পৌরসভা', 'সিটি কর্পোরেশন', 'উপজেলা প্রশাসন',
  'জেলা প্রশাসন', 'ভ্রাম্যমাণ আদালত', 'জজ আদালত', 'বিচারিক আদালত', 'নিম্ন আদালত', 'সদর হাসপাতাল',
  'মেডিকেল কলেজ হাসপাতাল', 'মেডিকেল কলেজ', 'থানা পুলিশ', 'আইনশৃঙ্খলা রক্ষাকারী বাহিনী', 'আইনশৃঙ্খলা বাহিনী',
  'government', 'police', 'court', 'judge', 'minister', 'state minister', 'adviser', 'secretary', 'chairman',
  'president', 'director', 'directorate general', 'official', 'leader', 'member', 'spokesperson', 'source', 'sources',
  'union parishad', 'upazila parishad', 'zila parishad', 'city corporation', 'mobile court', 'district administration',
]);

/**
 * Common Bangla everyday words that collide with NGO/org acronyms (e.g. "বেলা" = time/o'clock vs BELA,
 * "বিনা" = without vs BINA, "নগদ" = cash vs Nagad, "বারি" = home/water vs BARI, "আশা" = hope vs ASA).
 */
export const AMBIGUOUS_BANGLA_HOMOGRAPH_ALIASES = new Set([
  'বেলা',
  'বিনা',
  'বারি',
  'নগদ',
  'আশা',
  'সেতু',
  'দিশা',
  'আলো',
  'তারা',
  'সফল',
  'দেশ',
  'পথ',
  'কাজ',
  'মান',
  'বল',
  'জন',
  'কাল',
  'সময়',
  'সময়',
  'পল',
  'রবি',
  'বিকাশ',
  'উপায়',
  'উপায়',
  'রকেট',
  'নজরুল',
  'জিয়া',
  'জিয়া',
  'মুজিব',
  'হাসিনা',
  'খালেদা',
  'তারেক',
]);

/**
 * Over-broad 2-token Bangla/English person prefixes that match hundreds of unrelated people.
 */
export const AMBIGUOUS_PERSON_PREFIXES = new Set([
  'শেখ মোহাম্মদ',
  'শেখ মুহাম্মদ',
  'সৈয়দ মোহাম্মদ',
  'সৈয়দ মুহাম্মদ',
  'ড. মুহাম্মদ',
  'ডা. মুহাম্মদ',
  'অধ্যাপক মুহাম্মদ',
  'অধ্যাপক ড',
  'মো. আব্দুল',
  'মো. আবুল',
  'মো. নজরুল',
  'মো. সাইফুল',
  'মো. কামরুল',
  'মো. শফিকুল',
  'মো. মিজানুর',
  'মো. শহিদুল',
  'খন্দকার আব্দুল',
  'সরদার মো',
  'কাজী মোহাম্মদ',
  'মীর মোহাম্মদ',
  'গাজী মোহাম্মদ',
  'হাজী মোহাম্মদ',
  'sheikh mohammad',
  'sheikh mohammed',
  'syed mohammad',
  'md abdul',
  'prof muhammad',
]);

export interface ExistingAliasRef {
  entityId: string;
  entityType: EntityType;
}

/**
 * Checks whether an auto-discovered alias string is safe to register on an entity of `entityType`.
 */
export function isSafeAutoAlias(rawAlias: string, entityType: EntityType): {
  safe: boolean;
  norm: string;
  requireUppercase: boolean;
  reason?: string;
} {
  const trimmed = rawAlias.trim();
  const norm = normalizePhrase(trimmed);
  if (!norm || norm.length < 2) {
    return { safe: false, norm, requireUppercase: false, reason: 'too_short' };
  }
  if (GENERIC_BLOCKED_TERMS.has(norm)) {
    return { safe: false, norm, requireUppercase: false, reason: 'generic_term' };
  }
  if (AMBIGUOUS_BANGLA_HOMOGRAPH_ALIASES.has(norm)) {
    return { safe: false, norm, requireUppercase: false, reason: 'ambiguous_bangla_homograph' };
  }

  const tokens = norm.split(' ').filter(Boolean);
  const isAsciiOnly = /^[a-z0-9.\-&'\s]+$/.test(norm);

  if (entityType === 'person') {
    if (tokens.length < 2) {
      return { safe: false, norm, requireUppercase: false, reason: 'single_token_person_alias' };
    }
    if (AMBIGUOUS_PERSON_PREFIXES.has(norm)) {
      return { safe: false, norm, requireUppercase: false, reason: 'ambiguous_person_prefix' };
    }
    // Reject honorific-only or title-polluted long strings (> 5 tokens)
    if (tokens.length > 5) {
      return { safe: false, norm, requireUppercase: false, reason: 'overlong_person_alias' };
    }
    return { safe: true, norm, requireUppercase: false };
  }

  // Non-person entities (org, location, role, event_topic):
  // Require uppercase on any short single-token ASCII acronym/word (<= 5 chars, e.g. DGHS, CID, BMD, DUCSU, BELA, BCL)
  if (isAsciiOnly && tokens.length === 1 && norm.length <= 5) {
    // Reject common English lowercase words masquerading as acronyms
    if (trimmed !== trimmed.toUpperCase() && !/^[A-Z]{2,5}$/.test(trimmed)) {
      return { safe: false, norm, requireUppercase: true, reason: 'non_uppercase_short_ascii' };
    }
    return { safe: true, norm, requireUppercase: true };
  }

  // Reject single-token Bangla aliases shorter than 3 chars
  if (!isAsciiOnly && tokens.length === 1 && norm.length < 3) {
    return { safe: false, norm, requireUppercase: false, reason: 'short_single_bangla_alias' };
  }

  return { safe: true, norm, requireUppercase: false };
}

/**
 * Evaluates whether a verified candidate should be promoted to a new canonical entity,
 * merged onto an existing entity of the SAME type, rejected to the denylist, or deferred.
 */
export function evaluateCandidatePromotion(
  candidate: Pick<EntityCandidate, 'aliasNorm' | 'surfaceRaw' | 'guessedType' | 'docFreq' | 'outletCount' | 'distinctDays'>,
  verdict: LlmCandidateVerdictItem,
  existingAliasMap: Map<string, ExistingAliasRef | string>,
  denylist: Set<string>,
  policy: PromotionPolicyConfig = DEFAULT_PROMOTION_POLICY
): PromotionDecision {
  const norm = normalizePhrase(candidate.aliasNorm || candidate.surfaceRaw);
  if (!norm || denylist.has(norm) || GENERIC_BLOCKED_TERMS.has(norm)) {
    return { decision: 'reject', reason: 'denylisted_or_generic_term' };
  }

  if (!verdict.isNamedEntity) {
    return { decision: 'reject', reason: 'llm_rejected_not_named_entity' };
  }

  const resolvedType: EntityType = verdict.entityType ?? candidate.guessedType;
  const canonicalPrimary = normalizePhrase(verdict.canonicalBn || verdict.canonicalEn || candidate.surfaceRaw);
  if (!canonicalPrimary || GENERIC_BLOCKED_TERMS.has(canonicalPrimary) || AMBIGUOUS_PERSON_PREFIXES.has(canonicalPrimary)) {
    return { decision: 'reject', reason: `generic_canonical:${canonicalPrimary}`, resolvedType };
  }
  const tokens = canonicalPrimary.split(' ').filter(Boolean);

  const lookupRef = (key: string): ExistingAliasRef | null => {
    const val = existingAliasMap.get(key);
    if (!val) return null;
    if (typeof val === 'string') return { entityId: val, entityType: resolvedType };
    return val;
  };

  // Explicit LLM merge hint against an existing entity (only accept if same type!)
  if (verdict.sameAsEntityId) {
    return {
      decision: 'merge_proposal',
      reason: 'llm_same_as_existing',
      targetEntityId: verdict.sameAsEntityId,
      resolvedType,
    };
  }

  // Exact canonical/alias collision guard — ONLY merge when entityType matches!
  // (Never merge a `person` like "Ziaur Rahman" into an `org` like "Shaheed Ziaur Rahman Medical College Hospital"!)
  const checkNorms = [
    normalizePhrase(verdict.canonicalBn ?? ''),
    normalizePhrase(verdict.canonicalEn ?? ''),
    norm,
  ].filter(Boolean);

  for (const cn of checkNorms) {
    const existing = lookupRef(cn);
    if (existing && existing.entityType === resolvedType) {
      return {
        decision: 'merge_proposal',
        reason: `exact_same_type_collision:${cn}`,
        targetEntityId: existing.entityId,
        resolvedType,
      };
    }
  }

  if (resolvedType === 'person') {
    const cfg = policy.person;
    if (tokens.length < cfg.minTokens) {
      return { decision: 'defer', reason: `person_single_token_blocked:${canonicalPrimary}`, resolvedType };
    }
    if (verdict.confidence < cfg.minLlmConfidence) {
      return { decision: 'defer', reason: `low_llm_confidence:${verdict.confidence}`, resolvedType };
    }
    if (
      candidate.docFreq < cfg.minArticles ||
      candidate.outletCount < cfg.minOutlets ||
      candidate.distinctDays < cfg.minDays
    ) {
      return {
        decision: 'defer',
        reason: `below_person_threshold(art=${candidate.docFreq},out=${candidate.outletCount},days=${candidate.distinctDays})`,
        resolvedType,
      };
    }
    return { decision: 'promote', reason: 'passed_person_thresholds', resolvedType };
  }

  // org, location, role, event_topic
  const cfg = policy.other;
  if (verdict.confidence < cfg.minLlmConfidence) {
    return { decision: 'defer', reason: `low_llm_confidence:${verdict.confidence}`, resolvedType };
  }
  if (
    candidate.docFreq < cfg.minArticles ||
    candidate.outletCount < cfg.minOutlets ||
    candidate.distinctDays < cfg.minDays
  ) {
    return {
      decision: 'defer',
      reason: `below_entity_threshold(art=${candidate.docFreq},out=${candidate.outletCount},days=${candidate.distinctDays})`,
      resolvedType,
    };
  }
  return { decision: 'promote', reason: 'passed_entity_thresholds', resolvedType };
}

export interface AutoMergeEvidence {
  sharedClusters: number;
  nameCosine: number;
  llmSameEntity: boolean;
  llmConfidence: number;
}

export interface AutoMergeDecision {
  shouldMerge: boolean;
  reason: string;
}

function extractLastToken(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = normalizePhrase(name).split(' ').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1]! : null;
}

function surnamesMatchOrVariant(a: string, b: string): boolean {
  if (a === b) return true;
  const va = new Set(getTokenMatchVariants(a));
  for (const vb of getTokenMatchVariants(b)) {
    if (va.has(vb)) return true;
  }
  return false;
}

/**
 * Strict auto-merge policy (Principle: a duplicate entity is cheaper than a wrong merge).
 */
export function evaluateAutoMerge(
  entityA: Pick<Entity, 'id' | 'entityType' | 'canonicalBn' | 'canonicalEn'>,
  entityB: Pick<Entity, 'id' | 'entityType' | 'canonicalBn' | 'canonicalEn'>,
  evidence: AutoMergeEvidence,
  policy: AutoMergePolicyConfig = DEFAULT_MERGE_POLICY
): AutoMergeDecision {
  if (entityA.id === entityB.id) {
    return { shouldMerge: false, reason: 'same_entity_id' };
  }
  if (entityA.entityType !== entityB.entityType) {
    return { shouldMerge: false, reason: 'different_entity_type' };
  }
  if (evidence.sharedClusters < policy.minSharedClusters) {
    return { shouldMerge: false, reason: `insufficient_shared_clusters:${evidence.sharedClusters}` };
  }
  if (evidence.nameCosine < policy.minNameCosine) {
    return { shouldMerge: false, reason: `low_name_cosine:${evidence.nameCosine.toFixed(3)}` };
  }
  if (!evidence.llmSameEntity || evidence.llmConfidence < policy.minLlmConfidence) {
    return { shouldMerge: false, reason: `llm_not_confident:${evidence.llmConfidence}` };
  }

  // Conflicting same-script surname guard for persons (e.g. "Tareque Rahman" vs "Tareque Ahmed")
  if (entityA.entityType === 'person') {
    const enLastA = extractLastToken(entityA.canonicalEn);
    const enLastB = extractLastToken(entityB.canonicalEn);
    if (enLastA && enLastB && !surnamesMatchOrVariant(enLastA, enLastB) && evidence.nameCosine < 0.92) {
      return { shouldMerge: false, reason: `conflicting_en_surnames:${enLastA}!=${enLastB}` };
    }
    const bnLastA = extractLastToken(entityA.canonicalBn);
    const bnLastB = extractLastToken(entityB.canonicalBn);
    if (bnLastA && bnLastB && !surnamesMatchOrVariant(bnLastA, bnLastB) && evidence.nameCosine < 0.92) {
      return { shouldMerge: false, reason: `conflicting_bn_surnames:${bnLastA}!=${bnLastB}` };
    }
  }

  return {
    shouldMerge: true,
    reason: `clusters=${evidence.sharedClusters},cos=${evidence.nameCosine.toFixed(3)},llm=${evidence.llmConfidence.toFixed(2)}`,
  };
}

export interface SeedValidationError {
  code: string;
  message: string;
}

/**
 * Validates a seed registry snapshot: checks duplicate IDs, missing names,
 * dangling alias/role_term references, overlapping role_term windows, and cross-entity alias collisions.
 */
export function validateSeedRegistry(input: {
  entities: Entity[];
  aliases: EntityAlias[];
  roleTerms: RoleTerm[];
}): SeedValidationError[] {
  const errors: SeedValidationError[] = [];
  const entityIds = new Set<string>();

  for (const e of input.entities) {
    if (entityIds.has(e.id)) {
      errors.push({ code: 'DUPLICATE_ENTITY_ID', message: `Duplicate entity ID: ${e.id}` });
    }
    entityIds.add(e.id);
    if (!e.canonicalBn && !e.canonicalEn) {
      errors.push({ code: 'MISSING_CANONICAL_NAME', message: `Entity ${e.id} has neither canonicalBn nor canonicalEn` });
    }
  }

  const aliasIndex = new Map<string, EntityAlias[]>();
  for (const a of input.aliases) {
    if (!entityIds.has(a.entityId)) {
      errors.push({ code: 'DANGLING_ALIAS_ENTITY', message: `Alias "${a.aliasRaw}" points to missing entity ${a.entityId}` });
      continue;
    }
    const norm = normalizePhrase(a.aliasNorm || a.aliasRaw);
    const list = aliasIndex.get(norm) ?? [];
    for (const prev of list) {
      if (prev.entityId !== a.entityId && windowsOverlap(prev.validFrom ?? null, prev.validTo ?? null, a.validFrom ?? null, a.validTo ?? null)) {
        errors.push({
          code: 'ALIAS_COLLISION',
          message: `Alias "${norm}" collides between ${prev.entityId} and ${a.entityId}`,
        });
      }
    }
    list.push(a);
    aliasIndex.set(norm, list);
  }

  const termsByRole = new Map<string, RoleTerm[]>();
  for (const rt of input.roleTerms) {
    if (!entityIds.has(rt.roleEntityId)) {
      errors.push({ code: 'DANGLING_ROLE_TERM_ROLE', message: `RoleTerm ${rt.id} references missing role ${rt.roleEntityId}` });
    }
    if (!entityIds.has(rt.holderEntityId)) {
      errors.push({ code: 'DANGLING_ROLE_TERM_HOLDER', message: `RoleTerm ${rt.id} references missing holder ${rt.holderEntityId}` });
    }
    if (rt.validTo && rt.validFrom > rt.validTo) {
      errors.push({ code: 'INVALID_ROLE_WINDOW', message: `RoleTerm ${rt.id} has validFrom (${rt.validFrom}) > validTo (${rt.validTo})` });
    }
    const existing = termsByRole.get(rt.roleEntityId) ?? [];
    for (const prev of existing) {
      if (windowsOverlap(prev.validFrom, prev.validTo ?? null, rt.validFrom, rt.validTo ?? null)) {
        errors.push({
          code: 'OVERLAPPING_ROLE_TERM',
          message: `RoleTerms ${prev.id} and ${rt.id} overlap on role ${rt.roleEntityId}`,
        });
      }
    }
    existing.push(rt);
    termsByRole.set(rt.roleEntityId, existing);
  }

  return errors;
}

function windowsOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null
): boolean {
  const startA = aFrom ?? '0000-01-01';
  const endA = aTo ?? '9999-12-31';
  const startB = bFrom ?? '0000-01-01';
  const endB = bTo ?? '9999-12-31';
  return startA <= endB && startB <= endA;
}
