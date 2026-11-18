/**
 * @file packages/entities/src/resolver.ts
 * Temporal, morphology-aware Entity Resolution engine and Sentence-Anchored
 * Hypergraph Relation Extractor for Bangla & English news articles.
 */

import type {
  ArticleEntityMention,
  Entity,
  EntityRelation,
  EntityRelationType,
  EntityRole,
} from '@jachaikori/schema';
import { normalizeText, splitSentences, tokenizeWithSpans, type TokenSpan } from './normalize';
import type { ExpandedEntityAlias } from './seed';

export interface ArticleInputForEntities {
  id: string;
  title: string;
  lead?: string | null;
  cleanText?: string | null;
  publishedAt?: string | null;
}

export interface ArticleHypergraphOutput {
  mentions: ArticleEntityMention[];
  relations: EntityRelation[];
}

interface CompiledAlias {
  tokens: string[];
  entityId: string;
  entity: Entity;
  validFrom: string | null;
  validTo: string | null;
  requireUppercase: boolean;
  aliasRaw: string;
}

interface MatchedSpan {
  entityId: string;
  entity: Entity;
  surfaceForm: string;
  startTokenIdx: number;
  endTokenIdx: number;
  startChar: number;
  endChar: number;
  role: EntityRole;
}

const ROLE_GUARD_PREDECESSORS = new Set([
  // Former / ousted / acting / deputy modifiers
  'সাবেক',
  'প্রাক্তন',
  'ক্ষমতাচ্যুত',
  'ভারপ্রাপ্ত',
  'উপ',
  'former',
  'ex',
  'ex-',
  'ousted',
  'deputy',
  'acting',
  'interim',
  'late',
  // Foreign country / nationality qualifiers
  'ভারতের',
  'ভারতীয়',
  'পাকিস্তানের',
  'পাকিস্তানি',
  'ইসরায়েলের',
  'ইসরায়েলি',
  'ব্রিটিশ',
  'যুক্তরাজ্যের',
  'মার্কিন',
  'আমেরিকার',
  'চীনের',
  'চীনা',
  'রাশিয়ার',
  'রুশ',
  'ফ্রান্সের',
  'ফরাসি',
  'জার্মানির',
  'জার্মান',
  'জাপানের',
  'জাপানি',
  'কানাডার',
  'অস্ট্রেলিয়ার',
  'মালয়েশিয়ার',
  'তুরস্কের',
  'নেপালের',
  'শ্রীলঙ্কার',
  'ভুটানের',
  'indian',
  'pakistani',
  'israeli',
  'british',
  'uk',
  'us',
  'american',
  'chinese',
  'russian',
  'french',
  'german',
  'japanese',
  'canadian',
  'australian',
  'malaysian',
  'turkish',
  'nepali',
  'bhutanese',
  "india's",
  "pakistan's",
  "israel's",
  "uk's",
  "britain's",
]);

const BN_SPEECH_VERB_RE = /(?:বলেন|বলেছেন|জানান|জানিয়েছেন|মন্তব্য করেন|দাবি করেন|উল্লেখ করেন|হুঁশিয়ারি)/;
const EN_SPEECH_VERB_RE = /\b(?:said|says|told|tells|stated|noted|warned|according to)\b/i;

