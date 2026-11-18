import React, { useEffect, useMemo, useState } from 'react';
import type {
  ClusterGraphResponse,
  EntityGraphEdge,
  EntityGraphNode,
  EntityGraphResponse,
  EntitySummary,
  EventCluster,
  GraphNode,
  OutletId,
  SearchHit,
  SearchMode,
} from '@jachaikori/schema';
import { ForceGraph, OUTLET_COLORS } from './components/ForceGraph';
import {
  ENTITY_TYPE_COLORS,
  EntityHypergraph,
  RELATION_TYPE_COLORS,
} from './components/EntityHypergraph';
import { EntityTimelineView } from './components/EntityTimelineView';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const UI_COPY = {
  en: {
    brand: 'Jachaikori',
    badge: 'Cluster & Entity Explorer',
    searchPlaceholder: 'Search Bangla or English claim / headline…',
    searchBtn: 'Search',
    clustersTitle: 'Clusters',
    searchTitle: 'Search',
    entitiesTitle: 'Entities',
    articleNetMode: 'Article Network',
    entityHyperMode: 'Entity Hypergraph',
    entityTimelineMode: 'Entity Timeline',
    inspectorTitle: 'Coverage Timeline',
    hyperInspectorTitle: 'Hypergraph Inspector',
    simLabel: 'Similarity ≥',
    weightLabel: 'Min Articles ≥',
    hullsLabel: 'Article Hulls',
    emptyGraph: 'Select an event cluster or search hit to inspect how outlets connected and covered it.',
    emptyEntityGraph: 'Select a canonical entity or an event cluster to explore its entity-relation hypergraph.',
    readOriginal: 'Read original article ↗',
    clusterEntities: 'Canonical Entities in Cluster',
  },
  bn: {
    brand: 'যাচাই করি',
    badge: 'ক্লাস্টার ও এন্টিটি এক্সপ্লোরার',
    searchPlaceholder: 'বাংলা বা ইংরেজি দাবি / শিরোনাম লিখুন…',
    searchBtn: 'খুঁজুন',
    clustersTitle: 'ক্লাস্টার',
    searchTitle: 'অনুসন্ধান',
    entitiesTitle: 'এন্টিটি',
    articleNetMode: 'সংবাদ নেটওয়ার্ক',
    entityHyperMode: 'এন্টিটি হাইপারগ্রাফ',
    entityTimelineMode: 'এন্টিটি টাইমলাইন',
    inspectorTitle: 'প্রকাশনার সময়ক্রম',
    hyperInspectorTitle: 'হাইপারগ্রাফ তথ্য',
    simLabel: 'সাদৃশ্য ≥',
    weightLabel: 'ন্যূনতম সংবাদ ≥',
    hullsLabel: 'আর্টিকেল হাল',
    emptyGraph: 'সংবাদমাধ্যমগুলোর কভারেজ সম্পর্ক দেখতে বাম দিক থেকে একটি ক্লাস্টার বা সংবাদ নির্বাচন করুন।',
    emptyEntityGraph: 'সম্পর্ক ও হাইপারগ্রাফ দেখতে বাম দিক থেকে একটি এন্টিটি বা ক্লাস্টার নির্বাচন করুন।',
    readOriginal: 'মূল প্রতিবেদন পড়ুন ↗',
    clusterEntities: 'ক্লাস্টারে শনাক্তকৃত এন্টিটি',
  },
} as const;

