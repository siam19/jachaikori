/**
 * @file packages/retrieval/src/query-expander.ts
 * Forward-compatible Entity Resolution & query expansion hook.
 * Phase 3 will plug D1 `entity_alias` lookups into this interface without changing search callers.
 */

import type { EntityAlias } from '@jachaikori/schema';
import { normalizeBanglaForFts } from './bangla';

export interface QueryExpansionResult {
  originalQuery: string;
  expandedTerms: string[];
  matchedEntityIds: string[];
}

export interface QueryExpander {
  expand(query: string, referenceDateIso?: string): Promise<QueryExpansionResult> | QueryExpansionResult;
}

/**
 * In-memory / D1-backed alias expander supporting temporal validity windows
 * (e.g. role titles like "PM" / "প্রধানমন্ত্রী" bound to validFrom..validTo).
 */
export class AliasDictionaryExpander implements QueryExpander {
  private aliases: EntityAlias[];

  constructor(aliases: EntityAlias[] = []) {
    this.aliases = aliases;
  }

  expand(query: string, referenceDateIso?: string): QueryExpansionResult {
    const normQuery = normalizeBanglaForFts(query).toLowerCase();
    const tokens = new Set(normQuery.split(/\s+/).filter(Boolean));
    const expandedTerms = new Set<string>();
    const matchedEntityIds = new Set<string>();

    const refDay = referenceDateIso ? referenceDateIso.slice(0, 10) : null;

    for (const entry of this.aliases) {
      const aliasKey = normalizeBanglaForFts(entry.aliasNorm).toLowerCase();
      if (!tokens.has(aliasKey) && !normQuery.includes(aliasKey)) {
        continue;
      }

      if (refDay) {
        if (entry.validFrom && refDay < entry.validFrom.slice(0, 10)) continue;
        if (entry.validTo && refDay > entry.validTo.slice(0, 10)) continue;
      }

      matchedEntityIds.add(entry.entityId);
      // Expand sibling aliases for the matched entity
      for (const sibling of this.aliases) {
        if (sibling.entityId === entry.entityId && sibling.aliasRaw !== entry.aliasRaw) {
          if (refDay) {
            if (sibling.validFrom && refDay < sibling.validFrom.slice(0, 10)) continue;
            if (sibling.validTo && refDay > sibling.validTo.slice(0, 10)) continue;
          }
          expandedTerms.add(sibling.aliasRaw);
        }
      }
    }

    return {
      originalQuery: query,
      expandedTerms: Array.from(expandedTerms),
      matchedEntityIds: Array.from(matchedEntityIds),
    };
  }
}