const RELATION_PATTERNS: Array<{ type: EntityRelationType; re: RegExp }> = [
  {
    type: 'resigned_from',
    re: /(?:পদত্যাগ|অব্যাহতি|ছেড়েছেন|ছেড়েছেন|\bresign(?:ed|s|ation)?\b|\bstep(?:s|ped)? down\b)/i,
  },
  {
    type: 'legal_action',
    re: /(?:গ্রেপ্তার|আটক|মামলা|জামিন|হাতকড়া|ট্রাইব্যুনাল|হাইকোর্ট|সুপ্রিম কোর্ট|\barrest(?:ed|s)?\b|\bdetain(?:ed)?\b|\bindict(?:ed|ment)?\b|\bverdict\b|\bhearing\b|\bcourt\b)/i,
  },
  {
    type: 'criticized_or_protested',
    re: /(?:বিক্ষোভ|প্রতিবাদ|সমালোচনা|অভিযোগ|ক্ষোভ|হুঁশিয়ারি|পাল্টা|বিরুদ্ধে|\bprotest(?:ed|s)?\b|\bcriticiz(?:ed|es)\b|\baccus(?:ed|es)\b|\bdemand(?:ed|s)?\b|\bagainst\b)/i,
  },
  {
    type: 'met_with',
    re: /(?:সাক্ষাৎ|বৈঠক|আলাপ|সম্মেলন|সফর|\bmet\b|\bmeeting\b|\btalks\b|\bsummit\b|\bvisit(?:ed|s)?\b)/i,
  },
  {
    type: 'announced_or_agreed',
    re: /(?:ঘোষণা|প্রজ্ঞাপন|নির্দেশ|সিদ্ধান্ত|চুক্তি|ঋণ|অনুমোদন|\bannounc(?:ed|es)\b|\bapprov(?:ed|es)\b|\bpledg(?:ed|es)\b|\bsign(?:ed|s)\b|\bdirective\b)/i,
  },
];

