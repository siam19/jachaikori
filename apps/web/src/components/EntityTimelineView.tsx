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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const egoSvgRef = useRef<SVGSVGElement>(null);
  const brushSvgRef = useRef<SVGSVGElement>(null);
  const eventSvgRef = useRef<SVGSVGElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);

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
    setActiveEventId(null);
    setEventGraphData(null);
    setSelectedEdge(null);

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
      height: 500,
      lang,
      onEntity: (id) => {
        if (id !== entityId) onSelectEntity(id);
      },
      onEvent: (id) => setActiveEventId(id),
    });
  }, [egoData, lang, activeEventId, entityId, onSelectEntity]);

  // Render Activity Brush SVG
  useEffect(() => {
    if (!brushSvgRef.current || activity.length === 0) return;
    renderActivityBrush(brushSvgRef.current, activity, {
      width: 960,
      height: 84,
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
      height: 500,
      lang,
      onEdge: (edge) => setSelectedEdge(edge),
      onEntity: (id) => {
        setActiveEventId(null);
        onSelectEntity(id);
      },
    });
  }, [eventGraphData, lang, onSelectEntity]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 10, padding: 12 }}>
      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading timeline…'}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>
      )}

      {/* Activity Brush */}
      {activity.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
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
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <strong style={{ fontSize: 14 }}>{eventGraphData.event.label}</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                {eventGraphData.event.start} · {eventGraphData.event.articleCount} articles
              </span>
            </div>
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setActiveEventId(null)}>
              {lang === 'bn' ? '← টাইমলাইনে ফিরুন' : '← Back to Timeline'}
            </button>
          </div>
          <svg
            ref={eventSvgRef}
            role="group"
            aria-label="Event entity relation graph"
            style={{ width: '100%', height: 'auto', fontFamily: "'Noto Sans Bengali', system-ui, sans-serif" }}
          />
          {selectedEdge && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                {selectedEdge.relationType} ({selectedEdge.evidence.length})
              </div>
              <div ref={evidenceRef} style={{ fontSize: 12, color: 'var(--text)' }} />
            </div>
          )}
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

      {/* Co-entity ?with= intersection chips */}
      {egoData && egoData.entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {lang === 'bn' ? 'সহ-এন্টিটি ফিল্টার (?with=):' : 'Intersect with (?with=):'}
          </span>
          {egoData.entities
            .filter((e) => e.id !== entityId)
            .slice(0, 16)
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

      {/* Accessible plain-list fallback (also great on mobile) */}
      {displayedEvents.length > 0 && (
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
