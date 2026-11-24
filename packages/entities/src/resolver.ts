/**
 * @file packages/entities/src/resolver.ts
 * Entity Resolution v2 & High-Precision Typed Relationship Extractor.
 *
 * Pure, runtime-agnostic library (runs in Bun and Cloudflare Workers with zero network/DB deps):
 * - Prefix-trie longest-span matching with stem comparison on every token position
 * - Temporal `role_term` resolution + multi-token role guards + apposition lookahead + headline-topic guard
 * - Newspaper dateline stripping & unambiguous article-local name coreference
 * - Deduplicated `(articleId, entityId)` mentions separating `linkMethod`/`linkConfidence` from `salience`
 * - 17-type directional high-precision deterministic relations (dropping `co_occurred` / generic `located_in`)
 * - Rule-based `UnlinkedMention[]` candidate emitter for offline long-tail mining
 */

import type {
  ArticleEntityMention,
  Entity,
  EntityAlias,
  EntityRelation,
  EntityRelationType,
  EntityRole,
  EntityType,
  LinkMethod,
  RoleTerm,
  UnlinkedMention,
  UnlinkedTriggerPattern,
} from '@jachaikori/schema';
import {
  normalizePhrase,
  normalizeText,
  splitSentences,
  stripDateline,
  tokenizeWithSpans,
  type TokenSpan,
} from './normalize';

export const RESOLVER_VERSION = 'v2.0.0';

export interface ArticleInputForEntities {
  id: string;
  title: string;
  lead?: string | null;
  cleanText?: string | null;
  publishedAt?: string | null;
}

export interface ResolveArticleOptions {
  /** Emit unlinked candidate mentions for offline mining (default: true). */
  emitUnlinked?: boolean;
  /** Maximum body sentences to scan per article (default: 35). */
  maxBodySentences?: number;
}

export interface ArticleHypergraphOutput {
  mentions: ArticleEntityMention[];
  relations: EntityRelation[];
  unlinked: UnlinkedMention[];
  resolverVersion: string;
}

