#!/usr/bin/env node
// Move stored embeddings into the current NIM space
// (nvidia/nemotron-3.5-embed-8b@2048) table by table, with no retrieval gap.
//
//   npm run nvidia:reembed -- --status            per-table progress, no writes
//   npm run nvidia:reembed -- --dry-run           what a run would touch, no writes
//   npm run nvidia:reembed                        re-embed every table (resumes)
//   npm run nvidia:reembed -- --table agent_memories --batch 16 --pause-ms 500 --limit 200
//   npm run nvidia:reembed -- --verify            eval on production rows, new vs old
//   npm run nvidia:reembed -- --restore --table agent_memories   roll a table back
//
// How the migration stays safe (schema: api/_lib/migrations/20261116193000_embedding_migration_shadow.sql):
//   * Per-row spaces. Every row carries the tag of its live vector and every
//     reader embeds the query with that row's own model, so a half-migrated
//     table serves new vectors where present and old ones elsewhere.
//   * One UPDATE per row copies the old vector and tag into embedding_prev /
//     embedder_prev and writes the new pair, guarded by compare-and-swap on the
//     row's tag and content: a row edited mid-run is skipped, never clobbered.
//   * Resumable and idempotent. A cursor per (table, target) in
//     embedding_migrations records how far the id-ordered scan got; a re-run
//     continues from it and only reads rows outside the target space.
//   * Throttled. A pause between batches, exponential backoff on 429/5xx, and
//     strict embedding: a lane outage never rewrites a batch into the old space.
//   * Content refusals. The new model's screen refuses some texts (a 422). A
//     refused row that already has a servable vector keeps it (counted `kept`);
//     a row with no vector, or one in a retired space, gets the fallback lane's
//     vector so it becomes searchable at all (counted `backfilled`).
//   * Cutover per table: when the scan reaches the end the table is cut over.
//     The old vectors stay in *_prev until --verify passes on production data;
//     dropping them is a separate held migration
//     (api/_lib/migrations/held/20261116193100_drop_embedding_prev.sql).
//
// Requires DATABASE_URL and NVIDIA_API_KEY in the environment (or .env.local / .env).

import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({ batch: 16, pauseMs: 400, limit: Infinity, verifySample: 40, retries: 5 });

export const USAGE = `usage: npm run nvidia:reembed -- [--status | --dry-run | --verify | --restore]
       [--table agent_memories|agent_knowledge_chunks|widget_knowledge_chunks]
       [--batch N] [--pause-ms N] [--limit N] [--sample N] [--skip-deploy-check]`;

// ── Tables ──────────────────────────────────────────────────────────────────
// Column names cannot be bound as parameters, so each table spells out its own
// statements. Selects return id::text AS id, so they ORDER BY the qualified
// column: a bare ORDER BY id would sort bigint ids as text and the cursor
// would skip rows. `vec` is a JSON array string; jsonb tables cast it to jsonb and
// the pgvector table to vector.

// embedder_prev marks every row the run migrated. A row that had no vector
// before gets this sentinel instead of NULL, so --restore can return it to no
// vector and still tell it apart from rows new code wrote in the target space.
export const NO_PREVIOUS = '';

