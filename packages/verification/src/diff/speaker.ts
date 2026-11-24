/**
 * @file packages/verification/src/diff/speaker.ts
 * Deterministic quote-speaker & temporal `role_term` office cross-checker powered by
 * Sprint 5's compiled Entity Resolution v2 registry.
 */

import { resolveArticle, type CompiledRegistry } from '@jachaikori/entities';
import type {
  CardExtraction,
  ClaimDiffItem,
  StoredArticleClaim,
} from '@jachaikori/schema';

function displayEntityName(compiled: CompiledRegistry, entityId: string): { en: string; bn: string } {
  const ent = compiled.entityMap.get(entityId);
  return {
    en: ent?.canonicalEn || ent?.canonicalBn || entityId,
    bn: ent?.canonicalBn || ent?.canonicalEn || entityId,
  };
}

/**
 * Resolves a quoted speaker string to canonical entity ID(s) using Sprint 5's temporal resolver.
 */
function resolveSpeakerEntityIds(
  speakerText: string | null | undefined,
  compiled: CompiledRegistry,
  referenceDateIso: string
): string[] {
  if (!speakerText || !speakerText.trim()) return [];
  const res = resolveArticle(
    {
      id: '_speaker_probe',
      title: speakerText,
      publishedAt: referenceDateIso,
    },
    compiled,
    { emitUnlinked: false, maxBodySentences: 0 }
  );
  return res.mentions
    .filter((m) => {
      const ent = compiled.entityMap.get(m.entityId);
      return ent && !ent.isHub && (ent.entityType === 'person' || ent.entityType === 'org');
    })
    .map((m) => m.entityId);
}

/**
 * Checks:
 * 1. Quote speaker attribution mismatch (`mismatch_speaker`) when the card attributes a quote
 *    to Person/Org A while the accredited article's extracted claims attribute it to Person/Org B.
 * 2. Outdated office attribution via Sprint 5's `role_term` windows (e.g. a 2026 card naming a
 *    former Prime Minister as incumbent "প্রধানমন্ত্রী" without "সাবেক"/"former").
 */
