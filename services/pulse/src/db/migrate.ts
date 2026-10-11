// Applies src/db/migrations/*.sql in name order, once each, recorded in
// schema_migrations. Runs automatically on startup; also `npm run db:migrate`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetDir } from '../lib/paths.ts';
import { db } from './client.ts';
import { logger } from '../lib/log.ts';

const log = logger('migrate');
const dir = assetDir('migrations', 'src/db/migrations');

export async function migrate(): Promise<void> {
  const d = await db();
  await d.exec('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await d.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    log.info(`applying ${file}`);
    await d.exec(`begin; ${readFileSync(join(dir, file), 'utf8')}; insert into schema_migrations (id) values ('${file}'); commit;`);
  }
  if (d.kind === 'postgres') await enableTimescale();
}

/**
 * When the server has TimescaleDB (the docker-compose image does), turn the
 * append-only time series into compressed hypertables. Plain Postgres skips
 * this silently; every query works the same either way.
 */
async function enableTimescale(): Promise<void> {
  const d = await db();
  const available = await d.query(`select 1 from pg_available_extensions where name = 'timescaledb'`);
  if (!available.length) return;
  await d.exec('create extension if not exists timescaledb');
  for (const [table, after] of [
    ['token_snapshots', '7 days'],
    ['trades', '7 days'],
    ['list_appearances', '7 days'],
    ['market_snapshots', '30 days'],
  ] as const) {
    const ht = await d.query(`select 1 from timescaledb_information.hypertables where hypertable_name = $1`, [table]);
    if (ht.length) continue;
    log.info(`converting ${table} to a hypertable`);
    await d.exec(`select create_hypertable('${table}', by_range('ts', interval '1 day'), migrate_data => true)`);
    await d.exec(`alter table ${table} set (timescaledb.compress, timescaledb.compress_segmentby = 'chain')`);
    await d.exec(`select add_compression_policy('${table}', interval '${after}')`);
  }
}
