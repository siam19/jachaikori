/**
 * @file tools/crawler/src/gcp/gcs.ts
 * Zero-dependency GCS JSON API client supporting both Cloud Run GCE Metadata Server
 * authentication and local gcloud CLI OAuth tokens.
 */

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export interface GcsClientOptions {
  /** Override auth mode: 'metadata' (Cloud Run), 'gcloud' (local CLI), or 'auto'. */
  authMode?: 'metadata' | 'gcloud' | 'auto';
}

export class GcsClient {
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private authMode: 'metadata' | 'gcloud' | 'auto';

  constructor(options: GcsClientOptions = {}) {
    this.authMode = options.authMode ?? 'auto';
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.cachedToken;
    }

    const envToken = process.env.GCS_ACCESS_TOKEN;
    if (envToken) {
      this.cachedToken = envToken;
      this.tokenExpiresAt = Date.now() + 10 * 60_000;
      return envToken;
    }

    if (this.authMode === 'metadata' || this.authMode === 'auto') {
      try {
        const res = await fetch(METADATA_TOKEN_URL, {
          headers: { 'Metadata-Flavor': 'Google' },
          signal: AbortSignal.timeout(2500),
        });
        if (res.ok) {
          const data = (await res.json()) as { access_token: string; expires_in: number };
          this.cachedToken = data.access_token;
          this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3000) * 1000;
          return this.cachedToken;
        }
      } catch {
        if (this.authMode === 'metadata') {
          throw new Error('Failed to obtain OAuth token from GCE metadata server');
        }
      }
    }

    // Fallback to local `gcloud auth print-access-token`
    const proc = Bun.spawn(['gcloud', 'auth', 'print-access-token'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0 || !stdout.trim()) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Failed to obtain gcloud access token: ${stderr.trim()}`);
    }
    this.cachedToken = stdout.trim();
    this.tokenExpiresAt = Date.now() + 45 * 60_000;
    return this.cachedToken;
  }

  private async authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }

  async getObjectText(bucket: string, objectPath: string): Promise<string | null> {
    const encoded = encodeURIComponent(objectPath);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encoded}?alt=media`;
    const res = await this.authFetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GCS GET ${objectPath} failed (${res.status}): ${await res.text()}`);
    }
    return res.text();
  }

  async getObjectJson<T>(bucket: string, objectPath: string): Promise<T | null> {
    const text = await this.getObjectText(bucket, objectPath);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  /**
   * Uploads text to GCS. When `ifGenerationMatch: 0` is provided, acts as an atomic
   * distributed lock create and returns `false` on HTTP 412 Precondition Failed.
   */
  async putObjectText(
    bucket: string,
    objectPath: string,
    body: string,
    options: { contentType?: string; ifGenerationMatch?: number } = {}
  ): Promise<boolean> {
    const params = new URLSearchParams({
      uploadType: 'media',
      name: objectPath,
    });
    if (options.ifGenerationMatch !== undefined) {
      params.set('ifGenerationMatch', String(options.ifGenerationMatch));
    }

    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${params.toString()}`;
    const res = await this.authFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': options.contentType ?? 'text/plain; charset=utf-8',
      },
      body,
    });

    if (res.status === 412 && options.ifGenerationMatch !== undefined) {
      return false;
    }
    if (!res.ok) {
      throw new Error(`GCS PUT ${objectPath} failed (${res.status}): ${await res.text()}`);
    }
    return true;
  }

  async putObjectJson(
    bucket: string,
    objectPath: string,
    data: unknown,
    options: { ifGenerationMatch?: number } = {}
  ): Promise<boolean> {
    return this.putObjectText(bucket, objectPath, JSON.stringify(data), {
      contentType: 'application/json; charset=utf-8',
      ifGenerationMatch: options.ifGenerationMatch,
    });
  }

  async deleteObject(bucket: string, objectPath: string): Promise<void> {
    const encoded = encodeURIComponent(objectPath);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encoded}`;
    const res = await this.authFetch(url, { method: 'DELETE' });
    if (res.status !== 404 && !res.ok) {
      throw new Error(`GCS DELETE ${objectPath} failed (${res.status}): ${await res.text()}`);
    }
  }

  async listObjects(
    bucket: string,
    prefix: string
  ): Promise<Array<{ name: string; updated: string; size: number }>> {
    const out: Array<{ name: string; updated: string; size: number }> = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        prefix,
        maxResults: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params.toString()}`;
      const res = await this.authFetch(url);
      if (!res.ok) {
        throw new Error(`GCS LIST ${prefix} failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as {
        items?: Array<{ name: string; updated: string; size: string }>;
        nextPageToken?: string;
      };
      for (const item of data.items ?? []) {
        out.push({
          name: item.name,
          updated: item.updated,
          size: Number(item.size ?? 0),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return out;
  }
}
