/**
 * @file tools/backfill/src/seed-yaml.ts
 * Loads, validates, and exports the human-reviewable YAML seed registry (`registry/seed.yaml`)
 * including canonical entities, aliases, hub flags, and temporal `role_term` entries.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildSeedRegistry,
  normalizePhrase,
  normalizeText,
  validateSeedRegistry,
  type SeedValidationError,
} from '@jachaikori/entities';
import type { Entity, EntityAlias, RoleTerm } from '@jachaikori/schema';

export interface SeedYamlEntityEntry {
  id: string;
  canonicalBn?: string | null;
  canonicalEn?: string | null;
  entityType: Entity['entityType'];
  isHub?: boolean;
  shortTaglineBn?: string | null;
  shortTaglineEn?: string | null;
  descriptionBn?: string | null;
  descriptionEn?: string | null;
  metadata?: Record<string, unknown>;
  aliases: Array<{
    raw: string;
    kind?: EntityAlias['kind'];
    requireUppercase?: boolean;
    validFrom?: string | null;
    validTo?: string | null;
  }>;
}

export interface SeedYamlDocument {
  schemaVersion: number;
  updatedAt: string;
  entities: SeedYamlEntityEntry[];
  roleTerms: RoleTerm[];
}

export function exportBuiltinSeedToYaml(outPath: string): {
  entitiesCount: number;
  aliasesCount: number;
  roleTermsCount: number;
} {
  const builtin = buildSeedRegistry();
  const aliasesByEntity = new Map<string, EntityAlias[]>();
  for (const a of builtin.aliases) {
    const list = aliasesByEntity.get(a.entityId) ?? [];
    list.push(a);
    aliasesByEntity.set(a.entityId, list);
  }

  const doc: SeedYamlDocument = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString().slice(0, 10),
    entities: builtin.entities.map((e) => {
      let metadata: Record<string, unknown> | undefined;
      if (e.metadataJson) {
        try {
          const parsed = JSON.parse(e.metadataJson);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            metadata = parsed;
          }
        } catch {
          // ignore
        }
      }
      return {
        id: e.id,
        canonicalBn: e.canonicalBn ?? null,
        canonicalEn: e.canonicalEn ?? null,
        entityType: e.entityType,
        ...(e.isHub ? { isHub: true } : {}),
        ...(metadata ? { metadata } : {}),
        aliases: (aliasesByEntity.get(e.id) ?? []).map((a) => ({
          raw: a.aliasRaw,
          ...(a.kind && a.kind !== 'name' ? { kind: a.kind } : {}),
          ...(a.requireUppercase ? { requireUppercase: true } : {}),
          ...(a.validFrom ? { validFrom: a.validFrom } : {}),
          ...(a.validTo ? { validTo: a.validTo } : {}),
        })),
      };
    }),
    roleTerms: builtin.roleTerms,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${Bun.YAML.stringify(doc, null, 2)}\n`, 'utf8');
  return {
    entitiesCount: builtin.entities.length,
    aliasesCount: builtin.aliases.length,
    roleTermsCount: builtin.roleTerms.length,
  };
}

export function loadAndValidateSeedYaml(filePath: string): {
  entities: Entity[];
  aliases: EntityAlias[];
  roleTerms: RoleTerm[];
  errors: SeedValidationError[];
} {
  if (!existsSync(filePath)) {
    const builtin = buildSeedRegistry();
    return {
      ...builtin,
      errors: validateSeedRegistry(builtin),
    };
  }

  const raw = readFileSync(filePath, 'utf8');
  const doc = Bun.YAML.parse(raw) as SeedYamlDocument;

  const entities: Entity[] = [];
  const aliases: EntityAlias[] = [];
  const roleTerms: RoleTerm[] = (doc.roleTerms ?? []).map((rt) => ({
    id: rt.id,
    roleEntityId: rt.roleEntityId,
    holderEntityId: rt.holderEntityId,
    validFrom: rt.validFrom,
    validTo: rt.validTo ?? null,
    sourceUrl: rt.sourceUrl ?? null,
  }));

  for (const item of doc.entities ?? []) {
    entities.push({
      id: item.id,
      canonicalBn: item.canonicalBn ?? null,
      canonicalEn: item.canonicalEn ?? null,
      entityType: item.entityType,
      status: 'active',
      source: 'seed',
      isHub: Boolean(item.isHub),
      shortTaglineBn: item.shortTaglineBn ?? null,
      shortTaglineEn: item.shortTaglineEn ?? null,
      descriptionBn: item.descriptionBn ?? null,
      descriptionEn: item.descriptionEn ?? null,
      metadataJson: item.metadata ? JSON.stringify(item.metadata) : null,
    });

    for (const a of item.aliases ?? []) {
      const rawClean = normalizeText(a.raw);
      const norm = normalizePhrase(rawClean);
      if (!norm) continue;
      aliases.push({
        aliasNorm: norm,
        aliasRaw: rawClean,
        entityId: item.id,
        validFrom: a.validFrom ?? null,
        validTo: a.validTo ?? null,
        kind: a.kind ?? (a.requireUppercase ? 'acronym' : 'name'),
        requireUppercase: Boolean(a.requireUppercase),
        source: 'seed',
      });
    }
  }

  const errors = validateSeedRegistry({ entities, aliases, roleTerms });
  return { entities, aliases, roleTerms, errors };
}
