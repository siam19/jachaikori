import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  getCheck,
  getDivergentEvents,
  getEntityActivity,
  getEntityArticles,
  getEntityEgo,
  getEntityProfile,
  getEntityRelations,
  getEventComparison,
  getEventGraph,
  getHealth,
  getPopularChecks,
  listEntities,
  listEvents,
  searchArticles,
  suggestEntities,
} from './client';
import { lensQuery, type Lens } from '../lib/useLens';

export const healthQuery = () =>
  queryOptions({
    queryKey: ['health'] as const,
    queryFn: () => getHealth(),
    staleTime: 60_000,
  });

export const checkQuery = (id: string) =>
  queryOptions({
    queryKey: ['check', id] as const,
    queryFn: () => getCheck(id),
    staleTime: 60_000,
  });

export const popularChecksQuery = (limit = 8) =>
  queryOptions({
    queryKey: ['checks', 'popular', limit] as const,
    queryFn: () => getPopularChecks({ limit }),
    staleTime: 60_000,
  });

export const divergentEventsQuery = (limit = 6) =>
  queryOptions({
    queryKey: ['events', 'divergent', limit] as const,
    queryFn: () => getDivergentEvents(limit),
    staleTime: 5 * 60_000,
  });

export const eventsListQuery = (params?: {
  entity?: string;
  from?: string;
  to?: string;
  minOutlets?: number;
  limit?: number;
}) =>
  queryOptions({
    queryKey: ['events', 'list', params ?? {}] as const,
    queryFn: () => listEvents(params),
    staleTime: 2 * 60_000,
  });

export const eventComparisonQuery = (id: string) =>
  queryOptions({
    queryKey: ['events', id, 'comparison'] as const,
    queryFn: () => getEventComparison(id),
    staleTime: 5 * 60_000,
  });

export const eventGraphQuery = (id: string, includeHubs = false) =>
  queryOptions({
    queryKey: ['events', id, 'graph', includeHubs] as const,
    queryFn: () => getEventGraph(id, includeHubs),
    staleTime: 5 * 60_000,
  });

export const entitiesListQuery = (params?: {
  q?: string;
  type?: string;
  includeHubs?: boolean;
  limit?: number;
  offset?: number;
}) =>
  queryOptions({
    queryKey: ['entities', 'list', params ?? {}] as const,
    queryFn: () => listEntities(params),
    staleTime: 2 * 60_000,
  });

export const entitySuggestQuery = (q: string) =>
  queryOptions({
    queryKey: ['entities', 'suggest', q] as const,
    queryFn: () => suggestEntities(q, 8),
    enabled: q.trim().length >= 1,
    staleTime: 30_000,
  });

export const entityProfileQuery = (id: string) =>
  queryOptions({
    queryKey: ['entities', id, 'profile'] as const,
    queryFn: () => getEntityProfile(id),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

export const entityRelationsQuery = (id: string, lens: Lens) => {
  const params = lensQuery.relations(lens);
  return queryOptions({
    queryKey: ['entities', id, 'relations', params] as const,
    queryFn: () => getEntityRelations(id, params),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });
};

export const entityEgoQuery = (id: string, lens: Lens) => {
  const params = lensQuery.ego(lens);
  return queryOptions({
    queryKey: ['entities', id, 'ego', params] as const,
    queryFn: () => getEntityEgo(id, params),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });
};

export const entityActivityQuery = (id: string) =>
  queryOptions({
    queryKey: ['entities', id, 'activity'] as const,
    queryFn: () => getEntityActivity(id),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

export const entityArticlesQuery = (id: string, lens: Lens, offset = 0, limit = 20) => {
  const params = { ...lensQuery.articles(lens), offset, limit };
  return queryOptions({
    queryKey: ['entities', id, 'articles', params] as const,
    queryFn: () => getEntityArticles(id, params),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
};

export const searchArticlesQuery = (params: {
  q: string;
  outlet?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}) =>
  queryOptions({
    queryKey: ['search', params] as const,
    queryFn: () => searchArticles(params),
    enabled: params.q.trim().length > 0,
    staleTime: 60_000,
  });
