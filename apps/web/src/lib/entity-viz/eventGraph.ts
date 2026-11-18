import * as d3 from 'd3';
import type { EventEdge, EventGraphResponse, Lang } from './types';
import { TYPE_COLOR, labelFor, symbolPath, truncateLabel } from './style';

type E = EventGraphResponse['entities'][number];
type N = d3.SimulationNodeDatum & { id: string; r: number; e: E };
type L = d3.SimulationLinkDatum<N> & { edge: EventEdge };

const WEAK = new Set(['co_occurred', 'located_in']);

export interface EventGraphOptions {
  width: number;
  height: number;
  lang: Lang;
  onEdge: (edge: EventEdge) => void;
  onEntity: (id: string) => void;
  onHoverEntity?: (id: string | null) => void;
}

export function renderEventGraph(
  svgEl: SVGSVGElement,
  data: EventGraphResponse,
  o: EventGraphOptions,
): () => void {
  const { width, height, lang } = o;
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();

  svg
    .append('defs')
    .append('marker')
    .attr('id', 'entity-viz-arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 18)
    .attr('refY', 5)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0 0L10 5L0 10z')
    .attr('fill', 'var(--muted, #8b9bb4)');

  const g = svg.append('g');

  // Pan & zoom support
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 4])
    .on('zoom', (ev: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      g.attr('transform', ev.transform.toString());
    });
  svg.call(zoom);

  const nodes: N[] = data.entities.map((e) => ({ id: e.id, e, r: 8 + 14 * e.salience }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: L[] = data.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, edge }));

  const sim = d3
    .forceSimulation(nodes)
    .force('link', d3.forceLink<N, L>(links).id((d) => d.id).distance(110))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide<N>((d) => d.r + 6));

  const linkGroup = g.append('g');

  const link = linkGroup
    .selectAll<SVGLineElement, L>('line.viz-edge')
    .data(links)
    .join('line')
    .attr('class', 'viz-edge')
    .attr('stroke', 'var(--muted, #8b9bb4)')
    .attr('stroke-width', (d) => 1 + 1.5 * Math.log2(d.edge.weight + 1))
    .attr('stroke-dasharray', (d) => (WEAK.has(d.edge.relationType) ? '4 3' : null))
    .attr('stroke-opacity', (d) => (WEAK.has(d.edge.relationType) ? 0.45 : 0.85))
    .attr('marker-end', (d) => (d.edge.relationType === 'quoted_about' ? 'url(#entity-viz-arrow)' : null))
    .style('pointer-events', 'none');

  // Wide transparent hit-target for easier clicking and keyboard focus
  const linkHit = linkGroup
    .selectAll<SVGLineElement, L>('line.viz-edge-hit')
    .data(links)
    .join('line')
    .attr('class', 'viz-edge-hit')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 14)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.edge.relationType} (${d.edge.evidence.length} evidence)`)
    .style('cursor', 'pointer')
    .on('click', (_, d) => o.onEdge(d.edge))
    .on('keydown', (e: KeyboardEvent, d) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        o.onEdge(d.edge);
      }
    });

  linkHit.append('title').text((d) => `${d.edge.relationType} · ${d.edge.evidence.length} sentence(s)`);

  const node = g
    .append('g')
    .selectAll<SVGGElement, N>('g')
    .data(nodes)
    .join('g')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => labelFor(d.e, lang))
    .style('cursor', 'pointer')
    .on('click', (_, d) => o.onEntity(d.id))
    .on('mouseenter', (_, d) => o.onHoverEntity?.(d.id))
    .on('mouseleave', () => o.onHoverEntity?.(null))
    .on('focus', (_, d) => o.onHoverEntity?.(d.id))
    .on('blur', () => o.onHoverEntity?.(null))
    .on('keydown', (e: KeyboardEvent, d) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        o.onEntity(d.id);
      }
    });

  node
    .append('path')
    .attr('d', (d) => symbolPath(d.e.type, d.r))
    .attr('fill', (d) => TYPE_COLOR[d.e.type])
    .attr('stroke', 'var(--text, #e6edf7)')
    .attr('stroke-width', (d) => (d.e.roles.includes('quoted_speaker') ? 2.5 : 0));

  node.append('title').text((d) => `${labelFor(d.e, lang)} (${d.e.type})`);

  node
    .append('text')
    .text((d) => truncateLabel(labelFor(d.e, lang), 20))
    .attr('dy', (d) => -d.r - 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', 'var(--text, #e6edf7)')
    .attr('stroke', 'var(--bg, #0b0f17)')
    .attr('stroke-width', 3)
    .style('paint-order', 'stroke');

  const draw = () => {
    link
      .attr('x1', (d) => (d.source as N).x!)
      .attr('y1', (d) => (d.source as N).y!)
      .attr('x2', (d) => (d.target as N).x!)
      .attr('y2', (d) => (d.target as N).y!);
    linkHit
      .attr('x1', (d) => (d.source as N).x!)
      .attr('y1', (d) => (d.source as N).y!)
      .attr('x2', (d) => (d.target as N).x!)
      .attr('y2', (d) => (d.target as N).y!);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  };
  sim.on('tick', draw);

  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sim.stop();
    sim.tick(300);
    draw();
  }

  return () => sim.stop();
}

/** Safe evidence list: scraped text goes in via textContent only. */
export function renderEvidence(container: HTMLElement, edge: EventEdge): void {
  container.replaceChildren(
    ...edge.evidence.map((ev) => {
      const block = document.createElement('blockquote');
      const text = document.createElement('p');
      text.textContent = ev.snippet;
      const cite = document.createElement('cite');
      cite.textContent = ev.outlet;
      block.append(text, cite);
      return block;
    }),
  );
}
