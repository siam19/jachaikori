/**
 * @file packages/retrieval/src/query-expander.ts
 * Token-boundary-safe, temporally aware Entity Resolution query expander.
 * Uses prefix-indexed token lookup (O(query_tokens)), honors requireUppercase and
 * role-guard predecessors, supports role_term temporal resolution, and defaults
 * undated role queries to today.
 */

import type { EntityAlias, RoleTerm } from '@jachaikori/schema';
import { normalizeBanglaForFts } from './bangla';

export interface QueryExpansionResult {
  originalQuery: string;
  expandedTerms: string[];
  matchedEntityIds: string[];
}

export interface QueryExpander {
  expand(query: string, referenceDateIso?: string): Promise<QueryExpansionResult> | QueryExpansionResult;
}

interface QueryToken {
  raw: string;
  norm: string;
  hasUppercase: boolean;
}

interface CompiledQueryAlias {
  tokens: string[];
  entityId: string;
  aliasRaw: string;
  validFrom: string | null;
  validTo: string | null;
  requireUppercase: boolean;
}

const QUERY_ROLE_GUARDS = new Set([
  'সাবেক',
  'প্রাক্তন',
  'ক্ষমতাচ্যুত',
  'ভারপ্রাপ্ত',
  'former',
  'ex',
  'ousted',
  'deputy',
  'acting',
  'interim',
  'ভারতের',
  'ভারতীয়',
  'পাকিস্তানের',
  'পাকিস্তানি',
  'ইসরায়েলের',
  'ব্রিটিশ',
  'মার্কিন',
  'চীনের',
  'রাশিয়ার',
  'indian',
  'pakistani',
  'israeli',
  'british',
  'us',
  'american',
  'chinese',
  'russian',
]);

const BARE_ROLE_ALIASES = new Set(['pm', 'prime minister', 'প্রধানমন্ত্রী', 'chief adviser', 'প্রধান উপদেষ্টা']);