export function App() {
  const [lang, setLang] = useState<'en' | 'bn'>('en');
  const t = UI_COPY[lang];

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [leftTab, setLeftTab] = useState<'clusters' | 'search' | 'entities'>('clusters');
  const [graphMode, setGraphMode] = useState<'article' | 'entity' | 'timeline'>('article');
  const [activeTimelineEntityId, setActiveTimelineEntityId] = useState<string | null>(null);

  const [clusters, setClusters] = useState<EventCluster[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ latencyMs: number; mode: string; expandedTerms?: string[] } | null>(null);

  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [entityFilterQ, setEntityFilterQ] = useState('');
  const [entityFilterType, setEntityFilterType] = useState('');

  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<ClusterGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [minSimilarity, setMinSimilarity] = useState(0.78);

  const [entityGraph, setEntityGraph] = useState<EntityGraphResponse | null>(null);
  const [selectedEntityNode, setSelectedEntityNode] = useState<EntityGraphNode | null>(null);
  const [selectedEntityEdge, setSelectedEntityEdge] = useState<EntityGraphEdge | null>(null);
  const [minEdgeWeight, setMinEdgeWeight] = useState(1);
  const [showHyperedgeHulls, setShowHyperedgeHulls] = useState(true);
  const [hoveredHyperedgeIds, setHoveredHyperedgeIds] = useState<string[]>([]);

  const [healthInfo, setHealthInfo] = useState<{
    articles: number;
    clusters: number;
    entities?: number;
    entityRelations?: number;
  } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loadingClusters, setLoadingClusters] = useState(true);

  async function loadInitialData() {
    setApiError(null);
    setLoadingClusters(true);
    try {
      const [healthRes, clustersRes, entitiesRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/clusters?minOutlets=2&limit=40`),
        fetch(`${API_BASE}/entities?limit=60`),
      ]);
      if (!healthRes.ok || !clustersRes.ok) {
        throw new Error(
          `API returned HTTP ${!clustersRes.ok ? clustersRes.status : healthRes.status}. Make sure the API server is running (\`bun run dev\` or \`bun run api\`).`
        );
      }
      const healthData = await healthRes.json();
      const clustersData = await clustersRes.json();
      setHealthInfo(healthData.counts ?? null);

      const list: EventCluster[] = clustersData.clusters ?? [];
      setClusters(list);
      if (entitiesRes.ok) {
        const entData = await entitiesRes.json();
        setEntities(entData.entities ?? []);
      }
      if (list.length > 0 && !activeClusterId) {
        await loadClusterGraph(list[0]!.id);
      }
    } catch (err) {
      setApiError(
        err instanceof Error
          ? err.message
          : 'Cannot connect to Jachaikori API on port 8787.'
      );
    } finally {
      setLoadingClusters(false);
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ limit: '60' });
    if (entityFilterQ.trim()) qs.set('q', entityFilterQ.trim());
    if (entityFilterType) qs.set('type', entityFilterType);
    fetch(`${API_BASE}/entities?${qs.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.entities) setEntities(d.entities);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [entityFilterQ, entityFilterType]);

  async function loadClusterGraph(clusterId: string) {
    setActiveClusterId(clusterId);
    const res = await fetch(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/graph`);
    if (res.ok) {
      const data: ClusterGraphResponse = await res.json();
      setGraphData(data);
      setSelectedNode(data.nodes[0] ?? null);
    }
    if (graphMode === 'entity') {
      await loadClusterEntities(clusterId);
    }
  }

  async function loadClusterEntities(clusterId: string) {
    setActiveClusterId(clusterId);
    const res = await fetch(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/entities`);
    if (res.ok) {
      const data: EntityGraphResponse = await res.json();
      setEntityGraph(data);
      setSelectedEntityNode(data.nodes[0] ?? null);
      setSelectedEntityEdge(null);
      setHoveredHyperedgeIds([]);
      setGraphMode('entity');
    }
  }

  async function loadEntityGraph(entityId: string) {
    const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/graph`);
    if (res.ok) {
      const data: EntityGraphResponse = await res.json();
      setEntityGraph(data);
      setSelectedEntityNode(data.centerEntity ?? data.nodes[0] ?? null);
      setSelectedEntityEdge(null);
      setHoveredHyperedgeIds([]);
      setGraphMode('entity');
    }
  }

  async function loadArticleGraph(articleId: string) {
    setActiveClusterId(null);
    setGraphMode('article');
    const res = await fetch(`${API_BASE}/articles/${encodeURIComponent(articleId)}/graph`);
    if (res.ok) {
      const data: ClusterGraphResponse = await res.json();
      setGraphData(data);
      setSelectedNode(data.nodes.find((n) => n.id === articleId) ?? data.nodes[0] ?? null);
    }
  }

  async function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), mode, limit: 20 }),
    });
    if (res.ok) {
      const data = await res.json();
      setSearchHits(data.hits ?? []);
      setSearchMeta({
        latencyMs: data.latencyMs,
        mode: data.mode,
        expandedTerms: data.expandedTerms,
      });
      setLeftTab('search');
    }
  }

  const entityNodeById = useMemo(
    () => new Map((entityGraph?.nodes ?? []).map((n) => [n.id, n])),
    [entityGraph]
  );

  const selectedEntityRelations = useMemo(() => {
    if (!entityGraph || !selectedEntityNode) return [];
    return entityGraph.edges
      .filter((e) => e.source === selectedEntityNode.id || e.target === selectedEntityNode.id)
      .sort((a, b) => b.weight - a.weight);
  }, [entityGraph, selectedEntityNode]);

  const selectedEntityHyperedges = useMemo(() => {
    if (!entityGraph) return [];
    if (!selectedEntityNode) return entityGraph.hyperedges;
    return entityGraph.hyperedges.filter((h) => h.entityIds.includes(selectedEntityNode.id));
  }, [entityGraph, selectedEntityNode]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>{t.brand}</span>
          <span className="brand-badge">{t.badge}</span>
          {healthInfo && (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
              {healthInfo.articles.toLocaleString()} articles · {healthInfo.clusters.toLocaleString()} clusters
              {typeof healthInfo.entities === 'number' && healthInfo.entities > 0
                ? ` · ${healthInfo.entities.toLocaleString()} entities · ${(healthInfo.entityRelations ?? 0).toLocaleString()} relations`
                : ''}
            </span>
          )}
        </div>

        <form className="search-form" onSubmit={onSearchSubmit}>
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
          />
          <select
            className="select"
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
          >
            <option value="hybrid">Hybrid (RRF)</option>
            <option value="keyword">Keyword (FTS5)</option>
            <option value="semantic">Semantic (BGE-M3)</option>
          </select>
          <button className="btn btn-primary" type="submit">
            {t.searchBtn}
          </button>
        </form>

        <button className="btn" onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}>
          {lang === 'en' ? 'বাংলা' : 'English'}
        </button>
      </header>

      <main className="workspace">
        {/* Left Pane: Event Cluster Feed, Search Results, or Canonical Entities */}
        <section className="pane">
          <div className="pane-header">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn"
                style={{
                  padding: '4px 8px',
                  borderColor: leftTab === 'clusters' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setLeftTab('clusters')}
              >
                {t.clustersTitle} ({clusters.length})
              </button>
              <button
                className="btn"
                style={{
                  padding: '4px 8px',
                  borderColor: leftTab === 'entities' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setLeftTab('entities')}
              >
                {t.entitiesTitle} ({entities.length})
              </button>
              <button
                className="btn"
                style={{
                  padding: '4px 8px',
                  borderColor: leftTab === 'search' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setLeftTab('search')}
              >
                {t.searchTitle} ({searchHits.length})
              </button>
            </div>
            {searchMeta && leftTab === 'search' && <span>{searchMeta.latencyMs}ms</span>}
          </div>

          {leftTab === 'entities' && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <input
                className="search-input"
                style={{ padding: '5px 8px', fontSize: 12 }}
                value={entityFilterQ}
                onChange={(e) => setEntityFilterQ(e.target.value)}
                placeholder="Filter entities (bn / en)…"
              />
              <select
                className="select"
                style={{ padding: '5px 6px', fontSize: 12 }}
                value={entityFilterType}
                onChange={(e) => setEntityFilterType(e.target.value)}
              >
                <option value="">All</option>
                <option value="person">Person</option>
                <option value="org">Org</option>
                <option value="location">Location</option>
                <option value="role">Role</option>
                <option value="event_topic">Topic</option>
              </select>
            </div>
          )}

          <div className="pane-scroll">
            {leftTab === 'clusters' ? (
              apiError ? (
                <div className="empty-state">
                  <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 8 }}>API Unreachable</div>
                  <div style={{ marginBottom: 12 }}>{apiError}</div>
                  <div style={{ fontSize: 12, marginBottom: 12 }}>
                    Run <code>bun run dev</code> from the repo root (or start <code>bun run api</code> alongside Vite).
                  </div>
                  <button className="btn btn-primary" onClick={() => void loadInitialData()}>
                    Retry Connection
                  </button>
                </div>
              ) : loadingClusters ? (
                <div className="empty-state">Loading event clusters…</div>
              ) : clusters.length === 0 ? (
                <div className="empty-state">
                  No clusters indexed yet. Run <code>bun run backfill import-vectors</code> &{' '}
                  <code>bun run backfill cluster</code> after GCP embedding.
                </div>
              ) : (
                clusters.map((c) => (
                  <div
                    key={c.id}
                    className={`card ${activeClusterId === c.id ? 'active' : ''}`}
                    onClick={() => void loadClusterGraph(c.id)}
                  >
                    <div className="meta-row">
                      <span className="pill" style={{ color: 'var(--accent)' }}>
                        {c.outletCount}/8 outlets · {c.articleCount} articles
                      </span>
                      <span>{c.firstSeen?.slice(0, 10) ?? ''}</span>
                    </div>
                    <div className="card-title">{c.label}</div>
                    <div className="meta-row">
                      {c.outlets.map((o) => (
                        <span key={o} className="pill">
                          <span className="dot" style={{ background: OUTLET_COLORS[o] }} />
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )
            ) : leftTab === 'entities' ? (
              entities.length === 0 ? (
                <div className="empty-state">
                  No resolved entities yet. Run <code>bun run backfill resolve-entities</code>.
                </div>
              ) : (
                entities.map((ent) => (
                  <div
                    key={ent.id}
                    className={`card ${entityGraph?.centerEntity?.id === ent.id && graphMode === 'entity' ? 'active' : ''}`}
                    onClick={() => void loadEntityGraph(ent.id)}
                  >
                    <div className="meta-row">
                      <span className="pill" style={{ color: ENTITY_TYPE_COLORS[ent.entityType] }}>
                        <span className="dot" style={{ background: ENTITY_TYPE_COLORS[ent.entityType] }} />
                        {ent.entityType}
                      </span>
                      <span>{ent.articleCount.toLocaleString()} articles</span>
                    </div>
                    <div className="card-title">
                      {ent.canonicalBn || ent.canonicalEn}
                      {ent.canonicalBn && ent.canonicalEn ? (
                        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                          {' '}· {ent.canonicalEn}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )
            ) : (
              <>
                {searchMeta?.expandedTerms && searchMeta.expandedTerms.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', padding: '2px 4px' }}>
                    Alias expansion: <strong style={{ color: 'var(--accent)' }}>{searchMeta.expandedTerms.join(', ')}</strong>
                  </div>
                )}
                {searchHits.map((hit) => (
                  <div
                    key={hit.articleId}
                    className={`card ${selectedNode?.id === hit.articleId ? 'active' : ''}`}
                    onClick={() =>
                      hit.clusterId ? void loadClusterGraph(hit.clusterId) : void loadArticleGraph(hit.articleId)
                    }
                  >
                    <div className="meta-row">
                      <span className="pill">
                        <span className="dot" style={{ background: OUTLET_COLORS[hit.outlet] }} />
                        {hit.outlet}
                      </span>
                      <span>{hit.publishedAt?.slice(0, 10) ?? ''}</span>
                      <span className="pill">{hit.sources.join('+')}</span>
                    </div>
                    <div className="card-title">{hit.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{hit.snippet}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* Center Pane: Article Similarity Network OR Entity-Relation Hypergraph */}
        <section className="graph-pane">
          <div className="graph-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="btn"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderColor: graphMode === 'article' ? 'var(--accent)' : undefined,
                  color: graphMode === 'article' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setGraphMode('article')}
              >
                {t.articleNetMode}
              </button>
              <button
                className="btn"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderColor: graphMode === 'entity' ? 'var(--accent)' : undefined,
                  color: graphMode === 'entity' ? 'var(--accent)' : undefined,
                }}
                onClick={() => {
                  if (activeClusterId) {
                    void loadClusterEntities(activeClusterId);
                  } else if (entities[0]) {
                    void loadEntityGraph(entities[0].id);
                  } else {
                    setGraphMode('entity');
                  }
                }}
              >
                {t.entityHyperMode}
              </button>
              <button
                className="btn"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderColor: graphMode === 'timeline' ? 'var(--accent)' : undefined,
                  color: graphMode === 'timeline' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setGraphMode('timeline')}
              >
                {t.entityTimelineMode}
              </button>
              <span style={{ color: 'var(--muted)', marginLeft: 4 }}>
                {graphMode === 'article' && graphData
                  ? `${graphData.nodes.length} articles · ${graphData.edges.length} links`
                  : graphMode === 'entity' && entityGraph
                    ? `${entityGraph.nodes.length} entities · ${entityGraph.edges.length} relations · ${entityGraph.hyperedges.length} hyperedges`
                    : ''}
              </span>
            </div>

            {graphMode === 'timeline' ? (
            <EntityTimelineView
              entityId={activeTimelineEntityId ?? entityGraph?.centerEntity?.id ?? entities[0]?.id ?? null}
              lang={lang}
              onSelectEntity={(id) => {
                setActiveTimelineEntityId(id);
                setGraphMode('timeline');
              }}
            />
          ) : graphMode === 'article' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>
                  {t.simLabel} {minSimilarity.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={0.75}
                  max={0.95}
                  step={0.01}
                  value={minSimilarity}
                  onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                />
              </label>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showHyperedgeHulls}
                    onChange={(e) => setShowHyperedgeHulls(e.target.checked)}
                  />
                  <span>{t.hullsLabel}</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>
                    {t.weightLabel} {minEdgeWeight}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={minEdgeWeight}
                    onChange={(e) => setMinEdgeWeight(parseInt(e.target.value, 10))}
                  />
                </label>
              </div>
            )}
          </div>

          {graphMode === 'timeline' ? (
            <EntityTimelineView
              entityId={activeTimelineEntityId ?? entityGraph?.centerEntity?.id ?? entities[0]?.id ?? null}
              lang={lang}
              onSelectEntity={(id) => {
                setActiveTimelineEntityId(id);
                setGraphMode('timeline');
              }}
            />
          ) : graphMode === 'article' ? (
            graphData && graphData.nodes.length > 0 ? (
              <ForceGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                minSimilarity={minSimilarity}
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={(n) => setSelectedNode(n)}
              />
            ) : (
              <div className="empty-state">{t.emptyGraph}</div>
            )
          ) : entityGraph && entityGraph.nodes.length > 0 ? (
            <EntityHypergraph
              nodes={entityGraph.nodes}
              edges={entityGraph.edges}
              minWeight={minEdgeWeight}
              showHyperedgeHulls={showHyperedgeHulls}
              hyperedgeSets={entityGraph.hyperedges}
              highlightedEntityIds={hoveredHyperedgeIds}
              selectedEntityId={selectedEntityNode?.id ?? null}
              selectedEdge={selectedEntityEdge}
              onSelectEntity={(ent) => {
                setSelectedEntityNode(ent);
                setSelectedEntityEdge(null);
              }}
              onSelectEdge={(edge) => {
                setSelectedEntityEdge(edge);
              }}
            />
          ) : (
            <div className="empty-state">{t.emptyEntityGraph}</div>
          )}

          <div className="legend">
            {graphMode === 'article'
              ? (Object.keys(OUTLET_COLORS) as OutletId[])
                  .filter((o) => o !== 'dhaka-tribune')
                  .map((outlet) => (
                    <span key={outlet} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span className="dot" style={{ background: OUTLET_COLORS[outlet] }} />
                      {outlet}
                    </span>
                  ))
              : (Object.keys(ENTITY_TYPE_COLORS) as Array<keyof typeof ENTITY_TYPE_COLORS>).map((etype) => (
                  <span key={etype} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span className="dot" style={{ background: ENTITY_TYPE_COLORS[etype] }} />
                    {etype}
                  </span>
                ))}
          </div>
        </section>

        {/* Right Pane: Article Inspector OR Hypergraph Relation & Evidence Inspector */}
        <section className="pane">
          <div className="pane-header">
            <span>{graphMode === 'article' ? t.inspectorTitle : t.hyperInspectorTitle}</span>
            <span>
              {graphMode === 'article'
                ? `${graphData?.nodes.length ?? 0} nodes`
                : `${entityGraph?.edges.length ?? 0} relations`}
            </span>
          </div>

          <div className="pane-scroll">
            {graphMode === 'timeline' ? (
            <EntityTimelineView
              entityId={activeTimelineEntityId ?? entityGraph?.centerEntity?.id ?? entities[0]?.id ?? null}
              lang={lang}
              onSelectEntity={(id) => {
                setActiveTimelineEntityId(id);
                setGraphMode('timeline');
              }}
            />
          ) : graphMode === 'article' ? (
              <>
                {graphData?.entities && graphData.entities.length > 0 && (
                  <div className="card" style={{ cursor: 'default' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
                      {t.clusterEntities}
                    </div>
                    <div className="meta-row">
                      {graphData.entities.map((ent) => (
                        <button
                          key={ent.id}
                          type="button"
                          className="pill"
                          style={{
                            cursor: 'pointer',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                          }}
                          onClick={() => void loadEntityGraph(ent.id)}
                          title="Inspect Entity Hypergraph"
                        >
                          <span className="dot" style={{ background: ENTITY_TYPE_COLORS[ent.entityType] }} />
                          {ent.canonicalBn || ent.canonicalEn} ({ent.articleCount})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode && (
                  <div className="card active" style={{ cursor: 'default' }}>
                    <div className="meta-row">
                      <span className="pill">
                        <span className="dot" style={{ background: OUTLET_COLORS[selectedNode.outlet] }} />
                        {selectedNode.outlet}
                      </span>
                      <span>{selectedNode.publishedAt?.replace('T', ' ').slice(0, 16) ?? ''}</span>
                    </div>
                    <div className="card-title">{selectedNode.title}</div>
                    {selectedNode.lead && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0' }}>
                        {selectedNode.lead}
                      </p>
                    )}
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <a href={selectedNode.canonicalUrl} target="_blank" rel="noreferrer">
                        {t.readOriginal}
                      </a>
                      {activeClusterId && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => void loadClusterEntities(activeClusterId)}
                        >
                          Entity Hypergraph →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {graphData?.nodes.map((node) => (
                  <div
                    key={node.id}
                    className={`card ${selectedNode?.id === node.id ? 'active' : ''}`}
                    onClick={() => setSelectedNode(node)}
                  >
                    <div className="meta-row">
                      <span className="pill">
                        <span className="dot" style={{ background: OUTLET_COLORS[node.outlet] }} />
                        {node.outlet}
                      </span>
                      <span>{node.publishedAt?.replace('T', ' ').slice(0, 16) ?? ''}</span>
                    </div>
                    <div className="card-title" style={{ fontSize: 13 }}>
                      {node.title}
                    </div>
                  </div>
                ))}
              </>
            ) : selectedEntityEdge ? (
              <>
                <div className="card active" style={{ cursor: 'default' }}>
                  <div className="meta-row">
                    <span className="pill" style={{ color: RELATION_TYPE_COLORS[selectedEntityEdge.relationType] }}>
                      {selectedEntityEdge.relationType.replace(/_/g, ' ')}
                    </span>
                    <span>{selectedEntityEdge.weight} articles</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ marginLeft: 'auto', padding: '2px 7px', fontSize: 11 }}
                      onClick={() => setSelectedEntityEdge(null)}
                    >
                      Back
                    </button>
                  </div>
                  <div className="card-title" style={{ marginTop: 8 }}>
                    {(entityNodeById.get(selectedEntityEdge.source)?.canonicalBn ||
                      entityNodeById.get(selectedEntityEdge.source)?.canonicalEn ||
                      selectedEntityEdge.source)}{' '}
                    →{' '}
                    {(entityNodeById.get(selectedEntityEdge.target)?.canonicalBn ||
                      entityNodeById.get(selectedEntityEdge.target)?.canonicalEn ||
                      selectedEntityEdge.target)}
                  </div>
                </div>

                {selectedEntityEdge.evidence.map((ev) => (
                  <div key={`${ev.articleId}-${ev.snippet.slice(0, 16)}`} className="card" style={{ cursor: 'default' }}>
                    <div className="meta-row">
                      <span className="pill">
                        <span className="dot" style={{ background: OUTLET_COLORS[ev.outlet] }} />
                        {ev.outlet}
                      </span>
                      <span>{ev.publishedAt?.slice(0, 10) ?? ''}</span>
                    </div>
                    <div className="card-title" style={{ fontSize: 13 }}>{ev.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45, marginBottom: 6 }}>
                      “{ev.snippet}”
                    </div>
                    <a href={ev.canonicalUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      {t.readOriginal}
                    </a>
                  </div>
                ))}
              </>
            ) : (
              <>
                {selectedEntityNode && (
                  <div className="card active" style={{ cursor: 'default' }}>
                    <div className="meta-row">
                      <span className="pill" style={{ color: ENTITY_TYPE_COLORS[selectedEntityNode.entityType] }}>
                        <span className="dot" style={{ background: ENTITY_TYPE_COLORS[selectedEntityNode.entityType] }} />
                        {selectedEntityNode.entityType}
                      </span>
                      <span>{selectedEntityNode.mentionCount} articles</span>
                    </div>
                    <div className="card-title">
                      {selectedEntityNode.canonicalBn || selectedEntityNode.canonicalEn}
                      {selectedEntityNode.canonicalBn && selectedEntityNode.canonicalEn
                        ? ` (${selectedEntityNode.canonicalEn})`
                        : ''}
                    </div>
                    {selectedEntityNode.roles.length > 0 && (
                      <div className="meta-row" style={{ marginBottom: 8 }}>
                        {selectedEntityNode.roles.map((r) => (
                          <span key={r} className="pill">{r}</span>
                        ))}
                      </div>
                    )}
                    {!selectedEntityNode.isCenter && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => void loadEntityGraph(selectedEntityNode.id)}
                      >
                        Pivot Ego Hypergraph →
                      </button>
                    )}
                  </div>
                )}

                {selectedEntityRelations.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '2px 4px' }}>
                    TYPED RELATIONSHIPS ({selectedEntityRelations.length})
                  </div>
                )}
                {selectedEntityRelations.slice(0, 15).map((rel, idx) => {
                  const otherId = rel.source === selectedEntityNode?.id ? rel.target : rel.source;
                  const other = entityNodeById.get(otherId);
                  return (
                    <div
                      key={`${rel.source}-${rel.target}-${rel.relationType}-${idx}`}
                      className="card"
                      onClick={() => setSelectedEntityEdge(rel)}
                    >
                      <div className="meta-row">
                        <span className="pill" style={{ color: RELATION_TYPE_COLORS[rel.relationType] }}>
                          {rel.relationType.replace(/_/g, ' ')}
                        </span>
                        <span>{rel.weight} articles</span>
                      </div>
                      <div className="card-title" style={{ fontSize: 13 }}>
                        {other?.canonicalBn || other?.canonicalEn || otherId}
                      </div>
                      {rel.evidence[0] && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          “{rel.evidence[0].snippet.slice(0, 110)}”
                        </div>
                      )}
                    </div>
                  );
                })}

                {selectedEntityHyperedges.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '6px 4px 2px' }}>
                    ARTICLE HYPEREDGES ({selectedEntityHyperedges.length})
                  </div>
                )}
                {selectedEntityHyperedges.map((he) => (
                  <div
                    key={he.articleId}
                    className="card"
                    onMouseEnter={() => setHoveredHyperedgeIds(he.entityIds)}
                    onMouseLeave={() => setHoveredHyperedgeIds([])}
                    onClick={() => void loadArticleGraph(he.articleId)}
                  >
                    <div className="meta-row">
                      <span className="pill">
                        <span className="dot" style={{ background: OUTLET_COLORS[he.outlet] }} />
                        {he.outlet}
                      </span>
                      <span>{he.entityIds.length} entities linked</span>
                      <span>{he.publishedAt?.slice(0, 10) ?? ''}</span>
                    </div>
                    <div className="card-title" style={{ fontSize: 13 }}>{he.title}</div>
                    <div className="meta-row">
                      {he.entityIds.map((eid) => {
                        const node = entityNodeById.get(eid);
                        if (!node) return null;
                        return (
                          <span key={eid} className="pill">
                            <span className="dot" style={{ background: ENTITY_TYPE_COLORS[node.entityType] }} />
                            {node.canonicalBn || node.canonicalEn}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
