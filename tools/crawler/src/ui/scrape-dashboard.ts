/**
 * @file tools/crawler/src/ui/scrape-dashboard.ts
 * Static, flicker-free in-place terminal dashboard for concurrent outlet scraping,
 * styled to blend seamlessly with @clack/prompts (`│`, `◇`, `├`, `└` + picocolors).
 */

import color from 'picocolors';
import type { OutletId } from '@jachaikori/schema';

export type WorkerPhase =
  | 'queued'
  | 'scraping'
  | 'waiting'
  | 'breather'
  | 'cooldown'
  | 'done'
  | 'stopped';

export interface OutletScrapeState {
  outlet: OutletId;
  domain: string;
  transport: 'http' | 'playwright';
  activeTotal: number;
  extractedCount: number;
  sessionScraped: number;
  failedCount: number;
  sessionFailed: number;
  targetThisSession: number;
  phase: WorkerPhase;
  waitMsRemaining: number;
  note?: string;
}

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
// Strip ANSI escape codes to measure visible width and prevent line wrapping
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function visibleLength(str: string): number {
  return str.replace(ANSI_REGEX, '').length;
}

/**
 * Clips a styled line so its visible length never exceeds terminal columns,
 * guaranteeing that `\x1b[<N>A` cursor-up math never drifts due to line wrap.
 */