export interface RegistrySnapshotInput {
  version?: number;
  entities: Entity[];
  aliases: EntityAlias[];
  roleTerms?: RoleTerm[];
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

interface TrieNode {
  children: Map<string, TrieNode>;
  aliases: CompiledAlias[];
}

export interface CompiledRegistry {
  version: number;
  entityMap: Map<string, Entity>;
  redirectMap: Map<string, string>;
  trieRoot: TrieNode;
  roleTermsByRole: Map<string, RoleTerm[]>;
  foreignLocationIds: Set<string>;
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
  linkMethod: LinkMethod;
  linkConfidence: number;
  viaRoleId?: string;
}

const FOREIGN_LOCATION_IDS = new Set([
  'ent_india',
  'ent_usa',
  'ent_uk',
  'ent_china',
  'ent_pakistan',
  'ent_saudi',
  'ent_malaysia',
  'ent_turkey',
]);

const FORMER_PM_ENTITY_IDS = new Set([
  'ent_sheikh_hasina',
  'ent_khaleda_zia',
]);

const FOREIGN_LEADER_ENTITY_IDS = new Set([
  'ent_narendra_modi',
  'ent_imran_khan',
  'ent_donald_trump',
]);

const ROLE_GUARD_PREDECESSORS = new Set([
  // Former / ousted / acting / deputy / jailed modifiers
  'সাবেক',
  'প্রাক্তন',
  'ক্ষমতাচ্যুত',
  'পদচ্যুত',
  'পলাতক',
  'কারাবন্দী',
  'কারাবন্দি',
  'ভারপ্রাপ্ত',
  'অন্তর্বর্তী',
  'তিনবারের',
  'দুইবারের',
  'উপ',
  'সহ',
  'প্রয়াত',
  'প্রয়াত',
  'former',
  'ex',
  'ex-',
  'ousted',
  'deposed',
  'fugitive',
  'jailed',
  'deputy',
  'acting',
  'interim',
  'late',
  'three-time',
  'two-time',
  'vice',
  'assistant',
  'state',
  'shadow',
  // Foreign country possessive / nationality qualifiers (intentionally possessive/adjectival so
  // Bangla SOV clauses like "আজ তুরস্ক যাচ্ছেন প্রধানমন্ত্রী" do not falsely block the PM)
  'ভারতের',
  'ভারতীয়',
  'ভারতীয়',
  'পাকিস্তানের',
  'পাকিস্তানি',
  'ইসরায়েলের',
  'ইসরায়েলি',
  'ব্রিটিশ',
  'যুক্তরাজ্যের',
  'মার্কিন',
  'যুক্তরাষ্ট্রের',
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
  'মালদ্বীপের',
  'থাইল্যান্ডের',
  'সিঙ্গাপুরের',
  'ইরানের',
  'সৌদি',
  'বিদেশি',
  'বিদেশী',
  'indian',
  "india's",
  'pakistani',
  "pakistan's",
  'israeli',
  "israel's",
  'british',
  'uk',
  "uk's",
  "britain's",
  'us',
  'usa',
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
  'foreign',
]);

// Words that immediately follow a role when it is NOT an apposition person name
const BN_NON_NAME_FOLLOWERS = new Set([
  'আজ',
  'আগামীকাল',
  'গতকাল',
  'এখন',
  'তখন',
  'বলেন',
  'বলেছেন',
  'বললেন',
  'জানান',
  'জানিয়েছেন',
  'জানালেন',
  'করেন',
  'করেছেন',
  'করবেন',
  'হিসেবে',
  'পদে',
  'থেকে',
  'নিয়ে',
  'নিয়েই',
  'সঙ্গে',
  'সাথে',
  'বিরুদ্ধে',
  'বিষয়ে',
  'উপলক্ষে',
  'আগামী',
  'নতুন',
  'দেশের',
  'সরকার',
  'সরকারের',
  'কার্যালয়ে',
  'বাসভবনে',
  'দপ্তরে',
  'ভবনে',
  'আমলে',
  'সময়ে',
  'শাসনামলে',
  'মেয়াদে',
  'ও',
  'এবং',
  'বা',
  'কিন্তু',
  'তবে',
  'যখন',
  'যিনি',
  'তাঁর',
  'তার',
  'নিজেই',
  'আরও',
  'আবার',
  'পুনরায়',
  'এক',
  'দুই',
  'তিন',
  'সব',
  'সকল',
  'কোনো',
  'এই',
  'সেই',
  'ওই',
  'কি',
  'কী',
  'না',
  'নয়',
  'হয়ে',
  'হয়েছেন',
  'হন',
  'ছিল',
  'ছিলেন',
  'থাকবেন',
  'দিয়েছেন',
  'দেন',
  'দেবেন',
  'নিতে',
  'দিতে',
  'করতে',
  'যেতে',
  'আসতে',
  'পৌঁছেছেন',
  'যাচ্ছেন',
  'এসেছেন',
]);

const COMMON_SURNAMES_SKIP_COREF = new Set([
  'রহমান',
  'আহমেদ',
  'আহমদ',
  'হোসেন',
  'হোসাইন',
  'খান',
  'খাঁন',
  'ইসলাম',
  'আলী',
  'আলি',
  'চৌধুরী',
  'বেগম',
  'খাতুন',
  'আক্তার',
  'আখতার',
  'উদ্দিন',
  'উদ্দীন',
  'সরকার',
  'মিয়া',
  'মিয়া',
  'আলম',
  'করিম',
  'হাসান',
  'হক',
  'রশিদ',
  'কবির',
  'সুলতানা',
  'rahman',
  'ahmed',
  'ahmad',
  'hossain',
  'hussain',
  'khan',
  'islam',
  'ali',
  'chowdhury',
  'begum',
  'khatun',
  'akter',
  'akhter',
  'uddin',
  'sarkar',
  'sarker',
  'mia',
  'miah',
  'alam',
  'karim',
  'hasan',
  'hassan',
  'haque',
  'hoque',
  'rashid',
  'kabir',
  'sultana',
]);

const BN_SPEECH_VERB_RE =
  /(?:বলেন|বলেছেন|বললেন|জানান|জানিয়েছেন|জানালেন|মন্তব্য করেন|দাবি করেন|উল্লেখ করেন|হুঁশিয়ারি|আহ্বান জানান|যোগ করেন)/;
const EN_SPEECH_VERB_RE =
  /\b(?:said|says|told|tells|stated|noted|warned|claimed|added|urged|according to)\b/i;

const CLAUSE_REL_PATTERNS: Array<{ type: EntityRelationType; label: string; re: RegExp }> = [
  {
    type: 'resigned_or_removed',
    label: 'resigned / removed',
    re: /(?:পদত্যাগ|অব্যাহতি|অপসারণ|বরখাস্ত|ছেড়েছেন|ছেড়েছেন|\bresign(?:ed|s|ation)?\b|\bstep(?:s|ped)?\s+down\b|\bsack(?:ed)?\b|\bremoved?\s+from\b)/i,
  },
  {
    type: 'appointed_or_elected',
    label: 'appointed / elected',
    re: /(?:নিয়োগ|নিয়োগ|শপথ\s+নিয়ে|শপথ\s+নিয়ে|নির্বাচিত\s+হয়ে|নির্বাচিত\s+হয়ে|\bappoint(?:ed|ment)?\b|\bsworn\s+in\b|\belected\b)/i,
  },
  {
    type: 'ruled_or_sentenced',
    label: 'ruled / sentenced',
    re: /(?:মৃত্যুদণ্ড|যাবজ্জীবন|কারাদণ্ড|জামিন|স্থগিতাদেশ|রায়\s+ঘোষণা|রায়\s+ঘোষণা|খালাস|\bverdict\b|\bsentenc(?:ed|e)\b|\bbail\b|\bupheld\b|\bacquitt(?:ed|al)\b)/i,
  },
  {
    type: 'investigated_or_charged',
    label: 'investigated / charged',
    re: /(?:গ্রেপ্তার|আটক|মামলা|চার্জশিট|অভিযোগপত্র|অনুসন্ধান|তদন্ত|রিমান্ড|\barrest(?:ed|s)?\b|\bdetain(?:ed)?\b|\bindict(?:ed|ment)?\b|\bchargesheet\b|\bprob(?:e|ing)\b|\binvestigat(?:e|ion|ing)\b|\bsued\b)/i,
  },
  {
    type: 'regulated_or_directed',
    label: 'regulated / directed',
    re: /(?:প্রজ্ঞাপন|নির্দেশ\s+দিয়েছেন|নির্দেশ\s+দিয়েছেন|রুল\s+জারি|জরিমানা|নিষেধাজ্ঞা|পর্ষদ\s+ভেঙে|\bdirective\b|\bissued\s+(?:a\s+)?rule\b|\bfined\b|\bsuspend(?:ed)?\b|\bdissolved\b|\bbanned\b)/i,
  },
  {
    type: 'funded_or_invested',
    label: 'funded / invested',
    re: /(?:ঋণ\s+অনুমোদন|ঋণ\s+চুক্তি|বিনিয়োগ|বিনিয়োগ|অনুদান|অর্থায়ন|অর্থায়ন|\bloan\b|\bcredit\s+line\b|\binvest(?:ed|ment)\b|\bgrant\b|\bfund(?:ed|ing)\b)/i,
  },
  {
    type: 'signed_deal_or_agreed',
    label: 'signed deal / agreed',
    re: /(?:চুক্তি\s+স্বাক্ষর|সমঝোতা\s+স্মারক|চুক্তি\s+হয়েছে|চুক্তি\s+হয়েছে|অনুমোদন\s+দিয়েছে|অনুমোদন\s+দিয়েছে|\bsign(?:ed)?\s+(?:a\s+|an\s+)?(?:deal|pact|mou|agreement)\b|\bagreement\b|\bmou\b|\bapproved\b)/i,
  },
  {
    type: 'diplomatic_action',
    label: 'diplomatic action',
    re: /(?:প্রত্যর্পণ|তলব|কূটনৈতিক|রাষ্ট্রদূত|ভিসা\s+নিষেধাজ্ঞা|রপ্তানি\s+বন্ধ|\bextradit(?:e|ion)\b|\bsummon(?:ed)?\s+(?:the\s+)?envoy\b|\bdiplomatic\b|\bbilateral\b|\btariff\b|\bexport\s+ban\b)/i,
  },
  {
    type: 'demanded_or_urged',
    label: 'demanded / urged',
    re: /(?:দাবি\s+জানিয়ে|দাবি\s+জানিয়ে|আহ্বান\s+জানিয়ে|আহ্বান\s+জানিয়ে|আলটিমেটাম|ধর্মঘট|হরতাল|\bdemand(?:ed|s)?\b|\burged\b|\bcalled\s+for\b|\bultimatum\b)/i,
  },
  {
    type: 'criticized_or_opposed',
    label: 'criticized / opposed',
    re: /(?:বিক্ষোভ|প্রতিবাদ|সমালোচনা|নিন্দা|ক্ষোভ|অভিযোগ\s+করে|হুঁশিয়ারি|\bprotest(?:ed|s)?\b|\bcriticiz(?:ed|es)\b|\bcondemn(?:ed|s)?\b|\baccus(?:ed|es)\b|\boppos(?:ed|es)\b)/i,
  },
  {
    type: 'supported_or_endorsed',
    label: 'supported / endorsed',
    re: /(?:সমর্থন\s+জানিয়ে|সমর্থন\s+জানিয়ে|স্বাগত\s+জানিয়ে|স্বাগত\s+জানিয়ে|প্রশংসা|ঐকমত্য|\bsupport(?:ed|s)?\b|\bendorse(?:d|s)?\b|\bwelcom(?:ed|es)\b|\bprais(?:ed|es)\b)/i,
  },
  {
    type: 'met_with',
    label: 'met with',
    re: /(?:সাক্ষাৎ|বৈঠক|আলাপ|সম্মেলন|সফর|\bmet\b|\bmeeting\b|\btalks\b|\bsummit\b|\bvisit(?:ed|s)?\b)/i,
  },
];

// Triggers for UnlinkedMention mining
const BN_PERSON_TITLE_TRIGGERS = new Set([
  'মন্ত্রী',
  'প্রতিমন্ত্রী',
  'উপদেষ্টা',
  'সচিব',
  'মহাসচিব',
  'সভাপতি',
  'চেয়ারম্যান',
  'চেয়ারম্যান',
  'মহাপরিচালক',
  'পরিচালক',
  'কমিশনার',
  'বিচারপতি',
  'অধ্যাপক',
  'ব্যারিস্টার',
  'অ্যাডভোকেট',
  'মেয়র',
  'মেয়র',
  'গভর্নর',
  'মুখপাত্র',
  'সমন্বয়ক',
  'সমন্বয়ক',
  'কমান্ডার',
  'প্রধান',
  'ড.',
  'ডা.',
  'ড',
  'ডা',
  'অ্যাটর্নি',
  'প্রকৌশলী',
  'আহ্বায়ক',
  'আহ্বায়ক',
]);

const BN_ORG_SUFFIXES = new Set([
  'ব্যাংক',
  'কমিশন',
  'মন্ত্রণালয়',
  'মন্ত্রণালয়',
  'অধিদপ্তর',
  'বোর্ড',
  'কর্পোরেশন',
  'বিশ্ববিদ্যালয়',
  'বিশ্ববিদ্যালয়',
  'হাসপাতাল',
  'ফেডারেশন',
  'অ্যাসোসিয়েশন',
  'সমিতি',
  'কাউন্সিল',
  'আদালত',
  'ট্রাইব্যুনাল',
  'লিমিটেড',
  'গ্রুপ',
  'পার্টি',
  'লীগ',
  'ফ্রন্ট',
  'বাহিনী',
  'কর্তৃপক্ষ',
  'ইনস্টিটিউট',
  'ফাউন্ডেশন',
  'পরিষদ',
]);

const EN_PROPER_STOP_FIRST = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'by', 'for', 'to', 'of', 'from', 'with', 'as', 'after', 'before',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'this', 'that', 'these', 'those', 'however', 'meanwhile', 'according', 'speaking', 'addressing', 'earlier', 'later', 'today', 'yesterday', 'tomorrow',
  'new', 'old', 'first', 'second', 'third', 'last', 'next', 'former', 'current', 'chief', 'senior', 'general', 'national',
]);

