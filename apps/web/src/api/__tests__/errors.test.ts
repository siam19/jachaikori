import { describe, expect, it } from 'vitest';
import { ApiError, classify } from '../errors';

describe('classify API error mapper', () => {
  it('maps HTTP statuses cleanly', () => {
    expect(classify(new ApiError(400))).toBe('bad_format');
    expect(classify(new ApiError(413))).toBe('too_large');
    expect(classify(new ApiError(404))).toBe('not_found');
    expect(classify(new ApiError(502))).toBe('upstream');
    expect(classify(new ApiError(500))).toBe('upstream');
  });

  it('maps AbortError to upstream and TypeError to offline', () => {
    expect(classify(new DOMException('timeout', 'AbortError'))).toBe('upstream');
    expect(classify(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classify(new Error('other'))).toBe('unknown');
  });
});