function clipToWidth(str: string, maxCols: number): string {
  if (maxCols <= 10 || visibleLength(str) <= maxCols) return str;

  let vis = 0;
  let out = '';
  let i = 0;
  const target = maxCols - 1;

  while (i < str.length && vis < target) {
    if (str[i] === '\x1b') {
      const end = str.indexOf('m', i);
      if (end !== -1) {
        out += str.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += str[i];
    vis++;
    i++;
  }

  return `${out}\x1b[0m…`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function renderProgressBar(completed: number, total: number, width: number = 8): string {
  if (total <= 0 || completed <= 0) return color.dim('░'.repeat(width));
  const ratio = Math.min(1, Math.max(0, completed / total));
  if (ratio >= 1) return color.green('█'.repeat(width));

  const totalEighths = Math.max(1, Math.round(ratio * width * 8));
  const fullBlocks = Math.min(width, Math.floor(totalEighths / 8));
  const remainder = fullBlocks < width ? totalEighths % 8 : 0;
  const partialChar = remainder > 0 ? PARTIAL_BLOCKS[remainder]! : '';
  const usedCells = fullBlocks + (partialChar ? 1 : 0);
  const emptyCells = Math.max(0, width - usedCells);

  return `${color.cyan('█'.repeat(fullBlocks) + partialChar)}${color.dim('░'.repeat(emptyCells))}`;
}

export class ScrapeDashboard {
  private states = new Map<OutletId, OutletScrapeState>();
  private orderedOutlets: OutletId[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderedLines = 0;
  private frameIdx = 0;
  private startedAt = Date.now();
  private shuttingDown = false;
  private isTty: boolean;
  private lastNonTtyLogAt = 0;
  private cursorHidden = false;

  private readonly exitHandler = () => {
    this.restoreCursor();
  };

  constructor(initialStates: OutletScrapeState[]) {
    this.isTty = Boolean(process.stdout.isTTY);
    for (const st of initialStates) {
      this.states.set(st.outlet, { ...st });
      this.orderedOutlets.push(st.outlet);
    }
  }

  getState(outlet: OutletId): OutletScrapeState | undefined {
    return this.states.get(outlet);
  }

  updateOutlet(outlet: OutletId, patch: Partial<OutletScrapeState>): void {
    const existing = this.states.get(outlet);
    if (!existing) return;
    Object.assign(existing, patch);
  }

  setShuttingDown(flag: boolean): void {
    this.shuttingDown = flag;
    if (this.isTty) {
      this.renderFrame();
    }
  }

  start(refreshWaitDynamic?: (state: OutletScrapeState) => void): void {
    this.startedAt = Date.now();

    if (this.isTty) {
      process.stdout.write('\x1b[?25l');
      this.cursorHidden = true;
      process.on('exit', this.exitHandler);
      this.renderFrame(refreshWaitDynamic);
      this.timer = setInterval(() => {
        this.frameIdx = (this.frameIdx + 1) % SPINNER_FRAMES.length;
        this.renderFrame(refreshWaitDynamic);
      }, 200);
    } else {
      this.logNonTtySummary('Starting concurrent polite scrape');
      this.timer = setInterval(() => {
        if (Date.now() - this.lastNonTtyLogAt >= 10_000) {
          this.logNonTtySummary('Progress');
        }
      }, 2000);
    }
  }

  stop(refreshWaitDynamic?: (state: OutletScrapeState) => void): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.isTty) {
      this.renderFrame(refreshWaitDynamic);
      this.restoreCursor();
      process.removeListener('exit', this.exitHandler);
    } else {
      this.logNonTtySummary('Finished');
    }
  }

  private restoreCursor(): void {
    if (this.cursorHidden) {
      process.stdout.write('\x1b[?25h');
      this.cursorHidden = false;
    }
  }

  private logNonTtySummary(prefix: string): void {
    this.lastNonTtyLogAt = Date.now();
    let totalActive = 0;
    let totalExtracted = 0;
    let sessionScraped = 0;
    let sessionFailed = 0;

    const perOutlet: string[] = [];
    for (const id of this.orderedOutlets) {
      const st = this.states.get(id)!;
      totalActive += st.activeTotal;
      totalExtracted += st.extractedCount;
      sessionScraped += st.sessionScraped;
      sessionFailed += st.sessionFailed;
      perOutlet.push(`${id}:${st.extractedCount}/${st.activeTotal}(+${st.sessionScraped})`);
    }

    console.log(
      `[${prefix}] ${totalExtracted}/${totalActive} (+${sessionScraped} new, ${sessionFailed} err) | ${perOutlet.join(' ')}`
    );
  }

  private renderFrame(refreshWaitDynamic?: (state: OutletScrapeState) => void): void {
    const cols = Math.max(60, (process.stdout.columns ?? 100) - 1);
    const rail = color.gray('│');
    const spinner = SPINNER_FRAMES[this.frameIdx]!;

    let totalActive = 0;
    let totalExtracted = 0;
    let totalSessionScraped = 0;
    let totalSessionTarget = 0;
    let totalFailed = 0;

    const lines: string[] = [];

    lines.push(`${rail}`);
    lines.push(
      `${color.cyan('◇')}  ${color.bold('Live Outlet Progress')} ${color.dim('(1 polite serial stream per domain)')}`
    );
    lines.push(
      `${rail}  ${color.dim(
        `${'OUTLET'.padEnd(21)} ${'MODE'.padEnd(4)} ${'PROGRESS'.padEnd(15)} ${'SCRAPED / TOTAL'.padEnd(13)} ${'NEW'.padEnd(6)} STATE`
      )}`
    );

    for (const id of this.orderedOutlets) {
      const st = this.states.get(id)!;
      refreshWaitDynamic?.(st);

      totalActive += st.activeTotal;
      totalExtracted += st.extractedCount;
      totalSessionScraped += st.sessionScraped;
      totalSessionTarget += st.targetThisSession;
      totalFailed += st.failedCount;

      const pct =
        st.activeTotal > 0
          ? `${((st.extractedCount / st.activeTotal) * 100).toFixed(1).padStart(5)}%`
          : '  0.0%';
      const bar = `${renderProgressBar(st.extractedCount, st.activeTotal, 8)} ${color.dim(pct)}`;

      const modeBadge =
        st.transport === 'playwright'
          ? color.magenta('PW  ')
          : color.cyan('HTTP');

      const countsStr = `${color.white(st.extractedCount.toLocaleString().padStart(5))}${color.dim('/')}${color.dim(st.activeTotal.toLocaleString().padEnd(6))}`;

      const sessionBadge =
        st.sessionScraped > 0
          ? color.green(`+${st.sessionScraped}`.padEnd(6))
          : color.dim('+0'.padEnd(6));

      let icon = color.dim('·');
      let stateLabel = '';

      switch (st.phase) {
        case 'scraping':
          icon = color.cyan(spinner);
          stateLabel = color.cyan('Fetching…');
          break;
        case 'waiting': {
          icon = color.blue(spinner);
          const sec = (Math.max(100, st.waitMsRemaining) / 1000).toFixed(1);
          stateLabel = color.dim(`Polite ${sec}s`);
          break;
        }
        case 'breather': {
          icon = color.yellow('⏸');
          const sec = Math.ceil(st.waitMsRemaining / 1000);
          stateLabel = color.yellow(`Breather ${sec}s`);
          break;
        }
        case 'cooldown': {
          icon = color.red('⏸');
          const sec = Math.ceil(st.waitMsRemaining / 1000);
          stateLabel = color.red(`Cooldown ${sec}s`);
          break;
        }
        case 'queued':
          icon = color.dim('○');
          stateLabel = color.dim('Queued');
          break;
        case 'done':
          icon = color.green('✔');
          stateLabel = color.green('Done');
          break;
        case 'stopped':
          icon = color.yellow('■');
          stateLabel = color.yellow('Saved · Paused');
          break;
      }

      if (st.sessionFailed > 0) {
        stateLabel += ` ${color.red(`(${st.sessionFailed} err)`)}`;
      }

      const nameCol =
        st.phase === 'done'
          ? color.green(st.outlet.padEnd(19))
          : color.bold(color.white(st.outlet.padEnd(19)));

      lines.push(
        `${rail}  ${icon} ${nameCol} ${modeBadge} ${bar} ${countsStr} ${sessionBadge} ${stateLabel}`
      );
    }

    const elapsedMs = Date.now() - this.startedAt;
    const elapsedMin = elapsedMs / 60_000;
    const ratePerMin =
      elapsedMs >= 3_000 && totalSessionScraped > 0
        ? (totalSessionScraped / elapsedMin).toFixed(1)
        : '—';

    const overallPct =
      totalActive > 0 ? ((totalExtracted / totalActive) * 100).toFixed(1) : '0.0';

    const remainingInSession = Math.max(0, totalSessionTarget - totalSessionScraped);
    let etaStr = '—';
    if (elapsedMs >= 5_000 && totalSessionScraped >= 3 && remainingInSession > 0) {
      const msPerItem = elapsedMs / totalSessionScraped;
      etaStr = formatDuration(remainingInSession * msPerItem);
    } else if (remainingInSession === 0) {
      etaStr = '00:00';
    }

    lines.push(`${rail}`);
    lines.push(
      `${rail}  ${color.bold('Total:')} ${color.green(totalExtracted.toLocaleString())} / ${totalActive.toLocaleString()} (${overallPct}%)  ${color.dim('•')}  ${color.bold('Session:')} ${color.green(`+${totalSessionScraped.toLocaleString()}`)}  ${color.dim('•')}  ${color.bold('Rate:')} ${color.cyan(`${ratePerMin}/min`)}  ${color.dim('•')}  ${color.bold('Elapsed:')} ${formatDuration(elapsedMs)}  ${color.dim('•')}  ${color.bold('ETA:')} ${etaStr}`
    );

    if (this.shuttingDown) {
      lines.push(
        `${rail}  ${color.yellow('⚠ Stopping gracefully… saving in-flight article to catalog.sqlite & closing browsers (Ctrl+C again to force)')}`
      );
    } else {
      const failHint =
        totalFailed > 0 ? ` · ${color.yellow(`${totalFailed.toLocaleString()} failed in DB`)}` : '';
      lines.push(
        `${rail}  ${color.dim('SQLite WAL auto-commit active · Press Ctrl+C anytime to stop safely')}${failHint}`
      );
    }

    const clipped = lines.map((l) => clipToWidth(l, cols));
    let out = '';
    if (this.renderedLines > 0) {
      out += `\x1b[${this.renderedLines}A\r`;
    }
    for (const line of clipped) {
      out += `\x1b[2K${line}\n`;
    }

    process.stdout.write(out);
    this.renderedLines = clipped.length;
  }
}
