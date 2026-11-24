import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Pin, RotateCcw, Sparkles, X } from 'lucide-react';
import type { EntityRelationType } from '@jachaikori/schema';
import type { AggregatedEntityRelation } from '../../api/client';
import { tt, type Lang } from '../../i18n/tt';
import { formatNumber } from '../../i18n/format';
import { formatDhakaDate } from '../../lib/dates';
import { RELATION_CATEGORY_TYPES, type RelationCategoryId } from '../../lib/useLens';
import { OutletName } from '../../ui/OutletName';
import { Verbatim } from '../../ui/Verbatim';

export interface GraphHistoryEntry {
  id: string;
  name: string;
}

interface EntityGraphProps {
  centerId: string;
  centerName: string;
  centerType: string;
  relations: AggregatedEntityRelation[];
  lang: Lang;
  loading?: boolean;
  fetching?: boolean;
  history: GraphHistoryEntry[];
  onNavigateEntity: (targetId: string, targetName: string) => void;
  onGoBack: () => void;
  onJumpHistory: (index: number) => void;
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  entityType: string;
  isCenter: boolean;
  weight: number;
  radius: number;
  category: Exclude<RelationCategoryId, 'all'>;
  x: number;
  y: number;
}

interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  key: string;
  rel: AggregatedEntityRelation;
  category: Exclude<RelationCategoryId, 'all'>;
  curveIndex: number;
  curveCount: number;
  predicate: string;
}

const WIDTH = 820;
const HEIGHT = 540;

const CATEGORY_ORDER: readonly Exclude<RelationCategoryId, 'all'>[] = [
  'structure',
  'stance',
  'economy',
  'law',
  'diplomacy',
];

const CATEGORY_COLOR: Record<Exclude<RelationCategoryId, 'all'>, string> = {
  structure: 'var(--color-ink)',
  stance: 'var(--color-violet)',
  economy: 'var(--color-sage)',
  law: 'var(--color-rust)',
  diplomacy: 'var(--color-ochre)',
};

