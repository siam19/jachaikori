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
import type { GraphEdge, GraphNode, OutletId } from '@jachaikori/schema';

export const OUTLET_COLORS: Record<OutletId, string> = {
  'prothom-alo': '#ef4444',
  'daily-star': '#38bdf8',
  'business-standard': '#f59e0b',
  'bdnews24': '#a855f7',
  'ittefaq': '#10b981',
  'jugantor': '#ec4899',
  'bangladesh-protidin': '#84cc16',
  'kaler-kantho': '#fb923c',
  'dhaka-tribune': '#94a3b8',
};

interface SimNode extends SimulationNodeDatum, GraphNode {}
interface SimLink extends SimulationLinkDatum<SimNode> {
  similarity: number;
}

interface DragState {
  mode: 'pan' | 'node';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  movedPx: number;
  node: SimNode | null;
  didWakeSim: boolean;
}

interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  minSimilarity: number;
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNode) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export const ForceGraph: React.FC<ForceGraphProps> = ({
  nodes,
  edges,
  minSimilarity,
  selectedNodeId,
  onSelectNode,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [isDragging, setIsDragging] = useState<'pan' | 'node' | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ width: 400, height: 300, dpr: 1 });
  const dragRef = useRef<DragState | null>(null);
  const selectedIdRef = useRef<string | null>(selectedNodeId);
  const hoveredIdRef = useRef<string | null>(null);

  selectedIdRef.current = selectedNodeId;
  hoveredIdRef.current = hoveredNode?.id ?? null;

  const filteredEdges = useMemo(
    () => edges.filter((e) => e.similarity >= minSimilarity),
    [edges, minSimilarity]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = sizeRef.current;
    const curSelected = selectedIdRef.current;
    const curHovered = hoveredIdRef.current;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { x: tx, y: ty, scale } = transformRef.current;
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    // Draw similarity edges
    for (const link of simLinksRef.current) {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

      const isHighlighted =
        curSelected && (src.id === curSelected || tgt.id === curSelected);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = isHighlighted
        ? 'rgba(56, 189, 248, 0.85)'
        : `rgba(148, 163, 184, ${Math.min(0.65, (link.similarity - 0.7) * 2)})`;
      ctx.lineWidth = (isHighlighted ? 2.2 : 1 + (link.similarity - 0.75) * 4) / Math.sqrt(scale);
      ctx.stroke();
    }

    // Draw article nodes colored by outlet
    for (const node of simNodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const radius = 8 + Math.min(10, node.degree * 1.4);
      const color = OUTLET_COLORS[node.outlet] ?? '#94a3b8';
      const isSelected = node.id === curSelected;
      const isHovered = node.id === curHovered;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.lineWidth = 3 / Math.sqrt(scale);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // Compact outlet label under node
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(230, 237, 247, 0.82)';
      ctx.textAlign = 'center';
      ctx.fillText(node.outlet, node.x, node.y + radius + 12);
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
  }, [selectedNodeId, hoveredNode, draw]);

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

  // Attach non-passive wheel listener so scrolling over the canvas zooms without scrolling the page
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(factor, e.clientX, e.clientY);
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

    const simNodes: SimNode[] = nodes.map((n) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 140,
      y: height / 2 + (Math.random() - 0.5) * 140,
    }));

    const simLinks: SimLink[] = filteredEdges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => 150 - d.similarity * 70)
          .strength((d) => Math.max(0.2, d.similarity - 0.5))
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>((d) => 12 + Math.min(8, d.degree * 1.5)));

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

  function findNodeAt(clientX: number, clientY: number): SimNode | null {
    const pt = clientToWorld(clientX, clientY);
    if (!pt) return null;

    for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
      const n = simNodesRef.current[i]!;
      if (n.x == null || n.y == null) continue;
      const r = 10 + Math.min(10, n.degree * 1.4);
      const dx = pt.x - n.x;
      const dy = pt.y - n.y;
      if (dx * dx + dy * dy <= r * r) {
        return n;
      }
    }
    return null;
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
      startClientX: e.clientX,
      startClientY: e.clientY,
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
      setHoveredNode(findNodeAt(e.clientX, e.clientY));
      return;
    }

    const stepDx = e.clientX - drag.lastClientX;
    const stepDy = e.clientY - drag.lastClientY;
    drag.lastClientX = e.clientX;
    drag.lastClientY = e.clientY;
    drag.movedPx += Math.hypot(stepDx, stepDy);

    if (drag.mode === 'pan') {
      transformRef.current.x += stepDx;
      transformRef.current.y += stepDy;
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
      if (drag.didWakeSim) {
        simulationRef.current?.alphaTarget(0);
      }
      if (!cancelled && drag.movedPx <= 4) {
        onSelectNode(drag.node);
      }
    }

    dragRef.current = null;
    setIsDragging(null);
  }

  const cursorStyle =
    isDragging === 'pan' || isDragging === 'node'
      ? 'grabbing'
      : hoveredNode
        ? 'pointer'
        : 'grab';

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 320, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          cursor: cursorStyle,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => handlePointerUpOrCancel(e, false)}
        onPointerCancel={(e) => handlePointerUpOrCancel(e, true)}
        onPointerLeave={() => {
          if (!dragRef.current) setHoveredNode(null);
        }}
        onDoubleClick={() => resetView()}
      />

      {/* Zoom & Reset Controls */}
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
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 7px', fontSize: 12 }}
          title="Zoom out"
          onClick={() => zoomAt(1 / 1.2)}
        >
          −
        </button>
        <span style={{ minWidth: 38, textAlign: 'center', color: 'var(--muted)' }}>{zoomPct}%</span>
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 7px', fontSize: 12 }}
          title="Zoom in"
          onClick={() => zoomAt(1.2)}
        >
          +
        </button>
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 7px', fontSize: 11 }}
          title="Reset pan & zoom"
          onClick={() => resetView()}
        >
          Reset
        </button>
      </div>

      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            right: 12,
            maxWidth: 480,
            background: 'rgba(11, 15, 23, 0.94)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          <div style={{ color: OUTLET_COLORS[hoveredNode.outlet], fontWeight: 600 }}>
            {hoveredNode.outlet} · {hoveredNode.publishedAt?.slice(0, 10) ?? 'unknown date'}
          </div>
          <div style={{ marginTop: 2, fontWeight: 500 }}>{hoveredNode.title}</div>
        </div>
      )}
    </div>
  );
};
