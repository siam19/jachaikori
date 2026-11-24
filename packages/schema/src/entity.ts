/**
 * @file packages/schema/src/entity.ts
 * Canonical entity, temporal role term, alias, hyperedge membership,
 * 17-type directional relationship, unlinked candidate, and AI dossier schemas.
 */

import { z } from 'zod';
import { OutletIdSchema } from './outlet';

export const EntityTypeSchema = z.enum([
  'person',
  'org',
  'location',
  'role',
  'event_topic',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EntityStatusSchema = z.enum(['active', 'rejected', 'merged']);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

export const EntitySourceSchema = z.enum(['seed', 'auto', 'manual']);
export type EntitySource = z.infer<typeof EntitySourceSchema>;

export const AliasKindSchema = z.enum([
  'name',
  'acronym',
  'role',
  'short_name',
  'spelling_variant',
]);
export type AliasKind = z.infer<typeof AliasKindSchema>;

export const EntityRoleSchema = z.enum([
  'quoted_speaker',
  'actor',
  'subject',
  'location',
  'mentioned',
]);
export type EntityRole = z.infer<typeof EntityRoleSchema>;

export const LinkMethodSchema = z.enum([
  'name_exact',
  'alias_stem',
  'role_dated',
  'role_inferred',
  'article_coref',
  'llm_linked',
]);
export type LinkMethod = z.infer<typeof LinkMethodSchema>;

/**
 * 17 canonical directional relationship types covering institutional/career structure,
 * speech/stance, economy/policy, law/accountability, and diplomacy/incidents.
 */
export const CANONICAL_RELATION_TYPES = [
  // Structure & Career
  'holds_role',
  'affiliated_with',
  'part_of',
  'appointed_or_elected',
  'resigned_or_removed',
  // Speech & Stance
  'quoted_about',
  'supported_or_endorsed',
  'criticized_or_opposed',
  'demanded_or_urged',
  // Economy, Policy & Governance
  'signed_deal_or_agreed',
  'funded_or_invested',
  'regulated_or_directed',
  // Law & Accountability
  'investigated_or_charged',
  'ruled_or_sentenced',
  // Diplomacy & Specific Incidents
  'met_with',
  'diplomatic_action',
  'incident_at',
] as const;

export const EntityRelationTypeSchema = z.enum(CANONICAL_RELATION_TYPES);
export type EntityRelationType = z.infer<typeof EntityRelationTypeSchema>;

const LEGACY_RELATION_MAP: Record<string, EntityRelationType> = {
  resigned_from: 'resigned_or_removed',
  legal_action: 'investigated_or_charged',
  criticized_or_protested: 'criticized_or_opposed',
  announced_or_agreed: 'signed_deal_or_agreed',
  located_in: 'incident_at',
};

const CANONICAL_RELATION_SET = new Set<string>(CANONICAL_RELATION_TYPES);

/**
 * Maps canonical or legacy relation names to the 17-type taxonomy (drops noisy `co_occurred`).
 */
export function normalizeRelationType(raw: string | null | undefined): EntityRelationType | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (CANONICAL_RELATION_SET.has(key)) return key as EntityRelationType;
  return LEGACY_RELATION_MAP[key] ?? null;
}

export const RelationSourceSchema = z.enum(['deterministic', 'llm_claim']);
export type RelationSource = z.infer<typeof RelationSourceSchema>;

export const EntitySchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable().optional(),
  canonicalEn: z.string().nullable().optional(),
  entityType: EntityTypeSchema,
  status: EntityStatusSchema.default('active').optional(),
  source: EntitySourceSchema.default('seed').optional(),
  mergedInto: z.string().nullable().optional(),
  isHub: z.boolean().default(false).optional(),
  descriptionBn: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  shortTaglineBn: z.string().nullable().optional(),
  shortTaglineEn: z.string().nullable().optional(),
  descriptionSourcesJson: z.string().nullable().optional(),
  descriptionUpdatedAt: z.string().nullable().optional(),
  autoScore: z.number().nullable().optional(),
  verdictJson: z.string().nullable().optional(),
  articleCount: z.number().int().min(0).optional(),
  eventCount: z.number().int().min(0).optional(),
  firstSeen: z.string().nullable().optional(),
  lastSeen: z.string().nullable().optional(),
  metadataJson: z.string().nullable().optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntityAliasSchema = z.object({
  aliasNorm: z.string(),
  aliasRaw: z.string(),
  entityId: z.string(),
  validFrom: z.string().nullable().optional().describe('ISO date start for temporal alias window'),
  validTo: z.string().nullable().optional().describe('ISO date end for temporal alias window'),
  kind: AliasKindSchema.optional(),
  requireUppercase: z.boolean().optional(),
  source: EntitySourceSchema.optional(),
});
export type EntityAlias = z.infer<typeof EntityAliasSchema>;

export const RoleTermSchema = z.object({
  id: z.string(),
  roleEntityId: z.string(),
  holderEntityId: z.string(),
  validFrom: z.string().describe('ISO date YYYY-MM-DD when holder assumed role'),
  validTo: z.string().nullable().optional().describe('ISO date YYYY-MM-DD when holder left role, or null if incumbent'),
  sourceUrl: z.string().nullable().optional(),
});
export type RoleTerm = z.infer<typeof RoleTermSchema>;

export const RegistrySnapshotSchema = z.object({
  version: z.number().int().min(1),
  generatedAt: z.string(),
  entities: z.array(EntitySchema),
  aliases: z.array(EntityAliasSchema),
  roleTerms: z.array(RoleTermSchema).default([]),
});
export type RegistrySnapshot = z.infer<typeof RegistrySnapshotSchema>;

export const ArticleEntityMentionSchema = z.object({
  articleId: z.string(),
  entityId: z.string(),
  chunkId: z.string().nullable().optional(),
  surfaceForm: z.string(),
  role: EntityRoleSchema.default('mentioned'),
  mentionCount: z.number().int().min(1).default(1).optional(),
  inHeadline: z.boolean().default(false).optional(),
  linkMethod: LinkMethodSchema.default('name_exact').optional(),
  linkConfidence: z.number().min(0).max(1).default(0.9).optional(),
  salience: z.number().min(0).max(1).default(0.5).optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type ArticleEntityMention = z.infer<typeof ArticleEntityMentionSchema>;

export const EntityRelationSchema = z.object({
  id: z.string(),
  articleId: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  relationType: EntityRelationTypeSchema,
  predicateLabel: z.string().nullable().optional(),
  source: RelationSourceSchema.default('deterministic').optional(),
  evidenceSnippet: z.string(),
  publishedAt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const UnlinkedTriggerPatternSchema = z.enum([
  'bangla_title_name',
  'headline_colon_speaker',
  'english_proper_noun',
  'bangla_org_suffix',
  'role_apposition',
]);
export type UnlinkedTriggerPattern = z.infer<typeof UnlinkedTriggerPatternSchema>;

export const UnlinkedMentionSchema = z.object({
  surface: z.string(),
  normalized: z.string(),
  sentenceIndex: z.number().int().min(0),
  startChar: z.number().int().min(0),
  endChar: z.number().int().min(0),
  triggerPattern: UnlinkedTriggerPatternSchema,
  guessedType: EntityTypeSchema,
  contextSnippet: z.string(),
});
export type UnlinkedMention = z.infer<typeof UnlinkedMentionSchema>;

export const EntityCandidateSchema = z.object({
  aliasNorm: z.string(),
  surfaceRaw: z.string(),
  guessedType: EntityTypeSchema,
  docFreq: z.number().int().min(1),
  outletCount: z.number().int().min(1),
  distinctDays: z.number().int().min(1),
  sampleSentencesJson: z.string(),
  status: z.enum(['pending', 'promoted', 'merged', 'rejected']).default('pending'),
  verdictJson: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
export type EntityCandidate = z.infer<typeof EntityCandidateSchema>;

export const EntityMergeLogSchema = z.object({
  id: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  reason: z.string(),
  score: z.number().nullable().optional(),
  createdAt: z.string(),
  undoneAt: z.string().nullable().optional(),
});
export type EntityMergeLog = z.infer<typeof EntityMergeLogSchema>;

export const EntitySummarySchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  isHub: z.boolean().optional(),
  shortTaglineBn: z.string().nullable().optional(),
  shortTaglineEn: z.string().nullable().optional(),
  articleCount: z.number().int().min(0),
  eventCount: z.number().int().min(0).optional(),
  relationCount: z.number().int().min(0).default(0),
});
export type EntitySummary = z.infer<typeof EntitySummarySchema>;

export const EntityProfileSchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  status: EntityStatusSchema,
  source: EntitySourceSchema,
  isHub: z.boolean(),
  redirectedFrom: z.string().optional(),
  shortTaglineBn: z.string().nullable(),
  shortTaglineEn: z.string().nullable(),
  descriptionBn: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionUpdatedAt: z.string().nullable(),
  descriptionSources: z.array(
    z.object({
      articleId: z.string(),
      title: z.string(),
      outlet: OutletIdSchema,
      publishedAt: z.string().nullable(),
      canonicalUrl: z.string(),
    })
  ),
  aliases: z.array(
    z.object({
      aliasRaw: z.string(),
      kind: AliasKindSchema.nullable().optional(),
    })
  ),
  roleTerms: z.array(
    z.object({
      id: z.string(),
      roleEntityId: z.string(),
      roleNameBn: z.string().nullable(),
      roleNameEn: z.string().nullable(),
      holderEntityId: z.string(),
      holderNameBn: z.string().nullable(),
      holderNameEn: z.string().nullable(),
      validFrom: z.string(),
      validTo: z.string().nullable(),
    })
  ),
  stats: z.object({
    articleCount: z.number().int().min(0),
    eventCount: z.number().int().min(0),
    relationCount: z.number().int().min(0),
    firstSeen: z.string().nullable(),
    lastSeen: z.string().nullable(),
  }),
});
export type EntityProfile = z.infer<typeof EntityProfileSchema>;

export const EntityGraphNodeSchema = z.object({
  id: z.string(),
  canonicalBn: z.string().nullable(),
  canonicalEn: z.string().nullable(),
  entityType: EntityTypeSchema,
  isHub: z.boolean().optional(),
  shortTaglineBn: z.string().nullable().optional(),
  shortTaglineEn: z.string().nullable().optional(),
  mentionCount: z.number().int().min(1),
  roles: z.array(EntityRoleSchema).default([]),
  isCenter: z.boolean().optional(),
});
export type EntityGraphNode = z.infer<typeof EntityGraphNodeSchema>;

export const EntityRelationEvidenceSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  outlet: OutletIdSchema,
  publishedAt: z.string().nullable(),
  canonicalUrl: z.string(),
  snippet: z.string(),
  relationType: EntityRelationTypeSchema,
  predicateLabel: z.string().nullable().optional(),
  source: RelationSourceSchema.optional(),
});
export type EntityRelationEvidence = z.infer<typeof EntityRelationEvidenceSchema>;

export const EntityGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationType: EntityRelationTypeSchema,
  predicateLabels: z.array(z.string()).optional(),
  weight: z.number().int().min(1),
  evidence: z.array(EntityRelationEvidenceSchema).default([]),
});
export type EntityGraphEdge = z.infer<typeof EntityGraphEdgeSchema>;

