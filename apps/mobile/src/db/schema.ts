/**
 * Local SQLite schema. `mutation_queue` backs packages/offline-sync's
 * `QueueStorageAdapter`; the `cached_*` tables are the authorized-data
 * cache pulled down while online (see src/sync/catalog-sync.ts) so the POS
 * screen can browse products/customers/branch info with zero connectivity.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mutation_queue (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  nextAttemptAt INTEGER NOT NULL,
  syncedAt INTEGER,
  serverResponse TEXT
);

CREATE INDEX IF NOT EXISTS idx_mutation_queue_status ON mutation_queue(status);

CREATE TABLE IF NOT EXISTS cached_variants (
  id TEXT PRIMARY KEY NOT NULL,
  productId TEXT NOT NULL,
  productName TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  retailPrice TEXT NOT NULL,
  availableQuantity INTEGER NOT NULL,
  stockStatus TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_customers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  updatedAt INTEGER NOT NULL
);

-- Single-row table: the branch/stock location/register this device is
-- currently operating as. A cashier device is scoped to one branch at a
-- time (spec's POS model), so there's no need for a multi-row table here.
CREATE TABLE IF NOT EXISTS active_branch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  branchName TEXT NOT NULL,
  stockLocationId TEXT NOT NULL,
  registerId TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
