import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type {
  EntityGraphEdge,
  EntityGraphNode,
  EntityRelationType,
  EntityType,
} from '@jachaikori/schema';

export const ENTITY_TYPE_COLORS: Record<EntityType, string> = {
  person: '#38bdf8',
  org: '#a855f7',
  location: '#10b981',
  role: '#f59e0b',
  event_topic: '#ec4899',
};

export const RELATION_TYPE_COLORS: Record<EntityRelationType, string> = {
  quoted_about: '#38bdf8',
  resigned_from: '#ef4444',
  legal_action: '#f59e0b',
  criticized_or_protested: '#ec4899',
  met_with: '#10b981',
  announced_or_agreed: '#a855f7',
  located_in: '#64748b',
  co_occurred: '#475569',
};

interface SimEntityNode extends SimulationNodeDatum, EntityGraphNode {}
interface SimEntityLink extends SimulationLinkDatum<SimEntityNode> {
  raw: EntityGraphEdge;
  relationType: EntityRelationType;
  weight: number;
}

interface DragState {
  mode: 'pan' | 'node';
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  movedPx: number;
  node: SimEntityNode | null;
  didWakeSim: boolean;
}

interface EntityHypergraphProps {
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
  minWeight: number;
  showHyperedgeHulls: boolean;
  hyperedgeSets: Array<{ articleId: string; title: string; entityIds: string[] }>;
  highlightedEntityIds: string[];
  selectedEntityId: string | null;
  selectedEdge: EntityGraphEdge | null;
  onSelectEntity: (node: EntityGraphNode) => void;
  onSelectEdge: (edge: EntityGraphEdge) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

function nodeRadius(n: EntityGraphNode): number {
  const base = n.isCenter ? 14 : 9;
  return base + Math.min(12, Math.sqrt(n.mentionCount) * 2.2);
}

function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export const EntityHypergraph: React.FC<EntityHypergraphProps> = ({
  nodes,
  edges,
  minWeight,
  showHyperedgeHulls,
  hyperedgeSets,
  highlightedEntityIds,
  selectedEntityId,
  selectedEdge,
  onSelectEntity,
  onSelectEdge,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimEntityNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<EntityGraphEdge | null>(null);
  const [isDragging, setIsDragging] = useState<'pan' | 'node' | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const simNodesRef = useRef<SimEntityNode[]>([]);
  const simLinksRef = useRef<SimEntityLink[]>([]);
  const simulationRef = useRef<Simulation<SimEntityNode, SimEntityLink> | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ width: 400, height: 320, dpr: 1 });
  const dragRef = useRef<DragState | null>(null);

  const selectedEntityRef = useRef(selectedEntityId);
  const selectedEdgeRef = useRef(selectedEdge);
  const hoveredNodeRef = useRef<SimEntityNode | null>(null);
  const hoveredEdgeRef = useRef<EntityGraphEdge | null>(null);
  const highlightedSetRef = useRef<Set<string>>(new Set());
  const hyperedgeSetsRef = useRef(hyperedgeSets);
  const showHullsRef = useRef(showHyperedgeHulls);

  selectedEntityRef.current = selectedEntityId;
  selectedEdgeRef.current = selectedEdge;
  hoveredNodeRef.current = hoveredNode;
  hoveredEdgeRef.current = hoveredEdge;
  highlightedSetRef.current = new Set(highlightedEntityIds);
  hyperedgeSetsRef.current = hyperedgeSets;
  showHullsRef.current = showHyperedgeHulls;

