import type { ActivityPoint, EgoResponse, EntityNode, EntityType, EventGraphResponse, EventNode, Incidence } from './types';

const API = import.meta.env.VITE_API_URL ?? '/api';

async function get<T>(path: string, params: URLSearchParams): Promise<T> {
  const qs = params.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

function mapEvent(ev: any): EventNode {
  return {
    id: ev.id,
    label: ev.label ?? ev.id,
    start: ev.start ?? ev.firstSeen ?? ev.lastSeen ?? new Date().toISOString().slice(0, 10),
    end: ev.end ?? ev.lastSeen ?? ev.firstSeen ?? new Date().toISOString().slice(0, 10),
    articleCount: ev.articleCount ?? 0,
    outletCount: ev.outletCount ?? 0,
  };
}

function mapEntity(e: any, fallbackCount = 1): EntityNode {
  return {
    id: e.id,
    label: e.label ?? { bn: e.canonicalBn ?? null, en: e.canonicalEn ?? null },
    type: (e.type ?? e.entityType ?? 'person') as EntityType,
    eventCount: e.eventCount ?? e.together ?? e.articleCount ?? fallbackCount,
    score: typeof e.score === 'number' ? e.score : undefined,
  };
}

export async function getEgo(id: string, from: string, to: string, hubs = false): Promise<EgoResponse> {
  const raw = await get<any>(
    `/entities/${encodeURIComponent(id)}/ego`,
    new URLSearchParams({ from, to, hubs: hubs ? '1' : '0' }),
  );
  if (raw.center && Array.isArray(raw.entities)) {
    return raw as EgoResponse;
  }

  const center = mapEntity(raw.centerEntity ?? { id }, raw.nMe ?? 1);
  center.eventCount = raw.nMe ?? center.eventCount;

  const entities: EntityNode[] = [
    center,
    ...(raw.neighbors ?? []).map((n: any) => mapEntity(n, n.together ?? 1)),
  ];
  const events: EventNode[] = (raw.events ?? []).map(mapEvent);
  const incidence: Incidence[] = Array.isArray(raw.incidence)
    ? raw.incidence.map((inc: any) => ({
        eventId: inc.eventId,
        entityId: inc.entityId,
        role: inc.role ?? 'mentioned',
        salience: typeof inc.salience === 'number' ? inc.salience : 0.5,
      }))
    : (raw.events ?? []).map((ev: any) => ({
        eventId: ev.id,
        entityId: center.id,
        role: ev.role ?? 'mentioned',
        salience: typeof ev.salience === 'number' ? ev.salience : 0.5,
      }));

  return { center, entities, events, incidence };
}

export async function getActivity(id: string, from: string, to: string): Promise<ActivityPoint[]> {
  const raw = await get<any>(
    `/entities/${encodeURIComponent(id)}/activity`,
    new URLSearchParams({ from, to }),
  );
  const list = Array.isArray(raw) ? raw : raw.series ?? [];
  return list
    .map((pt: any) => ({
      day: pt.day ?? pt.date,
      articleCount: pt.articleCount ?? 0,
    }))
    .filter((pt: ActivityPoint) => typeof pt.day === 'string' && pt.day.length >= 10);
}

export async function getEventGraph(eventId: string): Promise<EventGraphResponse> {
  const raw = await get<any>(`/events/${encodeURIComponent(eventId)}/graph`, new URLSearchParams());
  if (raw.entities && raw.event?.start) {
    return raw as EventGraphResponse;
  }

  const entities = (raw.nodes ?? raw.entities ?? []).map((n: any) => ({
    ...mapEntity(n, n.articleCount ?? 1),
    roles: Array.isArray(n.roles) ? n.roles : n.role ? [n.role] : ['mentioned'],
    salience: typeof n.salience === 'number' ? n.salience : 0.5,
  }));

  const articles = Array.isArray(raw.articles)
    ? raw.articles.map((a: any) => ({
        id: a.id,
        title: a.title ?? a.canonicalUrl ?? a.id,
        publishedAt: a.publishedAt ?? null,
        canonicalUrl: a.canonicalUrl ?? '',
        outlet: a.outlet ?? '',
        entityIds: Array.isArray(a.entityIds) ? a.entityIds : [],
      }))
    : [];

  return {
    event: mapEvent(raw.event ?? { id: eventId }),
    entities,
    edges: raw.edges ?? [],
    articles,
  };
}

/** Events in which ALL listed entities participated (the hyperedge intersection query). */
export async function getEvents(entityIds: string[], from: string, to: string): Promise<EventNode[]> {
  const q = new URLSearchParams({ from, to });
  entityIds.forEach((id) => q.append('entity', id));
  const raw = await get<any>('/events', q);
  const list = Array.isArray(raw) ? raw : raw.events ?? [];
  return list.map(mapEvent);
}
