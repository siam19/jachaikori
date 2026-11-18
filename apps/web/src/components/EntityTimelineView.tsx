import React, { useEffect, useRef, useState } from 'react';
import { getActivity, getEgo, getEventGraph, getEvents } from '../lib/entity-viz/api';
import { renderActivityBrush } from '../lib/entity-viz/activityBrush';
import { renderEgo } from '../lib/entity-viz/egoGraph';
import { renderEventGraph, renderEvidence } from '../lib/entity-viz/eventGraph';
import { readState, toSearch } from '../lib/entity-viz/state';
import { TYPE_COLOR, labelFor } from '../lib/entity-viz/style';
import type {
  ActivityPoint,
  EgoResponse,
  EventEdge,
  EventGraphResponse,
  EventNode,
  Lang,
} from '../lib/entity-viz/types';

interface Props {
  entityId: string | null;
  lang: Lang;
  onSelectEntity: (id: string) => void;
}

function defaultWindow(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 90 * 864e5);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

export function EntityTimelineView({ entityId, lang, onSelectEntity }: Props) {
  const defaults = defaultWindow();
  const initial = typeof window !== 'undefined'
    ? readState(new URL(window.location.href), defaults)
    : { with: [], from: defaults.from, to: defaults.to, lang };

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [withIds, setWithIds] = useState<string[]>(initial.with);

  const [egoData, setEgoData] = useState<EgoResponse | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [intersectEvents, setIntersectEvents] = useState<EventNode[] | null>(null);

  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [eventGraphData, setEventGraphData] = useState<EventGraphResponse | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EventEdge | null>(null);
  const [highlightedEntityId, setHighlightedEntityId] = useState<string | null>(null);
  const [pinnedEntityId, setPinnedEntityId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ entityId: string; eventId: string | null }>>([]);
  const pendingEventRestoreRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const egoSvgRef = useRef<SVGSVGElement>(null);
  const brushSvgRef = useRef<SVGSVGElement>(null);
  const eventSvgRef = useRef<SVGSVGElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);

  const navigateToEntity = (nextId: string) => {
    if (!entityId || nextId === entityId) return;
    setHistory((prev) => [...prev.slice(-19), { entityId, eventId: activeEventId }]);
    onSelectEntity(nextId);
  };

  const goBack = () => {
    if (history.length === 0) {
      if (activeEventId) setActiveEventId(null);
      return;
    }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    if (prev.entityId === entityId) {
      setActiveEventId(prev.eventId);
    } else {
      pendingEventRestoreRef.current = prev.eventId;
      onSelectEntity(prev.entityId);
    }
  };

  // Sync URL state
  useEffect(() => {
    if (!entityId || typeof window === 'undefined') return;
    const search = toSearch({ entity: entityId, with: withIds, from, to, lang });
    window.history.replaceState(null, '', search);
  }, [entityId, withIds, from, to, lang]);

  // Fetch ego + activity when entity or window changes
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const restoredEventId = pendingEventRestoreRef.current;
    pendingEventRestoreRef.current = null;
    setActiveEventId(restoredEventId);
    setEventGraphData(null);
    setSelectedEdge(null);
    setHighlightedEntityId(null);
    setPinnedEntityId(null);

    Promise.all([getEgo(entityId, from, to), getActivity(entityId, from, to)])
      .then(([ego, act]) => {
        if (cancelled) return;
        setEgoData(ego);
        setActivity(act);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load entity timeline');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityId, from, to]);

  // Fetch hyperedge intersection events when `withIds` is non-empty
  useEffect(() => {
    if (!entityId || withIds.length === 0) {
      setIntersectEvents(null);
      return;
    }
    let cancelled = false;
    getEvents([entityId, ...withIds], from, to)
      .then((evs) => {
        if (!cancelled) setIntersectEvents(evs);
      })
      .catch(() => {
        if (!cancelled) setIntersectEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, withIds, from, to]);

  // Fetch event graph when an event is selected
  useEffect(() => {
    setHighlightedEntityId(null);
    setPinnedEntityId(null);
    if (!activeEventId) {
      setEventGraphData(null);
      setSelectedEdge(null);
      return;
    }
    let cancelled = false;
    getEventGraph(activeEventId)
      .then((eg) => {
        if (!cancelled) setEventGraphData(eg);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load event graph');
      });
    return () => {
      cancelled = true;
    };
  }, [activeEventId]);

  // Render Ego SVG
  useEffect(() => {
    if (!egoData || !egoSvgRef.current || activeEventId) return;
    return renderEgo(egoSvgRef.current, egoData, {
      width: 960,
      height: 440,
      lang,
      onEntity: (id) => navigateToEntity(id),
      onEvent: (id) => setActiveEventId(id),
    });
  }, [egoData, lang, activeEventId, entityId]);

  // Render Activity Brush SVG
  useEffect(() => {
    if (!brushSvgRef.current || activity.length === 0) return;
    renderActivityBrush(brushSvgRef.current, activity, {
      width: 960,
      height: 68,
      selected: [from, to],
      onBrush: (newFrom, newTo) => {
        setFrom(newFrom);
        setTo(newTo);
      },
    });
  }, [activity, from, to]);

  // Render Event Graph SVG
  useEffect(() => {
    if (!eventGraphData || !eventSvgRef.current) return;
    return renderEventGraph(eventSvgRef.current, eventGraphData, {
      width: 960,
      height: 360,
      lang,
      onEdge: (edge) => setSelectedEdge(edge),
      onEntity: (id) => navigateToEntity(id),
      onHoverEntity: (id) => setHighlightedEntityId(id),
    });
  }, [eventGraphData, lang, entityId, activeEventId]);

  // Render Evidence safely via textContent
  useEffect(() => {
    if (!evidenceRef.current) return;
    if (!selectedEdge) {
      evidenceRef.current.replaceChildren();
      return;
    }
    renderEvidence(evidenceRef.current, selectedEdge);
  }, [selectedEdge]);

  if (!entityId) {
    return (
      <div className="empty-state">
        {lang === 'bn'
          ? 'টাইমলাইন ও ইভেন্ট দেখতে বাম দিক থেকে একটি এন্টিটি নির্বাচন করুন।'
          : 'Select an entity from the left panel to explore its timeline and events.'}
      </div>
    );
  }

  const displayedEvents = intersectEvents ?? egoData?.events ?? [];

  const toggleWith = (id: string) => {
    setWithIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const activeHighlightId = highlightedEntityId ?? pinnedEntityId;
  const centerLabel = egoData ? labelFor(egoData.center, lang) : entityId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 10, padding: 12 }}>
      {/* Navigation & Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {history.length > 0 && (
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={goBack}>
              {lang === 'bn' ? '← পেছনে' : '← Back'}
            </button>
          )}
          {egoData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: TYPE_COLOR[egoData.center.type],
                  display: 'inline-block',
                }}
              />
              <strong style={{ fontSize: 14 }}>{centerLabel}</strong>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {egoData.events.length} {lang === 'bn' ? 'টি ইভেন্ট' : 'events'}
              </span>
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {activeEventId
            ? lang === 'bn'
              ? 'এন্টিটিতে হোভার করলে সংশ্লিষ্ট সংবাদ হাইলাইট হবে · ক্লিক করলে কেন্দ্র বদলাবে'
              : 'Hover an entity to highlight its articles · Click an entity to center it'
            : lang === 'bn'
              ? 'বৃত্তে ক্লিক করে ইভেন্ট দেখুন · এন্টিটিতে ক্লিক করে কেন্দ্র বদলান'
              : 'Click a circle to open an event · Click an entity to center it'}
        </span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading timeline…'}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>
      )}

      {/* Activity Brush */}
      {!activeEventId && activity.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
            {lang === 'bn' ? `সময়সীমা: ${from} → ${to}` : `Window (UTC): ${from} → ${to}`}
          </div>
          <svg
            ref={brushSvgRef}
            role="group"
            aria-label="Entity activity over time"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>
      )}

      {/* Main Graph: either EventGraph (when drilled in) or EgoGraph */}
      {activeEventId && eventGraphData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
              <div>
                <strong style={{ fontSize: 14 }}>{eventGraphData.event.label}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                  {eventGraphData.event.start.slice(0, 10)} · {eventGraphData.event.articleCount} articles
                </span>
              </div>
              <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setActiveEventId(null)}>
                {lang === 'bn' ? '← ইভেন্ট তালিকায় ফিরুন' : '← Back to Timeline'}
              </button>
            </div>
            <svg
              ref={eventSvgRef}
              role="group"
              aria-label="Event entity relation graph"
              style={{ width: '100%', height: 'auto', fontFamily: "'Noto Sans Bengali', system-ui, sans-serif" }}
            />
            {eventGraphData.entities.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {lang === 'bn' ? 'এন্টিটি (হোভার = সংবাদ হাইলাইট):' : 'Entities (hover to highlight articles):'}
                </span>
                {eventGraphData.entities.map((ent) => {
                  const isHighlighted = activeHighlightId === ent.id;
                  return (
                    <button
                      key={ent.id}
                      className="btn"
                      onMouseEnter={() => setHighlightedEntityId(ent.id)}
                      onMouseLeave={() => setHighlightedEntityId(null)}
                      onFocus={() => setHighlightedEntityId(ent.id)}
                      onBlur={() => setHighlightedEntityId(null)}
                      onClick={() => navigateToEntity(ent.id)}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        borderColor: isHighlighted ? TYPE_COLOR[ent.type] : undefined,
                        background: isHighlighted ? 'var(--accent-soft)' : undefined,
                      }}
                    >
                      {labelFor(ent, lang)}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedEdge && (
              <div style={{ marginTop: 10, padding: 10, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  {selectedEdge.relationType} ({selectedEdge.evidence.length})
                </div>
                <div ref={evidenceRef} style={{ fontSize: 12, color: 'var(--text)' }} />
              </div>
            )}
          </div>

          {/* Clickable Articles for the selected Event */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
              {lang === 'bn'
                ? `সংশ্লিষ্ট সংবাদ (${eventGraphData.articles?.length ?? 0})`
                : `Articles (${eventGraphData.articles?.length ?? 0})`}
            </div>
            {!eventGraphData.articles || eventGraphData.articles.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {lang === 'bn' ? 'কোনো সংবাদ পাওয়া যায়নি।' : 'No articles linked to this event.'}
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {eventGraphData.articles.map((article) => {
                  const mentioned = activeHighlightId ? article.entityIds.includes(activeHighlightId) : false;
                  const dimmed = Boolean(activeHighlightId && !mentioned);
                  return (
                    <li
                      key={article.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: mentioned ? 'var(--accent-soft)' : 'var(--bg)',
                        border: `1px solid ${mentioned ? 'var(--accent)' : 'var(--border)'}`,
                        opacity: dimmed ? 0.5 : 1,
                        transition: 'opacity 120ms ease, border-color 120ms ease, background 120ms ease',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {article.canonicalUrl ? (
                          <a
                            href={article.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: 'var(--text)',
                              textDecoration: 'none',
                              fontSize: 13,
                              fontWeight: 500,
                              display: 'block',
                            }}
                          >
                            {article.title} ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: 13, color: 'var(--text)' }}>{article.title}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {mentioned && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'var(--accent)',
                              color: '#06121f',
                            }}
                          >
                            {lang === 'bn' ? 'উল্লিখিত' : 'Mentioned'}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {article.outlet}
                          {article.publishedAt ? ` · ${article.publishedAt.slice(0, 10)}` : ''}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        egoData && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <svg
              ref={egoSvgRef}
              role="group"
              aria-label="Events and related entities over time"
              style={{ width: '100%', height: 'auto', fontFamily: "'Noto Sans Bengali', system-ui, sans-serif" }}
            />
          </div>
        )
      )}

      {/* Co-entity ?with= intersection chips (only in timeline view) */}
      {!activeEventId && egoData && egoData.entities.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {lang === 'bn' ? 'সহ-এন্টিটি ফিল্টার:' : 'Filter with:'}
          </span>
          {egoData.entities
            .filter((e) => e.id !== entityId)
            .slice(0, 10)
            .map((e) => {
              const active = withIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  className="btn"
                  onClick={() => toggleWith(e.id)}
                  style={{
                    padding: '3px 8px',
                    fontSize: 11,
                    borderColor: active ? TYPE_COLOR[e.type] : undefined,
                    background: active ? 'var(--accent-soft)' : undefined,
                  }}
                >
                  {labelFor(e, lang)} ({e.eventCount})
                </button>
              );
            })}
        </div>
      )}

      {/* Accessible plain-list fallback (only in timeline view) */}
      {!activeEventId && displayedEvents.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
            {lang === 'bn' ? `ইভেন্ট তালিকা (${displayedEvents.length})` : `Events (${displayedEvents.length})`}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {displayedEvents.map((ev) => (
              <li
                key={ev.id}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <button
                  onClick={() => setActiveEventId(ev.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  {ev.label}
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {ev.start.slice(0, 10)} · {ev.articleCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