const EDGE_PUNCT_RE = /^[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+|[`"'‘’“”.,:;!?()[\]{}<>|—–\-।॥/\\]+$/g;

function tokenizeQuery(query: string): QueryToken[] {
  const normalized = normalizeBanglaForFts(query);
  if (!normalized) return [];
  const out: QueryToken[] = [];
  for (const part of normalized.split(/\s+/)) {
    const trimmed = part.replace(EDGE_PUNCT_RE, '');
    if (!trimmed) continue;
    let norm = trimmed.toLowerCase();
    if (norm.endsWith("'s") && norm.length > 2) {
      norm = norm.slice(0, -2);
    }
    if (!norm) continue;
    out.push({
      raw: trimmed,
      norm,
      hasUppercase: /[A-Z]/.test(trimmed),
    });
  }
  return out;
}

function isValidOnDay(validFrom: string | null | undefined, validTo: string | null | undefined, refDay: string): boolean {
  if (!validFrom && !validTo) return true;
  if (validFrom && refDay < validFrom.slice(0, 10)) return false;
  if (validTo && refDay > validTo.slice(0, 10)) return false;
  return true;
}

/**
 * Prefix-indexed, token-safe alias expander supporting temporal validity windows
 * and `role_term` resolution (e.g., "PM" / "প্রধানমন্ত্রী" bound to validFrom..validTo).
 */
export class AliasDictionaryExpander implements QueryExpander {
  private firstTokenIndex = new Map<string, CompiledQueryAlias[]>();
  private aliasesByEntity = new Map<string, CompiledQueryAlias[]>();
  private roleTermsByRole = new Map<string, RoleTerm[]>();

  constructor(aliases: EntityAlias[] = [], roleTerms: RoleTerm[] = []) {
    for (const entry of aliases) {
      const normPhrase = normalizeBanglaForFts(entry.aliasNorm || entry.aliasRaw).toLowerCase();
      const tokens = normPhrase
        .split(/\s+/)
        .map((t) => t.replace(EDGE_PUNCT_RE, ''))
        .filter(Boolean);
      if (tokens.length === 0) continue;

      const compiled: CompiledQueryAlias = {
        tokens,
        entityId: entry.entityId,
        aliasRaw: entry.aliasRaw,
        validFrom: entry.validFrom ?? null,
        validTo: entry.validTo ?? null,
        requireUppercase: Boolean(entry.requireUppercase),
      };

      const head = tokens[0]!;
      const bucket = this.firstTokenIndex.get(head);
      if (bucket) bucket.push(compiled);
      else this.firstTokenIndex.set(head, [compiled]);

      const entBucket = this.aliasesByEntity.get(entry.entityId);
      if (entBucket) entBucket.push(compiled);
      else this.aliasesByEntity.set(entry.entityId, [compiled]);
    }

    for (const bucket of this.firstTokenIndex.values()) {
      bucket.sort((a, b) => b.tokens.length - a.tokens.length);
    }

    for (const rt of roleTerms) {
      const list = this.roleTermsByRole.get(rt.roleEntityId);
      if (list) list.push(rt);
      else this.roleTermsByRole.set(rt.roleEntityId, [rt]);
    }
  }

  expand(query: string, referenceDateIso?: string): QueryExpansionResult {
    const queryTokens = tokenizeQuery(query);
    if (queryTokens.length === 0) {
      return { originalQuery: query, expandedTerms: [], matchedEntityIds: [] };
    }

    // Default undated queries to today so temporal role aliases expand only to the incumbent holder
    const refDay = (referenceDateIso ?? new Date().toISOString()).slice(0, 10);
    const expandedTerms = new Set<string>();
    const matchedEntityIds = new Set<string>();

    let i = 0;
    while (i < queryTokens.length) {
      const tok = queryTokens[i]!;
      const candidates = this.firstTokenIndex.get(tok.norm);
      if (!candidates) {
        i++;
        continue;
      }

      let best: CompiledQueryAlias | null = null;
      for (const cand of candidates) {
        if (best && cand.tokens.length <= best.tokens.length) continue;
        if (i + cand.tokens.length > queryTokens.length) continue;
        if (!isValidOnDay(cand.validFrom, cand.validTo, refDay)) continue;

        let ok = true;
        for (let k = 0; k < cand.tokens.length; k++) {
          const qt = queryTokens[i + k]!;
          if (qt.norm !== cand.tokens[k]) {
            ok = false;
            break;
          }
          if (cand.requireUppercase && !qt.hasUppercase) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        // Prevent matching "PM" inside times like "2 PM"
        if (cand.tokens.length === 1 && cand.tokens[0] === 'pm' && i > 0) {
          if (/^[0-9:.-]+$/.test(queryTokens[i - 1]!.norm)) continue;
        }

        // Guard bare role aliases when preceded by former/foreign qualifiers within 2 tokens
        const joined = cand.tokens.join(' ');
        if (BARE_ROLE_ALIASES.has(joined) && i > 0) {
          let blocked = false;
          for (let back = 1; back <= Math.min(2, i); back++) {
            if (QUERY_ROLE_GUARDS.has(queryTokens[i - back]!.norm)) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }

        best = cand;
      }

      if (!best) {
        i++;
        continue;
      }

      let targetEntityId = best.entityId;
      // Resolve role entity -> incumbent holder on refDay if role_term exists
      const roleTerms = this.roleTermsByRole.get(targetEntityId);
      if (roleTerms) {
        const activeTerm = roleTerms.find((rt) => isValidOnDay(rt.validFrom, rt.validTo, refDay));
        if (activeTerm) {
          targetEntityId = activeTerm.holderEntityId;
        }
      }

      matchedEntityIds.add(targetEntityId);
      const siblings = this.aliasesByEntity.get(targetEntityId) ?? [];
      for (const sibling of siblings) {
        if (sibling.aliasRaw === best.aliasRaw) continue;
        if (!isValidOnDay(sibling.validFrom, sibling.validTo, refDay)) continue;
        // Skip noisy 2-char acronyms when expanding FTS terms
        if (sibling.aliasRaw.length <= 2 && /^[A-Za-z]+$/.test(sibling.aliasRaw)) continue;
        expandedTerms.add(sibling.aliasRaw);
      }

      i += best.tokens.length;
    }

    return {
      originalQuery: query,
      expandedTerms: Array.from(expandedTerms),
      matchedEntityIds: Array.from(matchedEntityIds),
    };
  }
}
