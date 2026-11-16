#!/usr/bin/env node
// Live check for the knowledge rerank stage (api/_lib/rerank.js) through the
// real HTTP path: Vite dev server -> server/index.mjs -> GET
// /api/widgets/:id/knowledge?test=<query> (the studio's retrieval debugger)
// -> testRetrieval -> NVIDIA embedder and reranker. Nothing is mocked; only the
// database is a throwaway PGlite with the production schema
// (scripts/lib/isolated-db.mjs), so no production row is read or written.
// Widget knowledge is used because it scores cosine in JS over jsonb vectors;
// agent knowledge needs pgvector, which PGlite 0.5 does not ship. Both paths
// call the same rerankPassages().
//
// It seeds one widget with six real docs (pinned to the rerank eval's corpus
// commit) through the real ingestKnowledge, then asks each question twice
// through the dev server: once with KNOWLEDGE_RERANK_ENABLED unset (the cosine
// order production serves today) and once with it set to 1, printing both
// orders and the wall time of each.
//
// Usage: NVIDIA_API_KEY=... node scripts/rerank-live-check.mjs [--dev-port 3254] [--api-port 3255]

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? Number(args[i + 1]) : dflt;
};
const DEV_PORT = opt('dev-port', 3254);
const API_PORT = opt('api-port', 3255);
const QUESTIONS = JSON.parse(readFileSync(resolve(ROOT, 'data/evals/rerank/questions.json'), 'utf8'));
const DOCS = ['docs/3d-api.md', 'docs/embedding.md', 'docs/sdk.md', 'docs/vscode.md', 'docs/materialize.md', 'docs/restyle.md'];
const ASK = ['r18', 'r09', 'r01'];

if (!process.env.NVIDIA_API_KEY) {
	console.error('NVIDIA_API_KEY is required (the embedder and the reranker are real NVIDIA calls).');
	process.exit(2);
}

// Isolate this process before any server module loads.
process.env.DATABASE_URL = 'postgres://isolated.invalid/rerank-live-check';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.PORT = String(API_PORT);
delete process.env.KNOWLEDGE_RERANK_ENABLED;
for (const k of Object.keys(process.env)) if (/^(UPSTASH_|REDIS_|QSTASH_)/.test(k)) delete process.env[k];

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const { ingestKnowledge } = await import('../api/widgets/[id]/_knowledge.js');
const { rerankModel } = await import('../api/_lib/rerank.js');

const [{ id: userId }] = await sql`insert into users (email, display_name) values ('rerank@live-check.invalid', 'Rerank check') returning id`;
const widgetId = `wdgt_${randomBytes(9).toString('base64url')}`;
await sql`insert into widgets (id, user_id, type, name) values (${widgetId}, ${userId}, 'talking-agent', 'Docs agent')`;
const apiKey = `sk_test_${randomBytes(24).toString('hex')}`;
const keyHash = createHash('sha256').update(apiKey).digest('hex');
await sql`insert into api_keys (user_id, name, prefix, token_hash, scope) values (${userId}, 'rerank live check', ${apiKey.slice(0, 12)}, ${keyHash}, 'avatars:read')`;

let chunkTotal = 0;
for (const path of DOCS) {
	const text = execFileSync('git', ['show', `${QUESTIONS.corpus_commit}:${path}`], { cwd: ROOT, encoding: 'utf8' });
	const out = await ingestKnowledge({ widgetId, userId, input: { source_type: 'markdown', title: path, content: text } });
	chunkTotal += Number(out?.doc?.chunk_count ?? out?.chunk_count ?? 0);
}
const [{ n: stored }] = await sql`select count(*)::int as n from widget_knowledge_chunks where widget_id = ${widgetId}`;
console.log(`seeded widget ${widgetId}: ${DOCS.length} docs, ${stored} chunks embedded (corpus ${QUESTIONS.corpus_commit.slice(0, 9)})`);

await import('../server/index.mjs');
const vite = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], {
	cwd: ROOT,
	env: { ...process.env, DEV_API_PROXY: `http://127.0.0.1:${API_PORT}`, PORT: '' },
	stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((ok, fail) => {
	const timer = setTimeout(() => fail(new Error('vite did not start within 60s')), 60_000);
	vite.stdout.on('data', (b) => {
		if (/Local:/.test(String(b))) {
			clearTimeout(timer);
			ok();
		}
	});
	vite.on('exit', (code) => fail(new Error(`vite exited with ${code}`)));
});
console.log(`dev server http://localhost:${DEV_PORT} -> api http://127.0.0.1:${API_PORT}; reranker ${rerankModel()}\n`);

// top_k 12 mirrors the production candidate pool (SEARCH_POOL); the reranker
// reorders that pool and the first 4 are what a chat turn is grounded in.
async function search(query) {
	const t0 = performance.now();
	const res = await fetch(`http://localhost:${DEV_PORT}/api/widgets/${widgetId}/knowledge?test=${encodeURIComponent(query)}&top_k=12`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	const ms = Math.round(performance.now() - t0);
	const body = await res.json();
	if (!res.ok) throw new Error(`search ${res.status}: ${JSON.stringify(body)}`);
	return { ms, ...(body.data ?? body) };
}

let exitCode = 0;
try {
	for (const id of ASK) {
		const q = QUESTIONS.queries.find((x) => x.id === id);
		const label = (r) => `${r.title}#${r.chunk_index} cos=${Number(r.score).toFixed(3)}  "${r.excerpt.replace(/\s+/g, ' ').slice(0, 70)}"`;
		delete process.env.KNOWLEDGE_RERANK_ENABLED;
		const cos = await search(q.q);
		process.env.KNOWLEDGE_RERANK_ENABLED = '1';
		const rr = await search(q.q);
		console.log(`${id}: ${q.q}`);
		console.log(`  cosine   reranked=${cos.reranked} ${cos.ms}ms`);
		cos.results.slice(0, 4).forEach((r, i) => console.log(`    ${i + 1}. ${label(r)}`));
		console.log(`  rerank   reranked=${rr.reranked} ${rr.ms}ms (added ${rr.ms - cos.ms}ms)`);
		rr.results.slice(0, 4).forEach((r, i) => console.log(`    ${i + 1}. ${label(r)}`));
		console.log('');
	}
} catch (err) {
	console.error(err.message);
	exitCode = 1;
} finally {
	vite.kill();
	process.exit(exitCode);
}
