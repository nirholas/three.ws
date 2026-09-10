#!/usr/bin/env node
// Re-embed all stored widget knowledge chunks into the free NVIDIA NIM
// embedding space (nvidia/nemotron-3-embed-1b@2048), safely.
//
// Why: rows embedded with OpenAI text-embedding-3-small@256 can only be
// queried while an OpenAI key serves — and the platform's free-first policy
// wants retrieval off the paid lane entirely. This migrates every chunk to
// the NIM space using the same access layer the API uses (api/_lib/db.js +
// api/_lib/embeddings.js), so what the script writes is exactly what
// retrieval reads.
//
// Safety properties:
//   • Resume-safe + idempotent — each chunk row carries an `embedder` tag;
//     a re-run only touches rows still outside the target space, and a crash
//     mid-run loses nothing.
//   • Atomic per document set — a doc's `embedder` tag flips only after every
//     chunk in it is verified migrated. Retrieval routes per-chunk tag, so
//     even mid-migration every chunk is queried in its own (correct) space.
//   • Throttled, with exponential backoff on 429/5xx/network errors — the
//     free tier is credit-metered and rate-limited.
//   • --dry-run prints counts and cost/time estimates and writes NOTHING.
//
// Usage:
//   node scripts/reembed-widget-knowledge.mjs --dry-run
//   node scripts/reembed-widget-knowledge.mjs [--widget wdgt_x] [--batch 64] [--throttle-ms 400]
//
// Requires DATABASE_URL (+ NVIDIA_API_KEY for a real run) from .env.local /
// .env / the environment. Run AFTER the T3.1 tagging schema is deployed
// (api/_lib/migrations/2026-06-11-knowledge-embedder-tag.sql).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Env loading happens inside main() (not at import time) so the exported
// functions stay side-effect-free for unit tests.
function loadEnvFile(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return;
	}
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (!m) continue;
		const [, k, v] = m;
		if (process.env[k]) continue;
		process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}

const { NIM_EMBED_TAG, embedderConfigured, embedPassages } = await import(
	'../api/_lib/embeddings.js'
);

// Free-tier pacing defaults: 64 chunks per request (well under the probed
// 512-input batch ceiling), a polite gap between requests, and a generous
// per-request latency assumption for the dry-run time estimate.
const DEFAULT_BATCH = 64;
const DEFAULT_THROTTLE_MS = 400;
const EST_REQUEST_SECONDS = 1.0;

export function parseCliArgs(argv) {
	const args = { dryRun: false, widget: null, batch: DEFAULT_BATCH, throttleMs: DEFAULT_THROTTLE_MS };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') args.dryRun = true;
		else if (a === '--widget') args.widget = argv[++i] || null;
		else if (a === '--batch') args.batch = Math.max(1, Math.min(512, Number(argv[++i]) || DEFAULT_BATCH));
		else if (a === '--throttle-ms') args.throttleMs = Math.max(0, Number(argv[++i]) || 0);
		else throw new Error(`unknown argument: ${a}`);
	}
	return args;
}

/**
 * Survey every knowledge doc and classify what the migration would do to it.
 * Read-only — this is the whole of --dry-run.
 */
export async function planMigration(sql, { targetTag, widgetId = null }) {
	const rows = await sql`
		select d.id, d.widget_id, d.title, d.status, d.embedder as doc_embedder,
		       count(c.id)::int as total_chunks,
		       count(c.id) filter (where c.embedder is distinct from ${targetTag})::int as pending_chunks,
		       coalesce(sum(c.token_count) filter (where c.embedder is distinct from ${targetTag}), 0)::int as pending_tokens
		from widget_knowledge_docs d
		left join widget_knowledge_chunks c on c.doc_id = d.id
		where ${widgetId}::text is null or d.widget_id = ${widgetId}
		group by d.id, d.widget_id, d.title, d.status, d.embedder
		order by d.widget_id, d.id
	`;
	return rows.map((d) => ({ ...d, ...classifyDoc(d, targetTag) }));
}

/** Decide the action for one surveyed doc. Pure — unit-tested directly. */
export function classifyDoc(doc, targetTag) {
	if (doc.status !== 'ready') return { action: 'skip', reason: `status=${doc.status}` };
	if (!Number(doc.total_chunks)) return { action: 'skip', reason: 'no chunks stored' };
	if (!Number(doc.pending_chunks)) {
		return doc.doc_embedder === targetTag
			? { action: 'done', reason: 'already migrated' }
			: { action: 'flip', reason: 'all chunks migrated; doc tag stale (resumed run)' };
	}
	return { action: 'migrate', reason: `${doc.pending_chunks}/${doc.total_chunks} chunks pending` };
}

/**
 * Retry `fn` on rate limits (429), upstream 5xx, and network-level failures
 * with exponential backoff. Never retries hard 4xx/config errors.
 */
export async function withBackoff(fn, { attempts = 6, baseMs = 2000, sleep, log = () => {} } = {}) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const status = err?.status;
			const retriable =
				status === 429 ||
				(typeof status === 'number' && status >= 500) ||
				(status === undefined && err?.code !== 'no_embedder' && err?.code !== 'unknown_embedder');
			if (!retriable || attempt >= attempts - 1) throw err;
			const delayMs = Math.min(60_000, baseMs * 2 ** attempt) + Math.floor(Math.random() * 250);
			log(`    ${status === 429 ? 'rate limited' : `retryable error (${status ?? err?.code ?? 'network'})`} — backing off ${delayMs}ms (attempt ${attempt + 1}/${attempts})`);
			await sleep(delayMs);
		}
	}
}

