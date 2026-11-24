import { describe, expect, test } from 'bun:test';
import { buildSeedRegistry, compileRegistry } from '@jachaikori/entities';
import { AliasDictionaryExpander } from '@jachaikori/retrieval';
import {
  buildVerificationQueries,
  computePerceptualHash,
  createVerificationProviders,
  detectImageMime,
  dHashFromGrayscaleGrid,
  GeminiFlashAdapter,
  hammingDistanceHex64,
  HeuristicVerificationAdapter,
  InMemoryVlmCache,
  MAX_IMAGE_BYTES,
  normalizePublisherLogo,
  runVerificationPipeline,
  validateImageBytes,
  WorkersAiAdapter,
  type VerificationCheckStore,
  type VerificationRetriever,
} from '../src/index';
import type { VerificationCheck } from '@jachaikori/schema';

// Helper to build a valid minimal uncompressed PNG (colorType=2 RGB) with custom pixels
async function buildTestPng(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number]
): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 3);
    raw[rowOff] = 0; // None filter
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[rowOff + 1 + x * 3] = r;
      raw[rowOff + 1 + x * 3 + 1] = g;
      raw[rowOff + 1 + x * 3 + 2] = b;
    }
  }

  // Compress with Web Standard CompressionStream('deflate') (zlib)
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writeP = writer.write(raw).then(() => writer.close());
  const reader = cs.readable.getReader();
  const zChunks: Uint8Array[] = [];
  let zLen = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      zChunks.push(value);
      zLen += value.byteLength;
    }
  }
  await writeP;
  const idatData = new Uint8Array(zLen);
  let pos = 0;
  for (const c of zChunks) {
    idatData.set(c, pos);
    pos += c.byteLength;
  }

  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    // CRC32 isn't checked by our lightweight reader; write 0
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrDv = new DataView(ihdr.buffer);
  ihdrDv.setUint32(0, width, false);
  ihdrDv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const c1 = makeChunk('IHDR', ihdr);
  const c2 = makeChunk('IDAT', idatData);
  const c3 = makeChunk('IEND', new Uint8Array(0));
  const full = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  full.set(sig, 0);
  full.set(c1, sig.length);
  full.set(c2, sig.length + c1.length);
  full.set(c3, sig.length + c1.length + c2.length);
  return full;
}

describe('Image Validation & Perceptual dHash', () => {
  test('validates magic bytes and rejects unsupported or oversized payloads', async () => {
    const png = await buildTestPng(18, 16, (x, y) => [x * 12, y * 14, 100]);
    expect(detectImageMime(png)).toBe('image/png');
    expect(validateImageBytes(png).ext).toBe('png');

    expect(() => validateImageBytes(new Uint8Array(10))).toThrow(/too small/i);
    expect(() => validateImageBytes(new TextEncoder().encode('not an image at all, just plain text payload!'))).toThrow(
      /unsupported image/i
    );
    const fakeHuge = new Uint8Array(MAX_IMAGE_BYTES + 64);
    fakeHuge[0] = 0xff;
    fakeHuge[1] = 0xd8;
    fakeHuge[2] = 0xff;
    expect(() => validateImageBytes(fakeHuge)).toThrow(/exceeds maximum/i);
  });

  test('dHash produces low Hamming distance for slightly perturbed PNGs and high distance for distinct images', async () => {
    const imgA = await buildTestPng(36, 32, (x, y) => {
      const v = Math.min(255, Math.floor(x * 6 + y * 2));
      return [v, v, v];
    });
    // Slightly brighten / perturb pixels (simulating JPEG recompression / slight tone tweak)
    const imgA2 = await buildTestPng(36, 32, (x, y) => {
      const v = Math.min(255, Math.floor(x * 6 + y * 2) + ((x + y) % 3));
      return [v, v, v];
    });
    // Completely inverted horizontal gradient (different image)
    const imgB = await buildTestPng(36, 32, (x, y) => {
      const v = Math.max(0, 255 - Math.floor(x * 6 + y * 2));
      return [v, v, v];
    });

    const hA = await computePerceptualHash(imgA, 'image/png');
    const hA2 = await computePerceptualHash(imgA2, 'image/png');
    const hB = await computePerceptualHash(imgB, 'image/png');

    expect(hA.method).toBe('dhash_png');
    expect(hA.hash).toHaveLength(16);
    expect(hammingDistanceHex64(hA.hash, hA2.hash)).toBeLessThanOrEqual(4);
    expect(hammingDistanceHex64(hA.hash, hB.hash)).toBeGreaterThanOrEqual(40);

    // Direct grid helper check
    const g = dHashFromGrayscaleGrid({ width: 9, height: 8, luma: new Float32Array(72).map((_, i) => i % 9) });
    expect(g).toBe('ffffffffffffffff');
  });
});

