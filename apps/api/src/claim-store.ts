/**
 * @file apps/api/src/claim-store.ts
 * D1 / SQLite adapter for Sprint 5/7 `claim` table:
 * - Bulk-reads cached Stage B / on-demand structured claims for article IDs
 * - Reads full article body text for on-demand claim extraction fallback
 * - Persists on-demand extracted claims (`extractor_version = 'v2-ondemand'`)
 */

import type { StoredArticleClaim } from '@jachaikori/schema';
import type { ArticleClaimStore } from '@jachaikori/verification';

interface RawClaimRow {
  id: string;
  articleId: string;
  claimText: string;
  claimType: string | null;
  speakerEntityId: string | null;
  speakerName: string | null;
  subjectEntityId: string | null;
  subjectName: string | null;
  objectEntityId: string | null;
  objectName: string | null;
  numbersJson: string | null;
  datesJson: string | null;
  hedgingLevel: string | null;
  evidenceSnippet: string | null;
  confidence: number | null;
  extractorVersion: string | null;
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function hydrateClaimRow(r: RawClaimRow): StoredArticleClaim {
  const hl = r.hedgingLevel ?? 'reported';
  const hedgingLevel: StoredArticleClaim['hedgingLevel'] =
    hl === 'certain' || hl === 'reported' || hl === 'hedged' || hl === 'conditional'
      ? hl
      : 'reported';

  return {
    id: r.id,
    articleId: r.articleId,
    claimText: r.claimText,
    claimType: r.claimType ?? 'factual',
    speakerEntityId: r.speakerEntityId ?? null,
    speakerName: r.speakerName ?? null,
    subjectEntityId: r.subjectEntityId ?? null,
    subjectName: r.subjectName ?? null,
    objectEntityId: r.objectEntityId ?? null,
    objectName: r.objectName ?? null,
    numbers: parseJsonStringArray(r.numbersJson),
    dates: parseJsonStringArray(r.datesJson),
    hedgingLevel,
    evidenceSnippet: r.evidenceSnippet ?? null,
    confidence: Number(r.confidence ?? 0.85),
    extractorVersion: r.extractorVersion ?? 'v2',
  };
}

export class D1ArticleClaimStore implements ArticleClaimStore {
  constructor(private readonly db: D1Database) {}

  async getByArticleIds(articleIds: string[]): Promise<Map<string, StoredArticleClaim[]>> {
    const out = new Map<string, StoredArticleClaim[]>();
    if (articleIds.length === 0) return out;

    const unique = Array.from(new Set(articleIds));
    for (let i = 0; i < unique.length; i += 60) {
      const chunk = unique.slice(i, i + 60);
      const ph = chunk.map(() => '?').join(',');
      try {
        const res = await this.db
          .prepare(
            `SELECT c.id,
                    c.article_id as articleId,
                    c.claim_text as claimText,
                    c.claim_type as claimType,
                    c.speaker_entity_id as speakerEntityId,
                    COALESCE(sp.canonical_en, sp.canonical_bn) as speakerName,
                    c.subject_entity_id as subjectEntityId,
                    COALESCE(sb.canonical_en, sb.canonical_bn) as subjectName,
                    c.object_entity_id as objectEntityId,
                    COALESCE(ob.canonical_en, ob.canonical_bn) as objectName,
                    c.numbers_json as numbersJson,
                    c.dates_json as datesJson,
                    c.hedging_level as hedgingLevel,
                    c.evidence_snippet as evidenceSnippet,
                    c.confidence,
                    c.extractor_version as extractorVersion
             FROM claim c
             LEFT JOIN entity sp ON sp.id = c.speaker_entity_id
             LEFT JOIN entity sb ON sb.id = c.subject_entity_id
             LEFT JOIN entity ob ON ob.id = c.object_entity_id
             WHERE c.article_id IN (${ph})`
          )
          .bind(...chunk)
          .all<RawClaimRow>();

        for (const r of res.results ?? []) {
          const list = out.get(r.articleId) ?? [];
          list.push(hydrateClaimRow(r));
          out.set(r.articleId, list);
        }
      } catch {
        // Fallback for pre-0004 schemas lacking speaker_entity_id/numbers_json columns
        try {
          const res = await this.db
            .prepare(
              `SELECT id, article_id as articleId, claim_text as claimText, claim_type as claimType,
                      subject_entity_id as subjectEntityId, object_entity_id as objectEntityId,
                      evidence_snippet as evidenceSnippet, confidence
               FROM claim WHERE article_id IN (${ph})`
            )
            .bind(...chunk)
            .all<any>();
          for (const r of res.results ?? []) {
            const list = out.get(r.articleId) ?? [];
            list.push(
              hydrateClaimRow({
                ...r,
                speakerEntityId: null,
                speakerName: null,
                subjectName: null,
                objectName: null,
                numbersJson: null,
                datesJson: null,
                hedgingLevel: 'reported',
                extractorVersion: 'v1',
              })
            );
            out.set(r.articleId, list);
          }
        } catch {
          // Table absent -> return empty
        }
      }
    }

    return out;
  }

  async getArticleBodies(articleIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (articleIds.length === 0) return out;
    const unique = Array.from(new Set(articleIds)).slice(0, 40);
    const ph = unique.map(() => '?').join(',');
    try {
      const res = await this.db
        .prepare(`SELECT id, COALESCE(clean_text, lead, title) as body FROM article WHERE id IN (${ph})`)
        .bind(...unique)
        .all<{ id: string; body: string }>();
      for (const r of res.results ?? []) {
        if (r.body) out.set(r.id, r.body);
      }
    } catch {
      // Non-fatal
    }
    return out;
  }

  async saveArticleClaims(claims: StoredArticleClaim[]): Promise<void> {
    if (claims.length === 0) return;
    for (const c of claims) {
      try {
        await this.db
          .prepare(
            `INSERT OR IGNORE INTO claim (
               id, article_id, claim_text, claim_type,
               speaker_entity_id, subject_entity_id, object_entity_id,
               numbers_json, dates_json, hedging_level,
               evidence_snippet, confidence, extractor_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            c.id,
            c.articleId,
            c.claimText,
            c.claimType,
            c.speakerEntityId,
            c.subjectEntityId,
            c.objectEntityId,
            c.numbers.length > 0 ? JSON.stringify(c.numbers) : null,
            c.dates.length > 0 ? JSON.stringify(c.dates) : null,
            c.hedgingLevel,
            c.evidenceSnippet,
            c.confidence,
            c.extractorVersion
          )
          .run();
      } catch {
        // Non-fatal cache write
      }
    }
  }
}
