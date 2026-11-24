#!/usr/bin/env bun
/**
 * @file tools/eval/entities/eval_baseline.ts
 * Deterministic baseline runner that runs @jachaikori/entities EntityHypergraphResolver
 * on tools/eval/entities/eval_128.jsonl and outputs baseline metrics to
 * tools/eval/entities/baseline_report.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildSeedRegistry, EntityHypergraphResolver } from '../../../packages/entities/src';
import type { EvalArticleRecord } from './sample';

interface FlaggedPmFp {
  articleId: string;
  outlet: string;
  stratum: string;
  title: string;
  surfaceForm: string;
  entityId: string;
  canonicalEn: string | null;
}

const PM_SURFACE_RE = /^(?:pm|prime\s+minister|প্রধানমন্ত্রী|প্রধানমন্ত্রীর|প্রধানমন্ত্রীকে)$/i;
const EDGE_CONTEXT_RE =
  /সাবেক প্রধানমন্ত্রী|ক্ষমতাচ্যুত প্রধানমন্ত্রী|former prime minister|ex-pm|ভারতের প্রধানমন্ত্রী|পাকিস্তানের প্রধানমন্ত্রী|ব্রিটিশ প্রধানমন্ত্রী|চীনের প্রধানমন্ত্রী|প্রধানমন্ত্রী মোদি|narendra modi/i;

function main(): void {
  const dir = dirname(import.meta.path);
  const manifestPath = resolve(dir, 'eval_128.jsonl');
  const outPath = resolve(dir, 'baseline_report.json');

  const lines = readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const articles: EvalArticleRecord[] = lines.map((l) => JSON.parse(l) as EvalArticleRecord);

  const seed = buildSeedRegistry();
  const entityById = new Map(seed.entities.map((e) => [e.id, e]));
  const resolver = new EntityHypergraphResolver(seed.entities, seed.aliases, seed.roleTerms);

  let linkedArticles = 0;
  let totalMentions = 0;
  let totalRelations = 0;
  const roleDistribution: Record<string, number> = {};
  const entityStats = new Map<string, { mentions: number; articleIds: Set<string> }>();
  const flaggedPmFps: FlaggedPmFp[] = [];

  for (const art of articles) {
    const out = resolver.resolveArticle({
      id: art.id,
      title: art.title,
      lead: art.lead,
      cleanText: art.clean_text,
      publishedAt: art.published_at,
    });

    if (out.mentions.length > 0) {
      linkedArticles++;
    }
    totalMentions += out.mentions.length;
    totalRelations += out.relations.length;

    const fullText = `${art.title} ${art.lead ?? ''} ${art.clean_text ?? ''}`;
    const hasEdgeContext = art.stratum === 'edge_pm' || EDGE_CONTEXT_RE.test(fullText);

    for (const m of out.mentions) {
      roleDistribution[m.role] = (roleDistribution[m.role] ?? 0) + 1;

      let stat = entityStats.get(m.entityId);
      if (!stat) {
        stat = { mentions: 0, articleIds: new Set() };
        entityStats.set(m.entityId, stat);
      }
      stat.mentions++;
      stat.articleIds.add(art.id);

      if (hasEdgeContext && PM_SURFACE_RE.test(m.surfaceForm.trim())) {
        const ent = entityById.get(m.entityId);
        flaggedPmFps.push({
          articleId: art.id,
          outlet: art.outlet,
          stratum: art.stratum,
          title: art.title,
          surfaceForm: m.surfaceForm,
          entityId: m.entityId,
          canonicalEn: ent?.canonicalEn ?? null,
        });
      }
    }
  }

  const topEntities = Array.from(entityStats.entries())
    .map(([entityId, stat]) => {
      const ent = entityById.get(entityId);
      return {
        entityId,
        canonicalBn: ent?.canonicalBn ?? null,
        canonicalEn: ent?.canonicalEn ?? null,
        entityType: ent?.entityType ?? 'unknown',
        mentions: stat.mentions,
        articles: stat.articleIds.size,
      };
    })
    .sort((a, b) => b.mentions - a.mentions || a.entityId.localeCompare(b.entityId))
    .slice(0, 20);

  const report = {
    totalArticles: articles.length,
    linkedArticles,
    totalMentions,
    totalRelations,
    roleDistribution,
    topEntities,
    flaggedPmFpCount: flaggedPmFps.length,
    flaggedPmFps,
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`Baseline report written to ${outPath}`);
  console.log(
    `Articles: ${report.totalArticles} | Linked: ${report.linkedArticles} | Mentions: ${report.totalMentions} | Relations: ${report.totalRelations} | Flagged PM FPs: ${report.flaggedPmFpCount}`
  );
  console.log('Roles:', JSON.stringify(report.roleDistribution));
}

main();