describe('Publisher Logo & Entity-Aware Query Builder', () => {
  test('normalizes Bangla and English publisher logos to OutletId', () => {
    expect(normalizePublisherLogo('প্রথম আলো')).toBe('prothom-alo');
    expect(normalizePublisherLogo('The Daily Star')).toBe('daily-star');
    expect(normalizePublisherLogo('TBS News')).toBe('business-standard');
    expect(normalizePublisherLogo('দৈনিক ইত্তেফাক')).toBe('ittefaq');
    expect(normalizePublisherLogo('Random Facebook Page')).toBeNull();
  });

  test('resolves temporal PM role_term and expands cross-lingual Bangla/English queries', () => {
    const seed = buildSeedRegistry();
    const compiled = compileRegistry({
      version: 1,
      entities: seed.entities,
      aliases: seed.aliases,
      roleTerms: seed.roleTerms,
    });
    const expander = new AliasDictionaryExpander(seed.aliases, seed.roleTerms);

    const plan = buildVerificationQueries(
      {
        inputKind: 'photo_card',
        language: 'bn',
        headline: 'প্রধানমন্ত্রী ৩ কোটি টাকার অনুদান দিয়েছেন',
        ocrText: 'প্রধানমন্ত্রী ৩ কোটি টাকার অনুদান দিয়েছেন — প্রথম আলো',
        quotedSpeaker: 'প্রধানমন্ত্রী',
        attributedStatement: 'প্রধানমন্ত্রী ৩ কোটি টাকার অনুদান দিয়েছেন',
        isQuote: false,
        claimedNumbers: ['৩ কোটি টাকা'],
        claimedDates: ['2026-11-18'],
        claimedEntities: ['প্রধানমন্ত্রী'],
        publisherLogo: 'প্রথম আলো',
        publisherLogoOutletId: 'prothom-alo',
        hasVerifiableClaim: true,
        confidence: 0.94,
      },
      compiled,
      expander
    );

    expect(plan.resolvedEntities.some((e) => e.entityId === 'ent_tareque_rahman')).toBe(true);
    expect(plan.ftsQueries.length).toBeGreaterThan(0);
    expect(plan.queryTerms.some((t) => t === 'Tarique Rahman' || t === 'তারেক রহমান')).toBe(true);
    expect(plan.semanticQuery).toContain('Tarique Rahman');
  });
});