const EN_ORG_KEYWORDS = new Set([
  'bank', 'commission', 'ministry', 'board', 'corporation', 'university', 'hospital', 'federation',
  'association', 'council', 'court', 'tribunal', 'limited', 'ltd', 'group', 'party', 'league',
  'authority', 'institute', 'foundation', 'police', 'committee', 'agency', 'department', 'bureau', 'force',
]);

const EXCLUDED_HEADLINE_SPEAKERS = new Set([
  'প্রতিবেদক', 'নিজস্ব প্রতিবেদক', 'প্রতিনিধি', 'বিশেষ প্রতিনিধি', 'ডেস্ক', 'ডেক্স',
  'সংশ্লিষ্ট', 'সাক্ষাৎকার', 'মতামত', 'সম্পাদকীয়', 'বিশ্লেষণ', 'সরকার', 'পুলিশ', 'আদালত',
  'বিশেষজ্ঞরা', 'বিশ্লেষকরা', 'সূত্র', 'বক্তারা', 'নেতারা', 'প্রতিবেদন', 'আপডেট', 'সর্বশেষ', 'ভিডিও',
  'মন্ত্রী', 'প্রতিমন্ত্রী', 'উপদেষ্টা', 'সচিব', 'চেয়ারম্যান', 'মেয়র', 'পরিচালক', 'সভাপতি',
  'সাধারণ সম্পাদক', 'মুখপাত্র', 'কমিটি', 'বিচারক', 'minister', 'adviser', 'secretary', 'chairman',
  'experts', 'study', 'report', 'official', 'spokesperson', 'police', 'court', 'govt',
]);

const ROLE_PRIORITY: Record<EntityRole, number> = {
  quoted_speaker: 5,
  actor: 4,
  subject: 3,
  location: 2,
  mentioned: 1,
};

const LINK_METHOD_PRIORITY: Record<LinkMethod, number> = {
  name_exact: 6,
  alias_stem: 5,
  llm_linked: 4,
  role_dated: 3,
  article_coref: 2,
  role_inferred: 1,
};

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

function createTrieNode(): TrieNode {
  return { children: new Map(), aliases: [] };
}

function isValidForDate(
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
  refDay: string | null
): boolean {
  if (!validFrom && !validTo) return true;
  if (!refDay) return !validTo;
  if (validFrom && refDay < validFrom.slice(0, 10)) return false;
  if (validTo && refDay > validTo.slice(0, 10)) return false;
  return true;
}

/**
 * Compiles a registry snapshot (entities, aliases, role terms) into an immutable
 * in-memory prefix trie for fast, zero-IO resolution in Bun or Cloudflare Workers.
 */
export function compileRegistry(snapshot: RegistrySnapshotInput): CompiledRegistry {
  const redirectMap = new Map<string, string>();
  const rawById = new Map<string, Entity>();

  for (const e of snapshot.entities) {
    rawById.set(e.id, e);
    if (e.status === 'merged' && e.mergedInto) {
      redirectMap.set(e.id, e.mergedInto);
    }
  }

  const resolveRedirect = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (redirectMap.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = redirectMap.get(cur)!;
    }
    return cur;
  };

  const entityMap = new Map<string, Entity>();
  const foreignLocationIds = new Set<string>(FOREIGN_LOCATION_IDS);

  for (const e of snapshot.entities) {
    if (e.status === 'rejected' || e.status === 'merged') continue;
    entityMap.set(e.id, e);
    if (e.entityType === 'location' && e.metadataJson) {
      try {
        const meta = JSON.parse(e.metadataJson);
        if (meta && meta.foreign === true) foreignLocationIds.add(e.id);
      } catch {
        // ignore malformed metadata
      }
    }
  }

  const trieRoot = createTrieNode();
  for (const a of snapshot.aliases) {
    const targetId = resolveRedirect(a.entityId);
    const entity = entityMap.get(targetId);
    if (!entity) continue;

    const normPhrase = normalizePhrase(a.aliasNorm || a.aliasRaw);
    const tokens = normPhrase.split(' ').filter(Boolean);
    if (tokens.length === 0) continue;

    const compiled: CompiledAlias = {
      tokens,
      entityId: targetId,
      entity,
      validFrom: a.validFrom ?? null,
      validTo: a.validTo ?? null,
      requireUppercase: Boolean(a.requireUppercase),
      aliasRaw: a.aliasRaw,
    };

    let node = trieRoot;
    for (const tok of tokens) {
      let next = node.children.get(tok);
      if (!next) {
        next = createTrieNode();
        node.children.set(tok, next);
      }
      node = next;
    }
    node.aliases.push(compiled);
  }

  const roleTermsByRole = new Map<string, RoleTerm[]>();
  for (const rt of snapshot.roleTerms ?? []) {
    const roleId = resolveRedirect(rt.roleEntityId);
    const holderId = resolveRedirect(rt.holderEntityId);
    if (!entityMap.has(holderId)) continue;
    const normalizedRt: RoleTerm = { ...rt, roleEntityId: roleId, holderEntityId: holderId };
    const list = roleTermsByRole.get(roleId);
    if (list) list.push(normalizedRt);
    else roleTermsByRole.set(roleId, [normalizedRt]);
  }
  for (const list of roleTermsByRole.values()) {
    list.sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  }

  return {
    version: snapshot.version ?? 1,
    entityMap,
    redirectMap,
    trieRoot,
    roleTermsByRole,
    foreignLocationIds,
  };
}

interface TrieMatchCandidate {
  alias: CompiledAlias;
  spanLen: number;
  isExact: boolean;
}

