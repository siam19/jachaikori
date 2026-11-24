#!/usr/bin/env bun
/**
 * @file scripts/dev.ts
 * Launches both the local SQLite API (`apps/api` on 127.0.0.1:8787) and the
 * Morning Edition web app (`apps/web` on localhost:5173) and forwards signals cleanly.
 */

const apiProc = Bun.spawn(['bun', '--filter', '@jachaikori/api', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const webProc = Bun.spawn(['bun', '--filter', '@jachaikori/web', 'dev'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const shutdown = (signal: NodeJS.Signals) => {
  apiProc.kill(signal);
  webProc.kill(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCode = await Promise.race([apiProc.exited, webProc.exited]);
shutdown('SIGTERM');
process.exit(exitCode);