export function compareSpeakerAndRoles(params: {
  extraction: CardExtraction;
  articleClaims: StoredArticleClaim[];
  articleTitle: string;
  articleSnippet: string;
  articlePublishedAt: string | null;
  compiled: CompiledRegistry;
  referenceDateIso: string;
}): ClaimDiffItem[] {
  const diffs: ClaimDiffItem[] = [];
  const { extraction, articleClaims, compiled, referenceDateIso } = params;

  // 1. Speaker attribution comparison
  if (extraction.quotedSpeaker) {
    const cardSpeakers = resolveSpeakerEntityIds(extraction.quotedSpeaker, compiled, referenceDateIso);
    const articleSpeakerIds = new Set<string>();

    for (const c of articleClaims) {
      if (c.speakerEntityId) articleSpeakerIds.add(c.speakerEntityId);
      else if (c.speakerName) {
        for (const id of resolveSpeakerEntityIds(c.speakerName, compiled, params.articlePublishedAt ?? referenceDateIso)) {
          articleSpeakerIds.add(id);
        }
      }
    }

    // Fallback: also inspect quoted speakers from the article title/snippet if no claim rows carried speakerEntityId
    if (articleSpeakerIds.size === 0) {
      const artResolved = resolveArticle(
        {
          id: '_art_speaker_probe',
          title: params.articleTitle,
          lead: params.articleSnippet,
          publishedAt: params.articlePublishedAt ?? referenceDateIso,
        },
        compiled,
        { emitUnlinked: false, maxBodySentences: 6 }
      );
      for (const m of artResolved.mentions) {
        if (m.role === 'quoted_speaker') {
          articleSpeakerIds.add(m.entityId);
        }
      }
    }

    if (cardSpeakers.length > 0 && articleSpeakerIds.size > 0) {
      const matchedId = cardSpeakers.find((id) => articleSpeakerIds.has(id));
      if (matchedId) {
        const name = displayEntityName(compiled, matchedId);
        diffs.push({
          flag: 'match',
          severity: 'info',
          deterministic: true,
          cardSpan: extraction.quotedSpeaker,
          articleSpan: name.en,
          explanationEn: `Attributed speaker matches accredited reporting (${name.en}).`,
          explanationBn: `উদ্ধৃতির বক্তা মূলধারার প্রতিবেদনের সঙ্গে মিলেছে (${name.bn})।`,
          confidence: 0.95,
        });
      } else {
        const cardName = displayEntityName(compiled, cardSpeakers[0]!);
        const artNamesEn = Array.from(articleSpeakerIds)
          .slice(0, 2)
          .map((id) => displayEntityName(compiled, id).en)
          .join(', ');
        const artNamesBn = Array.from(articleSpeakerIds)
          .slice(0, 2)
          .map((id) => displayEntityName(compiled, id).bn)
          .join(', ');

        diffs.push({
          flag: 'mismatch_speaker',
          severity: 'major',
          deterministic: true,
          cardSpan: extraction.quotedSpeaker,
          articleSpan: artNamesEn,
          explanationEn: `Card attributes this statement to ${cardName.en}, whereas the matched accredited article attributes quotes to ${artNamesEn}.`,
          explanationBn: `কার্ডে বক্তব্যটি ${cardName.bn}-এর নামে উল্লেখ করা হয়েছে, তবে মূলধারার প্রতিবেদনে বক্তা হিসেবে ${artNamesBn}-এর নাম রয়েছে।`,
          confidence: 0.93,
        });
      }
    }
  }

  // 2. Office-tenure cross-check against `role_term` windows
  const refDay = referenceDateIso.slice(0, 10);
  const fullCardText = [extraction.headline, extraction.quotedSpeaker, extraction.ocrText]
    .filter(Boolean)
    .join(' ');
  const hasFormerMarker = /(?:সাবেক|প্রাক্তন|ক্ষমতাচ্যুত|former|ex-|ousted)/i.test(fullCardText);

  if (!hasFormerMarker && fullCardText.trim()) {
    const rolePatterns: Array<{ roleEntityId: string; re: RegExp; labelEn: string; labelBn: string }> = [
      {
        roleEntityId: 'ent_role_prime_minister',
        re: /(?:প্রধানমন্ত্রী|prime\s+minister)/i,
        labelEn: 'Prime Minister',
        labelBn: 'প্রধানমন্ত্রী',
      },
      {
        roleEntityId: 'ent_role_chief_adviser',
        re: /(?:প্রধান\s+উপদেষ্টা|chief\s+adviser|chief\s+advisor)/i,
        labelEn: 'Chief Adviser',
        labelBn: 'প্রধান উপদেষ্টা',
      },
    ];

    const cardPeople = resolveSpeakerEntityIds(fullCardText, compiled, referenceDateIso);
    for (const rp of rolePatterns) {
      if (!rp.re.test(fullCardText)) continue;
      const terms = compiled.roleTermsByRole.get(rp.roleEntityId) ?? [];
      if (terms.length === 0) continue;

      for (const personId of cardPeople) {
        const personTerms = terms.filter((t) => t.holderEntityId === personId);
        if (personTerms.length === 0) continue;
        const activeNow = personTerms.some(
          (t) => refDay >= t.validFrom.slice(0, 10) && (!t.validTo || refDay <= t.validTo.slice(0, 10))
        );
        if (!activeNow) {
          const latestTerm = personTerms[0]!;
          const personName = displayEntityName(compiled, personId);
          diffs.push({
            flag: 'missing_context',
            severity: 'notable',
            deterministic: true,
            cardSpan: `${rp.labelEn} ${personName.en}`,
            articleSpan: `${latestTerm.validFrom}..${latestTerm.validTo ?? 'present'}`,
            explanationEn: `Card refers to ${personName.en} with the title "${rp.labelEn}" without a "former" qualifier; office records show their term was ${latestTerm.validFrom} to ${latestTerm.validTo ?? 'present'}.`,
            explanationBn: `কার্ডে ${personName.bn}-কে "${rp.labelBn}" হিসেবে উল্লেখ করা হয়েছে; রেকর্ড অনুযায়ী তাঁর মেয়াদকাল ছিল ${latestTerm.validFrom} থেকে ${latestTerm.validTo ?? 'বর্তমান'}।`,
            confidence: 0.9,
          });
        }
      }
    }
  }

  return diffs;
}
