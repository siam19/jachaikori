#!/usr/bin/env bun
/**
 * @file scripts/dev.ts
 * Launches the local SQLite API (`apps/api` on 127.0.0.1:8787) and forwards
 * termination signals cleanly. (Legacy `apps/web` was removed in Sprint 6 ahead
 * of the redesigned frontend handoff in Sprint 7.)
 */

const apiProc = Bun.spawn(['bun', '--filter', '@jachaikori/api', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const shutdown = (signal: NodeJS.Signals) => {
  apiProc.kill(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCode = await apiProc.exited;
process.exit(exitCode);
