import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL } from './schema';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens (once) and migrates the on-device database. Safe to call repeatedly — same promise is reused. */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('salesmaster.db').then(async (db) => {
      await db.execAsync(SCHEMA_SQL);
      return db;
    });
  }
  return dbPromise;
}

/** Test/dev only: drops the cached module-level handle so a fresh getDatabase() reopens. */
export function __resetDatabaseHandleForTests(): void {
  dbPromise = null;
}
