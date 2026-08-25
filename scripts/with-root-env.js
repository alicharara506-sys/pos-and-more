#!/usr/bin/env node

/**
 * apps/api, apps/worker, and apps/web all run with their own app directory
 * as cwd (`pnpm --filter <app> dev`), but the workspace's single .env lives
 * at the repo root. None of Nest/tsx/Next auto-load a .env from a parent
 * directory, so every app would otherwise fail `loadEnv()`'s validation (or,
 * for apps/web, silently miss NEXT_PUBLIC_* vars). This loads the root .env
 * into the child process's environment before running the real dev command.
 * Real environment variables already set always win over a value from the
 * file — this mirrors packages/database/scripts/with-env.js.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootEnvPath = path.resolve(__dirname, '..', '.env');
const env = { ...process.env };

if (fs.existsSync(rootEnvPath)) {
  const lines = fs.readFileSync(rootEnvPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
}

const [, , cmd, ...args] = process.argv;
const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: true });
process.exit(result.status ?? 1);