describe('Dual-Provider VLM & Reranker Adapters + Failover', () => {
  test('GeminiFlashAdapter calls Vertex AI REST and parses structured extraction & rerank', async () => {
    let seenUrl = '';
    const mockFetch: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      const bodyStr = String(init?.body ?? '');
      const isRerank = bodyStr.includes('CANDIDATES:');
      const responsePayload = isRerank
        ? {
            rankings: [
              { articleId: 'art_1', relevanceScore: 0.91, matchSummary: 'Direct coverage of the directive.' },
            ],
          }
        : {
            inputKind: 'photo_card',
            language: 'bn',
            headline: 'বাংলাদেশ ব্যাংক বৈদেশিক ঋণ নীতিমালা শিথিল করেছে',
            ocrText: 'বাংলাদেশ ব্যাংক বৈদেশিক ঋণ নীতিমালা শিথিল করেছে — প্রথম আলো',
            quotedSpeaker: null,
            attributedStatement: 'বাংলাদেশ ব্যাংক বৈদেশিক ঋণ নীতিমালা শিথিল করেছে',
            isQuote: false,
            claimedNumbers: [],
            claimedDates: [],
            claimedEntities: ['বাংলাদেশ ব্যাংক'],
            publisherLogo: 'প্রথম আলো',
            hasVerifiableClaim: true,
            confidence: 0.95,
          };

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responsePayload) }] } }],
          usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 120 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const adapter = new GeminiFlashAdapter({
      vertexProjectId: 'ugstar',
      vertexLocation: 'global',
      vertexAccessToken: 'tok_test',
      model: 'gemini-3.5-flash',
      fetchImpl: mockFetch,
    });

    const png = await buildTestPng(18, 16, (x, y) => [x * 10, y * 10, 50]);
    const ext = await adapter.extractFromImage(png, 'image/png');
    expect(seenUrl).toContain('https://aiplatform.googleapis.com/v1/projects/ugstar/locations/global');
    expect(ext.extraction.publisherLogoOutletId).toBe('prothom-alo');
    expect(ext.usage.costUsd).toBeGreaterThan(0);

    const rr = await adapter.rerank(ext.extraction, [
      {
        articleId: 'art_1',
        outlet: 'prothom-alo',
        title: 'BB eases foreign borrowing rules',
        canonicalUrl: 'https://example.com/1',
        publishedAt: '2026-11-18T10:00:00Z',
        snippet: 'Bangladesh Bank relaxed foreign borrowing rules.',
        rrfScore: 0.03,
      },
    ]);
    expect(rr.scores[0]?.relevanceScore).toBe(0.91);
  });

  test('WorkersAiAdapter uses env.AI binding, strips markdown fences, and runs BGE cross-encoder reranker', async () => {
    const calls: string[] = [];
    const adapter = new WorkersAiAdapter({
      aiBinding: {
        async run(model, _input) {
          calls.push(model);
          if (model.includes('bge-reranker')) {
            return { response: [{ id: 0, score: 0.87 }] };
          }
          return {
            response:
              '```json\n{"inputKind":"photo_card","language":"en","headline":"IMF approves $4.7B loan","ocrText":"IMF approves $4.7B loan","quotedSpeaker":null,"attributedStatement":"IMF approves $4.7B loan","isQuote":false,"claimedNumbers":["$4.7B"],"claimedDates":[],"claimedEntities":["IMF"],"publisherLogo":"The Daily Star","hasVerifiableClaim":true,"confidence":0.92}\n```',
          };
        },
      },
    });

    const png = await buildTestPng(18, 16, (x, y) => [x * 10, y * 10, 50]);
    const ext = await adapter.extractFromImage(png, 'image/png');
    expect(ext.extraction.headline).toBe('IMF approves $4.7B loan');
    expect(ext.extraction.publisherLogoOutletId).toBe('daily-star');

    const rr = await adapter.rerank(ext.extraction, [
      {
        articleId: 'art_imf',
        outlet: 'daily-star',
        title: 'IMF approves $4.7B loan tranche',
        canonicalUrl: 'https://thedailystar.net/imf',
        publishedAt: '2026-11-10T10:00:00Z',
        snippet: 'IMF executive board approved the $4.7B tranche.',
        rrfScore: 0.025,
      },
    ]);
    expect(calls[1]).toBe('@cf/baai/bge-reranker-base');
    expect(rr.scores[0]?.relevanceScore).toBe(0.87);
  });

  test('auto factory cleanly falls back from Gemini to Workers AI on error', async () => {
    const providers = createVerificationProviders({
      preference: 'auto',
      gemini: {
        apiKey: 'broken_key',
        fetchImpl: (async () => new Response('Quota exceeded', { status: 429 })) as unknown as typeof fetch,
      },
      workersAi: {
        aiBinding: {
          async run() {
            return {
              response: JSON.stringify({
                inputKind: 'text',
                language: 'en',
                headline: 'Central bank raises policy rate',
                ocrText: 'Central bank raises policy rate',
                isQuote: false,
                claimedNumbers: [],
                claimedDates: [],
                claimedEntities: ['Bangladesh Bank'],
                hasVerifiableClaim: true,
                confidence: 0.88,
              }),
            };
          },
        },
      },
    });

    expect(providers.activeProviders).toEqual(['gemini', 'workers-ai', 'heuristic']);
    const res = await providers.extractor.extractFromText('Central bank raises policy rate');
    expect(res.usage.provider).toBe('workers-ai');
    expect(res.extraction.headline).toBe('Central bank raises policy rate');
  });
});

