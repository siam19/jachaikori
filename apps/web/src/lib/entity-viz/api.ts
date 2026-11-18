import type { ActivityPoint, EgoResponse, EventGraphResponse, EventNode } from './types';

const API = import.meta.env.VITE_API_URL ?? '/api';

async function get<T>(path: string, params: URLSearchParams): Promise<T> {
  const qs = params.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const getEgo = (id: string, from: string, to: string, hubs = false) =>
  get<EgoResponse>(
    `/entities/${encodeURIComponent(id)}/ego`,
    new URLSearchParams({ from, to, hubs: hubs ? '1' : '0' }),
  );

export const getActivity = (id: string, from: string, to: string) =>
  get<ActivityPoint[]>(
    `/entities/${encodeURIComponent(id)}/activity`,
    new URLSearchParams({ from, to }),
  );

export const getEventGraph = (eventId: string) =>
  get<EventGraphResponse>(`/events/${encodeURIComponent(eventId)}/graph`, new URLSearchParams());

/** Events in which ALL listed entities participated (the hyperedge intersection query). */
export function getEvents(entityIds: string[], from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  entityIds.forEach((id) => q.append('entity', id));
  return get<EventNode[]>('/events', q);
}
