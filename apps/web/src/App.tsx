import React, { useEffect, useState } from 'react';
import type {
  ClusterGraphResponse,
  EventCluster,
  GraphNode,
  OutletId,
  SearchHit,
  SearchMode,
} from '@jachaikori/schema';
import { ForceGraph, OUTLET_COLORS } from './components/ForceGraph';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const UI_COPY = {
  en: {
    brand: 'Jachaikori',
    badge: 'Cluster Explorer',
    searchPlaceholder: 'Search Bangla or English claim / headline…',
    searchBtn: 'Search',
    clustersTitle: 'Event Clusters',
    searchTitle: 'Search Results',
    graphTitle: 'Similarity Network',
    inspectorTitle: 'Coverage Timeline',
    simLabel: 'Similarity ≥',
    emptyGraph: 'Select an event cluster or search hit to inspect how outlets connected and covered it.',
    readOriginal: 'Read original article ↗',
    entitiesSoon: 'Canonical Entities (Phase 3 ready)',
  },
  bn: {
    brand: 'যাচাই করি',
    badge: 'ক্লাস্টার এক্সপ্লোরার',
    searchPlaceholder: 'বাংলা বা ইংরেজি দাবি / শিরোনাম লিখুন…',
    searchBtn: 'খুঁজুন',
    clustersTitle: 'ইভেন্ট ক্লাস্টার',
    searchTitle: 'অনুসন্ধানের ফলাফল',
    graphTitle: 'সাদৃশ্য নেটওয়ার্ক',
    inspectorTitle: 'প্রকাশনার সময়ক্রম',
    simLabel: 'সাদৃশ্য ≥',
    emptyGraph: 'সংবাদমাধ্যমগুলোর কভারেজ সম্পর্ক দেখতে বাম দিক থেকে একটি ক্লাস্টার বা সংবাদ নির্বাচন করুন।',
    readOriginal: 'মূল প্রতিবেদন পড়ুন ↗',
    entitiesSoon: 'ক্যানোনিকাল এন্টিটি (Phase 3 প্রস্তুত)',
  },
} as const;

export function App() {
  const [lang, setLang] = useState<'en' | 'bn'>('en');
  const t = UI_COPY[lang];

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [leftTab, setLeftTab] = useState<'clusters' | 'search'>('clusters');

  const [clusters, setClusters] = useState<EventCluster[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ latencyMs: number; mode: string } | null>(null);

  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<ClusterGraphResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [minSimilarity, setMinSimilarity] = useState(0.78);
  const [healthInfo, setHealthInfo] = useState<{ articles: number; clusters: number } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loadingClusters, setLoadingClusters] = useState(true);

  async function loadInitialData() {
    setApiError(null);
    setLoadingClusters(true);
    try {
      const [healthRes, clustersRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/clusters?minOutlets=2&limit=40`),
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

  async function loadClusterGraph(clusterId: string) {
    setActiveClusterId(clusterId);
    const res = await fetch(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/graph`);
    if (res.ok) {
      const data: ClusterGraphResponse = await res.json();
      setGraphData(data);
      setSelectedNode(data.nodes[0] ?? null);
    }
  }

  async function loadArticleGraph(articleId: string) {
    setActiveClusterId(null);
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
      setSearchMeta({ latencyMs: data.latencyMs, mode: data.mode });
      setLeftTab('search');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>{t.brand}</span>
          <span className="brand-badge">{t.badge}</span>
          {healthInfo && (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
              {healthInfo.articles.toLocaleString()} articles · {healthInfo.clusters.toLocaleString()} clusters
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
        {/* Left Pane: Event Cluster Feed or Search Results */}
        <section className="pane">
          <div className="pane-header">
            <div style={{ display: 'flex', gap: 8 }}>
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
                  borderColor: leftTab === 'search' ? 'var(--accent)' : undefined,
                }}
                onClick={() => setLeftTab('search')}
              >
                {t.searchTitle} ({searchHits.length})
              </button>
            </div>
            {searchMeta && leftTab === 'search' && <span>{searchMeta.latencyMs}ms</span>}
          </div>

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
                    onClick={() => loadClusterGraph(c.id)}
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
            ) : (
              searchHits.map((hit) => (
                <div
                  key={hit.articleId}
                  className={`card ${selectedNode?.id === hit.articleId ? 'active' : ''}`}
                  onClick={() =>
                    hit.clusterId ? loadClusterGraph(hit.clusterId) : loadArticleGraph(hit.articleId)
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
              ))
            )}
          </div>
        </section>

        {/* Center Pane: Interactive Force-Directed Similarity Graph */}
        <section className="graph-pane">
          <div className="graph-toolbar">
            <span style={{ fontWeight: 600 }}>
              {t.graphTitle}
              {graphData ? ` (${graphData.nodes.length} articles, ${graphData.edges.length} links)` : ''}
            </span>
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
          </div>

          {graphData && graphData.nodes.length > 0 ? (
            <ForceGraph
              nodes={graphData.nodes}
              edges={graphData.edges}
              minSimilarity={minSimilarity}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={(n) => setSelectedNode(n)}
            />
          ) : (
            <div className="empty-state">{t.emptyGraph}</div>
          )}

          <div className="legend">
            {(Object.keys(OUTLET_COLORS) as OutletId[])
              .filter((o) => o !== 'dhaka-tribune')
              .map((outlet) => (
                <span key={outlet} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="dot" style={{ background: OUTLET_COLORS[outlet] }} />
                  {outlet}
                </span>
              ))}
          </div>
        </section>

        {/* Right Pane: Cross-Outlet Timeline & Article Inspector */}
        <section className="pane">
          <div className="pane-header">
            <span>{t.inspectorTitle}</span>
            <span>{graphData?.nodes.length ?? 0} nodes</span>
          </div>

          <div className="pane-scroll">
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
                  <span className="pill" style={{ color: 'var(--muted)' }}>
                    {t.entitiesSoon}
                  </span>
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
          </div>
        </section>
      </main>
    </div>
  );
}