export const EntityHyperedgeSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  outlet: OutletIdSchema,
  publishedAt: z.string().nullable(),
  canonicalUrl: z.string(),
  entityIds: z.array(z.string()),
  roleByEntity: z.record(z.string(), EntityRoleSchema),
});
export type EntityHyperedge = z.infer<typeof EntityHyperedgeSchema>;

export const EntityGraphResponseSchema = z.object({
  centerEntity: EntityGraphNodeSchema.nullable(),
  clusterLabel: z.string().nullable().optional(),
  nodes: z.array(EntityGraphNodeSchema),
  edges: z.array(EntityGraphEdgeSchema),
  hyperedges: z.array(EntityHyperedgeSchema),
});
export type EntityGraphResponse = z.infer<typeof EntityGraphResponseSchema>;

export const LlmExtractedEntitySchema = z.object({
  entityId: z.string().nullable().describe('Matched ID from KNOWN_CANDIDATES, or null if new entity'),
  canonicalBn: z.string().nullable().optional(),
  canonicalEn: z.string().nullable().optional(),
  entityType: EntityTypeSchema,
  surfaceForm: z.string(),
  role: EntityRoleSchema.default('mentioned'),
  confidence: z.number().min(0).max(1).default(0.85),
});
export type LlmExtractedEntity = z.infer<typeof LlmExtractedEntitySchema>;

