import type {
  CrossOutletDifference,
  EntityProfile,
  EntityRelationEvidence,
  EntityRelationType,
  EntitySummary,
  EntityType,
  EventCluster,
  EventComparisonResponse,
  OutletId,
  PopularCheckSummary,
  SearchHit,
  SearchResponse,
  VerificationCheck,
} from '@jachaikori/schema';
import { ApiError } from './errors';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787'
).replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const norm = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${norm}`;
}

async function devValidate(schemaName: string, data: unknown): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    const schemas = await import('@jachaikori/schema');
    const schema = (schemas as Record<string, { safeParse?: (d: unknown) => { success: boolean; error?: unknown } }>)[schemaName];
    if (schema?.safeParse) {
      const res = schema.safeParse(data);
      if (!res.success) {
        console.warn(`[contract] ${schemaName} drift:`, res.error);
      }
    }
  } catch {
    // Non-fatal in dev
  }
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number; schemaName?: string }
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(resolveApiUrl(path), {
      ...init,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      throw new ApiError(res.status, body);
    }
    if (init?.schemaName) {
      void devValidate(init.schemaName, body);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// --- Verification ---

export interface VerifyImageInput {
  file: File;
  bypassCache?: boolean;
  provider?: 'auto' | 'gemini' | 'workers-ai';
  signal?: AbortSignal;
}

export interface VerifyTextInput {
  text: string;
  bypassCache?: boolean;
  provider?: 'auto' | 'gemini' | 'workers-ai';
  signal?: AbortSignal;
}

export async function verifyImage(input: VerifyImageInput): Promise<VerificationCheck> {
  const form = new FormData();
  form.append('image', input.file);
  if (input.bypassCache) form.append('bypassCache', 'true');
  if (input.provider) form.append('provider', input.provider);
  return fetchJson<VerificationCheck>('/verify', {
    method: 'POST',
    body: form,
    timeoutMs: 35_000,
    signal: input.signal,
    schemaName: 'VerificationCheckSchema',
  });
}

export async function verifyText(input: VerifyTextInput): Promise<VerificationCheck> {
  return fetchJson<VerificationCheck>('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      bypassCache: input.bypassCache ?? false,
      provider: input.provider ?? 'auto',
    }),
    timeoutMs: 35_000,
    signal: input.signal,
    schemaName: 'VerificationCheckSchema',
  });
}

export function getCheck(id: string): Promise<VerificationCheck> {
  return fetchJson<VerificationCheck>(`/checks/${encodeURIComponent(id)}`, {
    schemaName: 'VerificationCheckSchema',
  });
}

export function getPopularChecks(params?: {
  limit?: number;
  status?: 'matched' | 'no_coverage';
}): Promise<{ checks: PopularCheckSummary[] }> {
  return fetchJson<{ checks: PopularCheckSummary[] }>(
    `/checks/popular${qs({ limit: params?.limit ?? 12, status: params?.status })}`
  );
}

// --- Entities ---

export interface EntitySuggestion {
  id: string;
  canonicalBn: string | null;
  canonicalEn: string | null;
  entityType: EntityType;
  isHub: boolean;
  shortTaglineBn: string | null;
  shortTaglineEn: string | null;
  articleCount: number;
}

export function suggestEntities(q: string, limit = 8): Promise<{ entities: EntitySuggestion[] }> {
  return fetchJson<{ entities: EntitySuggestion[] }>(`/entities/suggest${qs({ q, limit })}`);
}

export function listEntities(params?: {
  q?: string;
  type?: string;
  includeHubs?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ entities: EntitySummary[] }> {
  return fetchJson<{ entities: EntitySummary[] }>(
    `/entities${qs({
      q: params?.q,
      type: params?.type,
      includeHubs: params?.includeHubs === undefined ? 'false' : String(params.includeHubs),
      limit: params?.limit ?? 48,
      offset: params?.offset ?? 0,
    })}`
  );
}

export function getEntityProfile(id: string): Promise<EntityProfile> {
  return fetchJson<EntityProfile>(`/entities/${encodeURIComponent(id)}`, {
    schemaName: 'EntityProfileSchema',
  });
}

export function getRandomEntity(): Promise<EntityProfile> {
  return fetchJson<EntityProfile>('/entities/random', {
    schemaName: 'EntityProfileSchema',
  });
}

export interface AggregatedEntityRelation {
  direction: 'out' | 'in';
  relationType: EntityRelationType;
  predicateLabels: string[];
  sources: string[];
  weight: number;
  latestAt: string | null;
  otherEntity: {
    id: string;
    canonicalBn: string | null;
    canonicalEn: string | null;
    entityType: EntityType;
    isHub: boolean;
    shortTaglineBn: string | null;
    shortTaglineEn: string | null;
  };
  evidence: EntityRelationEvidence[];
}

export function getEntityRelations(
  id: string,
  params?: {
    type?: string;
    source?: 'llm_claim' | 'deterministic';
    from?: string;
    to?: string;
    includeHubs?: boolean;
    limit?: number;
  }
): Promise<{ entityId: string; redirectedFrom?: string; relations: AggregatedEntityRelation[] }> {
  return fetchJson(
    `/entities/${encodeURIComponent(id)}/relations${qs({
      type: params?.type,
      source: params?.source,
      from: params?.from,
      to: params?.to,
      includeHubs: params?.includeHubs ? 'true' : 'false',
      limit: params?.limit ?? 40,
    })}`
  );
}

export interface EntityEgoNeighbor {
  id: string;
  canonicalBn: string | null;
  canonicalEn: string | null;
  entityType: EntityType;
  isHub?: boolean;
  shortTaglineBn?: string | null;
  shortTaglineEn?: string | null;
  together: number;
  totalOther: number;
  score: number;
}

export interface EntityEgoResponse {
  centerEntity: {
    id: string;
    canonicalBn: string | null;
    canonicalEn: string | null;
    entityType: EntityType;
  };
  nMe: number;
  nAll: number;
  neighbors: EntityEgoNeighbor[];
  events?: EventCluster[];
}

export function getEntityEgo(
  id: string,
  params?: { from?: string; to?: string; includeHubs?: boolean; limit?: number }
): Promise<EntityEgoResponse> {
  return fetchJson<EntityEgoResponse>(
    `/entities/${encodeURIComponent(id)}/ego${qs({
      from: params?.from,
      to: params?.to,
      includeHubs: params?.includeHubs ? 'true' : 'false',
      limit: params?.limit ?? 16,
    })}`
  );
}

export interface EntityActivityPoint {
  date: string;
  eventCount: number;
  articleCount: number;
  outletCount: number;
}

export function getEntityActivity(
  id: string
): Promise<{ entityId: string; series: EntityActivityPoint[] }> {
  return fetchJson(`/entities/${encodeURIComponent(id)}/activity`);
}

export interface EntityArticleItem {
  id: string;
  articleId?: string;
  outlet: OutletId;
  title: string;
  canonicalUrl: string;
  publishedAt: string | null;
  lead?: string | null;
  snippet?: string | null;
  role?: string | null;
  salience?: number | null;
  clusterId?: string | null;
  clusterOutletCount?: number | null;
}

export function getEntityArticles(
  id: string,
  params?: {
    with?: string;
    role?: string;
    from?: string;
    to?: string;
    sort?: 'recent' | 'salience';
    limit?: number;
    offset?: number;
  }
): Promise<{
  entityId: string;
  withEntityId?: string | null;
  total: number;
  articles: EntityArticleItem[];
}> {
  return fetchJson(
    `/entities/${encodeURIComponent(id)}/articles${qs({
      with: params?.with,
      role: params?.role,
      from: params?.from,
      to: params?.to,
      sort: params?.sort ?? 'recent',
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
    })}`
  );
}

// --- Events & Comparison ---

export interface DivergentEventPreview extends EventCluster {
  differences: CrossOutletDifference[];
  headlineDifference: CrossOutletDifference;
}

export function getDivergentEvents(limit = 6): Promise<{ events: DivergentEventPreview[] }> {
  return fetchJson<{ events: DivergentEventPreview[] }>(`/events/divergent${qs({ limit })}`);
}

export function listEvents(params?: {
  entity?: string;
  from?: string;
  to?: string;
  minOutlets?: number;
  limit?: number;
}): Promise<{ events: EventCluster[] }> {
  return fetchJson<{ events: EventCluster[] }>(
    `/events${qs({
      entity: params?.entity,
      from: params?.from,
      to: params?.to,
      minOutlets: params?.minOutlets,
      limit: params?.limit ?? 30,
    })}`
  );
}

export function getEventComparison(id: string): Promise<EventComparisonResponse> {
  return fetchJson<EventComparisonResponse>(`/events/${encodeURIComponent(id)}/comparison`, {
    schemaName: 'EventComparisonResponseSchema',
  });
}

export interface EventGraphResponse {
  event: EventCluster;
  nodes: Array<{
    id: string;
    canonicalBn: string | null;
    canonicalEn: string | null;
    entityType: EntityType;
    isHub?: boolean;
    articleCount?: number;
    mentionCount?: number;
    roles?: string[];
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationType?: string;
    weight?: number;
  }>;
  articles?: Array<{
    id: string;
    outlet: OutletId;
    title: string;
    canonicalUrl: string;
    publishedAt: string | null;
  }>;
}

export function getEventGraph(id: string, includeHubs = false): Promise<EventGraphResponse> {
  return fetchJson<EventGraphResponse>(
    `/events/${encodeURIComponent(id)}/graph${qs({ includeHubs: includeHubs ? 'true' : 'false' })}`
  );
}

export interface HealthResponse {
  ok: boolean;
  counts: {
    articles: number;
    chunks: number;
    clusters: number;
    edges: number;
    entities: number;
    entityRelations: number;
  };
  activeEntities?: number;
  outlets?: number;
  lastUpdatedAt?: string | null;
}

export function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>('/health');
}

// --- Search ---

export interface SearchApiResponse extends SearchResponse {
  matchedEntityIds?: string[];
  hits: SearchHit[];
}

export function searchArticles(params: {
  q: string;
  outlet?: string;
  fromDate?: string;
  toDate?: string;
  mode?: 'hybrid' | 'keyword' | 'semantic';
  limit?: number;
}): Promise<SearchApiResponse> {
  return fetchJson<SearchApiResponse>(
    `/search${qs({
      q: params.q,
      outlet: params.outlet,
      fromDate: params.fromDate,
      toDate: params.toDate,
      mode: params.mode ?? 'hybrid',
      limit: params.limit ?? 20,
    })}`
  );
}