function stableEdgeId(parts: string[]): string {
  let h1 = 2166136261;
  let h2 = 2166136261;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) {
    const ch = joined.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 16777619);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 16777619);
  }
  return `rel_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function isAliasValidForDate(alias: CompiledAlias, refDay: string | null): boolean {
  if (!alias.validFrom && !alias.validTo) return true;
  if (!refDay) return !alias.validTo;
  if (alias.validFrom && refDay < alias.validFrom.slice(0, 10)) return false;
  if (alias.validTo && refDay > alias.validTo.slice(0, 10)) return false;
  return true;
}

function classifySentenceRelation(
  sentence: string,
  src: MatchedSpan,
  tgt: MatchedSpan
): EntityRelationType {
  if (src.role === 'quoted_speaker' && tgt.role !== 'quoted_speaker') {
    return 'quoted_about';
  }
  if (tgt.role === 'quoted_speaker' && src.role !== 'quoted_speaker') {
    return 'quoted_about';
  }
  for (const rule of RELATION_PATTERNS) {
    if (rule.re.test(sentence)) {
      return rule.type;
    }
  }
  if (src.entity.entityType === 'location' || tgt.entity.entityType === 'location') {
    return 'located_in';
  }
  return 'co_occurred';
}

export class EntityHypergraphResolver {
  private entityMap: Map<string, Entity>;
  private firstTokenIndex: Map<string, CompiledAlias[]>;

  constructor(entities: Entity[], aliases: ExpandedEntityAlias[]) {
    this.entityMap = new Map(entities.map((e) => [e.id, e]));
    this.firstTokenIndex = new Map();

    for (const a of aliases) {
      const entity = this.entityMap.get(a.entityId);
      if (!entity) continue;
      const tokens = a.aliasNorm.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;

      const compiled: CompiledAlias = {
        tokens,
        entityId: a.entityId,
        entity,
        validFrom: a.validFrom ?? null,
        validTo: a.validTo ?? null,
        requireUppercase: Boolean(a.requireUppercase),
        aliasRaw: a.aliasRaw,
      };

      const head = tokens[0]!;
      const bucket = this.firstTokenIndex.get(head);
      if (bucket) {
        bucket.push(compiled);
      } else {
        this.firstTokenIndex.set(head, [compiled]);
      }
    }

    // Prefer longer multi-word aliases first so "প্রধানমন্ত্রী তারেক রহমান" matches before "প্রধানমন্ত্রী"
    for (const bucket of this.firstTokenIndex.values()) {
      bucket.sort((a, b) => b.tokens.length - a.tokens.length);
    }
  }

  /**
   * Matches canonical entities in a single sentence with temporal validity & Bangla suffix awareness.
   */
  matchSentence(sentence: string, refDay: string | null, isHeadline: boolean): MatchedSpan[] {
    const normalized = normalizeText(sentence);
    const tokens = tokenizeWithSpans(normalized);
    if (tokens.length === 0) return [];

    const matched: MatchedSpan[] = [];
    const colonIdx = normalized.lastIndexOf(':');
    const hasSpeechVerb = BN_SPEECH_VERB_RE.test(normalized) || EN_SPEECH_VERB_RE.test(normalized);

    let ti = 0;
    while (ti < tokens.length) {
      const tok = tokens[ti]!;
      const candidates = this.collectCandidatesForToken(tok);
      let best: { alias: CompiledAlias; spanLen: number } | null = null;

      for (const cand of candidates) {
        if (best && cand.tokens.length <= best.spanLen) continue;
        if (!isAliasValidForDate(cand, refDay)) continue;
        if (!this.matchesSpanAt(tokens, ti, cand)) continue;
        best = { alias: cand, spanLen: cand.tokens.length };
      }

      if (best) {
        const endTok = tokens[ti + best.spanLen - 1]!;
        const surfaceForm = normalized.slice(tok.startIndex, endTok.endIndex);
        let role: EntityRole = isHeadline ? 'subject' : 'mentioned';

        if (best.alias.entity.entityType === 'location') {
          role = 'location';
        } else if (
          (colonIdx > 8 && tok.startIndex > colonIdx && normalized.length - colonIdx < 45) ||
          (hasSpeechVerb && this.isAdjacentToSpeechVerb(normalized, tok.startIndex, endTok.endIndex))
        ) {
          role = 'quoted_speaker';
        } else if (isHeadline && ti <= 2) {
          role = 'actor';
        }

        matched.push({
          entityId: best.alias.entityId,
          entity: best.alias.entity,
          surfaceForm,
          startTokenIdx: ti,
          endTokenIdx: ti + best.spanLen - 1,
          startChar: tok.startIndex,
          endChar: endTok.endIndex,
          role,
        });
        ti += best.spanLen;
      } else {
        ti++;
      }
    }

    return matched;
  }

  private collectCandidatesForToken(tok: TokenSpan): CompiledAlias[] {
    const out: CompiledAlias[] = [];
    const seen = new Set<CompiledAlias>();
    for (const variant of tok.variants) {
      const list = this.firstTokenIndex.get(variant);
      if (!list) continue;
      for (const item of list) {
        if (!seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }

  private matchesSpanAt(tokens: TokenSpan[], startIdx: number, cand: CompiledAlias): boolean {
    const len = cand.tokens.length;
    if (startIdx + len > tokens.length) return false;

    for (let k = 0; k < len; k++) {
      const tok = tokens[startIdx + k]!;
      const expected = cand.tokens[k]!;
      if (cand.requireUppercase && !tok.hasUppercase) {
        return false;
      }

      const isLast = k === len - 1;
      const matches = isLast ? tok.variants.includes(expected) : tok.norm === expected;
      if (!matches) return false;
    }

    // Prevent matching "PM" inside times like "2 PM" or "10:30 PM"
    if (cand.tokens.length === 1 && cand.tokens[0] === 'pm' && startIdx > 0) {
      const prev = tokens[startIdx - 1]!.norm;
      if (/^[0-9:.-]+$/.test(prev)) return false;
    }

    // WP1 role guard: block bare PM / প্রধানমন্ত্রী / Prime Minister when preceded by
    // former/ousted/acting modifiers or foreign country/nationality qualifiers
    const isBarePmRole =
      (cand.tokens.length === 1 && (cand.tokens[0] === 'pm' || cand.tokens[0] === 'প্রধানমন্ত্রী')) ||
      (cand.tokens.length === 2 && cand.tokens[0] === 'prime' && cand.tokens[1] === 'minister');
    if (isBarePmRole && startIdx > 0) {
      const prev = tokens[startIdx - 1]!.norm;
      if (ROLE_GUARD_PREDECESSORS.has(prev)) {
        return false;
      }
    }

    return true;
  }

  private isAdjacentToSpeechVerb(sentence: string, startChar: number, endChar: number): boolean {
    const window = sentence.slice(Math.max(0, startChar - 30), Math.min(sentence.length, endChar + 35));
    return BN_SPEECH_VERB_RE.test(window) || EN_SPEECH_VERB_RE.test(window);
  }

  /**
   * Resolves all canonical entities (article hyperedge members) and sentence-level
   * typed entity-entity relationships for a single article.
   */
  resolveArticle(article: ArticleInputForEntities): ArticleHypergraphOutput {
    const refDay = article.publishedAt ? article.publishedAt.slice(0, 10) : null;
    const mentionMap = new Map<string, ArticleEntityMention>();
    const relationMap = new Map<string, EntityRelation>();

    const rolePriority: Record<EntityRole, number> = {
      quoted_speaker: 5,
      actor: 4,
      subject: 3,
      location: 2,
      mentioned: 1,
    };

    const sentences: Array<{ text: string; isHeadline: boolean }> = [
      { text: article.title, isHeadline: true },
    ];
    if (article.lead) {
      for (const s of splitSentences(article.lead)) {
        sentences.push({ text: s, isHeadline: false });
      }
    }
    if (article.cleanText) {
      // Cap body sentence scan per article at 35 sentences for clean signal & bounded throughput
      for (const s of splitSentences(article.cleanText).slice(0, 35)) {
        sentences.push({ text: s, isHeadline: false });
      }
    }

    for (const { text, isHeadline } of sentences) {
      const spans = this.matchSentence(text, refDay, isHeadline);
      if (spans.length === 0) continue;

      const uniqueInSentence: MatchedSpan[] = [];
      const seenEntityInSentence = new Set<string>();

      for (const span of spans) {
        const mentionKey = `${span.entityId}|${span.surfaceForm}`;
        const existing = mentionMap.get(mentionKey);
        if (!existing || rolePriority[span.role] > rolePriority[existing.role]) {
          mentionMap.set(mentionKey, {
            articleId: article.id,
            entityId: span.entityId,
            chunkId: null,
            surfaceForm: span.surfaceForm,
            role: span.role,
            confidence: isHeadline ? 0.95 : 0.85,
          });
        }

        if (!seenEntityInSentence.has(span.entityId)) {
          seenEntityInSentence.add(span.entityId);
          uniqueInSentence.push(span);
        }
      }

      if (uniqueInSentence.length < 2) continue;
      // Avoid quadratic blowup on long listicle sentences
      const pairEntities = uniqueInSentence.slice(0, 5);
      const snippet = text.length > 220 ? `${text.slice(0, 217)}...` : text;

      for (let i = 0; i < pairEntities.length; i++) {
        for (let j = i + 1; j < pairEntities.length; j++) {
          const a = pairEntities[i]!;
          const b = pairEntities[j]!;
          const relType = classifySentenceRelation(text, a, b);

          // Orient directional quote relations from speaker -> subject
          let src = a;
          let tgt = b;
          if (relType === 'quoted_about' && tgt.role === 'quoted_speaker' && src.role !== 'quoted_speaker') {
            src = b;
            tgt = a;
          } else if (relType === 'co_occurred' && src.entityId > tgt.entityId) {
            src = b;
            tgt = a;
          }

          const relKey = `${src.entityId}|${tgt.entityId}|${relType}`;
          if (!relationMap.has(relKey)) {
            relationMap.set(relKey, {
              id: stableEdgeId([article.id, relKey]),
              articleId: article.id,
              sourceEntityId: src.entityId,
              targetEntityId: tgt.entityId,
              relationType: relType,
              evidenceSnippet: snippet,
              publishedAt: article.publishedAt ?? null,
              confidence: isHeadline ? 0.92 : 0.8,
            });
          }
        }
      }
    }

    return {
      mentions: Array.from(mentionMap.values()),
      relations: Array.from(relationMap.values()),
    };
  }
}
