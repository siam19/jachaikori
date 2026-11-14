/**
 * @file tools/crawler/src/engine/url.ts
 * Canonical URL normalization rules to prevent duplicate indexing across tracking links and redirects.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'source',
  '_hsenc',
  '_hsmi',
  'mc_cid',
  'mc_eid',
]);

/**
 * Normalizes an article URL:
 * - Lowercases hostname
 * - Standardizes scheme to https
 * - Strips URL fragments (#...)
 * - Strips analytics and marketing query parameters
 * - Removes redundant trailing slashes from path
 */
export function canonicalizeUrl(rawUrl: string, customCleaner?: (url: string) => string): string {
  try {
    let clean = rawUrl.trim();
    if (customCleaner) {
      clean = customCleaner(clean);
    }

    const parsed = new URL(clean);
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';

    // Remove tracking query params
    const keysToRemove: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.startsWith('utm_')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      parsed.searchParams.delete(key);
    }

    // Sort remaining params for determinism
    parsed.searchParams.sort();

    // Strip trailing slash unless it's the root path '/'
    let normalized = parsed.toString();
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    return rawUrl.trim();
  }
}
