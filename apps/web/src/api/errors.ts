export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

export type Failure =
  | 'bad_format'
  | 'too_large'
  | 'upstream'
  | 'offline'
  | 'not_found'
  | 'unknown';

export function classify(e: unknown): Failure {
  if (e instanceof ApiError) {
    if (e.status === 400) return 'bad_format';
    if (e.status === 413) return 'too_large';
    if (e.status === 404) return 'not_found';
    if (e.status >= 500) return 'upstream';
  }
  if (e instanceof DOMException && e.name === 'AbortError') return 'upstream';
  if (e instanceof TypeError) return 'offline';
  return 'unknown';
}
