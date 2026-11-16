#!/usr/bin/env node
// Live check of PDF knowledge uploads end to end, through the real code: the
// real API server, the real NVIDIA NeMo Retriever page models, the real
// embedder and reranker, the real /agent/:id/edit page in Chromium and the
// real /api/chat route.
//
//   NVIDIA_API_KEY=... npm run knowledge:pdf-live-check [-- path/to/file.pdf "question" expected]
//
// Defaults to the Mistral 7B paper (arXiv 2310.06825v1, CC BY 4.0, cached by
// scripts/nvidia-pdf-extraction-eval.mjs or downloaded here) and a question
// whose answer sits in its Table 2.
//
// What it proves:
//   1. The knowledge panel accepts the PDF, shows per-page progress
//      ("Reading page x of y") and a live table preview while pages are read.
//   2. The finished document lists its tables, and "View tables" renders them.
//   3. The question retrieves a table chunk from that document.
//   4. /api/chat answers the question with the value from that table.
//   5. No console errors or warnings from the panel (isolated-environment noise
//      is matched narrowly by ENV_NOISE and still written out).
//
// Isolation: an in-process Postgres with the production schema plus a pgvector
// stand-in (scripts/lib/isolated-db.mjs, tests/_helpers/pglite-vector.js) and a
// process env reduced to an allowlist, so nothing reaches Neon. Outbound calls
// go only to the NVIDIA API. Screenshots land in $LIVE_CHECK_OUT (default the
// OS temp dir).

import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3259;
const WEB_PORT = 3258;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const OUT = process.env.LIVE_CHECK_OUT || join(tmpdir(), 'knowledge-pdf-live-check');
const EVAL_CACHE = join(homedir(), '.cache/three-ws-pdf-eval');

const [argPdf, argQuestion, argExpected] = process.argv.slice(2);
const QUESTION = argQuestion || 'According to my documents, what GSM8K score does LLaMA 2 13B get?';
const EXPECTED = argExpected || '34.3';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|PLAYWRIGHT_BROWSERS_PATH|LIVE_CHECK_OUT)$/;
for (const k of Object.keys(process.env)) if (!ENV_ALLOW.test(k)) delete process.env[k];
Object.assign(process.env, {
	NODE_ENV: 'development',
	PORT: String(API_PORT),
	PUBLIC_APP_ORIGIN: WEB,
	DATABASE_URL: 'postgres://isolated.invalid/three',
	JWT_SECRET: crypto.randomBytes(32).toString('base64url'),
	CRON_SECRET: crypto.randomBytes(24).toString('base64url'),
	...(NVIDIA_API_KEY ? { NVIDIA_API_KEY } : {}),
});

// Console lines that come from running the editor against an isolated
// database, not from the knowledge panel. Each is matched narrowly:
// - the Outfit preview loads the <agent-3d> library from https://three.ws, and
//   that build resolves the agent against production, where this throwaway
//   agent does not exist (its manifest and skill-access calls fail; in
//   production they are same-origin and the agent exists);
// - the X triggers card queries a column the isolated schema replay lacks;
// - headless Chromium's software GL reports ReadPixels stalls.
// Every ignored line is still written to console-ignored.txt.
const ENV_NOISE = [
	/^error: Access to fetch at 'https:\/\/three\.ws\/api\/agents\/[^/]+\/manifest' from origin 'http:\/\/localhost:\d+' has been blocked by CORS policy/,
	/^http 404: GET https:\/\/three\.ws\/api\/agents\/[^/]+\/[a-z-]+$/,
	/^error: Failed to load resource: the server responded with a status of 404 \(\)$/,
	/^error: Failed to load resource: net::ERR_FAILED$/,
	/^http 500: GET http:\/\/localhost:\d+\/api\/x\/triggers$/,
	/^error: Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)$/,
	/^warning: \[\.WebGL-[0-9a-fx]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/,
];

let failed = 0;
async function step(name, fn) {
	try {
		const detail = await fn();
		console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
	} catch (e) {
		failed += 1;
		console.log(`  FAIL  ${name}\n        ${e.message}`);
	}
}
const assert = (cond, msg) => {
	if (!cond) throw new Error(msg);
};

function portInUse(port) {
	return new Promise((done) => {
		const s = net.connect(port, '127.0.0.1');
		s.once('connect', () => (s.destroy(), done(true)));
		s.once('error', () => done(false));
	});
}

async function waitFor(what, fn, ms = 60_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`timed out waiting for ${what}`);
}

