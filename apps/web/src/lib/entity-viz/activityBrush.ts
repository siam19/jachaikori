import * as d3 from 'd3';
import type { ActivityPoint } from './types';

const parse = d3.utcParse('%Y-%m-%d');
const fmt = d3.utcFormat('%Y-%m-%d');

export interface BrushOptions {
  width: number;
  height: number;
  selected: [string, string]; // current window, inclusive UTC days
  onBrush: (from: string, to: string) => void;
}

export function renderActivityBrush(
  svgEl: SVGSVGElement,
  points: ActivityPoint[],
  o: BrushOptions,
): void {
  const { width, height } = o;
  const m = { t: 6, r: 12, b: 22, l: 12 };
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();

  const days = points
    .map((p) => ({ d: parse(p.day), n: p.articleCount }))
    .filter((p): p is { d: Date; n: number } => p.d !== null)
    .sort((a, b) => +a.d - +b.d);

  if (!days.length) return;

  const minDay = days[0].d;
  const maxDay = days[days.length - 1].d;
  const domainEnd = d3.utcDay.offset(maxDay, 1);

  const x = d3
    .scaleUtc()
    .domain([minDay, domainEnd])
    .range([m.l, width - m.r]);

  const maxCount = Math.max(1, d3.max(days, (d) => d.n) ?? 1);
  const y = d3
    .scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([height - m.b, m.t]);

  const bw = Math.max(1, x(d3.utcDay.offset(minDay, 1)) - x(minDay) - 1);

  svg
    .append('g')
    .attr('fill', 'var(--accent, #38bdf8)')
    .attr('fill-opacity', 0.65)
    .selectAll('rect')
    .data(days)
    .join('rect')
    .attr('x', (d) => x(d.d))
    .attr('y', (d) => y(d.n))
    .attr('width', bw)
    .attr('height', (d) => Math.max(0, y(0) - y(d.n)));

  svg
    .append('g')
    .attr('transform', `translate(0,${height - m.b})`)
    .attr('color', 'var(--muted, #8b9bb4)')
    .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));

  const brush = d3
    .brushX()
    .extent([
      [m.l, m.t],
      [width - m.r, height - m.b],
    ])
    .on('end', (ev: d3.D3BrushEvent<unknown>) => {
      if (!ev.sourceEvent || !ev.selection) return; // ignore programmatic moves and clears
      const [a, b] = (ev.selection as [number, number]).map((px) => x.invert(px));
      const fromDay = d3.utcDay.round(a);
      // b is the exclusive end of the brushed range; subtract 1 day to get inclusive `to`.
      const toExclusive = d3.utcDay.round(b);
      let toDay = d3.utcDay.offset(toExclusive, -1);
      if (toDay < fromDay) toDay = fromDay;
      o.onBrush(fmt(fromDay), fmt(toDay));
    });

  const gb = svg.append('g').call(brush);

  // Clamp o.selected to [minDay, maxDay] so brush.move never exceeds the extent.
  const selStartRaw = parse(o.selected[0]) ?? minDay;
  const selEndRaw = parse(o.selected[1]) ?? maxDay;
  const clampedStart = selStartRaw < minDay ? minDay : selStartRaw > maxDay ? maxDay : selStartRaw;
  const clampedEnd = selEndRaw < clampedStart ? clampedStart : selEndRaw > maxDay ? maxDay : selEndRaw;

  const x0 = Math.max(m.l, x(clampedStart));
  const x1 = Math.min(width - m.r, x(d3.utcDay.offset(clampedEnd, 1)));
  if (x1 > x0) {
    gb.call(brush.move, [x0, x1]);
  }
}