/**
 * Longest-span trie lookup supporting stem/orthographic variants on EVERY token position.
 */
function findBestTrieMatch(
  tokens: TokenSpan[],
  startIdx: number,
  trieRoot: TrieNode,
  refDay: string | null
): TrieMatchCandidate | null {
  let best: TrieMatchCandidate | null = null;

  const visit = (node: TrieNode, depth: number, allExact: boolean) => {
    if (depth > 0 && node.aliases.length > 0) {
      for (const alias of node.aliases) {
        if (!isValidForDate(alias.validFrom, alias.validTo, refDay)) continue;
        if (alias.requireUppercase) {
          let upperOk = true;
          for (let k = 0; k < depth; k++) {
            if (!tokens[startIdx + k]!.hasUppercase) {
              upperOk = false;
              break;
            }
          }
          if (!upperOk) continue;
        }
        // Prevent matching "PM" inside times like "2 PM" or "10:30 PM"
        if (depth === 1 && alias.tokens[0] === 'pm' && startIdx > 0) {
          if (/^[0-9:.-]+$/.test(tokens[startIdx - 1]!.norm)) continue;
        }

        if (
          !best ||
          depth > best.spanLen ||
          (depth === best.spanLen && allExact && !best.isExact) ||
          (depth === best.spanLen &&
            allExact === best.isExact &&
            alias.entity.entityType !== 'role' &&
            best.alias.entity.entityType === 'role')
        ) {
          best = { alias, spanLen: depth, isExact: allExact };
        }
      }
    }

    const pos = startIdx + depth;
    if (pos >= tokens.length || node.children.size === 0) return;

    const tok = tokens[pos]!;
    // Try exact norm first, then Bangla stem / orthographic variants
    for (let vi = 0; vi < tok.variants.length; vi++) {
      const v = tok.variants[vi]!;
      const child = node.children.get(v);
      if (!child) continue;
      visit(child, depth + 1, allExact && vi === 0);
    }
  };

  visit(trieRoot, 0, true);
  return best;
}

/**
 * Checks 1–3 preceding tokens (stopping at clause breaks) for former/ousted/foreign
 * modifiers or a preceding foreign location entity.
 */
function hasRoleGuardPredecessor(
  tokens: TokenSpan[],
  startIdx: number,
  priorSpans: MatchedSpan[],
  foreignLocationIds: Set<string>
): boolean {
  for (let back = 1; back <= 3; back++) {
    const idx = startIdx - back;
    if (idx < 0) break;
    // If the token at idx+1 is preceded by a clause break, do not cross the break
    if (tokens[idx + 1]!.precededByClauseBreak) break;

    const prevTok = tokens[idx]!;
    if (ROLE_GUARD_PREDECESSORS.has(prevTok.norm)) return true;
  }

  // Also check if a foreign location span is immediately adjacent before this role ("India PM")
  for (let i = priorSpans.length - 1; i >= 0; i--) {
    const sp = priorSpans[i]!;
    if (startIdx - sp.endTokenIdx > 1) break;
    if (foreignLocationIds.has(sp.entityId) && !tokens[startIdx]!.precededByClauseBreak) {
      return true;
    }
  }

  return false;
}

/**
 * Detects whether tokens immediately following a bare role look like an unknown person's name
 * in apposition (e.g., "Prime Minister Shehbaz Sharif", "প্রধানমন্ত্রী নরেন্দ্র মোদি").
 */
