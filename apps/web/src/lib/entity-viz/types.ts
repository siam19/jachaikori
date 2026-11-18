export type EntityType = 'person' | 'org' | 'location' | 'role' | 'event_topic';
export type Lang = 'bn' | 'en';

export interface EntityNode {
  id: string;
  label: { bn: string | null; en: string | null };
  type: EntityType;
  eventCount: number; // events in the selected window
  score?: number; // association with the center entity
}

export interface EventNode {
  id: string;
  label: string; // medoid headline
  start: string; // ISO date
  end: string;
  articleCount: number;
  outletCount: number;
}

export interface Incidence {
  eventId: string;
  entityId: string;
  role: string;
  salience: number;
}

export interface EgoResponse {
  center: EntityNode;
  entities: EntityNode[];
  events: EventNode[];
  incidence: Incidence[];
}

export interface ActivityPoint {
  day: string; // YYYY-MM-DD
  articleCount: number;
}

export interface EventEdge {
  source: string;
  target: string;
  relationType: string;
  weight: number;
  evidence: { articleId: string; outlet: string; snippet: string }[];
}

export interface EventGraphResponse {
  event: EventNode;
  entities: (EntityNode & { roles: string[]; salience: number })[];
  edges: EventEdge[];
}