export const LlmExtractedRelationSchema = z.object({
  sourceEntityId: z.string().nullable().optional(),
  sourceName: z.string().min(1),
  targetEntityId: z.string().nullable().optional(),
  targetName: z.string().min(1),
  relationType: EntityRelationTypeSchema,
  predicateLabel: z.string().min(1).max(80),
  evidenceSnippet: z.string().min(1).max(320),
  confidence: z.number().min(0).max(1).default(0.85),
});
export type LlmExtractedRelation = z.infer<typeof LlmExtractedRelationSchema>;

export const LlmExtractedClaimSchema = z.object({
  claimText: z.string().min(1),
  claimType: z.string().default('factual'),
  speakerEntityId: z.string().nullable().optional(),
  speakerName: z.string().nullable().optional(),
  subjectEntityId: z.string().nullable().optional(),
  subjectName: z.string().nullable().optional(),
  objectEntityId: z.string().nullable().optional(),
  objectName: z.string().nullable().optional(),
  numbers: z.array(z.string()).default([]).optional(),
  dates: z.array(z.string()).default([]).optional(),
  hedgingLevel: z.enum(['certain', 'reported', 'hedged', 'conditional']).default('reported').optional(),
  evidenceSnippet: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.85),
});
export type LlmExtractedClaim = z.infer<typeof LlmExtractedClaimSchema>;

