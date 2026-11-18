/**
 * @file packages/retrieval/test/bangla.test.ts
 * Tests Bangla FTS5 tokenization integrity, NFC/ZWJ normalization, and query quoting.
 */

import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  BANGLA_FTS_TOKENIZE_CLAUSE,
  buildFtsMatchQuery,
  normalizeBanglaForFts,
} from '../src/bangla';

describe('Bangla FTS5 Tokenization & Normalization', () => {
  it('preserves full Bangla words with matras, hasanta, and nukta without fragmenting', () => {
    const db = new Database(':memory:');
    db.run(
      `CREATE VIRTUAL TABLE fts_test USING fts5(title, body, tokenize="${BANGLA_FTS_TOKENIZE_CLAUSE}");`
    );

    const sampleTitle = normalizeBanglaForFts('কক্সবাজারে তৃতীয় এলএনজি টার্মিনালে র\u200d্যাবের অভিযান।');
    const sampleBody = normalizeBanglaForFts('বাংলাদেশের অর্থনীতিতে নতুন বিনিয়োগ ও ১২৩ কোটি টাকার প্রকল্প।');
    db.run('INSERT INTO fts_test (title, body) VALUES (?, ?)', [sampleTitle, sampleBody]);

    db.run('CREATE VIRTUAL TABLE fts_vocab USING fts5vocab(fts_test, instance);');
    const terms = (db.query('SELECT DISTINCT term FROM fts_vocab').all() as Array<{ term: string }>).map(
      (r) => r.term
    );

    expect(terms).toContain('কক্সবাজারে');
    expect(terms).toContain('তৃতীয়'); // NFC normalized
    expect(terms).toContain('এলএনজি');
    expect(terms).toContain('র্যাবের'); // ZWJ stripped
    expect(terms).toContain('বাংলাদেশের');
    expect(terms).toContain('১২৩');

    // Exact word queries match cleanly
    expect(
      db.query('SELECT * FROM fts_test WHERE fts_test MATCH ?').all(buildFtsMatchQuery('কক্সবাজারে এলএনজি'))
        .length
    ).toBe(1);

    // NFD query (য + ়) matches NFC (য়) indexed text
    expect(
      db
        .query('SELECT * FROM fts_test WHERE fts_test MATCH ?')
        .all(buildFtsMatchQuery('তৃতীয\u09bc'))
        .length
    ).toBe(1);

    // Partial consonant fragments must NOT falsely match
    expect(
      db.query('SELECT * FROM fts_test WHERE fts_test MATCH ?').all(buildFtsMatchQuery('কক'))
        .length
    ).toBe(0);

    db.close();
  });

  it('builds safe quoted FTS5 queries stripping punctuation', () => {
    expect(buildFtsMatchQuery('শেখ হাসিনা: কবে দেশে ফিরবেন?')).toBe(
      '"শেখ" "হাসিনা" "কবে" "দেশে" "ফিরবেন"'
    );
    expect(buildFtsMatchQuery('ঢাকা, চট্টগ্রাম!', 'OR')).toBe('"ঢাকা" OR "চট্টগ্রাম"');
    expect(buildFtsMatchQuery('   । , ?  ')).toBe('');
  });
});