export const TABLES = Object.freeze({
	agent_memories: {
		scope: 'agent_id',
		idType: 'uuid',
		select: (sql, target, cursor, limit) => sql`
			SELECT id::text AS id, content, embedder, embedding IS NOT NULL AS has_vector
			FROM agent_memories
			WHERE embedder IS DISTINCT FROM ${target}
			  AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid)
			ORDER BY agent_memories.id
			LIMIT ${limit}
		`,
		write: (sql, row, tag, vec) => sql`
			UPDATE agent_memories
			SET embedding_prev = embedding, embedder_prev = COALESCE(embedder, ${NO_PREVIOUS}),
			    embedding = ${vec}::jsonb, embedder = ${tag}
			WHERE id = ${row.id}::uuid
			  AND embedder IS NOT DISTINCT FROM ${row.embedder}
			  AND content = ${row.content}
			RETURNING id
		`,
		restore: (sql, target) => sql`
			UPDATE agent_memories
			SET embedding = embedding_prev, embedder = NULLIF(embedder_prev, ${NO_PREVIOUS}), embedding_prev = NULL, embedder_prev = NULL
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL
			RETURNING id
		`,
		counts: (sql) => sql`
			SELECT embedder, (embedding IS NOT NULL) AS has_vector, (embedding_prev IS NOT NULL) AS has_prev, count(*)::int AS n
			FROM agent_memories GROUP BY 1, 2, 3
		`,
		pending: (sql, target, cursor) => sql`
			SELECT count(*)::int AS n FROM agent_memories
			WHERE embedder IS DISTINCT FROM ${target} AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid)
		`,
		sample: (sql, target, n) => sql`
			SELECT id::text AS id, agent_id::text AS scope, content, embedding AS vec, embedder_prev AS prev_tag, embedding_prev AS prev_vec
			FROM agent_memories
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL AND embedding_prev IS NOT NULL
			  AND agent_id IN (
				SELECT agent_id FROM agent_memories
				WHERE embedder = ${target} AND embedder_prev IS NOT NULL
				GROUP BY agent_id HAVING count(*) >= 2
				ORDER BY count(*) DESC LIMIT ${n}
			  )
		`,
	},
	agent_knowledge_chunks: {
		scope: 'agent_id',
		idType: 'bigint',
		select: (sql, target, cursor, limit) => sql`
			SELECT id::text AS id, content, embedder, true AS has_vector
			FROM agent_knowledge_chunks
			WHERE embedder IS DISTINCT FROM ${target}
			  AND (${cursor}::bigint IS NULL OR id > ${cursor}::bigint)
			ORDER BY agent_knowledge_chunks.id
			LIMIT ${limit}
		`,
		write: (sql, row, tag, vec) => sql`
			UPDATE agent_knowledge_chunks
			SET embedding_prev = embedding, embedder_prev = COALESCE(embedder, ${NO_PREVIOUS}),
			    embedding = ${vec}::vector, embedder = ${tag}
			WHERE id = ${row.id}::bigint
			  AND embedder IS NOT DISTINCT FROM ${row.embedder}
			  AND content = ${row.content}
			RETURNING id
		`,
		restore: (sql, target) => sql`
			UPDATE agent_knowledge_chunks
			SET embedding = embedding_prev, embedder = NULLIF(embedder_prev, ${NO_PREVIOUS}), embedding_prev = NULL, embedder_prev = NULL
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL
			RETURNING id
		`,
		counts: (sql) => sql`
			SELECT embedder, true AS has_vector, (embedding_prev IS NOT NULL) AS has_prev, count(*)::int AS n
			FROM agent_knowledge_chunks GROUP BY 1, 2, 3
		`,
		pending: (sql, target, cursor) => sql`
			SELECT count(*)::int AS n FROM agent_knowledge_chunks
			WHERE embedder IS DISTINCT FROM ${target} AND (${cursor}::bigint IS NULL OR id > ${cursor}::bigint)
		`,
		sample: (sql, target, n) => sql`
			SELECT id::text AS id, agent_id::text AS scope, content, embedding::text AS vec, embedder_prev AS prev_tag, embedding_prev::text AS prev_vec
			FROM agent_knowledge_chunks
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL AND embedding_prev IS NOT NULL
			  AND agent_id IN (
				SELECT agent_id FROM agent_knowledge_chunks
				WHERE embedder = ${target} AND embedder_prev IS NOT NULL
				GROUP BY agent_id HAVING count(*) >= 2
				ORDER BY count(*) DESC LIMIT ${n}
			  )
		`,
	},
	widget_knowledge_chunks: {
		scope: 'widget_id',
		idType: 'bigint',
		select: (sql, target, cursor, limit) => sql`
			SELECT id::text AS id, content, embedder, embedding IS NOT NULL AS has_vector
			FROM widget_knowledge_chunks
			WHERE embedder IS DISTINCT FROM ${target}
			  AND (${cursor}::bigint IS NULL OR id > ${cursor}::bigint)
			ORDER BY widget_knowledge_chunks.id
			LIMIT ${limit}
		`,
		write: (sql, row, tag, vec) => sql`
			UPDATE widget_knowledge_chunks
			SET embedding_prev = embedding, embedder_prev = COALESCE(embedder, ${NO_PREVIOUS}),
			    embedding = ${vec}::jsonb, embedder = ${tag}
			WHERE id = ${row.id}::bigint
			  AND embedder IS NOT DISTINCT FROM ${row.embedder}
			  AND content = ${row.content}
			RETURNING id
		`,
		restore: (sql, target) => sql`
			UPDATE widget_knowledge_chunks
			SET embedding = embedding_prev, embedder = NULLIF(embedder_prev, ${NO_PREVIOUS}), embedding_prev = NULL, embedder_prev = NULL
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL
			RETURNING id
		`,
		counts: (sql) => sql`
			SELECT embedder, (embedding IS NOT NULL) AS has_vector, (embedding_prev IS NOT NULL) AS has_prev, count(*)::int AS n
			FROM widget_knowledge_chunks GROUP BY 1, 2, 3
		`,
		pending: (sql, target, cursor) => sql`
			SELECT count(*)::int AS n FROM widget_knowledge_chunks
			WHERE embedder IS DISTINCT FROM ${target} AND (${cursor}::bigint IS NULL OR id > ${cursor}::bigint)
		`,
		sample: (sql, target, n) => sql`
			SELECT id::text AS id, widget_id AS scope, content, embedding AS vec, embedder_prev AS prev_tag, embedding_prev AS prev_vec
			FROM widget_knowledge_chunks
			WHERE embedder = ${target} AND embedder_prev IS NOT NULL AND embedding_prev IS NOT NULL
			  AND widget_id IN (
				SELECT widget_id FROM widget_knowledge_chunks
				WHERE embedder = ${target} AND embedder_prev IS NOT NULL
				GROUP BY widget_id HAVING count(*) >= 2
				ORDER BY count(*) DESC LIMIT ${n}
			  )
		`,
	},
});

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