async function samplePdf() {
	if (argPdf) return { path: resolve(argPdf), name: basename(argPdf) };
	const cached = join(EVAL_CACHE, 'mistral7b.pdf');
	if (!existsSync(cached)) {
		const res = await fetch('https://arxiv.org/pdf/2310.06825v1', { headers: { 'User-Agent': 'three.ws-live-check' } });
		assert(res.ok, `arXiv download failed: HTTP ${res.status}`);
		mkdirSync(EVAL_CACHE, { recursive: true });
		writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
	}
	// Uploaded under a readable name, the way an owner would.
	const path = join(OUT, 'Mistral-7B.pdf');
	writeFileSync(path, readFileSync(cached));
	return { path, name: 'Mistral-7B.pdf' };
}

async function chat(sid, agentId, message) {
	const res = await fetch(`${API}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Cookie: `__Host-sid=${sid}`, Origin: WEB },
		body: JSON.stringify({ message, agentId, provider: 'nvidia' }),
	});
	const raw = await res.text();
	if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${raw.slice(0, 300)}`);
	let text = '';
	for (const line of raw.split('\n')) {
		if (!line.startsWith('data: ')) continue;
		try {
			const ev = JSON.parse(line.slice(6));
			if (ev.type === 'chunk') text += ev.text;
			if (ev.type === 'guard' && ev.action === 'replace') text = ev.text;
		} catch {
			// a non-JSON keepalive line
		}
	}
	return text.trim();
}

