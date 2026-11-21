// scripts/lib/xai-usage-report.mjs over real Postgres (PGlite): spend by lane
// and model, plus the prompt-cache hit rate that shows whether x-grok-conv-id
// (api/_lib/xai-conv-id.js) is landing follow-up turns on a warm server.

import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { buildReport, formatReport } from '../scripts/lib/xai-usage-report.mjs';

const NOW = Date.parse('2026-11-21T12:00:00Z');
let sql;

beforeAll(async () => {
	const pg = new PGlite();
	await pg.exec(`create table xai_usage (
		id bigserial primary key, created_at timestamptz not null default now(), lane text not null, model text not null,
		input_tokens bigint not null default 0, output_tokens bigint not null default 0, cached_tokens bigint not null default 0,
		cost_usd_micro bigint not null default 0, cost_source text not null)`);
	const at = new Date(NOW - 3_600_000).toISOString();
	await pg.query(
		`insert into xai_usage (created_at, lane, model, input_tokens, cached_tokens, cost_usd_micro, cost_source) values
		($1, 'chat', 'grok-4.7', 10000, 7500, 30000, 'api'),
		($1, 'chat', 'grok-4.7', 10000, 0, 40000, 'api'),
		($1, 'image', 'grok-imagine-image-2.0', 0, 0, 40000, 'api')`,
		[at],
	);
	sql = createPgliteSql({ pg }).sql;
});

describe('xai usage report', () => {
	it('reports the prompt-cache hit rate per lane and model, and none for media lanes', async () => {
		const report = await buildReport(sql, { now: NOW, env: {} });
		const today = report.windows[0];
		const chat = today.rows.find((r) => r.lane === 'chat');
		expect(chat).toMatchObject({ calls: 2, input_tokens: 20000, cached_tokens: 7500 });
		expect(today.rows.find((r) => r.lane === 'image').input_tokens).toBe(0);
		const text = formatReport(report);
		expect(text).toMatch(/chat\s+grok-4\.7\s+2 calls\s+\$0\.07\s+cache 38%/);
		expect(text).not.toMatch(/grok-imagine-image-2\.0.*cache/);
		expect(text).toContain('prompt cache (today): 38% of 20000 input tokens served from cache');
	});
});
