#!/usr/bin/env node

/**
 * The Prisma CLI (and tsx-run scripts like seed.ts) only auto-load a .env
 * file that sits next to schema.prisma or in the current working directory
 * — neither is true here, since the workspace's .env lives at the repo
 * root while these scripts run with packages/database as their cwd. This
 * loads that root .env (if present) into the child process's environment
 * before running the real command. Real environment variables already set
 * (e.g. by CI, which passes DATABASE_URL/DIRECT_URL directly and never
 * writes a .env file) always win over a value from the file.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootEnvPath = path.resolve(__dirname, '..', '..', '..', '.env');
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