async function main() {
	assert(NVIDIA_API_KEY, 'NVIDIA_API_KEY is required: the page models, the embedder and the chat model are real NVIDIA endpoints');
	for (const p of [API_PORT, WEB_PORT]) {
		if (await portInUse(p)) throw new Error(`port ${p} is busy; stop whatever listens there and rerun`);
	}
	mkdirSync(OUT, { recursive: true });
	const pdf = await samplePdf();
	console.log(`PDF knowledge: upload, read, preview and answer on an isolated database (${pdf.name})\n`);

	const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
	const { pg, sql } = await useIsolatedDb();
	const { addVectorSupport } = await import('../tests/_helpers/pglite-vector.js');
	await addVectorSupport(pg);
	const [user] = await sql`INSERT INTO users (email, display_name, plan) VALUES ('pdf-live-check@example.invalid', 'PDF live check', 'pro') RETURNING id`;
	const [agent] = await sql`INSERT INTO agent_identities (user_id, name, description) VALUES (${user.id}, 'Research assistant', 'Answers from the papers its owner uploads') RETURNING id`;
	const { createSession } = await import('../api/_lib/auth.js');
	const sid = await createSession({ userId: user.id, userAgent: 'live-check', ip: '127.0.0.1', recordActivity: false });

	// Every NVIDIA call that fails is logged, so a turn that loses its document
	// context to an upstream error says why.
	const upstreamFailures = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = String(input?.url || input);
		const res = await realFetch(input, init);
		if (!res.ok && /nvidia\.com/.test(url)) upstreamFailures.push(`${new Date().toISOString()} ${res.status} ${url}`);
		return res;
	};
	process.on('exit', () => {
		if (upstreamFailures.length) writeFileSync(join(OUT, 'upstream-failures.txt'), `${upstreamFailures.join('\n')}\n`);
	});
	await import('../server/index.mjs');
	await waitFor('the API to listen', async () => !!(await fetch(`${API}/api/agents/${agent.id}/knowledge`, { headers: { Cookie: `__Host-sid=${sid}` }, signal: AbortSignal.timeout(5000) }).catch(() => null)));

	const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--port', String(WEB_PORT), '--strictPort', '--host', 'localhost'], {
		cwd: root,
		env: { ...process.env, DEV_API_PROXY: API },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let viteLog = '';
	vite.stdout.on('data', (d) => (viteLog += d));
	vite.stderr.on('data', (d) => (viteLog += d));
	let browser;
	try {
		await waitFor('the dev server', async () => (await fetch(`${WEB}/agent/${agent.id}/edit`).catch(() => null))?.ok, 120_000);
		const { chromium } = await import('playwright');
		browser = await chromium.launch();
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
		await ctx.addCookies([{ name: '__Host-sid', value: sid, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
		const page = await ctx.newPage();
		const problems = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
		});
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
		page.on('response', (r) => {
			if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
		});
		const panel = page.locator('#knowledge-docs-host');

		await step('knowledge panel loads on /agent/:id/edit with its empty state', async () => {
			// The first load also runs Vite's dependency optimizer, which can take minutes.
			await page.goto(`${WEB}/agent/${agent.id}/edit`, { waitUntil: 'commit', timeout: 300_000 });
			await panel.locator('input[data-kd="input"]').waitFor({ state: 'attached', timeout: 300_000 });
			await panel.scrollIntoViewIfNeeded();
			return (await panel.innerText()).split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 140);
		});

		const progress = new Set();
		let sawPreview = '';
		await step('upload shows per-page progress and a live table preview', async () => {
			await panel.locator('input[data-kd="input"]').setInputFiles(pdf.path);
			const uploads = panel.locator('[data-kd="uploads"]');
			let shotTaken = false;
			await waitFor(
				'the document to finish reading',
				async () => {
					const text = await uploads.innerText().catch(() => '');
					for (const m of text.matchAll(/page \d+ of \d+/gi)) progress.add(m[0].toLowerCase());
					const toggle = uploads.locator('[data-preview-toggle]');
					if (!sawPreview && (await toggle.count())) {
						sawPreview = (await toggle.first().innerText()).trim();
						if (/so far/.test(sawPreview) && !shotTaken) {
							await toggle.first().click();
							await page.waitForTimeout(400);
							await uploads.screenshot({ path: join(OUT, 'progress-preview.png') });
							shotTaken = true;
						}
					}
					if (/could not|failed|error/i.test(text) && !/reading/i.test(text)) throw new Error(`upload failed: ${text.slice(0, 300)}`);
					return (await panel.locator('[data-tables]').count()) > 0;
				},
				15 * 60_000,
			);
			assert(progress.size >= 2, `expected several "page x of y" states, saw ${[...progress].join(', ') || 'none'}`);
			assert(sawPreview, 'the table preview toggle never appeared');
			return `${progress.size} progress states (${[...progress].slice(0, 3).join(', ')}...), preview "${sawPreview}"`;
		});

		await step('"View tables" renders the extracted tables with the expected value', async () => {
			// Dismiss the finished upload row so only the document's own table view shows.
			const dismiss = panel.locator('[data-kd="uploads"] .kd-up-x');
			if (await dismiss.count()) await dismiss.first().click();
			const btn = panel.locator('[data-tables]').first();
			await btn.click();
			const tables = panel.locator('[data-tables-panel] table');
			await tables.first().waitFor({ timeout: 20_000 });
			const n = await tables.count();
			const text = await panel.locator('[data-tables-panel]').first().innerText();
			assert(text.includes(EXPECTED), `the table preview does not contain ${EXPECTED}`);
			const fig = panel.locator('[data-tables-panel] figure').filter({ hasText: EXPECTED }).first();
			await fig.scrollIntoViewIfNeeded();
			await fig.screenshot({ path: join(OUT, 'tables.png') });
			return `${n} tables rendered`;
		});

		await step('the question retrieves a table chunk from the uploaded PDF', async () => {
			const { searchKnowledge } = await import('../api/_lib/agent-knowledge.js');
			const { results } = await searchKnowledge(agent.id, QUESTION, { topK: 4, minScore: 0.2 });
			writeFileSync(join(OUT, 'retrieved.md'), results.map((r, i) => `## ${i + 1}. ${r.name} | ${r.heading || ''} (score ${r.score?.toFixed?.(3) ?? r.score})\n\n${r.content}`).join('\n\n'));
			const hit = results.find((r) => r.content.includes(EXPECTED));
			assert(hit, `no retrieved chunk holds ${EXPECTED}: ${results.map((r) => r.heading).join(' / ')}`);
			assert(/\|\s*-{3,}/.test(hit.content), 'the chunk holding the value is not a markdown table');
			return `rank ${results.indexOf(hit) + 1}: ${hit.name} | ${hit.heading || ''} | ${hit.locator || ''}`;
		});

		await step('/api/chat answers from the table', async () => {
			const reply = await chat(sid, agent.id, QUESTION);
			assert(reply.includes(EXPECTED), `reply does not contain ${EXPECTED}: ${reply.slice(0, 300)}`);
			writeFileSync(join(OUT, 'chat-reply.txt'), `${QUESTION}\n\n${reply}\n`);
			return reply.replace(/\s+/g, ' ').slice(0, 200);
		});

		await step('no console errors or warnings from the knowledge panel', async () => {
			const own = problems.filter((p) => !ENV_NOISE.some((re) => re.test(p)));
			assert(!own.length, own.slice(0, 5).join('\n        '));
			const ignored = problems.length - own.length;
			return ignored ? `${ignored} line(s) of isolated-environment noise ignored, listed in ${join(OUT, 'console-ignored.txt')}` : 'clean';
		});
		const noise = problems.filter((p) => ENV_NOISE.some((re) => re.test(p)));
		if (noise.length) writeFileSync(join(OUT, 'console-ignored.txt'), `${noise.join('\n')}\n`);
	} finally {
		await browser?.close().catch(() => {});
		vite.kill('SIGTERM');
		if (failed && viteLog) writeFileSync(join(OUT, 'vite.log'), viteLog);
	}

	console.log(`\nScreenshots and the chat reply: ${OUT}`);
	console.log(failed ? `FAIL: ${failed} step(s)` : 'PASS: every step');
	process.exit(failed ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