function relationCategory(type: EntityRelationType): Exclude<RelationCategoryId, 'all'> {
  for (const [cat, list] of Object.entries(RELATION_CATEGORY_TYPES)) {
    if ((list as readonly string[]).includes(type)) {
      return cat as Exclude<RelationCategoryId, 'all'>;
    }
  }
  return 'structure';
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function formatExcerptQuote(raw: string): string {
  const trimmed = raw.trim().replace(/^[“"‘']+|[”"’']+$/g, '').trim();
  const lead = trimmed.startsWith('…') || trimmed.startsWith('...') ? '' : '…';
  const trail = trimmed.endsWith('…') || trimmed.endsWith('...') ? '' : '…';
  return `“${lead}${trimmed}${trail}”`;
}

function clampNodePosition(n: { x: number; y: number; radius: number; isCenter: boolean }): void {
  if (n.isCenter) return;
  const padX = n.radius + 68;
  const padY = n.radius + 42;
  n.x = Math.max(padX, Math.min(WIDTH - padX, n.x));
  n.y = Math.max(padY, Math.min(HEIGHT - padY, n.y));
}

function edgeCurvePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  curveIndex: number,
  curveCount: number,
  seedBias: number,
  expanded = false
): { d: string; mx: number; my: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;

  const baseBend = (seedBias - 0.5) * 38;
  const baseStep = curveCount >= 6 ? 34 : curveCount >= 4 ? 42 : 52;
  const spreadStep = expanded ? baseStep * 1.25 : baseStep;
  const multiOffset =
    curveCount > 1
      ? (curveIndex - (curveCount - 1) / 2) * spreadStep
      : baseBend;

  const cx = (sx + tx) / 2 + nx * multiOffset;
  const cy = (sy + ty) / 2 + ny * multiOffset;
  const mx = 0.25 * sx + 0.5 * cx + 0.25 * tx;
  const my = 0.25 * sy + 0.5 * cy + 0.25 * ty;

  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`,
    mx,
    my,
  };
}

function repelFromSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; ux: number; uy: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy) || 0.001;
  return { dist, ux: dx / dist, uy: dy / dist };
}

/**
 * Interactive asymmetrical D3 force-directed ego graph:
 * - Pre-settles synchronously inside `useMemo` so frame 1 is ALWAYS organically spread out.
 * - When highlighting a neighbor (especially multi-edge pairs), smoothly slides BOTH the
 *   connected neighbor node AND the center node apart to open a wide uncluttered runway,
 *   while unrelated nodes glide smoothly out of the corridor via 60fps interpolation.
 * - Right-click any neighbor node to pin all its relationship markers open & clickable.
 * - Zero native HTML `<title>` tooltips; built-in Back & Breadcrumb navigation.
 */
export default function EntityGraph({
  centerId,
  centerName,
  centerType,
  relations,
  lang,
  loading = false,
  fetching = false,
  history,
  onNavigateEntity,
  onGoBack,
  onJumpHistory,
}: EntityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusLockUntilRef = useRef<number>(0);
  const dragRef = useRef<{
    node: GraphNode;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [pinnedNeighborId, setPinnedNeighborId] = useState<string | null>(null);
  const [hoveredNeighborId, setHoveredNeighborId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [resetTick, setResetTick] = useState(0);
  const [dragTick, setDragTick] = useState(0);

  const renderedPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const layoutKeyRef = useRef<string>('');
  const [, setAnimFrame] = useState(0);

  // Build AND synchronously settle D3 force layout inside useMemo so frame 1 is ALWAYS spread out
  const { nodes, edges } = useMemo(() => {
    const topRels = relations.slice(0, 24);
    const centerNode: GraphNode = {
      id: centerId,
      name: centerName,
      entityType: centerType,
      isCenter: true,
      weight: 999,
      radius: 32,
      category: 'structure',
      x: WIDTH * 0.48,
      y: HEIGHT * 0.5,
      fx: WIDTH * 0.48,
      fy: HEIGHT * 0.5,
    };

    const neighborMap = new Map<string, GraphNode>();
    const maxW = Math.max(1, ...topRels.map((r) => r.weight));
    const pairCounts = new Map<string, number>();
    const builtEdges: GraphEdge[] = [];

    for (const rel of topRels) {
      const otherId = rel.otherEntity.id;
      if (otherId === centerId) continue;

      const cat = relationCategory(rel.relationType);
      const otherName =
        lang === 'bn'
          ? rel.otherEntity.canonicalBn || rel.otherEntity.canonicalEn || otherId
          : rel.otherEntity.canonicalEn || rel.otherEntity.canonicalBn || otherId;

      if (!neighborMap.has(otherId)) {
        if (neighborMap.size >= 15) continue;
        const normW = Math.log2(rel.weight + 1) / Math.log2(maxW + 1);
        neighborMap.set(otherId, {
          id: otherId,
          name: otherName,
          entityType: rel.otherEntity.entityType,
          isCenter: false,
          weight: rel.weight,
          radius: Math.round(14 + normW * 11),
          category: cat,
          x: WIDTH * 0.48,
          y: HEIGHT * 0.5,
        });
      } else {
        neighborMap.get(otherId)!.weight += rel.weight;
      }

      const count = pairCounts.get(otherId) ?? 0;
      pairCounts.set(otherId, count + 1);
      const key = `${rel.direction}:${rel.relationType}:${otherId}:${count}`;

      builtEdges.push({
        key,
        rel,
        category: cat,
        source: rel.direction === 'out' ? centerId : otherId,
        target: rel.direction === 'out' ? otherId : centerId,
        curveIndex: count,
        curveCount: 1,
        predicate: rel.predicateLabels[0] ?? rel.relationType.replace(/_/g, ' '),
      });
    }

    for (const e of builtEdges) {
      e.curveCount = pairCounts.get(e.rel.otherEntity.id) ?? 1;
    }

    const orderedNeighbors = Array.from(neighborMap.values()).sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        b.weight - a.weight
    );
    const totalN = Math.max(1, orderedNeighbors.length);
    const startAngle = -Math.PI * 0.65 + (hashSeed(centerId) - 0.5) * 0.4;

    orderedNeighbors.forEach((n, idx) => {
      const seedA = hashSeed(`${centerId}:${n.id}:a`);
      const seedR = hashSeed(`${centerId}:${n.id}:r`);
      const angle = startAngle + (idx / totalN) * Math.PI * 2 + (seedA - 0.5) * 0.24;
      const normW = Math.log2(n.weight + 1) / Math.log2(maxW + 1);
      const multiExtra = (pairCounts.get(n.id) ?? 1) > 2 ? 32 : 0;
      const dist = 165 + (1 - normW) * 85 + multiExtra + (seedR - 0.5) * 30;
      n.x = WIDTH * 0.48 + Math.cos(angle) * dist * 1.12;
      n.y = HEIGHT * 0.5 + Math.sin(angle) * dist * 0.86;
      clampNodePosition(n);
    });

    const allNodes = [centerNode, ...orderedNeighbors];

    if (allNodes.length > 1) {
      const preSim = forceSimulation<GraphNode>(allNodes)
        .force(
          'link',
          forceLink<GraphNode, GraphEdge>(builtEdges)
            .id((d) => d.id)
            .distance((l) => {
              const norm = Math.log2(l.rel.weight + 1) / Math.log2(maxW + 1);
              const multiBonus = Math.min(75, Math.max(0, l.curveCount - 1) * 18);
              const jitter = (hashSeed(l.key) - 0.5) * 34;
              return 165 + (1 - norm) * 80 + multiBonus + jitter;
            })
            .strength(0.55)
        )
        .force('charge', forceManyBody<GraphNode>().strength(-520))
        .force(
          'collide',
          forceCollide<GraphNode>().radius((d) => d.radius + 54).iterations(4)
        )
        .force('x', forceX<GraphNode>(WIDTH * 0.5).strength(0.06))
        .force('y', forceY<GraphNode>(HEIGHT * 0.5).strength(0.08))
        .stop();

      for (let i = 0; i < 200; i++) {
        preSim.tick();
        for (const n of allNodes) clampNodePosition(n);
      }
    }

    return { nodes: allNodes, edges: builtEdges };
  }, [centerId, centerName, centerType, relations, lang, resetTick]);

  // Synchronously seed rendered positions on layout change so Frame 0 is 100% spread out
  const layoutKey = `${centerId}:${resetTick}:${nodes.map((n) => n.id).join(',')}`;
  if (layoutKeyRef.current !== layoutKey) {
    layoutKeyRef.current = layoutKey;
    const fresh = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      fresh.set(n.id, { x: n.x, y: n.y });
    }
    renderedPosRef.current = fresh;
  }

  // Keep a live paused D3 simulation purely for interactive pointer dragging
  useEffect(() => {
    if (nodes.length <= 1) return;
    const maxW = Math.max(1, ...edges.map((e) => e.rel.weight));

    const sim = forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance((l) => {
            const norm = Math.log2(l.rel.weight + 1) / Math.log2(maxW + 1);
            return 168 + (1 - norm) * 85;
          })
          .strength(0.45)
      )
      .force('charge', forceManyBody<GraphNode>().strength(-480))
      .force('collide', forceCollide<GraphNode>().radius((d) => d.radius + 52).iterations(3))
      .force('x', forceX<GraphNode>(WIDTH * 0.5).strength(0.05))
      .force('y', forceY<GraphNode>(HEIGHT * 0.5).strength(0.07))
      .alpha(0)
      .stop();

    sim.on('tick', () => {
      for (const n of nodes) clampNodePosition(n);
      setDragTick((t) => t + 1);
    });

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes, edges]);

  // Reset local focus when changing entity
  useEffect(() => {
    setSelectedEdgeKey(null);
    setPinnedNeighborId(null);
    setHoveredNeighborId(null);
    setHoveredEdgeKey(null);
  }, [centerId, resetTick]);

  const deselectAll = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    focusLockUntilRef.current = 0;
    setSelectedEdgeKey(null);
    setPinnedNeighborId(null);
    setHoveredNeighborId(null);
    setHoveredEdgeKey(null);
  }, []);

  // Escape key or clicking outside the graph + side panel deselects everything
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') deselectAll();
    };
    const onDocPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        deselectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDocPointerDown);
    };
  }, [deselectAll]);

  const scheduleClearHover = useCallback((respectLock = true) => {
    if (respectLock && performance.now() < focusLockUntilRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (respectLock && performance.now() < focusLockUntilRef.current) return;
      setHoveredNeighborId(null);
      setHoveredEdgeKey(null);
    }, 180);
  }, []);

  const enterNeighborFocus = useCallback((neighborId: string, edgeKey?: string, lockExpansion = false) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (lockExpansion) {
      // Prevent mouseleave jitter while the focused neighbor & center smoothly slide apart!
      focusLockUntilRef.current = performance.now() + 420;
    }
    setHoveredNeighborId(neighborId);
    setHoveredEdgeKey(edgeKey ?? null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const selectedEdge = edges.find((e) => e.key === selectedEdgeKey) ?? null;

  const focusNeighborId: string | null =
    pinnedNeighborId ??
    hoveredNeighborId ??
    (selectedEdge ? selectedEdge.rel.otherEntity.id : null);

  // Target positions:
  // When a neighbor is focused (especially with multiple edges!), smoothly spread BOTH
  // the focused neighbor AND the center node apart to carve a wide unobstructed runway,
  // and gently glide unrelated nodes out of the corridor!
  const targetPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      map.set(n.id, { x: n.x, y: n.y });
    }
    if (!focusNeighborId) return map;

    const center = map.get(centerId);
    const target = map.get(focusNeighborId);
    if (!center || !target) return map;

    const focusEdges = edges.filter((e) => e.rel.otherEntity.id === focusNeighborId);
    const edgeCount = focusEdges.length;

    // 1. Open a generous unobstructed runway between Center and Focused Neighbor!
    // Guarantee at least 320px for single/double edges and up to 440px for 4–7+ parallel edges!
    const desiredSpan = edgeCount >= 4 ? 440 : edgeCount >= 2 ? 380 : 300;
    const rawDx = target.x - center.x;
    const rawDy = target.y - center.y;
    const rawDist = Math.hypot(rawDx, rawDy) || 1;
    // Slight horizontal bias so pills (which are wider than tall) sit comfortably between the two nodes
    let ux = rawDx / rawDist;
    let uy = rawDy / rawDist;
    if (Math.abs(ux) < 0.45 && edgeCount >= 2) {
      const signX = rawDx >= 0 ? 1 : -1;
      ux = signX * 0.82;
      uy = (rawDy >= 0 ? 1 : -1) * 0.57;
    }

    let cx = center.x;
    let cy = center.y;
    let tx = target.x;
    let ty = target.y;

    if (rawDist < desiredSpan) {
      const deficit = desiredSpan - rawDist;
      // Split expansion: move neighbor 62% outward and center 38% opposite so BOTH stay cleanly inside the frame!
      const neighborShift = deficit * 0.62;
      const centerShift = deficit * 0.38;

      tx = Math.max(92, Math.min(WIDTH - 92, target.x + ux * neighborShift));
      ty = Math.max(58, Math.min(HEIGHT - 58, target.y + uy * neighborShift));
      cx = Math.max(115, Math.min(WIDTH - 115, center.x - ux * centerShift));
      cy = Math.max(72, Math.min(HEIGHT - 72, center.y - uy * centerShift));

      // If clamping left the span shorter than desired, push the opposite side to make up the difference
      const actualDist = Math.hypot(tx - cx, ty - cy) || 1;
      if (actualDist < desiredSpan - 20) {
        const extra = desiredSpan - actualDist;
        const nx = (tx - cx) / actualDist;
        const ny = (ty - cy) / actualDist;
        const nextCx = Math.max(110, Math.min(WIDTH - 110, cx - nx * extra));
        const nextCy = Math.max(68, Math.min(HEIGHT - 68, cy - ny * extra));
        cx = nextCx;
        cy = nextCy;
      }

      map.set(centerId, { x: cx, y: cy });
      map.set(focusNeighborId, { x: tx, y: ty });
    }

    // 2. Smoothly glide unrelated nodes away from the expanded corridor
    const corridorRadius = edgeCount >= 4 ? 235 : edgeCount >= 2 ? 205 : 170;
    const maxPush = edgeCount >= 4 ? 130 : edgeCount >= 2 ? 105 : 84;

    for (const n of nodes) {
      if (n.isCenter || n.id === focusNeighborId) continue;
      const p = map.get(n.id)!;
      const { dist: segDist, ux: rx, uy: ry } = repelFromSegment(p.x, p.y, cx, cy, tx, ty);
      if (segDist < corridorRadius) {
        const falloff = 0.5 * (1 + Math.cos((Math.PI * segDist) / corridorRadius));
        const push = falloff * maxPush;
        const padX = n.radius + 64;
        const padY = n.radius + 40;
        map.set(n.id, {
          x: Math.max(padX, Math.min(WIDTH - padX, p.x + rx * push)),
          y: Math.max(padY, Math.min(HEIGHT - padY, p.y + ry * push)),
        });
      }
    }

    return map;
  }, [nodes, edges, centerId, focusNeighborId, dragTick]);

  // 60fps liquid interpolation syncing SVG curves, SVG nodes, and pill positions smoothly
  useEffect(() => {
    const curMap = renderedPosRef.current;
    for (const [id, tgt] of targetPositions.entries()) {
      if (!curMap.has(id)) curMap.set(id, { x: tgt.x, y: tgt.y });
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || dragRef.current) {
      for (const [id, tgt] of targetPositions.entries()) {
        curMap.set(id, { x: tgt.x, y: tgt.y });
      }
      setAnimFrame((f) => f + 1);
      return;
    }

    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;
      const alpha = 1 - Math.exp(-dt * 12);
      let maxDelta = 0;

      for (const [id, tgt] of targetPositions.entries()) {
        const cur = curMap.get(id) ?? { x: tgt.x, y: tgt.y };
        const dx = tgt.x - cur.x;
        const dy = tgt.y - cur.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.25) {
          cur.x += dx * alpha;
          cur.y += dy * alpha;
          maxDelta = Math.max(maxDelta, d);
        } else {
          cur.x = tgt.x;
          cur.y = tgt.y;
        }
        curMap.set(id, cur);
      }

      setAnimFrame((f) => f + 1);
      if (maxDelta > 0.25) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [targetPositions]);

  const getPos = (id: string, fallbackX: number, fallbackY: number) =>
    renderedPosRef.current.get(id) ?? targetPositions.get(id) ?? { x: fallbackX, y: fallbackY };

  // Compute STABLE, cleanly spread relationship pills centered in the open runway between Center & Neighbor!
  // Never overlaps either node, never truncates, never jumps on hover!
  const activePills = useMemo(() => {
    if (!focusNeighborId) return [];
    const focusEdges = edges.filter((e) => e.rel.otherEntity.id === focusNeighborId);
    if (focusEdges.length === 0) return [];

    const centerPos = targetPositions.get(centerId) ?? { x: WIDTH * 0.48, y: HEIGHT * 0.5 };
    const neighborPos = targetPositions.get(focusNeighborId);
    if (!neighborPos) return [];

    const midX = (centerPos.x + neighborPos.x) / 2;
    const midY = (centerPos.y + neighborPos.y) / 2;

    const raw = focusEdges.map((edge) => {
      const sp = edge.rel.direction === 'out' ? centerPos : neighborPos;
      const tp = edge.rel.direction === 'out' ? neighborPos : centerPos;
      const { mx, my } = edgeCurvePath(
        sp.x,
        sp.y,
        tp.x,
        tp.y,
        edge.curveIndex,
        edge.curveCount,
        hashSeed(edge.key),
        true
      );
      return { edge, mx, my };
    });

    raw.sort((a, b) => a.my - b.my);
    const n = raw.length;
    // Compact comfortable gap that fits even 7–8 edges cleanly inside the 540px tall canvas
    const gapY = n >= 6 ? 38 : n >= 4 ? 42 : 46;
    const totalSpanY = (n - 1) * gapY;
    let startY = midY - totalSpanY / 2;
    if (startY < 28) startY = 28;
    if (startY + totalSpanY > HEIGHT - 28) startY = Math.max(28, HEIGHT - 28 - totalSpanY);

    return raw.map((item, idx) => {
      // Gentle horizontal arc stagger centered strictly at midX so pills stay well clear of BOTH endpoints!
      const normIdx = n > 1 ? idx / (n - 1) - 0.5 : 0; // -0.5 .. +0.5
      const arcBendX = (0.25 - normIdx * normIdx) * (midX > centerPos.x ? 18 : -18);
      const x = Math.max(140, Math.min(WIDTH - 140, midX + arcBendX));
      const y = startY + idx * gapY;
      return { edge: item.edge, x, y };
    });
  }, [edges, focusNeighborId, centerId, targetPositions]);

  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      const pt = toSvgCoords(e.clientX, e.clientY);
      drag.node.fx = pt.x;
      drag.node.fy = pt.y;
      drag.node.x = pt.x;
      drag.node.y = pt.y;
      simRef.current?.alphaTarget(0.22).restart();
    },
    [toSvgCoords]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { node, moved } = drag;
      dragRef.current = null;
      if (!node.isCenter) {
        node.fx = null;
        node.fy = null;
      }
      simRef.current?.alphaTarget(0);

      if (!moved && !node.isCenter && e.button === 0) {
        onNavigateEntity(node.id, node.name);
      }
    },
    [onNavigateEntity]
  );

  if (loading && relations.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 h-[540px] rounded-3xl bg-paper-sunk/60 animate-pulse" />
        <div className="lg:col-span-4 h-[540px] rounded-3xl bg-paper-sunk/60 animate-pulse" />
      </div>
    );
  }

  if (edges.length === 0) {
    return (
      <div className="rounded-3xl border border-rule/70 bg-paper-raised p-8 text-center text-sm text-pencil">
        {tt('empty.panel', lang)}
      </div>
    );
  }

  const maxWeight = Math.max(1, ...edges.map((e) => e.rel.weight));
  const prevStop = history.at(-1);
  const pinnedNode = pinnedNeighborId ? nodes.find((n) => n.id === pinnedNeighborId) : null;

  return (
    <div ref={rootRef} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
      {/* LEFT: Interactive D3 Asymmetrical Ego Graph Canvas */}
      <div className="lg:col-span-8 rounded-3xl border border-rule/75 bg-paper-raised shadow-sm overflow-hidden flex flex-col">
        {/* Top bar with Back button, Breadcrumbs (clean ellipsis overflow, never a scrollbar), Pinned indicator, and Reset */}
        <div
          onClick={deselectAll}
          className="flex items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-b border-rule/50 text-xs min-w-0"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
            {prevStop ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onGoBack();
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunk/90 hover:bg-paper-sunk px-3 py-1 text-xs font-medium text-ink transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                <span className="max-w-[140px] truncate">
                  {tt('graph.backTo', lang, { name: prevStop.name })}
                </span>
              </button>
            ) : null}

            {history.length > 0 ? (
              <nav
                aria-label="Graph history"
                className="hidden sm:flex items-center gap-1 text-[11px] text-pencil min-w-0 flex-1 overflow-hidden whitespace-nowrap"
              >
                {history.length > 2 ? (
                  <span className="shrink-0 text-pencil/80 px-0.5" aria-hidden="true">
                    … ›
                  </span>
                ) : null}
                {history.slice(-2).map((item, idx, arr) => {
                  const realIndex = history.length - arr.length + idx;
                  return (
                    <span
                      key={`${item.id}-${realIndex}`}
                      className="inline-flex items-center gap-1 min-w-0 max-w-[115px]"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpHistory(realIndex);
                        }}
                        className="rounded-full px-1.5 py-0.5 hover:bg-paper-sunk hover:text-ink transition-colors cursor-pointer truncate block"
                      >
                        {item.name}
                      </button>
                      <span className="text-rule-strong shrink-0">›</span>
                    </span>
                  );
                })}
                <span className="font-medium text-ink px-1 truncate min-w-0">
                  {centerName}
                </span>
              </nav>
            ) : (
              <span className="text-pencil truncate">{tt('graph.hint', lang)}</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pinnedNode ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deselectAll();
                }}
                className="inline-flex items-center gap-1 rounded-full bg-ink text-paper px-2.5 py-1 text-[11px] font-medium hover:opacity-90 cursor-pointer"
              >
                <Pin className="h-3 w-3 shrink-0" strokeWidth={1.7} />
                <span className="max-w-[100px] truncate">{pinnedNode.name}</span>
                <X className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              </button>
            ) : null}
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-pencil" strokeWidth={1.7} />
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deselectAll();
                setResetTick((v) => v + 1);
              }}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-pencil hover:text-ink hover:bg-paper-sunk cursor-pointer transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.6} />
              <span>{tt('graph.reset', lang)}</span>
            </button>
          </div>
        </div>

        {/* SVG Canvas + Stable Non-Truncated HTML Pill Overlay */}
        <div
          className="relative flex-1 min-h-[440px] sm:min-h-[520px] bg-paper/35 overflow-hidden"
          onMouseLeave={() => {
            if (!pinnedNeighborId) scheduleClearHover(false);
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-full block touch-none select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClick={deselectAll}
            onContextMenu={(e) => {
              e.preventDefault();
              deselectAll();
            }}
            role="img"
            aria-label={centerName}
          >
            <defs>
              <filter id="node-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1E1A16" floodOpacity="0.09" />
              </filter>
            </defs>

            {/* Curved clickable edges */}
            {edges.map((edge) => {
              const sNode = edge.source as GraphNode;
              const tNode = edge.target as GraphNode;
              const sp = getPos(sNode.id, sNode.x, sNode.y);
              const tp = getPos(tNode.id, tNode.x, tNode.y);

              const isSelected = selectedEdgeKey === edge.key;
              const isHoveredEdge = hoveredEdgeKey === edge.key;
              const inFocusCorridor =
                focusNeighborId !== null && edge.rel.otherEntity.id === focusNeighborId;
              const dimmed = focusNeighborId !== null && !inFocusCorridor;

              const { d, mx, my } = edgeCurvePath(
                sp.x,
                sp.y,
                tp.x,
                tp.y,
                edge.curveIndex,
                edge.curveCount,
                hashSeed(edge.key),
                inFocusCorridor
              );

              const strokeW =
                1.5 + (Math.log2(edge.rel.weight + 1) / Math.log2(maxWeight + 1)) * 3.0;
              const strokeColor = CATEGORY_COLOR[edge.category];
              const emphasized = isSelected || isHoveredEdge;

              return (
                <g
                  key={edge.key}
                  className="cursor-pointer"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeKey((cur) => (cur === edge.key ? null : edge.key));
                  }}
                  onMouseEnter={() => {
                    if (!pinnedNeighborId || edge.rel.otherEntity.id === pinnedNeighborId) {
                      enterNeighborFocus(edge.rel.otherEntity.id, edge.key, true);
                    }
                  }}
                  onMouseLeave={() => {
                    if (!pinnedNeighborId) scheduleClearHover(true);
                    else setHoveredEdgeKey(null);
                  }}
                >
                  <path d={d} fill="none" stroke="transparent" strokeWidth={22} />

                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={emphasized ? strokeW + 2 : inFocusCorridor ? strokeW + 0.8 : strokeW}
                    strokeLinecap="round"
                    opacity={
                      emphasized ? 0.96 : inFocusCorridor ? 0.68 : dimmed ? 0.1 : 0.4
                    }
                  />

                  {!inFocusCorridor && !dimmed ? (
                    <circle
                      cx={mx}
                      cy={my}
                      r={3.5}
                      fill="var(--color-paper-raised)"
                      stroke={strokeColor}
                      strokeWidth={1.4}
                      opacity={0.72}
                    />
                  ) : null}
                </g>
              );
            })}

            {/* Entity nodes */}
            {nodes.map((node) => {
              const pos = getPos(node.id, node.x, node.y);
              const isFocusedNeighbor = focusNeighborId === node.id;
              const isPinned = pinnedNeighborId === node.id;
              const dimmed = focusNeighborId !== null && !node.isCenter && !isFocusedNeighbor;
              const accent = CATEGORY_COLOR[node.category];

              const displayLabel =
                isFocusedNeighbor || node.isCenter
                  ? node.name
                  : node.name.length > 22
                  ? `${node.name.slice(0, 21)}…`
                  : node.name;
              const pillW = Math.max(76, displayLabel.length * 6.5 + 24);
              const pillH = 22;

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`}
                  style={{
                    opacity: dimmed ? 0.18 : 1,
                    transition: 'opacity 220ms ease',
                  }}
                  className={node.isCenter ? 'cursor-default' : 'cursor-pointer'}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                    dragRef.current = {
                      node,
                      startX: e.clientX,
                      startY: e.clientY,
                      moved: false,
                    };
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    if (node.isCenter) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setPinnedNeighborId((cur) => (cur === node.id ? null : node.id));
                  }}
                  onMouseEnter={() => {
                    if (!node.isCenter && !pinnedNeighborId) {
                      enterNeighborFocus(node.id, undefined, true);
                    }
                  }}
                  onMouseLeave={() => {
                    if (!node.isCenter && !pinnedNeighborId) {
                      scheduleClearHover(true);
                    }
                  }}
                >
                  {node.isCenter || isFocusedNeighbor || isPinned ? (
                    <circle
                      r={node.radius + (isPinned ? 9 : 7)}
                      fill="none"
                      stroke={node.isCenter ? 'var(--color-ink)' : accent}
                      strokeWidth={isPinned ? 2 : 1.5}
                      strokeDasharray={isPinned ? '4 3' : undefined}
                      opacity={isPinned ? 0.65 : 0.3}
                    />
                  ) : null}

                  <circle
                    r={node.radius}
                    fill={
                      node.isCenter
                        ? 'var(--color-ink)'
                        : isFocusedNeighbor
                        ? 'var(--color-paper-sunk)'
                        : 'var(--color-paper-raised)'
                    }
                    stroke={node.isCenter ? 'var(--color-ink)' : accent}
                    strokeWidth={node.isCenter ? 2 : isFocusedNeighbor ? 2.2 : 1.5}
                    filter="url(#node-soft-shadow)"
                  />

                  {!node.isCenter ? (
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--color-ink)"
                      className="font-mono-data font-medium pointer-events-none"
                    >
                      {formatNumber(node.weight, lang)}
                    </text>
                  ) : null}

                  <g transform={`translate(0, ${node.radius + 15})`}>
                    <rect
                      x={-pillW / 2}
                      y={-pillH / 2}
                      width={pillW}
                      height={pillH}
                      rx={pillH / 2}
                      fill={node.isCenter ? 'var(--color-ink)' : 'var(--color-paper-raised)'}
                      fillOpacity={node.isCenter ? 1 : 0.96}
                      stroke={node.isCenter ? 'none' : isFocusedNeighbor ? accent : 'var(--color-rule)'}
                      strokeWidth={isFocusedNeighbor ? 1.3 : 0.9}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize={10.5}
                      fill={node.isCenter ? 'var(--color-paper)' : 'var(--color-ink)'}
                      className="font-ui font-medium pointer-events-none"
                    >
                      {displayLabel}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Clean, stably spaced relationship markers floating inside the wide-open runway */}
          {activePills.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {activePills.map(({ edge, x, y }) => {
                const isSelected = selectedEdgeKey === edge.key;
                const isHoveredPill = hoveredEdgeKey === edge.key;
                const leftPct = (x / WIDTH) * 100;
                const topPct = (y / HEIGHT) * 100;
                const accent = CATEGORY_COLOR[edge.category];

                return (
                  <button
                    key={edge.key}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdgeKey((cur) => (cur === edge.key ? null : edge.key));
                    }}
                    onMouseEnter={() => {
                      enterNeighborFocus(edge.rel.otherEntity.id, edge.key, false);
                    }}
                    onMouseLeave={() => {
                      if (!pinnedNeighborId) scheduleClearHover(false);
                      else setHoveredEdgeKey(null);
                    }}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      borderColor: accent,
                    }}
                    className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 max-w-[260px] rounded-full border px-3 py-1 text-center shadow-sm transition-colors duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-ink text-paper shadow-md'
                        : isHoveredPill
                        ? 'bg-paper-sunk text-ink shadow-md'
                        : 'bg-paper-raised/98 text-ink'
                    }`}
                  >
                    <span className="inline-flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-medium leading-tight">
                      <span>{edge.rel.direction === 'out' ? '→' : '←'}</span>
                      <span>{edge.predicate}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-mono-data text-[10px] ${
                          isSelected ? 'bg-paper/20 text-paper' : 'bg-paper-sunk text-pencil'
                        }`}
                      >
                        {formatNumber(edge.rel.weight, lang)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* RIGHT: Edge Source Articles Side Panel */}
      <aside className="lg:col-span-4 rounded-3xl border border-rule/75 bg-paper-raised shadow-sm flex flex-col overflow-hidden max-h-[590px]">
        <div className="px-5 py-3.5 border-b border-rule/50 flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-medium text-ink m-0">
            {tt('graph.edgePanelTitle', lang)}
          </h3>
          {selectedEdge ? (
            <span className="rounded-full bg-paper-sunk px-2.5 py-0.5 text-[11px] font-mono-data text-ink">
              {tt('evt.articlesCount', lang, { n: selectedEdge.rel.weight })}
            </span>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!selectedEdge ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-dashed border-rule-strong/50 bg-paper/60 p-4 text-xs text-pencil leading-relaxed flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-pencil" strokeWidth={1.6} />
                <p className="m-0">{tt('graph.edgePanelEmpty', lang)}</p>
              </div>

              <div className="space-y-1.5">
                {edges.slice(0, 6).map((edge) => {
                  const otherName =
                    lang === 'bn'
                      ? edge.rel.otherEntity.canonicalBn || edge.rel.otherEntity.canonicalEn || edge.rel.otherEntity.id
                      : edge.rel.otherEntity.canonicalEn || edge.rel.otherEntity.canonicalBn || edge.rel.otherEntity.id;
                  return (
                    <button
                      key={edge.key}
                      type="button"
                      onClick={() => setSelectedEdgeKey(edge.key)}
                      onMouseEnter={() => {
                        if (!pinnedNeighborId) {
                          enterNeighborFocus(edge.rel.otherEntity.id, edge.key, false);
                        }
                      }}
                      onMouseLeave={() => {
                        if (!pinnedNeighborId) scheduleClearHover(false);
                      }}
                      className="w-full rounded-xl border border-rule/60 bg-paper/70 hover:bg-paper-sunk/70 px-3.5 py-2.5 text-left transition-colors cursor-pointer space-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-2 text-xs">
                        <span className="font-medium text-ink leading-snug">{otherName}</span>
                        <span className="font-mono-data text-[11px] text-pencil shrink-0">
                          {formatNumber(edge.rel.weight, lang)}
                        </span>
                      </div>
                      <div className="text-[11px] text-pencil leading-snug">{edge.predicate}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            (() => {
              const rel = selectedEdge.rel;
              const otherName =
                lang === 'bn'
                  ? rel.otherEntity.canonicalBn || rel.otherEntity.canonicalEn || rel.otherEntity.id
                  : rel.otherEntity.canonicalEn || rel.otherEntity.canonicalBn || rel.otherEntity.id;
              return (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-paper/80 border border-rule/60 p-4 space-y-2.5">
                    <div className="text-sm leading-relaxed text-ink">
                      {rel.direction === 'out' ? (
                        <>
                          <span className="font-semibold">{centerName}</span>{' '}
                          <span className="text-pencil italic">— {selectedEdge.predicate} →</span>{' '}
                          <span className="font-semibold">{otherName}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{otherName}</span>{' '}
                          <span className="text-pencil italic">— {selectedEdge.predicate} →</span>{' '}
                          <span className="font-semibold">{centerName}</span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigateEntity(rel.otherEntity.id, otherName)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-ink text-paper px-3.5 py-1.5 text-xs font-medium hover:opacity-90 cursor-pointer transition-opacity"
                    >
                      <span>{tt('graph.recenter', lang, { name: otherName })}</span>
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>

                  {rel.evidence.length === 0 ? (
                    <p className="text-xs text-pencil">{tt('empty.panel', lang)}</p>
                  ) : (
                    <div className="space-y-3">
                      {rel.evidence.map((ev, i) => (
                        <article
                          key={`${ev.articleId}-${i}`}
                          className="rounded-2xl border border-rule/70 bg-paper/70 p-3.5 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-pencil">
                            <div className="flex items-center gap-1.5">
                              <OutletName id={ev.outlet} lang={lang} />
                              {ev.publishedAt ? (
                                <>
                                  <span>·</span>
                                  <span>{formatDhakaDate(ev.publishedAt, lang, 'medium')}</span>
                                </>
                              ) : null}
                            </div>
                            <a
                              href={ev.canonicalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-ink hover:underline"
                            >
                              <span>{tt('src.open', lang)}</span>
                              <ExternalLink className="h-3 w-3" strokeWidth={1.6} />
                            </a>
                          </div>

                          <a
                            href={ev.canonicalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-sm font-medium text-ink hover:underline leading-snug"
                          >
                            <Verbatim text={ev.title} outlet={ev.outlet} />
                          </a>

                          {ev.snippet && ev.snippet !== ev.title ? (
                            <Verbatim
                              text={formatExcerptQuote(ev.snippet)}
                              outlet={ev.outlet}
                              as="p"
                              className="!text-pencil text-xs leading-relaxed m-0"
                            />
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </aside>
    </div>
  );
}