export function parseCliArgs(argv) {
	const opts = { mode: 'run', tables: Object.keys(TABLES), ...DEFAULTS };
	const num = (flag, v) => {
		const n = Number(v);
		if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number`);
		return n;
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--status') opts.mode = 'status';
		else if (a === '--dry-run') opts.mode = 'dry-run';
		else if (a === '--verify') opts.mode = 'verify';
		else if (a === '--restore') opts.mode = 'restore';
		else if (a === '--table') {
			const t = argv[++i];
			if (!TABLES[t]) throw new Error(`unknown table ${t}; one of ${Object.keys(TABLES).join(', ')}`);
			opts.tables = [t];
		} else if (a === '--batch') opts.batch = Math.min(64, Math.floor(num(a, argv[++i])));
		else if (a === '--pause-ms') opts.pauseMs = Math.floor(Number(argv[++i]) || 0);
		else if (a === '--limit') opts.limit = Math.floor(num(a, argv[++i]));
		else if (a === '--sample') opts.verifySample = Math.floor(num(a, argv[++i]));
		else if (a === '--skip-deploy-check') opts.skipDeployCheck = true;
		else if (a === '--help' || a === '-h') opts.mode = 'help';
		else throw new Error(`unknown argument ${a}\n${USAGE}`);
	}
	if (opts.mode === 'restore' && opts.tables.length !== 1) {
		throw new Error('--restore rolls back one table at a time: pass --table <name>');
	}
	return opts;
}

/**
 * What to do with one row after embedding: `move` it into the target space,
 * `backfill` it from the fallback lane (it had no servable vector before),
 * or `keep` its current vector (the target refused it and the old one serves).
 */
export function classifyResult(row, resultTag, target, isServable) {
	if (resultTag === target) return 'move';
	const servable = row.has_vector && row.embedder && isServable(row.embedder);
	return servable ? 'keep' : 'backfill';
}

/** Retry `fn` on rate limits, 5xx and network errors with exponential backoff. */
export async function withBackoff(fn, { retries = DEFAULTS.retries, baseMs = 1000, sleep = defaultSleep, log = () => {} } = {}) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const status = Number(err?.status) || 0;
			const transient = status === 429 || status >= 500 || (!status && err?.code !== 'content_refused');
			if (!transient || attempt >= retries) throw err;
			const wait = baseMs * 2 ** attempt;
			log(`  transient ${status || err?.name || 'error'}; retrying in ${wait}ms`);
			await sleep(wait);
		}
	}
}

function defaultSleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** Per-table phase from its cursor row and pending count. */
export function phaseOf(cursorRow, pending) {
	if (cursorRow?.verified_at) return 'verified';
	if (cursorRow?.completed_at && pending === 0) return 'cut over';
	if (cursorRow) return 'in progress';
	return pending > 0 ? 'not started' : 'cut over';
}

/** The rows `--status` prints, one per (table, embedder, has_prev) group. */
export function summarizeCounts(table, rows, target) {
	const out = { table, total: 0, target: 0, withPrev: 0, noVector: 0, spaces: {} };
	for (const r of rows) {
		const n = Number(r.n);
		out.total += n;
		if (!r.has_vector) out.noVector += n;
		if (r.has_prev) out.withPrev += n;
		if (r.embedder === target && r.has_vector) out.target += n;
		const key = r.has_vector ? r.embedder || '(untagged)' : '(no vector)';
		out.spaces[key] = (out.spaces[key] || 0) + n;
	}
	return out;
}

function unit(v) {
	const n = Math.hypot(...v) || 1;
	return v.map((x) => x / n);
}

function dot(a, b) {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

export function toVector(v) {
	if (Array.isArray(v)) return v.map(Number);
	if (typeof v === 'string') return JSON.parse(v);
	return null;
}

/**
 * The known-item query for a row: its leading words, the way a user recalls a
 * memory or a passage by a fragment of it rather than by its full text.
 */
export function knownItemQuery(content, words = 10) {
	return String(content || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, words).join(' ');
}

/**
 * Rank each row's known-item query against every row in its scope, once in
 * the new space and once in the old, and report recall@1 and MRR for both.
 * `embedQueryIn(tag, text)` embeds a query in a given space.
 */
export async function verifyRows(rows, target, embedQueryIn) {
	const byScope = new Map();
	for (const r of rows) {
		const vec = toVector(r.vec);
		const prev = toVector(r.prev_vec);
		if (!vec?.length || !prev?.length) continue;
		if (!byScope.has(r.scope)) byScope.set(r.scope, []);
		byScope.get(r.scope).push({ ...r, vec: unit(vec), prev: unit(prev) });
	}
	const score = { new: { hits: 0, rr: 0 }, old: { hits: 0, rr: 0 } };
	let queries = 0;
	for (const scopeRows of byScope.values()) {
		if (scopeRows.length < 2) continue;
		for (const r of scopeRows) {
			const q = knownItemQuery(r.content);
			if (!q) continue;
			const [qNew, qOld] = await Promise.all([embedQueryIn(target, q), embedQueryIn(r.prev_tag, q)]);
			for (const [key, qv, field] of [['new', qNew, 'vec'], ['old', qOld, 'prev']]) {
				const uq = unit(Array.from(qv));
				const ranked = scopeRows
					.filter((c) => (field === 'prev' ? c.prev_tag === r.prev_tag : true))
					.map((c) => ({ id: c.id, s: dot(uq, c[field]) }))
					.sort((a, b) => b.s - a.s);
				const rank = ranked.findIndex((c) => c.id === r.id) + 1;
				if (rank === 1) score[key].hits++;
				if (rank > 0) score[key].rr += 1 / rank;
			}
			queries++;
		}
	}
	const pct = (x) => (queries ? Math.round((1000 * x) / queries) / 10 : null);
	return {
		queries,
		scopes: [...byScope.values()].filter((s) => s.length >= 2).length,
		new: { recall_at_1: pct(score.new.hits), mrr: pct(score.new.rr) },
		old: { recall_at_1: pct(score.old.hits), mrr: pct(score.old.rr) },
		passed: queries > 0 && score.new.rr >= score.old.rr - 0.02 * queries,
	};
}

// ── Deploy gate ─────────────────────────────────────────────────────────────
// The commit that taught every reader the target space. Rows moved into a
// space the deployed readers do not recognise drop out of live search (the
// old scoreRowsBySpace treats an unknown tag as unconfigured), so a writing
// run refuses until production serves a build that contains this commit.
export const READER_COMMIT = '60128b5cc3159ecbf135273ba080b28da491299f';
export const VERSION_URL = process.env.REEMBED_VERSION_URL || 'https://three.ws/api/version';

/**
 * Decide whether a writing run may start, from the deployed /api/version body
 * and `isAncestor(a, b)` (true when commit a is contained in commit b).
 */
export async function deployGate(version, isAncestor) {
	const commit = version?.commit;
	if (!commit || commit === 'unknown') {
		return { ok: false, reason: `cannot tell which commit production runs (${VERSION_URL}); deploy three-ws-api first, or pass --skip-deploy-check for a non-production database` };
	}
	if (await isAncestor(READER_COMMIT, commit)) return { ok: true, commit };
	return {
		ok: false,
		reason: `production runs ${commit.slice(0, 9)}, which cannot read ${READER_COMMIT.slice(0, 9)}'s embedding spaces: moved rows would drop out of live search. deploy three-ws-api first`,
	};
}