export const LlmArticleExtractionSchema = z.object({
  articleId: z.string().optional(),
  entities: z.array(LlmExtractedEntitySchema).default([]),
  relations: z.array(LlmExtractedRelationSchema).default([]),
  claims: z.array(LlmExtractedClaimSchema).default([]),
});
export type LlmArticleExtraction = z.infer<typeof LlmArticleExtractionSchema>;

export const LlmCandidateVerdictItemSchema = z.object({
  aliasNorm: z.string(),
  isNamedEntity: z.boolean(),
  entityType: EntityTypeSchema.nullable().optional(),
  canonicalBn: z.string().nullable().optional(),
  canonicalEn: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]),
  sameAsEntityId: z.string().nullable().optional(),
  shortTaglineBn: z.string().nullable().optional(),
  shortTaglineEn: z.string().nullable().optional(),
  descriptionBn: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  affiliatedOrg: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type LlmCandidateVerdictItem = z.infer<typeof LlmCandidateVerdictItemSchema>;

export const LlmEntityDossierSchema = z.object({
  entityId: z.string(),
  shortTaglineBn: z.string().min(1).max(120),
  shortTaglineEn: z.string().min(1).max(120),
  descriptionBn: z.string().min(1).max(500),
  descriptionEn: z.string().min(1).max(500),
  citingArticleIds: z.array(z.string()).default([]),
});
export type LlmEntityDossier = z.infer<typeof LlmEntityDossierSchema>;
