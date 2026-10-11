// One query interface over two engines. DATABASE_URL selects real Postgres
// (TimescaleDB in docker-compose, Neon, Cloud SQL, anything); without it the
// archive lives in an embedded PGlite directory, so `npm start` works on a
// fresh clone with zero setup and the same SQL runs on both.
import { mkdirSync } from 'node:fs';
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';

const log = logger('db');

export type Row = Record<string, any>;

export interface Db {
  kind: 'postgres' | 'pglite';
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let instance: Promise<Db> | null = null;

export function db(): Promise<Db> {
  instance ??= open();
  return instance;
}

async function open(): Promise<Db> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    // Bigint and numeric columns come back as JS numbers; every value we store
    // fits a double, and charts want numbers, not strings.
    pg.types.setTypeParser(20, (v: string) => Number(v));
    pg.types.setTypeParser(1700, (v: string) => Number(v));
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
    pool.on('error', (err: Error) => log.error('pool error', err));
    log.info('using postgres');
    return {
      kind: 'postgres',
      async query(sql, params = []) {
        return (await pool.query(sql, params as any[])).rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }
  // PGlite creates only the leaf directory, so a fresh clone without data/ crashes.
  mkdirSync(config.pgliteDir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = await PGlite.create(config.pgliteDir, {
    parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) },
  });
  log.info(`using embedded pglite at ${config.pgliteDir}`);
  return {
    kind: 'pglite',
    async query(sql, params = []) {
      return (await lite.query(sql, params as any[])).rows as any[];
    },
    async exec(sql) {
      await lite.exec(sql);
    },
    async close() {
      await lite.close();
    },
  };
}

/**
 * Multi-row insert with an optional ON CONFLICT tail, chunked under the
 * protocol's 65535-parameter ceiling.
 */
export async function insertMany(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict = '',
): Promise<number> {
  if (!rows.length) return 0;
  const d = await db();
  const per = Math.max(1, Math.floor(60_000 / columns.length));
  let written = 0;
  for (let i = 0; i < rows.length; i += per) {
    const slice = rows.slice(i, i + per);
    const params: unknown[] = [];
    const tuples = slice.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await d.query(`insert into ${table} (${columns.join(',')}) values ${tuples.join(',')} ${conflict}`, params);
    written += slice.length;
  }
  return written;
}