  const filteredEdges = useMemo(
    () => edges.filter((e) => e.weight >= minWeight),
    [edges, minWeight]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = sizeRef.current;
    const { x: tx, y: ty, scale } = transformRef.current;
    const curSelEnt = selectedEntityRef.current;
    const curSelEdge = selectedEdgeRef.current;
    const curHovNode = hoveredNodeRef.current;
    const curHovEdge = hoveredEdgeRef.current;
    const hlSet = highlightedSetRef.current;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    const nodeById = new Map(simNodesRef.current.map((n) => [n.id, n]));

    // Draw translucent article hyperedge loops when enabled or when an article hyperedge is hovered
    if (showHullsRef.current || hlSet.size >= 2) {
      const activeGroups =
        hlSet.size >= 2
          ? [{ articleId: 'active', title: '', entityIds: Array.from(hlSet), highlight: true }]
          : hyperedgeSetsRef.current
              .filter((h) => h.entityIds.length >= 2)
              .slice(0, 8)
              .map((h) => ({ ...h, highlight: false }));

      for (const group of activeGroups) {
        const pts = group.entityIds
          .map((id) => nodeById.get(id))
          .filter((n): n is SimEntityNode => Boolean(n && n.x != null && n.y != null));
        if (pts.length < 2) continue;

        const cx = pts.reduce((sum, p) => sum + p.x!, 0) / pts.length;
        const cy = pts.reduce((sum, p) => sum + p.y!, 0) / pts.length;

        ctx.save();
        ctx.beginPath();
        // Sort radially around centroid to trace a smooth hyperedge envelope
        const sorted = [...pts].sort(
          (a, b) => Math.atan2(a.y! - cy, a.x! - cx) - Math.atan2(b.y! - cy, b.x! - cx)
        );
        for (let i = 0; i < sorted.length; i++) {
          const p = sorted[i]!;
          const angle = Math.atan2(p.y! - cy, p.x! - cx);
          const pad = nodeRadius(p) + 14;
          const px = p.x! + Math.cos(angle) * pad;
          const py = p.y! + Math.sin(angle) * pad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = group.highlight
          ? 'rgba(56, 189, 248, 0.14)'
          : 'rgba(168, 85, 247, 0.05)';
        ctx.fill();
        ctx.setLineDash([5 / scale, 4 / scale]);
        ctx.lineWidth = (group.highlight ? 2 : 1) / Math.sqrt(scale);
        ctx.strokeStyle = group.highlight
          ? 'rgba(56, 189, 248, 0.7)'
          : 'rgba(168, 85, 247, 0.25)';
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw typed entity relationship edges
    for (const link of simLinksRef.current) {
      const src = link.source as SimEntityNode;
      const tgt = link.target as SimEntityNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

      const isSelected =
        curSelEdge &&
        curSelEdge.source === link.raw.source &&
        curSelEdge.target === link.raw.target &&
        curSelEdge.relationType === link.raw.relationType;
      const isHovered =
        curHovEdge &&
        curHovEdge.source === link.raw.source &&
        curHovEdge.target === link.raw.target &&
        curHovEdge.relationType === link.raw.relationType;
      const touchesSelectedEntity =
        curSelEnt && (src.id === curSelEnt || tgt.id === curSelEnt);

      const baseColor = RELATION_TYPE_COLORS[link.relationType] ?? '#64748b';
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : baseColor;
      ctx.globalAlpha =
        isSelected || isHovered || touchesSelectedEntity ? 0.95 : link.relationType === 'co_occurred' ? 0.35 : 0.65;
      ctx.lineWidth =
        ((isSelected || isHovered ? 3.2 : 1.1) + Math.min(4, Math.log2(link.weight + 1))) /
        Math.sqrt(scale);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isSelected || isHovered || (link.relationType !== 'co_occurred' && scale >= 0.85)) {
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = isSelected || isHovered ? '#ffffff' : 'rgba(203, 213, 225, 0.78)';
        ctx.textAlign = 'center';
        ctx.fillText(`${link.relationType.replace(/_/g, ' ')} (${link.weight})`, mx, my - 4);
      }
    }

    // Draw canonical entity nodes
    for (const node of simNodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const r = nodeRadius(node);
      const color = ENTITY_TYPE_COLORS[node.entityType] ?? '#94a3b8';
      const isSelected = node.id === curSelEnt;
      const isHovered = curHovNode?.id === node.id;
      const isHyperHighlighted = hlSet.has(node.id);

      if (node.isCenter || isHyperHighlighted) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = isHyperHighlighted ? '#38bdf8' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2 / Math.sqrt(scale);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.lineWidth = 3 / Math.sqrt(scale);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      const label = node.canonicalBn || node.canonicalEn || node.id;
      ctx.font = `${node.isCenter ? '600 12px' : '500 11px'} "Inter", "Noto Sans Bengali", sans-serif`;
      ctx.fillStyle = isSelected || isHovered || node.isCenter ? '#ffffff' : 'rgba(230, 237, 247, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(label, node.x, node.y + r + 13);
    }

    ctx.restore();
  }, []);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(280, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    sizeRef.current = { width, height, dpr };
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    syncCanvasSize();
    const observer = new ResizeObserver(() => syncCanvasSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncCanvasSize]);

  useEffect(() => {
    draw();
  }, [selectedEntityId, selectedEdge, hoveredNode, hoveredEdge, highlightedEntityIds, showHyperedgeHulls, draw]);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pivotX = clientX != null ? clientX - rect.left : sizeRef.current.width / 2;
      const pivotY = clientY != null ? clientY - rect.top : sizeRef.current.height / 2;

      const prev = transformRef.current;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      if (nextScale === prev.scale) return;

      const worldX = (pivotX - prev.x) / prev.scale;
      const worldY = (pivotY - prev.y) / prev.scale;

      transformRef.current = {
        scale: nextScale,
        x: pivotX - worldX * nextScale,
        y: pivotY - worldY * nextScale,
      };
      setZoomPct(Math.round(nextScale * 100));
      draw();
    },
    [draw]
  );

  const resetView = useCallback(() => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setZoomPct(100);
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) {
      simNodesRef.current = [];
      simLinksRef.current = [];
      simulationRef.current?.stop();
      simulationRef.current = null;
      draw();
      return;
    }

    syncCanvasSize();
    const { width, height } = sizeRef.current;
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setZoomPct(100);

    const simNodes: SimEntityNode[] = nodes.map((n) => ({
      ...n,
      x: n.isCenter ? width / 2 : width / 2 + (Math.random() - 0.5) * 200,
      y: n.isCenter ? height / 2 : height / 2 + (Math.random() - 0.5) * 200,
    }));

    const nodeIds = new Set(simNodes.map((n) => n.id));
    const simLinks: SimEntityLink[] = filteredEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        raw: e,
        relationType: e.relationType,
        weight: e.weight,
      }));

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    const simulation = forceSimulation<SimEntityNode>(simNodes)
      .force(
        'link',
        forceLink<SimEntityNode, SimEntityLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => Math.max(95, 175 - Math.log2(d.weight + 1) * 18))
          .strength(0.35)
      )
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimEntityNode>((d) => nodeRadius(d) + 22));

    simulationRef.current = simulation;
    simulation.on('tick', draw);

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, filteredEdges, draw, syncCanvasSize]);

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { x: tx, y: ty, scale } = transformRef.current;
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    };
  }

  function findNodeAt(clientX: number, clientY: number): SimEntityNode | null {
    const pt = clientToWorld(clientX, clientY);
    if (!pt) return null;
    for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
      const n = simNodesRef.current[i]!;
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n) + 4;
      const dx = pt.x - n.x;
      const dy = pt.y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function findEdgeAt(clientX: number, clientY: number): EntityGraphEdge | null {
    const pt = clientToWorld(clientX, clientY);
    if (!pt) return null;
    let best: EntityGraphEdge | null = null;
    let bestDist = 7 / transformRef.current.scale;
    for (const link of simLinksRef.current) {
      const s = link.source as SimEntityNode;
      const t = link.target as SimEntityNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const d = pointToSegmentDist(pt.x, pt.y, s.x, s.y, t.x, t.y);
      if (d < bestDist) {
        bestDist = d;
        best = link.raw;
      }
    }
    return best;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hit = findNodeAt(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);

    dragRef.current = {
      mode: hit ? 'node' : 'pan',
      pointerId: e.pointerId,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      movedPx: 0,
      node: hit,
      didWakeSim: false,
    };

    if (hit) {
      hit.fx = hit.x;
      hit.fy = hit.y;
      setIsDragging('node');
    } else {
      setIsDragging('pan');
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) {
      const hitNode = findNodeAt(e.clientX, e.clientY);
      setHoveredNode(hitNode);
      setHoveredEdge(hitNode ? null : findEdgeAt(e.clientX, e.clientY));
      return;
    }

    const dx = e.clientX - drag.lastClientX;
    const dy = e.clientY - drag.lastClientY;
    drag.lastClientX = e.clientX;
    drag.lastClientY = e.clientY;
    drag.movedPx += Math.hypot(dx, dy);

    if (drag.mode === 'pan') {
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      draw();
      return;
    }

    if (drag.mode === 'node' && drag.node) {
      if (!drag.didWakeSim && drag.movedPx > 3) {
        simulationRef.current?.alphaTarget(0.25).restart();
        drag.didWakeSim = true;
      }
      const pt = clientToWorld(e.clientX, e.clientY);
      if (pt) {
        drag.node.fx = pt.x;
        drag.node.fy = pt.y;
        drag.node.x = pt.x;
        drag.node.y = pt.y;
        draw();
      }
    }
  }

  function handlePointerUpOrCancel(e: React.PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (drag.mode === 'node' && drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
      if (drag.didWakeSim) simulationRef.current?.alphaTarget(0);
      if (!cancelled && drag.movedPx <= 4) {
        onSelectEntity(drag.node);
      }
    } else if (drag.mode === 'pan' && !cancelled && drag.movedPx <= 4) {
      const edgeHit = findEdgeAt(e.clientX, e.clientY);
      if (edgeHit) onSelectEdge(edgeHit);
    }

    dragRef.current = null;
    setIsDragging(null);
  }

  const cursorStyle =
    isDragging ? 'grabbing' : hoveredNode || hoveredEdge ? 'pointer' : 'grab';

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 320, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: cursorStyle }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => handlePointerUpOrCancel(e, false)}
        onPointerCancel={(e) => handlePointerUpOrCancel(e, true)}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHoveredNode(null);
            setHoveredEdge(null);
          }
        }}
        onDoubleClick={() => resetView()}
      />

      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(11, 15, 23, 0.85)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '4px 6px',
          fontSize: 11,
        }}
      >
        <button type="button" className="btn" style={{ padding: '2px 7px', fontSize: 12 }} onClick={() => zoomAt(1 / 1.2)}>
          −
        </button>
        <span style={{ minWidth: 38, textAlign: 'center', color: 'var(--muted)' }}>{zoomPct}%</span>
        <button type="button" className="btn" style={{ padding: '2px 7px', fontSize: 12 }} onClick={() => zoomAt(1.2)}>
          +
        </button>
        <button type="button" className="btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => resetView()}>
          Reset
        </button>
      </div>

      {(hoveredNode || hoveredEdge) && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            right: 12,
            maxWidth: 500,
            background: 'rgba(11, 15, 23, 0.94)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {hoveredNode ? (
            <>
              <div style={{ color: ENTITY_TYPE_COLORS[hoveredNode.entityType], fontWeight: 600 }}>
                {hoveredNode.entityType} · {hoveredNode.mentionCount.toLocaleString()} articles
              </div>
              <div style={{ marginTop: 2, fontWeight: 600 }}>
                {hoveredNode.canonicalBn || hoveredNode.canonicalEn}
                {hoveredNode.canonicalBn && hoveredNode.canonicalEn ? ` (${hoveredNode.canonicalEn})` : ''}
              </div>
            </>
          ) : hoveredEdge ? (
            <>
              <div style={{ color: RELATION_TYPE_COLORS[hoveredEdge.relationType], fontWeight: 600 }}>
                {hoveredEdge.relationType.replace(/_/g, ' ')} · {hoveredEdge.weight} articles
              </div>
              {hoveredEdge.evidence[0] && (
                <div style={{ marginTop: 2, color: 'var(--muted)' }}>{hoveredEdge.evidence[0].snippet}</div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};
