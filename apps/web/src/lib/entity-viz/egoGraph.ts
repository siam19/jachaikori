import * as d3 from 'd3';
import type { EgoResponse, EntityNode, EventNode, Lang } from './types';
import { TYPE_COLOR, labelFor, symbolPath, truncateLabel } from './style';

type N = d3.SimulationNodeDatum & {
  id: string;
  kind: 'entity' | 'event';
  r: number;
  tx: number; // target x on the time axis
  entity?: EntityNode;
  event?: EventNode;
};
type L = d3.SimulationLinkDatum<N> & { salience: number };

export interface EgoOptions {
  width: number;
  height: number;
  lang: Lang;
  onEntity: (id: string) => void;
  onEvent: (id: string) => void;
}

/** Renders the entity-across-time ego graph and returns a cleanup function. */
export function renderEgo(svgEl: SVGSVGElement, data: EgoResponse, o: EgoOptions): () => void {
  const { width, height, lang } = o;
  const margin = 48;
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();
  const g = svg.append('g');

  // Time axis: events are pinned by start date.
  const times = data.events.map((e) => +new Date(e.start)).filter((t) => Number.isFinite(t));
  const t0 = d3.min(times) ?? Date.now();
  const t1 = d3.max(times) ?? t0 + 864e5;
  const x = d3
    .scaleUtc()
    .domain([new Date(t0), new Date(t1 === t0 ? t0 + 864e5 : t1)])
    .range([margin, width - margin]);

  const eventX = new Map(data.events.map((e) => [e.id, x(new Date(e.start))]));

  // Each entity sits at the mean x of the events it participated in.
  const acc = new Map<string, { sum: number; n: number }>();
  for (const i of data.incidence) {
    const ex = eventX.get(i.eventId);
    if (ex === undefined || !Number.isFinite(ex)) continue;
    const a = acc.get(i.entityId) ?? { sum: 0, n: 0 };
    a.sum += ex;
    a.n += 1;
    acc.set(i.entityId, a);
  }

  const nodes: N[] = [
    ...data.entities.map((e) => {
      const a = acc.get(e.id);
      return {
        id: e.id,
        kind: 'entity' as const,
        entity: e,
        r: 6 + 2.5 * Math.sqrt(Math.max(1, e.eventCount)),
        tx: a ? a.sum / a.n : width / 2,
      };
    }),
    ...data.events.map((ev) => ({
      id: ev.id,
      kind: 'event' as const,
      event: ev,
      r: 4 + 2 * Math.sqrt(Math.max(1, ev.articleCount)),
      tx: eventX.get(ev.id) ?? width / 2,
    })),
  ];

  const center = nodes.find((n) => n.id === data.center.id);
  if (center) {
    center.fx = width / 2;
    center.fy = height / 2;
  }

  const ids = new Set(nodes.map((n) => n.id));
  const links: L[] = data.incidence
    .filter((i) => ids.has(i.entityId) && ids.has(i.eventId))
    .map((i) => ({ source: i.entityId, target: i.eventId, salience: i.salience }));

  // Adjacency (built before d3 replaces link endpoints with objects).
  const adj = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const i of data.incidence) {
    connect(i.entityId, i.eventId);
    connect(i.eventId, i.entityId);
  }

  const sim = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink<N, L>(links)
        .id((d) => d.id)
        .distance(70)
        .strength((l) => 0.15 + 0.5 * l.salience),
    )
    .force('x', d3.forceX<N>((d) => d.tx).strength((d) => (d.kind === 'event' ? 0.9 : 0.12)))
    .force('y', d3.forceY<N>(height / 2).strength(0.04))
    .force('charge', d3.forceManyBody<N>().strength((d) => (d.kind === 'event' ? -40 : -120)))
    .force('collide', d3.forceCollide<N>((d) => d.r + 3));

  const link = g
    .append('g')
    .attr('stroke', 'var(--muted, #8b9bb4)')
    .selectAll<SVGLineElement, L>('line')
    .data(links)
    .join('line')
    .attr('stroke-opacity', (d) => 0.2 + 0.55 * d.salience)
    .attr('stroke-width', (d) => 0.5 + 2 * d.salience);

  const activate = (d: N) => (d.kind === 'entity' ? o.onEntity(d.id) : o.onEvent(d.id));

  const node = g
    .append('g')
    .selectAll<SVGGElement, N>('g')
    .data(nodes)
    .join('g')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .style('cursor', 'pointer')
    .attr('aria-label', (d) => (d.kind === 'entity' ? labelFor(d.entity!, lang) : d.event!.label))
    .on('click', (_, d) => activate(d))
    .on('keydown', (e: KeyboardEvent, d) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(d);
      }
    });

  node
    .filter((d) => d.kind === 'entity')
    .append('path')
    .attr('d', (d) => symbolPath(d.entity!.type, d.r))
    .attr('fill', (d) => TYPE_COLOR[d.entity!.type])
    .attr('fill-opacity', 0.92)
    .attr('stroke', (d) => (d.id === data.center.id ? 'var(--text, #e6edf7)' : 'var(--bg, #0b0f17)'))
    .attr('stroke-width', (d) => (d.id === data.center.id ? 2 : 1));

  node
    .filter((d) => d.kind === 'event')
    .append('circle')
    .attr('r', (d) => d.r)
    .attr('fill', 'var(--bg, #0b0f17)')
    .attr('fill-opacity', 0.6)
    .attr('stroke', 'var(--accent, #38bdf8)')
    .attr('stroke-opacity', 0.75)
    .attr('stroke-width', 1.5);

  node.append('title').text((d) =>
    d.kind === 'entity'
      ? `${labelFor(d.entity!, lang)} · ${d.entity!.eventCount} events`
      : `${d.event!.label}\n${d.event!.start} · ${d.event!.articleCount} articles, ${d.event!.outletCount} outlets`,
  );

  node
    .filter((d) => d.kind === 'entity')
    .append('text')
    .text((d) => truncateLabel(labelFor(d.entity!, lang), 20))
    .attr('dy', (d) => -d.r - 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', 'var(--text, #e6edf7)')
    .attr('stroke', 'var(--bg, #0b0f17)')
    .attr('stroke-width', 3)
    .style('paint-order', 'stroke');

  // Hover and focus: dim everything except the node's neighborhood.
  node
    .on('mouseenter focus', (_, d) => {
      const nb = adj.get(d.id) ?? new Set<string>();
      node.style('opacity', (n) => (n.id === d.id || nb.has(n.id) ? 1 : 0.15));
      link.style('opacity', (l) =>
        (l.source as N).id === d.id || (l.target as N).id === d.id ? 1 : 0.05,
      );
    })
    .on('mouseleave blur', () => {
      node.style('opacity', null);
      link.style('opacity', null);
    });

  svg
    .append('g')
    .attr('transform', `translate(0,${height - 24})`)
    .attr('color', 'var(--muted, #8b9bb4)')
    .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));

  const draw = () => {
    link
      .attr('x1', (d) => (d.source as N).x!)
      .attr('y1', (d) => (d.source as N).y!)
      .attr('x2', (d) => (d.target as N).x!)
      .attr('y2', (d) => (d.target as N).y!);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  };
  sim.on('tick', draw);

  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sim.stop();
    sim.tick(300); // manual ticks do not fire the 'tick' event
    draw();
  }

  return () => sim.stop();
}