function detectUnknownAppositionName(
  tokens: TokenSpan[],
  afterIdx: number
): { endTokenIdx: number; surfaceTokens: TokenSpan[] } | null {
  if (afterIdx + 1 >= tokens.length) return null;
  if (tokens[afterIdx]!.precededByClauseBreak) return null;

  const t0 = tokens[afterIdx]!;
  const t1 = tokens[afterIdx + 1]!;
  if (t1.precededByClauseBreak) return null;

  // English apposition: 2-3 consecutive capitalized name tokens ("Shehbaz Sharif", "Keir Starmer")
  if (
    !t0.isBangla &&
    !t1.isBangla &&
    /^[A-Z][a-z.'-]+$/.test(t0.raw) &&
    /^[A-Z][a-z.'-]+$/.test(t1.raw) &&
    !EN_PROPER_STOP_FIRST.has(t0.norm)
  ) {
    const collected = [t0, t1];
    if (
      afterIdx + 2 < tokens.length &&
      !tokens[afterIdx + 2]!.precededByClauseBreak &&
      /^[A-Z][a-z.'-]+$/.test(tokens[afterIdx + 2]!.raw)
    ) {
      collected.push(tokens[afterIdx + 2]!);
    }
    return { endTokenIdx: afterIdx + collected.length - 1, surfaceTokens: collected };
  }

  // Bangla apposition: 2 clean Bangla name tokens where neither is a non-name follower/verb/digit
  if (
    t0.isBangla &&
    t1.isBangla &&
    t0.norm.length >= 2 &&
    t1.norm.length >= 2 &&
    !/[0-9০-৯]/.test(t0.norm) &&
    !/[0-9০-৯]/.test(t1.norm) &&
    !BN_NON_NAME_FOLLOWERS.has(t0.norm) &&
    !BN_NON_NAME_FOLLOWERS.has(t1.norm) &&
    !BN_ORG_SUFFIXES.has(t0.norm) &&
    !BN_ORG_SUFFIXES.has(t1.norm) &&
    !BN_SPEECH_VERB_RE.test(t0.norm) &&
    !BN_SPEECH_VERB_RE.test(t1.norm)
  ) {
    return { endTokenIdx: afterIdx + 1, surfaceTokens: [t0, t1] };
  }

  return null;
}

function isAdjacentToSpeechVerb(sentence: string, startChar: number, endChar: number, isBangla: boolean): boolean {
  // Bangla is verb-final (SOV), so the speaker frequently precedes the verb by 40-80 chars
  const left = isBangla ? 45 : 30;
  const right = isBangla ? 85 : 40;
  const window = sentence.slice(Math.max(0, startChar - left), Math.min(sentence.length, endChar + right));
  return BN_SPEECH_VERB_RE.test(window) || EN_SPEECH_VERB_RE.test(window);
}

function classifyClauseRelation(
  sentence: string,
  src: MatchedSpan,
  tgt: MatchedSpan
): { type: EntityRelationType; label: string; flipDirection?: boolean } | null {
  // 1) Quoted speaker -> subject/entity
  if (src.role === 'quoted_speaker' && tgt.role !== 'quoted_speaker') {
    return { type: 'quoted_about', label: 'quoted about' };
  }
  if (tgt.role === 'quoted_speaker' && src.role !== 'quoted_speaker') {
    return { type: 'quoted_about', label: 'quoted about', flipDirection: true };
  }

  // Only inspect clause-scoped pairs (within 130 chars) to avoid cross-clause hallucinations
  const minStart = Math.min(src.startChar, tgt.startChar);
  const maxEnd = Math.max(src.endChar, tgt.endChar);
  if (maxEnd - minStart > 160) return null;

  const between = sentence.slice(Math.min(src.endChar, tgt.endChar), Math.max(src.startChar, tgt.startChar));
  if (/[;।]/.test(between)) return null;

  const clauseWindow = sentence.slice(Math.max(0, minStart - 35), Math.min(sentence.length, maxEnd + 45));

  for (const rule of CLAUSE_REL_PATTERNS) {
    if (rule.re.test(clauseWindow)) {
      return { type: rule.type, label: rule.label };
    }
  }

  // Intentionally drop noisy `co_occurred` and generic `located_in`
  return null;
}

function extractUnlinkedMentions(
  sentence: string,
  tokens: TokenSpan[],
  coveredTokenIndices: Set<number>,
  sentenceIndex: number,
  isHeadline: boolean,
  out: UnlinkedMention[]
): void {
  const snippet = sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
  const localSeen = new Set<string>();

  const pushCandidate = (
    surface: string,
    startChar: number,
    endChar: number,
    triggerPattern: UnlinkedTriggerPattern,
    guessedType: EntityType
  ) => {
    const cleanSurface = surface.trim();
    const norm = normalizePhrase(cleanSurface);
    if (!norm || norm.length < 3 || norm.length > 64) return;
    if (/[0-9০-৯]/.test(norm)) return;
    if (EXCLUDED_HEADLINE_SPEAKERS.has(norm)) return;
    const dedupKey = `${norm}|${guessedType}`;
    if (localSeen.has(dedupKey)) return;
    localSeen.add(dedupKey);

    out.push({
      surface: cleanSurface,
      normalized: norm,
      sentenceIndex,
      startChar,
      endChar,
      triggerPattern,
      guessedType,
      contextSnippet: snippet,
    });
  };

  // 1) Headline `: <Speaker>` tail
  if (isHeadline) {
    const colonIdx = sentence.lastIndexOf(':');
    if (colonIdx > 10 && sentence.length - colonIdx <= 44) {
      const tailTokens = tokens.filter((t) => t.startIndex > colonIdx);
      if (tailTokens.length >= 2 && tailTokens.length <= 4) {
        const anyCovered = tailTokens.some((t) => coveredTokenIndices.has(tokens.indexOf(t)));
        if (!anyCovered) {
          const first = tailTokens[0]!;
          const last = tailTokens[tailTokens.length - 1]!;
          const rawTail = sentence.slice(first.startIndex, last.endIndex);
          const isValidTail =
            first.isBangla
              ? tailTokens.every((t) => t.isBangla && !BN_NON_NAME_FOLLOWERS.has(t.norm))
              : tailTokens.every((t) => /^[A-Z][a-zA-Z.'-]+$/.test(t.raw));
          if (isValidTail) {
            const guessedType: EntityType =
              BN_ORG_SUFFIXES.has(last.norm) || EN_ORG_KEYWORDS.has(last.norm) ? 'org' : 'person';
            pushCandidate(rawTail, first.startIndex, last.endIndex, 'headline_colon_speaker', guessedType);
          }
        }
      }
    }
  }

  // 2) Bangla `<title> <Name>` trigger
  for (let i = 0; i < tokens.length - 2; i++) {
    const tok = tokens[i]!;
    if (!tok.isBangla) continue;
    const isTrigger = tok.variants.some((v) => BN_PERSON_TITLE_TRIGGERS.has(v));
    if (!isTrigger) continue;

    const nameToks: TokenSpan[] = [];
    for (let k = 1; k <= 3 && i + k < tokens.length; k++) {
      const nt = tokens[i + k]!;
      if (nt.precededByClauseBreak || !nt.isBangla || coveredTokenIndices.has(i + k)) break;
      if (
        nt.norm.length < 2 ||
        BN_NON_NAME_FOLLOWERS.has(nt.norm) ||
        BN_ORG_SUFFIXES.has(nt.norm) ||
        BN_SPEECH_VERB_RE.test(nt.norm)
      ) {
        break;
      }
      nameToks.push(nt);
    }
    if (nameToks.length >= 2) {
      const first = nameToks[0]!;
      const last = nameToks[nameToks.length - 1]!;
      pushCandidate(
        sentence.slice(first.startIndex, last.endIndex),
        first.startIndex,
        last.endIndex,
        'bangla_title_name',
        'person'
      );
    }
  }

  // 3) Bangla Org suffix trigger (2–4 Bangla tokens ending in an institutional noun;
  //    allows including an immediately preceding location/hub token like "বাংলাদেশ" or "ঢাকা")
  for (let i = 1; i < tokens.length; i++) {
    const endTok = tokens[i]!;
    if (!endTok.isBangla || coveredTokenIndices.has(i)) continue;
    const isOrgEnd = endTok.variants.some((v) => BN_ORG_SUFFIXES.has(v));
    if (!isOrgEnd) continue;

    const orgToks: TokenSpan[] = [endTok];
    for (let back = 1; back <= 3 && i - back >= 0; back++) {
      if (tokens[i - back + 1]!.precededByClauseBreak) break;
      const pt = tokens[i - back]!;
      if (!pt.isBangla) break;
      if (coveredTokenIndices.has(i - back) && back === 1) break;
      if (BN_NON_NAME_FOLLOWERS.has(pt.norm) || BN_SPEECH_VERB_RE.test(pt.norm)) break;
      orgToks.unshift(pt);
    }
    if (orgToks.length >= 2) {
      const first = orgToks[0]!;
      const last = orgToks[orgToks.length - 1]!;
      pushCandidate(
        sentence.slice(first.startIndex, last.endIndex),
        first.startIndex,
        last.endIndex,
        'bangla_org_suffix',
        'org'
      );
    }
  }

  // 4) English TitleCase multi-token proper noun phrase (2–4 tokens;
  //    allows prepending an immediately preceding TitleCase location prefix like "Bangladesh" / "Dhaka" for org phrases)
  let ei = 0;
  while (ei < tokens.length) {
    const t = tokens[ei]!;
    if (
      t.isBangla ||
      coveredTokenIndices.has(ei) ||
      !/^[A-Z][a-zA-Z.'-]+$/.test(t.raw) ||
      EN_PROPER_STOP_FIRST.has(t.norm)
    ) {
      ei++;
      continue;
    }

    const phrase: TokenSpan[] = [t];
    let ej = ei + 1;
    while (ej < tokens.length && phrase.length < 4) {
      const nt = tokens[ej]!;
      if (nt.precededByClauseBreak || nt.isBangla || coveredTokenIndices.has(ej)) break;
      if (!/^[A-Z][a-zA-Z.'-]+$/.test(nt.raw)) break;
      phrase.push(nt);
      ej++;
    }

    const isOrg = phrase.some((p) => EN_ORG_KEYWORDS.has(p.norm));
    if (
      isOrg &&
      ei > 0 &&
      !t.precededByClauseBreak &&
      !tokens[ei - 1]!.isBangla &&
      /^[A-Z][a-zA-Z.'-]+$/.test(tokens[ei - 1]!.raw) &&
      !EN_PROPER_STOP_FIRST.has(tokens[ei - 1]!.norm)
    ) {
      phrase.unshift(tokens[ei - 1]!);
    }

    if (phrase.length >= 2) {
      const first = phrase[0]!;
      const last = phrase[phrase.length - 1]!;
      pushCandidate(
        sentence.slice(first.startIndex, last.endIndex),
        first.startIndex,
        last.endIndex,
        'english_proper_noun',
        isOrg ? 'org' : 'person'
      );
      ei = ej;
    } else {
      ei++;
    }
  }
}

interface SentenceMatchResult {
  spans: MatchedSpan[];
  tokens: TokenSpan[];
  coveredTokens: Set<number>;
  unlinked: UnlinkedMention[];
}

function matchSentenceInternal(
  sentence: string,
  refDay: string | null,
  isHeadline: boolean,
  sentenceIndex: number,
  compiled: CompiledRegistry,
  suppressBarePmHolder: boolean,
  emitUnlinked: boolean
): SentenceMatchResult {
  const normalized = normalizeText(sentence);
  const tokens = tokenizeWithSpans(normalized, true);
  const coveredTokens = new Set<number>();
  const matched: MatchedSpan[] = [];
  const unlinked: UnlinkedMention[] = [];

  if (tokens.length === 0) {
    return { spans: matched, tokens, coveredTokens, unlinked };
  }

  const colonIdx = normalized.lastIndexOf(':');
  const hasSpeechVerb = BN_SPEECH_VERB_RE.test(normalized) || EN_SPEECH_VERB_RE.test(normalized);
  const snippet = normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;

  let ti = 0;
  while (ti < tokens.length) {
    const best = findBestTrieMatch(tokens, ti, compiled.trieRoot, refDay);

    if (!best) {
      ti++;
      continue;
    }

    const tok = tokens[ti]!;
    const endIdx = ti + best.spanLen - 1;
    const endTok = tokens[endIdx]!;
    const surfaceForm = normalized.slice(tok.startIndex, endTok.endIndex);

    let finalEntity = best.alias.entity;
    let finalEntityId = best.alias.entityId;
    let linkMethod: LinkMethod = best.isExact ? 'name_exact' : 'alias_stem';
    let linkConfidence = best.isExact ? 0.95 : 0.88;
    let viaRoleId: string | undefined;

    // Handle role entities with multi-token guards, apposition lookahead, and temporal role_term resolution
    if (best.alias.entity.entityType === 'role') {
      const guardedByPredecessor = hasRoleGuardPredecessor(
        tokens,
        ti,
        matched,
        compiled.foreignLocationIds
      );

      // Lookahead 1: Is this role immediately followed by a known person entity? ("প্রধানমন্ত্রী শেখ হাসিনা")
      const nextMatch =
        endIdx + 1 < tokens.length && !tokens[endIdx + 1]!.precededByClauseBreak
          ? findBestTrieMatch(tokens, endIdx + 1, compiled.trieRoot, refDay)
          : null;

      if (nextMatch && nextMatch.alias.entity.entityType === 'person') {
        // Bind to the named person directly (consuming both role + person tokens)
        const personEndIdx = endIdx + nextMatch.spanLen;
        const personEndTok = tokens[personEndIdx]!;
        const fullSurface = normalized.slice(tok.startIndex, personEndTok.endIndex);
        let role: EntityRole = isHeadline ? 'subject' : 'mentioned';
        if (
          (isHeadline && colonIdx > 8 && tok.startIndex > colonIdx && normalized.length - colonIdx < 45) ||
          (hasSpeechVerb && isAdjacentToSpeechVerb(normalized, tok.startIndex, personEndTok.endIndex, tok.isBangla))
        ) {
          role = 'quoted_speaker';
        } else if (isHeadline && ti <= 2) {
          role = 'actor';
        }

        matched.push({
          entityId: nextMatch.alias.entityId,
          entity: nextMatch.alias.entity,
          surfaceForm: fullSurface,
          startTokenIdx: ti,
          endTokenIdx: personEndIdx,
          startChar: tok.startIndex,
          endChar: personEndTok.endIndex,
          role,
          linkMethod: nextMatch.isExact ? 'name_exact' : 'alias_stem',
          linkConfidence: nextMatch.isExact ? 0.96 : 0.9,
          viaRoleId: guardedByPredecessor ? undefined : best.alias.entityId,
        });
        for (let k = ti; k <= personEndIdx; k++) coveredTokens.add(k);
        ti = personEndIdx + 1;
        continue;
      }

      // Lookahead 2: Role followed by an unknown proper name in apposition ("Prime Minister Shehbaz Sharif")
      const unknownApp = detectUnknownAppositionName(tokens, endIdx + 1);
      if (unknownApp) {
        if (emitUnlinked) {
          const firstApp = unknownApp.surfaceTokens[0]!;
          const lastApp = unknownApp.surfaceTokens[unknownApp.surfaceTokens.length - 1]!;
          const appSurface = normalized.slice(firstApp.startIndex, lastApp.endIndex);
          unlinked.push({
            surface: appSurface,
            normalized: normalizePhrase(appSurface),
            sentenceIndex,
            startChar: firstApp.startIndex,
            endChar: lastApp.endIndex,
            triggerPattern: 'role_apposition',
            guessedType: 'person',
            contextSnippet: snippet,
          });
        }
        // Do NOT bind bare role to Bangladeshi incumbent when naming an unknown person
        for (let k = ti; k <= unknownApp.endTokenIdx; k++) coveredTokens.add(k);
        ti = unknownApp.endTokenIdx + 1;
        continue;
      }

      // If preceded by former/ousted/foreign modifier -> block temporal holder binding!
      if (guardedByPredecessor) {
        for (let k = ti; k <= endIdx; k++) coveredTokens.add(k);
        ti = endIdx + 1;
        continue;
      }

      // Temporal role_term lookup (e.g. ent_role_prime_minister -> ent_tareque_rahman on 2026-11-17)
      const terms = compiled.roleTermsByRole.get(best.alias.entityId);
      if (terms && terms.length > 0) {
        const activeTerm = terms.find((rt) => isValidForDate(rt.validFrom, rt.validTo, refDay));
        const suppressHolder =
          best.alias.entityId === 'ent_role_prime_minister' && suppressBarePmHolder;

        if (suppressHolder) {
          // Body bare PM mention in an article whose headline is about a former/foreign PM:
          // do not bind to Bangladesh's incumbent or pollute ent_role_prime_minister
          for (let k = ti; k <= endIdx; k++) coveredTokens.add(k);
          ti = endIdx + 1;
          continue;
        }

        if (activeTerm) {
          const holder = compiled.entityMap.get(activeTerm.holderEntityId);
          if (holder) {
            finalEntity = holder;
            finalEntityId = holder.id;
            linkMethod = 'role_dated';
            linkConfidence = isHeadline ? 0.85 : 0.74;
          }
        } else {
          linkMethod = 'role_inferred';
          linkConfidence = 0.5;
        }
      } else {
        linkMethod = 'role_inferred';
        linkConfidence = 0.72;
      }
    }

    let role: EntityRole = isHeadline ? 'subject' : 'mentioned';
    if (finalEntity.entityType === 'location') {
      role = 'location';
    } else if (
      (isHeadline && colonIdx > 8 && tok.startIndex > colonIdx && normalized.length - colonIdx < 45) ||
      (hasSpeechVerb && isAdjacentToSpeechVerb(normalized, tok.startIndex, endTok.endIndex, tok.isBangla))
    ) {
      role = 'quoted_speaker';
    } else if (isHeadline && ti <= 2) {
      role = 'actor';
    }

    matched.push({
      entityId: finalEntityId,
      entity: finalEntity,
      surfaceForm,
      startTokenIdx: ti,
      endTokenIdx: endIdx,
      startChar: tok.startIndex,
      endChar: endTok.endIndex,
      role,
      linkMethod,
      linkConfidence,
      viaRoleId,
    });

    for (let k = ti; k <= endIdx; k++) coveredTokens.add(k);
    ti = endIdx + 1;
  }

  return { spans: matched, tokens, coveredTokens, unlinked };
}

/**
 * Pure, deterministic v2 article entity & relationship resolver.
 */
export function resolveArticle(
  article: ArticleInputForEntities,
  compiled: CompiledRegistry,
  opts: ResolveArticleOptions = {}
): ArticleHypergraphOutput {
  const emitUnlinked = opts.emitUnlinked ?? true;
  const maxBodySentences = opts.maxBodySentences ?? 35;
  const refDay = article.publishedAt ? article.publishedAt.slice(0, 10) : null;

  const sentences: Array<{ text: string; isHeadline: boolean; isLead: boolean }> = [
    { text: article.title, isHeadline: true, isLead: false },
  ];

  if (article.lead) {
    const cleanLead = stripDateline(article.lead);
    for (const s of splitSentences(cleanLead, true)) {
      sentences.push({ text: s, isHeadline: false, isLead: true });
    }
  }

  if (article.cleanText) {
    const cleanBody = stripDateline(article.cleanText);
    for (const s of splitSentences(cleanBody, true).slice(0, maxBodySentences)) {
      sentences.push({ text: s, isHeadline: false, isLead: false });
    }
  }

  // Pass 1a: Resolve headline first to detect former-PM / foreign-leader topic context
  const sentenceResults: SentenceMatchResult[] = [];
  const headlineResult = matchSentenceInternal(
    sentences[0]!.text,
    refDay,
    true,
    0,
    compiled,
    false,
    emitUnlinked
  );
  sentenceResults.push(headlineResult);

  // Determine whether bare body mentions of PM/প্রধানমন্ত্রী should be suppressed from binding to the incumbent PM
  const headlineEntityIds = new Set(headlineResult.spans.map((s) => s.entityId));
  const headlineTextLower = normalizeText(article.title).toLowerCase();
  const headlineMentionsFormerOrForeign =
    Array.from(headlineEntityIds).some(
      (id) => FORMER_PM_ENTITY_IDS.has(id) || FOREIGN_LEADER_ENTITY_IDS.has(id) || compiled.foreignLocationIds.has(id)
    ) ||
    /(?:ইমরান খান|নরেন্দ্র মোদি|imran khan|narendra modi|shehbaz sharif|ইসলামাবাদ|নয়াদিল্লি|দিল্লি|delhi|islamabad)/.test(
      headlineTextLower
    );
  const headlineExplicitlyNamesIncumbentPm =
    headlineResult.spans.some(
      (s) => s.entityId === 'ent_tareque_rahman' || (s.linkMethod === 'role_dated' && s.entityId === 'ent_tareque_rahman')
    );
  const suppressBarePmInBody = headlineMentionsFormerOrForeign && !headlineExplicitlyNamesIncumbentPm;

  // Pass 1b: Resolve lead & body sentences
  for (let si = 1; si < sentences.length; si++) {
    const s = sentences[si]!;
    sentenceResults.push(
      matchSentenceInternal(
        s.text,
        refDay,
        false,
        si,
        compiled,
        suppressBarePmInBody,
        emitUnlinked
      )
    );
  }

  // Pass 2: Article-local unambiguous person name coreference (partial/surname mentions after full name)
  const corefCandidateMap = new Map<string, Set<string>>();
  for (const sr of sentenceResults) {
    for (const sp of sr.spans) {
      if (sp.entity.entityType !== 'person') continue;
      if (sp.linkMethod === 'role_dated' || sp.linkMethod === 'role_inferred') continue;
      const names = [sp.entity.canonicalBn, sp.entity.canonicalEn, sp.surfaceForm].filter(Boolean) as string[];
      for (const name of names) {
        const parts = normalizePhrase(name).split(' ').filter(Boolean);
        if (parts.length < 2) continue;
        // Register last token if distinctive (len >= 4 and not a common surname)
        const last = parts[parts.length - 1]!;
        if (last.length >= 4 && !COMMON_SURNAMES_SKIP_COREF.has(last)) {
          const set = corefCandidateMap.get(last) ?? new Set<string>();
          set.add(sp.entityId);
          corefCandidateMap.set(last, set);
        }
        // Register 2-token prefix for 3+ token names (e.g., "মির্জা ফখরুল ইসলাম আলমগীর" -> "মির্জা ফখরুল")
        if (parts.length >= 3) {
          const twoPrefix = `${parts[0]} ${parts[1]}`;
          const set = corefCandidateMap.get(twoPrefix) ?? new Set<string>();
          set.add(sp.entityId);
          corefCandidateMap.set(twoPrefix, set);
        }
      }
    }
  }

  const unambiguousSingleCoref = new Map<string, Entity>();
  for (const [tokenKey, idSet] of corefCandidateMap) {
    if (idSet.size !== 1 || tokenKey.includes(' ')) continue;
    const onlyId = Array.from(idSet)[0]!;
    const ent = compiled.entityMap.get(onlyId);
    if (ent) unambiguousSingleCoref.set(tokenKey, ent);
  }

  if (unambiguousSingleCoref.size > 0) {
    for (let si = 0; si < sentenceResults.length; si++) {
      const sr = sentenceResults[si]!;
      const sentText = normalizeText(sentences[si]!.text);
      for (let ti = 0; ti < sr.tokens.length; ti++) {
        if (sr.coveredTokens.has(ti)) continue;
        const tok = sr.tokens[ti]!;
        let matchedEnt: Entity | undefined;
        for (const v of tok.variants) {
          const hit = unambiguousSingleCoref.get(v);
          if (hit) {
            matchedEnt = hit;
            break;
          }
        }
        if (!matchedEnt) continue;
        // Require capitalized English token for English coref
        if (!tok.isBangla && !tok.hasUppercase) continue;

        sr.coveredTokens.add(ti);
        sr.spans.push({
          entityId: matchedEnt.id,
          entity: matchedEnt,
          surfaceForm: sentText.slice(tok.startIndex, tok.endIndex),
          startTokenIdx: ti,
          endTokenIdx: ti,
          startChar: tok.startIndex,
          endChar: tok.endIndex,
          role: sentences[si]!.isHeadline ? 'subject' : 'mentioned',
          linkMethod: 'article_coref',
          linkConfidence: 0.78,
        });
      }
    }
  }

  // Pass 3: Aggregate deduplicated mentions per (articleId, entityId), extract relations & unlinked candidates
  const mentionAgg = new Map<
    string,
    {
      entity: Entity;
      surfaceForm: string;
      role: EntityRole;
      mentionCount: number;
      inHeadline: boolean;
      inLead: boolean;
      linkMethod: LinkMethod;
      linkConfidence: number;
    }
  >();

  const relationMap = new Map<string, EntityRelation>();
  const allUnlinked: UnlinkedMention[] = [];

  for (let si = 0; si < sentences.length; si++) {
    const sent = sentences[si]!;
    const sr = sentenceResults[si]!;
    const normalizedSent = normalizeText(sent.text);
    const snippet = normalizedSent.length > 220 ? `${normalizedSent.slice(0, 217)}...` : normalizedSent;

    for (const u of sr.unlinked) allUnlinked.push(u);
    if (emitUnlinked) {
      extractUnlinkedMentions(
        normalizedSent,
        sr.tokens,
        sr.coveredTokens,
        si,
        sent.isHeadline,
        allUnlinked
      );
    }

    if (sr.spans.length === 0) continue;

    // Sort spans by position so adjacency checks work properly
    sr.spans.sort((a, b) => a.startTokenIdx - b.startTokenIdx);

    const uniqueInSentence: MatchedSpan[] = [];
    const seenInSentence = new Set<string>();

    for (const sp of sr.spans) {
      const existing = mentionAgg.get(sp.entityId);
      if (!existing) {
        mentionAgg.set(sp.entityId, {
          entity: sp.entity,
          surfaceForm: sp.surfaceForm,
          role: sp.role,
          mentionCount: 1,
          inHeadline: sent.isHeadline,
          inLead: sent.isLead,
          linkMethod: sp.linkMethod,
          linkConfidence: sp.linkConfidence,
        });
      } else {
        existing.mentionCount++;
        if (sent.isHeadline) existing.inHeadline = true;
        if (sent.isLead) existing.inLead = true;
        if (ROLE_PRIORITY[sp.role] > ROLE_PRIORITY[existing.role]) {
          existing.role = sp.role;
        }
        if (
          LINK_METHOD_PRIORITY[sp.linkMethod] > LINK_METHOD_PRIORITY[existing.linkMethod] ||
          (sp.linkMethod === existing.linkMethod && sp.linkConfidence > existing.linkConfidence)
        ) {
          existing.linkMethod = sp.linkMethod;
          existing.linkConfidence = sp.linkConfidence;
          existing.surfaceForm = sp.surfaceForm;
        }
      }

      // Emit direct `holds_role` relation when a person was matched via `<Role> <Person>` apposition
      if (sp.viaRoleId && compiled.entityMap.has(sp.viaRoleId)) {
        const relKey = `${sp.entityId}|${sp.viaRoleId}|holds_role`;
        if (!relationMap.has(relKey)) {
          relationMap.set(relKey, {
            id: stableEdgeId([article.id, relKey]),
            articleId: article.id,
            sourceEntityId: sp.entityId,
            targetEntityId: sp.viaRoleId,
            relationType: 'holds_role',
            predicateLabel: 'holds role',
            source: 'deterministic',
            evidenceSnippet: snippet,
            publishedAt: article.publishedAt ?? null,
            confidence: 0.9,
          });
        }
      }

      if (!seenInSentence.has(sp.entityId)) {
        seenInSentence.add(sp.entityId);
        uniqueInSentence.push(sp);
      }
    }

    // Check adjacent `<Org> <title?> <Person>` appositions for `affiliated_with`
    for (let k = 0; k < sr.spans.length - 1; k++) {
      const left = sr.spans[k]!;
      const right = sr.spans[k + 1]!;
      if (left.entityId === right.entityId) continue;
      const gapTokens = right.startTokenIdx - left.endTokenIdx - 1;
      if (gapTokens >= 0 && gapTokens <= 2 && left.entity.entityType === 'org' && right.entity.entityType === 'person') {
        let hasBreak = false;
        let hasTitle = false;
        for (let t = left.endTokenIdx + 1; t <= right.startTokenIdx; t++) {
          if (sr.tokens[t]!.precededByClauseBreak) hasBreak = true;
          if (t < right.startTokenIdx) {
            if (sr.tokens[t]!.variants.some((v) => BN_PERSON_TITLE_TRIGGERS.has(v)) || /^(?:chairman|president|secretary|chief|leader|spokesperson|director|head|member|mp)$/i.test(sr.tokens[t]!.norm)) {
              hasTitle = true;
            }
          }
        }
        if (!hasBreak && hasTitle) {
          const titleText = normalizedSent.slice(
            sr.tokens[left.endTokenIdx + 1]!.startIndex,
            sr.tokens[right.startTokenIdx - 1]!.endIndex
          );
          const relKey = `${right.entityId}|${left.entityId}|affiliated_with`;
          if (!relationMap.has(relKey)) {
            relationMap.set(relKey, {
              id: stableEdgeId([article.id, relKey]),
              articleId: article.id,
              sourceEntityId: right.entityId,
              targetEntityId: left.entityId,
              relationType: 'affiliated_with',
              predicateLabel: titleText.slice(0, 60) || 'affiliated with',
              source: 'deterministic',
              evidenceSnippet: snippet,
              publishedAt: article.publishedAt ?? null,
              confidence: 0.88,
            });
          }
        }
      }
    }

    if (uniqueInSentence.length < 2) continue;
    const pairEntities = uniqueInSentence.slice(0, 5);

    for (let i = 0; i < pairEntities.length; i++) {
      for (let j = i + 1; j < pairEntities.length; j++) {
        const a = pairEntities[i]!;
        const b = pairEntities[j]!;
        // Skip pairs where both entities are background hub locations
        if (a.entity.isHub && b.entity.isHub && a.entity.entityType === 'location' && b.entity.entityType === 'location') {
          continue;
        }

        const classified = classifyClauseRelation(normalizedSent, a, b);
        if (!classified) continue;

        let src = a;
        let tgt = b;
        if (classified.flipDirection) {
          src = b;
          tgt = a;
        }

        const relKey = `${src.entityId}|${tgt.entityId}|${classified.type}`;
        if (!relationMap.has(relKey)) {
          relationMap.set(relKey, {
            id: stableEdgeId([article.id, relKey]),
            articleId: article.id,
            sourceEntityId: src.entityId,
            targetEntityId: tgt.entityId,
            relationType: classified.type,
            predicateLabel: classified.label,
            source: 'deterministic',
            evidenceSnippet: snippet,
            publishedAt: article.publishedAt ?? null,
            confidence: sent.isHeadline ? 0.9 : 0.78,
          });
        }
      }
    }
  }

  const mentions: ArticleEntityMention[] = [];
  for (const [entityId, agg] of mentionAgg) {
    const roleBoost =
      agg.role === 'quoted_speaker' || agg.role === 'actor'
        ? 0.25
        : agg.role === 'subject'
          ? 0.2
          : 0.05;
    const salience = Math.min(
      1.0,
      Number(
        (
          (agg.inHeadline ? 0.45 : 0) +
          (agg.inLead ? 0.15 : 0) +
          roleBoost +
          Math.min(0.15, Math.log2(1 + agg.mentionCount) * 0.06)
        ).toFixed(3)
      )
    );

    mentions.push({
      articleId: article.id,
      entityId,
      chunkId: null,
      surfaceForm: agg.surfaceForm,
      role: agg.role,
      mentionCount: agg.mentionCount,
      inHeadline: agg.inHeadline,
      linkMethod: agg.linkMethod,
      linkConfidence: agg.linkConfidence,
      salience,
      confidence: agg.linkConfidence,
    });
  }

  return {
    mentions,
    relations: Array.from(relationMap.values()),
    unlinked: allUnlinked,
    resolverVersion: RESOLVER_VERSION,
  };
}

/**
 * Class wrapper around pure `compileRegistry()` + `resolveArticle()` for convenient stateful usage.
 */
export class EntityHypergraphResolver {
  public readonly compiled: CompiledRegistry;

  constructor(entities: Entity[], aliases: EntityAlias[], roleTerms: RoleTerm[] = [], version = 1) {
    this.compiled = compileRegistry({ version, entities, aliases, roleTerms });
  }

  resolveArticle(article: ArticleInputForEntities, opts?: ResolveArticleOptions): ArticleHypergraphOutput {
    return resolveArticle(article, this.compiled, opts);
  }
}