async function gitIsAncestor(a, b) {
	try {
		await promisify(execFile)('git', ['merge-base', '--is-ancestor', a, b], { cwd: root });
		return true;
	} catch {
		return false;
	}
}

async function fetchDeployedVersion() {
	try {
		const res = await fetch(VERSION_URL, { signal: AbortSignal.timeout(15_000) });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

// ── Database-backed steps ───────────────────────────────────────────────────

async function readCursor(sql, table, target) {
	const [row] = await sql`SELECT * FROM embedding_migrations WHERE table_name = ${table} AND target = ${target}`;
	return row || null;
}

async function saveCursor(sql, table, target, cursor, delta, completed) {
	await sql`
		INSERT INTO embedding_migrations (table_name, target, cursor, scanned, moved, backfilled, kept, skipped, completed_at)
		VALUES (${table}, ${target}, ${cursor}, ${delta.scanned}, ${delta.moved}, ${delta.backfilled}, ${delta.kept}, ${delta.skipped},
		        ${completed ? new Date().toISOString() : null}::timestamptz)
		ON CONFLICT (table_name, target) DO UPDATE SET
			cursor = EXCLUDED.cursor,
			scanned = embedding_migrations.scanned + EXCLUDED.scanned,
			moved = embedding_migrations.moved + EXCLUDED.moved,
			backfilled = embedding_migrations.backfilled + EXCLUDED.backfilled,
			kept = embedding_migrations.kept + EXCLUDED.kept,
			skipped = embedding_migrations.skipped + EXCLUDED.skipped,
			completed_at = COALESCE(EXCLUDED.completed_at, embedding_migrations.completed_at),
			updated_at = now()
	`;
}

/**
 * Re-embed one table from its cursor. `embed(texts)` resolves to
 * [{ tag, vector }] aligned with texts (embedPassagesEach in strict mode).
 */
export async function runTable(sql, name, { target, embed, isServable, batch, pauseMs, limit, sleep = defaultSleep, log = () => {} }) {
	const spec = TABLES[name];
	const state = await readCursor(sql, name, target);
	let cursor = state?.cursor ?? null;
	const total = { scanned: 0, moved: 0, backfilled: 0, kept: 0, skipped: 0 };
	let completed = false;
	while (total.scanned < limit) {
		const rows = await spec.select(sql, target, cursor, Math.min(batch, limit - total.scanned));
		if (!rows.length) {
			completed = true;
			await saveCursor(sql, name, target, cursor, { scanned: 0, moved: 0, backfilled: 0, kept: 0, skipped: 0 }, true);
			break;
		}
		const results = await withBackoff(() => embed(rows.map((r) => r.content || '')), { sleep, log });
		const delta = { scanned: rows.length, moved: 0, backfilled: 0, kept: 0, skipped: 0 };
		for (let i = 0; i < rows.length; i++) {
			const action = classifyResult(rows[i], results[i].tag, target, isServable);
			if (action === 'keep') {
				delta.kept++;
				continue;
			}
			const written = await spec.write(sql, rows[i], results[i].tag, JSON.stringify(Array.from(results[i].vector)));
			if (!written.length) delta.skipped++;
			else delta[action === 'move' ? 'moved' : 'backfilled']++;
		}
		cursor = rows.at(-1).id;
		await saveCursor(sql, name, target, cursor, delta, false);
		for (const k of Object.keys(total)) total[k] += delta[k];
		log(`  ${name}: +${delta.moved} moved, +${delta.backfilled} backfilled, +${delta.kept} kept, +${delta.skipped} skipped (cursor ${cursor})`);
		if (pauseMs) await sleep(pauseMs);
	}
	return { ...total, completed, cursor };
}

export async function tableStatus(sql, name, target) {
	const spec = TABLES[name];
	const [counts, cursorRow] = await Promise.all([spec.counts(sql), readCursor(sql, name, target)]);
	const [{ n: pending }] = await spec.pending(sql, target, cursorRow?.cursor ?? null);
	return { ...summarizeCounts(name, counts, target), pending, phase: phaseOf(cursorRow, pending), cursor: cursorRow };
}

function printStatus(statuses, target) {
	console.log(`target space: ${target}\n`);
	const head = ['table', 'phase', 'rows', 'in target', 'pending', 'old kept in prev', 'no vector'];
	const lines = statuses.map((s) => [s.table, s.phase, s.total, s.target, s.pending, s.withPrev, s.noVector].map(String));
	const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
	const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
	console.log(fmt(head));
	console.log(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const l of lines) console.log(fmt(l));
	for (const s of statuses) {
		console.log(`\n${s.table}`);
		for (const [space, n] of Object.entries(s.spaces).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${space}`);
		const c = s.cursor;
		if (c) {
			console.log(`  run: scanned ${c.scanned}, moved ${c.moved}, backfilled ${c.backfilled}, kept ${c.kept}, skipped ${c.skipped}; updated ${new Date(c.updated_at).toISOString()}`);
			if (c.verification) console.log(`  verification: ${JSON.stringify(c.verification)}`);
		}
	}
}

function loadEnvFile(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return;
	}
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (!m || process.env[m[1]]) continue;
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

async function main() {
	const opts = parseCliArgs(process.argv.slice(2));
	if (opts.mode === 'help') {
		console.log(USAGE);
		return;
	}
	loadEnvFile(resolve(root, '.env.local'));
	loadEnvFile(resolve(root, '.env'));
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

	const { sql } = await import('../api/_lib/db.js');
	const emb = await import('../api/_lib/embeddings.js');
	const target = emb.NIM_EMBED_TAG;

	const [{ ready }] = await sql`
		SELECT count(*) = 2 AS ready FROM information_schema.columns
		WHERE table_name = 'agent_memories' AND column_name IN ('embedding_prev', 'embedder_prev')
	`;
	if (!ready) {
		throw new Error('shadow columns missing: apply api/_lib/migrations/20261116193000_embedding_migration_shadow.sql first');
	}

	if (opts.mode === 'status' || opts.mode === 'dry-run') {
		const statuses = [];
		for (const t of opts.tables) statuses.push(await tableStatus(sql, t, target));
		printStatus(statuses, target);
		if (opts.mode === 'dry-run') {
			const pending = statuses.reduce((s, x) => s + x.pending, 0);
			const requests = statuses.reduce((s, x) => s + Math.ceil(x.pending / opts.batch), 0);
			console.log(`\ndry run: ${pending} rows would be embedded in ${requests} requests of up to ${opts.batch}; nothing was written`);
		}
		return;
	}

	if (!emb.embedderConfigured(target)) throw new Error(`${target} is not configured (NVIDIA_API_KEY)`);

	if (opts.mode === 'restore') {
		const [t] = opts.tables;
		const rows = await TABLES[t].restore(sql, target);
		await sql`DELETE FROM embedding_migrations WHERE table_name = ${t} AND target = ${target}`;
		console.log(`${t}: restored ${rows.length} rows to their previous space and cleared the cursor`);
		return;
	}

	if (opts.mode === 'verify') {
		for (const t of opts.tables) {
			const rows = await TABLES[t].sample(sql, target, opts.verifySample);
			const servable = rows.filter((r) => emb.embedderConfigured(r.prev_tag));
			const result = await verifyRows(servable, target, (tag, text) => withBackoff(() => emb.embedQuery(tag, text)));
			console.log(`${t}: ${result.queries} known-item queries over ${result.scopes} scopes`);
			console.log(`  new space  recall@1 ${result.new.recall_at_1}  MRR ${result.new.mrr}`);
			console.log(`  old space  recall@1 ${result.old.recall_at_1}  MRR ${result.old.mrr}`);
			if (!result.queries) {
				console.log('  nothing to verify yet (no scope has two re-embedded rows with an old vector)');
				continue;
			}
			const cursorRow = await readCursor(sql, t, target);
			const verifiedAt = result.passed && cursorRow?.completed_at ? new Date().toISOString() : null;
			await sql`
				UPDATE embedding_migrations SET verification = ${JSON.stringify({ ...result, at: new Date().toISOString() })}::jsonb,
					verified_at = ${verifiedAt}::timestamptz, updated_at = now()
				WHERE table_name = ${t} AND target = ${target}
			`;
			console.log(result.passed ? (verifiedAt ? '  PASSED: cutover verified' : '  passed, but the scan has not finished: run it to the end, then verify again') : '  FAILED: the new space retrieves worse here; keep the old vectors and investigate (--restore rolls back)');
		}
		return;
	}

	if (!opts.skipDeployCheck) {
		const gate = await deployGate(await fetchDeployedVersion(), gitIsAncestor);
		if (!gate.ok) throw new Error(gate.reason);
		console.log(`production runs ${gate.commit.slice(0, 9)}, which reads every embedding space: ok to move rows`);
	}

	const log = (m) => console.log(m);
	for (const t of opts.tables) {
		console.log(`${t}: re-embedding into ${target}`);
		const r = await runTable(sql, t, {
			target,
			embed: (texts) => emb.embedPassagesEach(target, texts, { strict: true }),
			isServable: (tag) => emb.embedderConfigured(tag),
			batch: opts.batch,
			pauseMs: opts.pauseMs,
			limit: opts.limit,
			log,
		});
		console.log(`${t}: ${r.completed ? 'scan complete, table cut over' : `stopped at --limit (cursor ${r.cursor}); re-run to continue`}. moved ${r.moved}, backfilled ${r.backfilled}, kept ${r.kept}, skipped ${r.skipped}`);
	}
	const statuses = [];
	for (const t of opts.tables) statuses.push(await tableStatus(sql, t, target));
	console.log('');
	printStatus(statuses, target);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main().then(
		() => process.exit(0),
		(err) => {
			console.error(`nvidia-reembed: ${err.message}`);
			process.exit(1);
		},
	);
}