/**
 * Migrate one document set. Re-embeds only chunks whose tag differs from the
 * target (idempotent / resume point is the per-row tag), then flips the doc
 * tag iff a verification count confirms zero chunks remain outside the target
 * space — the set-level flip is atomic with respect to retrieval semantics.
 */
export async function migrateDoc(
	{ sql, embedBatchFn, sleep, log = () => {} },
	doc,
	{ targetTag, batch = DEFAULT_BATCH, throttleMs = DEFAULT_THROTTLE_MS },
) {
	let migrated = 0;
	for (;;) {
		const pending = await sql`
			select id, content from widget_knowledge_chunks
			where doc_id = ${doc.id} and embedder is distinct from ${targetTag}
			order by chunk_index
			limit ${batch}
		`;
		if (!pending.length) break;

		const vectors = await withBackoff(
			() => embedBatchFn(pending.map((r) => String(r.content))),
			{ sleep, log },
		);
		for (let i = 0; i < pending.length; i++) {
			await sql`
				update widget_knowledge_chunks
				set embedding = ${JSON.stringify(Array.from(vectors[i]))}::jsonb,
				    embedder = ${targetTag}
				where id = ${pending[i].id}
			`;
		}
		migrated += pending.length;
		if (throttleMs) await sleep(throttleMs);
	}

	const [{ remaining }] = await sql`
		select count(*)::int as remaining from widget_knowledge_chunks
		where doc_id = ${doc.id} and embedder is distinct from ${targetTag}
	`;
	if (Number(remaining) === 0) {
		await sql`update widget_knowledge_docs set embedder = ${targetTag} where id = ${doc.id}`;
		return { migrated, flipped: true };
	}
	return { migrated, flipped: false };
}

export function summarizePlan(plan, { batch = DEFAULT_BATCH, throttleMs = DEFAULT_THROTTLE_MS } = {}) {
	const by = (action) => plan.filter((d) => d.action === action);
	const pendingChunks = plan.reduce((s, d) => s + Number(d.pending_chunks || 0), 0);
	const pendingTokens = plan.reduce((s, d) => s + Number(d.pending_tokens || 0), 0);
	const requests = plan.reduce((s, d) => s + Math.ceil(Number(d.pending_chunks || 0) / batch), 0);
	const estSeconds = Math.ceil(requests * (EST_REQUEST_SECONDS + throttleMs / 1000));
	return {
		docs: plan.length,
		migrate: by('migrate').length,
		flip: by('flip').length,
		done: by('done').length,
		skip: by('skip').length,
		pendingChunks,
		pendingTokens,
		requests,
		estSeconds,
	};
}

async function main() {
	loadEnvFile(resolve(root, '.env.local'));
	loadEnvFile(resolve(root, '.env'));

	const args = parseCliArgs(process.argv.slice(2));
	const targetTag = NIM_EMBED_TAG;

	if (!process.env.DATABASE_URL) {
		console.error('DATABASE_URL not set (.env.local / .env / environment)');
		process.exit(1);
	}
	if (!args.dryRun && !embedderConfigured(targetTag)) {
		console.error('NVIDIA_API_KEY not set — required to embed into the NIM space. (--dry-run works without it.)');
		process.exit(1);
	}

	const { sql } = await import('../api/_lib/db.js');
	const host = new URL(process.env.DATABASE_URL).host;
	console.log(`${args.dryRun ? 'DRY RUN — surveying' : 'Migrating'} widget knowledge on ${host}`);
	console.log(`target space: ${targetTag}${args.widget ? ` · widget: ${args.widget}` : ''} · batch ${args.batch} · throttle ${args.throttleMs}ms\n`);

	const plan = await planMigration(sql, { targetTag, widgetId: args.widget });
	const totals = summarizePlan(plan, { batch: args.batch, throttleMs: args.throttleMs });

	for (const d of plan) {
		if (d.action === 'done') continue;
		console.log(`[${d.action.padEnd(7)}] ${d.id} (${d.widget_id}) "${String(d.title).slice(0, 60)}" — ${d.reason}`);
	}
	console.log(
		`\n${totals.docs} docs: ${totals.migrate} to migrate, ${totals.flip} tag-flip only, ` +
			`${totals.done} already migrated, ${totals.skip} skipped`,
	);
	console.log(
		`${totals.pendingChunks} chunks to re-embed (~${totals.pendingTokens} tokens) ` +
			`→ ~${totals.requests} NIM requests, est. ~${totals.estSeconds}s (free tier: $0; ~${totals.requests} metered credits)`,
	);

	if (args.dryRun) {
		console.log('\nDRY RUN — nothing was written.');
		return;
	}

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const embedBatchFn = (texts) => embedPassages(targetTag, texts);
	const log = (msg) => console.log(msg);

	let migratedChunks = 0;
	let flippedDocs = 0;
	let incomplete = 0;
	for (const d of plan) {
		if (d.action === 'done' || d.action === 'skip') continue;
		console.log(`→ ${d.id} (${d.widget_id}): ${d.reason}`);
		const result = await migrateDoc(
			{ sql, embedBatchFn, sleep, log },
			d,
			{ targetTag, batch: args.batch, throttleMs: args.throttleMs },
		);
		migratedChunks += result.migrated;
		if (result.flipped) flippedDocs++;
		else {
			incomplete++;
			console.warn(`  ! ${d.id} still has unmigrated chunks — tag NOT flipped (safe to re-run)`);
		}
	}

	console.log(`\nDone: ${migratedChunks} chunks re-embedded, ${flippedDocs} document sets flipped to ${targetTag}.`);
	if (incomplete) {
		console.warn(`${incomplete} sets incomplete — re-run this script to resume.`);
		process.exitCode = 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error('reembed failed:', err?.message || err);
		process.exit(1);
	});
}
