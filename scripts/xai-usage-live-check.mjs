#!/usr/bin/env node
// Prove the xAI ledger end to end on a throwaway Postgres: apply the real
// migration stream (including xai_usage), record calls through the real
// recordXaiUsage path, then print the same report `npm run grok:usage` prints.
//
// No xAI key is needed. The recorded responses follow xAI's documented usage
// objects (chat completions and Responses API shapes); nothing touches
// production. Run: node scripts/xai-usage-live-check.mjs

import { useIsolatedDb } from './lib/isolated-db.mjs';

const { pg } = await useIsolatedDb();

const { GROK_MODELS, XAI_MEDIA_MODELS } = await import('../api/_lib/chat-models.js');
const { recordXaiUsage, flushXaiUsage } = await import('../api/_lib/xai-usage.js');
const { sql } = await import('../api/_lib/db.js');
const { buildReport, formatReport } = await import('./lib/xai-usage-report.mjs');
const { gatherXaiCreditHealth } = await import('../api/_lib/xai-credit-health.js');

const flagship = GROK_MODELS[0].id;
const budget = GROK_MODELS.find((m) => m.tier !== 'flagship')?.id ?? flagship;
const image = XAI_MEDIA_MODELS.find((m) => m.kind === 'image');

// A chat completion with a reported cost (cost_source api).
recordXaiUsage({
	lane: 'chat',
	model: flagship,
	response: { id: 'chatcmpl-live-check-1', usage: { prompt_tokens: 1800, completion_tokens: 240, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens_details: { reasoning_tokens: 90 }, cost_in_usd_ticks: 96_000_000 } },
});
// A streamed chat usage chunk with no cost (priced from the table).
recordXaiUsage({ lane: 'chat', model: budget, usage: { prompt_tokens: 5200, completion_tokens: 410 } });
// A Responses API call (the x_search tool).
recordXaiUsage({ lane: 'other', model: flagship, response: { id: 'resp-live-check-1', usage: { input_tokens: 2400, output_tokens: 700, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }, meta: { tool: 'x_search' } });
// An image lane call: units, no tokens.
recordXaiUsage({ lane: 'image', model: image.id, units: 4 });
await flushXaiUsage();

const { rows } = await pg.query('select lane, model, cost_source, cost_usd_micro from xai_usage order by id');
console.log(`rows written by recordXaiUsage: ${rows.length}`);
for (const r of rows) console.log(`  ${r.lane.padEnd(6)} ${r.model.padEnd(24)} ${r.cost_source.padEnd(12)} ${r.cost_usd_micro}`);

const env = { XAI_CREDIT_GRANT_USD: '500', XAI_CREDIT_ISSUED_AT: new Date(Date.now() - 20 * 86_400_000).toISOString(), XAI_DAILY_SPEND_CAP_USD: '50' };
console.log('\n' + formatReport(await buildReport(sql, { env })));

Object.assign(process.env, env);
console.log('\nhealthz subsystem:', JSON.stringify(await gatherXaiCreditHealth()));
process.exit(0);