describe('End-to-End Verification Pipeline (Cache, Perceptual Dedup & Honest Empty State)', () => {
  test('deduplicates recompressed viral cards via dHash and returns neutral no_coverage when below floor', async () => {
    const saved = new Map<string, VerificationCheck>();
    const exactIndex = new Map<string, string>();
    const checkStore: VerificationCheckStore = {
      async findByExactHash(inputType, hash) {
        const id = exactIndex.get(`${inputType}:${hash}`);
        return id ? saved.get(id) ?? null : null;
      },
      async findRecentPerceptualHashes() {
        return Array.from(saved.values())
          .filter((c) => c.perceptualHash)
          .map((c) => ({ id: c.id, perceptualHash: c.perceptualHash! }));
      },
      async getById(id) {
        return saved.get(id) ?? null;
      },
      async incrementHitCount(id, nowIso) {
        const row = saved.get(id);
        if (!row) return 1;
        row.hitCount += 1;
        row.lastHitAt = nowIso;
        return row.hitCount;
      },
      async save(check, textHash) {
        saved.set(check.id, check);
        if (check.imageHash) exactIndex.set(`image:${check.imageHash}`, check.id);
        if (textHash) exactIndex.set(`text:${textHash}`, check.id);
      },
    };

    const seed = buildSeedRegistry();
    const compiled = compileRegistry({
      version: 1,
      entities: seed.entities,
      aliases: seed.aliases,
      roleTerms: seed.roleTerms,
    });
    const expander = new AliasDictionaryExpander(seed.aliases, seed.roleTerms);
    const vlmCache = new InMemoryVlmCache();
    let vlmCalls = 0;

    const workersAdapter = new WorkersAiAdapter({
      aiBinding: {
        async run(model) {
          if (model.includes('bge-reranker')) {
            return { response: [{ id: 0, score: 0.91 }] };
          }
          vlmCalls++;
          return {
            response: JSON.stringify({
              inputKind: 'photo_card',
              language: 'en',
              headline: 'Bangladesh Bank eases foreign borrowing rules for BIDA firms',
              ocrText: 'Bangladesh Bank eases foreign borrowing rules for BIDA firms',
              isQuote: false,
              claimedNumbers: [],
              claimedDates: [],
              claimedEntities: ['Bangladesh Bank', 'BIDA'],
              publisherLogo: 'The Business Standard',
              hasVerifiableClaim: true,
              confidence: 0.93,
            }),
          };
        },
      },
    });

    const retriever: VerificationRetriever = {
      async searchKeyword() {
        return [
          {
            chunkId: 'chk_a1',
            articleId: 'art_bb_1',
            outlet: 'business-standard',
            title: 'BB eases foreign borrowing rules for BIDA-registered firms',
            canonicalUrl: 'https://tbsnews.net/bb-bida',
            publishedAt: '2026-11-18T10:00:00Z',
            snippet: 'Bangladesh Bank has relaxed foreign borrowing rules for BIDA-registered enterprises.',
          },
        ];
      },
      async searchSemantic() {
        return [];
      },
    };

    const cardImg1 = await buildTestPng(36, 32, (x, y) => [Math.min(255, x * 6 + y * 2), 90, 120]);
    const cardImgRecompressed = await buildTestPng(36, 32, (x, y) => [
      Math.min(255, x * 6 + y * 2 + ((x + y) % 2)),
      91,
      119,
    ]);

    // 1. Fresh upload -> calls VLM & matches accredited article
    const r1 = await runVerificationPipeline(
      { type: 'image', bytes: cardImg1 },
      { extractor: workersAdapter, reranker: workersAdapter, compiledRegistry: compiled, expander, retriever, checkStore, vlmCache }
    );
    expect(r1.status).toBe('matched');
    expect(r1.cacheHit).toBe('none');
    expect(r1.sources).toHaveLength(1);
    expect(r1.sources[0]?.articleId).toBe('art_bb_1');
    expect(vlmCalls).toBe(1);

    // 2. Slightly perturbed repost -> perceptual dHash hit (ZERO extra VLM calls!)
    const r2 = await runVerificationPipeline(
      { type: 'image', bytes: cardImgRecompressed },
      { extractor: workersAdapter, reranker: workersAdapter, compiledRegistry: compiled, expander, retriever, checkStore, vlmCache }
    );
    expect(r2.cacheHit).toBe('perceptual');
    expect(r2.id).toBe(r1.id);
    expect(r2.hitCount).toBe(2);
    expect(r2.costUsd).toBe(0);
    expect(vlmCalls).toBe(1);

    // 3. Unmatched claim -> honest neutral `no_coverage` empty state
    const heuristic = new HeuristicVerificationAdapter();
    const emptyRetriever: VerificationRetriever = {
      async searchKeyword() {
        return [];
      },
      async searchSemantic() {
        return [];
      },
    };
    const r3 = await runVerificationPipeline(
      { type: 'text', text: 'মঙ্গল গ্রহে বুলেট ট্রেন চালু করেছে রেলপথ মন্ত্রণালয়' },
      { extractor: heuristic, reranker: heuristic, compiledRegistry: compiled, expander, retriever: emptyRetriever, checkStore, vlmCache }
    );
    expect(r3.status).toBe('no_coverage');
    expect(r3.sources).toHaveLength(0);
    expect(r3.emptyStateNotice?.en).toContain('does not mean the claim is false');
  });
});
