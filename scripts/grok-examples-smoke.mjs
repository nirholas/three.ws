#!/usr/bin/env node
// Smoke test for the Grok examples. A plain run covers the six in the first
// table of examples/grok/README.md. Three more (the TypeScript SDK recipe, the
// LiteLLM gateway and the MetaGPT studio) take longer to install and run when
// they are named with --only, or with --all.
//
// Each example is copied into its own temp directory and set up there the way
// its README says (npm ci, a Python venv), so nothing is installed globally and
// the working tree is never touched. Then, per example:
//
//   three.ws leg  always live: catalog search, the studio MCP server, rendering.
//   xAI leg       with XAI_API_KEY: the full run must succeed. Without it: the
//                 example is run with a deliberately invalid key and must report
//                 xAI's own "Incorrect API key" answer, which proves the request
//                 really reaches api.x.ai with the right shape.
//   generation    one free text-to-3D generation (x-search --prop), with
//                 THREE_WS_API_KEY, or a short-lived QA key minted from
//                 AUDIT_EMAIL / AUDIT_PASSWORD in .env and revoked afterwards.
//                 The same key gives the MetaGPT studio its signed-in render
//                 leg (look_at_model).
//
//   npm run grok:examples-smoke
//   npm run grok:examples-smoke -- --only grok-curl,grok-agent-avatar
//   npm run grok:examples-smoke -- --all
//   npm run grok:examples-smoke -- --no-generate
//   npm run grok:examples-smoke -- --mcp-url https://<public host>/api/mcp-studio
//   npm run grok:examples-smoke -- --save-output <dir>
//
// --mcp-url points the four examples where xAI's cloud calls the MCP server
// (grok-python-mcp, grok-node-responses, grok-curl, grok-sentence-to-3d) at a
// development server, which has to be reachable from the internet: xAI cannot
// call localhost. Those runs send no three.ws key, because a key belongs to a
// production account and catalog search needs none. The other examples keep
// their defaults.
//
// --save-output writes one <example>.txt per example: every command it ran and
// what that command printed, with the xAI key and the three.ws key replaced by
// <XAI_API_KEY> and <THREE_WS_API_KEY>. The README captures come from these.
//
// Prints one PASS or FAIL line per example and exits non-zero on any FAIL.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mintQaKey, revokeQaKey } from './lib/qa-api-key.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES_DIR = join(ROOT, 'examples');
export const INVALID_XAI_KEY = 'xai-smoke-test-invalid-key';
export const XAI_REJECTION = /Incorrect API key provided/;
const GENERATION_PROMPT = 'a low-poly wooden chair';

// Secrets the children never see unless a leg hands them over on purpose.
const SCRUBBED = ['XAI_API_KEY', 'GROK_API_KEY', 'THREE_WS_API_KEY', 'AUDIT_EMAIL', 'AUDIT_PASSWORD'];

/** A child environment: the parent's, minus every secret, plus the leg's own values. */
export function childEnv(base, extra = {}) {
	const env = { ...base };
	for (const key of SCRUBBED) delete env[key];
	for (const [key, value] of Object.entries(extra)) if (value) env[key] = value;
	return env;
}

// The examples that hand the three.ws MCP server to xAI as a remote tool.
const REMOTE_MCP_EXAMPLES = new Set(['grok-python-mcp', 'grok-node-responses', 'grok-curl', 'grok-sentence-to-3d']);

// The examples with a leg that needs a signed-in three.ws account.
const SIGNED_IN_EXAMPLES = new Set(['grok-x-search-to-3d', 'metagpt-3d-studio']);

/** The environment and three.ws key one example runs with, given an optional --mcp-url. */
export function legContext({ name, base, threeWsKey, mcpUrl }) {
	if (!mcpUrl || !REMOTE_MCP_EXAMPLES.has(name)) return { base, threeWsKey };
	return { base: { ...base, THREE_WS_MCP_URL: mcpUrl }, threeWsKey: null };
}

/** The examples one run covers: the named ones, else every one with --all, else those not marked `extra`. */
export function selectExamples(examples, { only = null, all = false } = {}) {
	if (only) return examples.filter((e) => only.has(e.name));
	return all ? examples : examples.filter((e) => !e.extra);
}

/** Did a run fail the way xAI fails a bad key, and not some other way? */
export function isDocumentedRejection({ code, output }) {
	return code !== 0 && XAI_REJECTION.test(output);
}

/** First https GLB URL a run printed. */
export function firstGlb(output) {
	return output.match(/https:\/\/\S+?\.glb\b/)?.[0] ?? null;
}

/** The GLB a run ended on: its last `glb` line, else the first GLB it printed. */
export function answerGlb(output) {
	const own = output.match(/^glb\s+.*$/gm)?.at(-1);
	return firstGlb(own ?? output);
}

export function resultLine({ name, ok, legs, error }) {
	const head = `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)}`;
	const body = legs.map((l) => `${l.leg}: ${l.note}`).join(' | ');
	return error ? `${head} ${body}${body ? ' | ' : ''}error: ${error}` : `${head} ${body}`;
}

/** Replace each secret value in `text` with its label. */
export function redact(text, secrets) {
	let out = text;
	for (const [label, value] of Object.entries(secrets)) if (value) out = out.split(value).join(label);
	return out;
}

// Everything the current example printed, kept only under --save-output.
let transcript = null;
const record = (text) => transcript?.push(text);

function run(cmd, args, opts) {
	return spawnAndCollect(cmd, args, opts).then((r) => {
		record(`$ ${cmd} ${args.join(' ')}\n${r.output.trimEnd()}\n[exit ${r.code}]`);
		return r;
	});
}

function spawnAndCollect(cmd, args, { cwd, env, timeoutMs = 180_000 }) {
	return new Promise((done) => {
		const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (d) => (output += d));
		child.stderr.on('data', (d) => (output += d));
		const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
		child.on('error', (err) => {
			clearTimeout(timer);
			done({ code: 127, output: `${output}${err.message}` });
		});
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			done({ code: code ?? 1, output: signal ? `${output}\nkilled by ${signal} after ${timeoutMs / 1000}s` : output });
		});
	});
}

async function must(cmd, args, opts, what) {
	const r = await run(cmd, args, opts);
	if (r.code !== 0) throw new Error(`${what} exited ${r.code}: ${tail(r.output)}`);
	return r.output;
}

const tail = (text, n = 300) => text.trim().split('\n').slice(-4).join(' / ').slice(-n);

function freePort() {
	return new Promise((done, fail) => {
		const srv = createServer().listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => done(port));
		});
		srv.on('error', fail);
	});
}

function workspace(name) {
	const dir = mkdtempSync(join(tmpdir(), `grok-smoke-${name}-`));
	cpSync(join(EXAMPLES_DIR, name), dir, {
		recursive: true,
		filter: (src) => !/[/\\](node_modules|\.venv|dist)([/\\]|$)/.test(src),
	});
	return dir;
}

// A uv binary: the one on PATH, else one installed into a venv inside the
// example's temp copy. MetaGPT needs a Python older than most machines default
// to, and uv fetches it.
async function uvBin(cwd, base) {
	if ((await run('uv', ['--version'], { cwd, env: base })).code === 0) return 'uv';
	await must('python3', ['-m', 'venv', '.uv'], { cwd, env: base }, 'python3 -m venv .uv');
	await must(join(cwd, '.uv', 'bin', 'pip'), ['install', '--quiet', 'uv'], { cwd, env: base, timeoutMs: 300_000 }, 'pip install uv');
	return join(cwd, '.uv', 'bin', 'uv');
}

// Wait for a local server to answer 200 on `url`, or fail with why it did not.
async function waitForHttp(url, child, what, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let exited = null;
	child.on('exit', (code) => (exited = code ?? 1));
	while (Date.now() < deadline) {
		if (exited !== null) throw new Error(`${what} exited ${exited} before it listened`);
		const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
		if (ok) return;
		await new Promise((next) => setTimeout(next, 500));
	}
	throw new Error(`${what} did not answer ${url} in ${timeoutMs / 1000}s`);
}

// The xAI leg, shared by the CLI examples: a real key must succeed, a missing
// one is replaced by an invalid key that xAI must reject in its own words.
// `xaiKeyHolder: 'server'` is for an example whose xAI key lives in a server
// the caller started (which then got the real or invalid key), not in this
// command. `okCodes` lists the exits that count as a finished run.
async function xaiLeg(cmd, args, { cwd, base, threeWsKey, extraEnv = {}, okCodes = [0], xaiKeyHolder = 'command' }) {
	const real = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
	const xaiKey = xaiKeyHolder === 'command' ? real || INVALID_XAI_KEY : null;
	const env = childEnv(base, { ...extraEnv, XAI_API_KEY: xaiKey, THREE_WS_API_KEY: threeWsKey });
	const r = await run(cmd, args, { cwd, env, timeoutMs: 15 * 60_000 });
	if (real) {
		if (!okCodes.includes(r.code)) throw new Error(`the Grok run exited ${r.code}: ${tail(r.output)}`);
		const glb = answerGlb(r.output);
		return { leg: 'xAI', note: `live run ok${glb ? `, ${glb}` : ''}` };
	}
	if (!isDocumentedRejection(r)) throw new Error(`expected xAI's invalid-key answer, got exit ${r.code}: ${tail(r.output)}`);
	return { leg: 'xAI', note: 'no key: api.x.ai answered the documented 400 "Incorrect API key"' };
}

function expectLine(output, pattern, what) {
	if (!pattern.test(output)) throw new Error(`${what}: ${tail(output)}`);
}

const EXAMPLES = [
	{
		name: 'grok-python-mcp',
		async run({ cwd, base, threeWsKey }) {
			const py = join(cwd, '.venv', 'bin', 'python');
			const hasUv = (await run('uv', ['--version'], { cwd, env: base })).code === 0;
			if (hasUv) {
				await must('uv', ['venv', '--quiet', '--python', '3.12'], { cwd, env: base }, 'uv venv');
				await must('uv', ['pip', 'install', '--quiet', '--python', py, '-r', 'requirements.txt'], { cwd, env: base, timeoutMs: 600_000 }, 'uv pip install');
			} else {
				await must('python3', ['-m', 'venv', '.venv'], { cwd, env: base }, 'python3 -m venv');
				await must(py, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], { cwd, env: base, timeoutMs: 600_000 }, 'pip install');
			}
			const out = await must(py, ['main.py', '--check'], { cwd, env: childEnv(base) }, 'main.py --check');
			expectLine(out, /three-ws/i, 'the check printed no server');
			return [{ leg: 'three.ws', note: 'MCP tools + catalog live' }, await xaiLeg(py, ['main.py'], { cwd, base, threeWsKey })];
		},
	},
	{
		name: 'grok-node-responses',
		async run({ cwd, base, threeWsKey }) {
			await must('npm', ['ci', '--no-audit', '--no-fund'], { cwd, env: base, timeoutMs: 300_000 }, 'npm ci');
			const out = await must('node', ['index.mjs', '--check', '--out', 'check.png'], { cwd, env: childEnv(base) }, 'index.mjs --check');
			expectLine(out, /^png\s+check\.png \(\d+ bytes/m, 'the check rendered no PNG');
			return [{ leg: 'three.ws', note: 'catalog + PNG render live' }, await xaiLeg('node', ['index.mjs', '--out', 'model.png'], { cwd, base, threeWsKey })];
		},
	},
	{
		name: 'grok-curl',
		async run({ cwd, base, threeWsKey }) {
			const env = childEnv(base, { OUT: join(cwd, 'check.png') });
			const out = await must('bash', ['run.sh', '--three-ws-only', '--catalog-only'], { cwd, env }, 'run.sh --catalog-only');
			expectLine(out, /^png\s+\S+ \(\d+ bytes\)/m, 'the catalog run rendered no PNG');
			return [{ leg: 'three.ws', note: 'REST catalog + PNG render live' }, await xaiLeg('bash', ['run.sh'], { cwd, base, threeWsKey })];
		},
	},
	{
		name: 'grok-x-search-to-3d',
		async run({ cwd, base, threeWsKey, generate, timing }) {
			await must('npm', ['ci', '--no-audit', '--no-fund'], { cwd, env: base }, 'npm ci');
			await must('node', ['--test', 'test.mjs'], { cwd, env: childEnv(base) }, 'node --test');
			const out = await must('node', ['index.mjs', '--check'], { cwd, env: childEnv(base) }, 'index.mjs --check');
			expectLine(out, /^ok\s+three\.ws leg is live/m, 'the check did not finish');
			const legs = [{ leg: 'three.ws', note: 'MCP tools + catalog live, 6 unit tests' }];
			if (generate && threeWsKey) {
				const gen = await must(
					'node',
					['index.mjs', '--prop', GENERATION_PROMPT],
					{ cwd, env: childEnv(base, { THREE_WS_API_KEY: threeWsKey }), timeoutMs: 10 * 60_000 },
					'the free generation',
				);
				const glb = firstGlb(gen.match(/^glb\s+.*$/m)?.[0] ?? '');
				if (!glb) throw new Error(`the generation printed no GLB: ${tail(gen)}`);
				const head = await fetch(glb, { method: 'HEAD' });
				if (!head.ok) throw new Error(`the generated GLB answered HTTP ${head.status}`);
				timing.firstGlbMs = Date.now() - timing.copiedAt;
				legs.push({ leg: 'generation', note: `${glb} (fresh copy to GLB ${(timing.firstGlbMs / 1000).toFixed(1)}s)` });
			} else {
				legs.push({ leg: 'generation', note: generate ? 'skipped: no THREE_WS_API_KEY and no QA login in .env' : 'skipped (--no-generate)' });
			}
			legs.push(await xaiLeg('node', ['index.mjs', 'lunar landers'], { cwd, base, threeWsKey }));
			return legs;
		},
	},
	{
		name: 'grok-agent-avatar',
		async run({ cwd, base }) {
			await must('npm', ['ci', '--no-audit', '--no-fund'], { cwd, env: base }, 'npm ci');
			await must('node', ['--test', 'test.mjs'], { cwd, env: childEnv(base) }, 'node --test');
			const real = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
			const port = await freePort();
			const server = spawn('node', ['server.mjs'], {
				cwd,
				env: childEnv(base, { PORT: String(port), XAI_API_KEY: real || INVALID_XAI_KEY }),
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			try {
				await new Promise((ready, fail) => {
					const timer = setTimeout(() => fail(new Error('server.mjs did not start in 10s')), 10_000);
					server.stdout.on('data', (d) => /localhost/.test(String(d)) && (clearTimeout(timer), ready()));
					server.stdout.on('data', (d) => record(`$ node server.mjs\n${String(d).trimEnd()}`));
					server.stderr.on('data', (d) => record(String(d).trimEnd()));
					server.on('exit', (code) => fail(new Error(`server.mjs exited ${code}`)));
				});
				const origin = `http://127.0.0.1:${port}`;
				const page = await fetch(`${origin}/`);
				const html = await page.text();
				if (!page.ok || !html.includes('<agent-3d')) throw new Error(`the page answered ${page.status} without <agent-3d>`);
				const element = html.match(/src="(https:\/\/three\.ws\/agent-3d\/[^"]+)"/)?.[1];
				const cdn = element && (await fetch(element, { method: 'HEAD' }));
				if (!cdn?.ok) throw new Error(`the <agent-3d> script ${element || '(none)'} did not load`);
				const chat = await fetch(`${origin}/api/chat`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in five words.' }] }),
				});
				const body = await chat.json();
				record(`$ POST /api/chat {"messages":[{"role":"user","content":"Say hello in five words."}]}\nHTTP ${chat.status} ${JSON.stringify(body)}`);
				let xai;
				if (real) {
					if (!chat.ok || !body.reply) throw new Error(`chat answered ${chat.status}: ${JSON.stringify(body).slice(0, 200)}`);
					xai = { leg: 'xAI', note: `live reply (${body.mood}): ${body.reply.slice(0, 60)}` };
				} else {
					if (chat.status !== 502 || !XAI_REJECTION.test(body.message || '')) {
						throw new Error(`expected a 502 carrying xAI's invalid-key answer, got ${chat.status}: ${JSON.stringify(body).slice(0, 200)}`);
					}
					xai = { leg: 'xAI', note: 'no key: the proxy relayed api.x.ai\'s documented 400 as a 502' };
				}
				return [{ leg: 'three.ws', note: `page + pinned <agent-3d> CDN script live, 8 tests` }, xai];
			} finally {
				server.kill('SIGTERM');
			}
		},
	},
	{
		name: 'grok-build-workflow',
		async run({ cwd, base }) {
			const starter = join(cwd, 'starter');
			await must('npm', ['ci', '--no-audit', '--no-fund'], { cwd: starter, env: base, timeoutMs: 300_000 }, 'npm ci');
			await must('npm', ['test'], { cwd: starter, env: childEnv(base) }, 'npm test');
			await must('npm', ['run', 'build'], { cwd: starter, env: childEnv(base) }, 'npm run build');
			const res = await fetch(STARTER_DEFAULT_GLB, { headers: { origin: 'http://localhost:3277' } });
			const bytes = new Uint8Array(await res.arrayBuffer());
			const magic = new TextDecoder().decode(bytes.slice(0, 4));
			if (!res.ok || magic !== 'glTF') throw new Error(`the starter's default GLB answered ${res.status} (${magic})`);
			if (res.headers.get('access-control-allow-origin') == null) throw new Error("the starter's default GLB sends no CORS header");
			const grok = (await run('grok', ['--version'], { cwd, env: base })).code === 0;
			return [
				{ leg: 'three.ws', note: `starter built, 4 tests, catalog GLB live with CORS (${bytes.length} bytes)` },
				{ leg: 'Grok Build', note: grok ? 'grok CLI present: run /three-ws-tour by hand' : 'grok CLI not installed here: the plugin is covered by tests/grok-plugin.test.js and tests/grok-build-plugin-*.test.js' },
			];
		},
	},
	{
		name: 'grok-sentence-to-3d',
		extra: true,
		async run({ cwd, base, threeWsKey }) {
			const ts = join(cwd, 'typescript');
			await must('npm', ['ci', '--no-audit', '--no-fund'], { cwd: ts, env: base, timeoutMs: 300_000 }, 'npm ci');
			await must('npm', ['test'], { cwd: ts, env: childEnv(base) }, 'npm test');
			await must('npm', ['run', 'typecheck'], { cwd: ts, env: childEnv(base) }, 'npm run typecheck');
			const out = await must('npm', ['run', '--silent', 'check'], { cwd: ts, env: childEnv(base) }, 'npm run check');
			expectLine(out, /three-ws/i, 'the check printed no server');
			return [{ leg: 'three.ws', note: 'MCP tools + catalog live, unit tests + typecheck' }, await xaiLeg('npm', ['start', '--silent'], { cwd: ts, base, threeWsKey })];
		},
	},
	{
		name: 'litellm-grok-gateway',
		extra: true,
		async run({ cwd, base, threeWsKey }) {
			const py = join(cwd, '.venv', 'bin', 'python');
			await must('python3', ['-m', 'venv', '.venv'], { cwd, env: base }, 'python3 -m venv');
			await must(py, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], { cwd, env: base, timeoutMs: 900_000 }, 'pip install');
			const real = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
			const port = await freePort();
			// The key clients present to this one proxy: made here, gone when the proxy stops.
			const masterKey = `sk-${randomUUID()}`;
			const proxy = spawn(join(cwd, '.venv', 'bin', 'litellm'), ['--config', 'config.yaml', '--host', '127.0.0.1', '--port', String(port)], {
				cwd,
				env: childEnv(base, { LITELLM_MASTER_KEY: masterKey, XAI_API_KEY: real || INVALID_XAI_KEY }),
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			proxy.stdout.on('data', () => {});
			proxy.stderr.on('data', () => {});
			try {
				const origin = `http://127.0.0.1:${port}`;
				await waitForHttp(`${origin}/health/liveliness`, proxy, 'the LiteLLM proxy', 120_000);
				const extraEnv = { LITELLM_MASTER_KEY: masterKey, LITELLM_BASE_URL: origin };
				const out = await must(py, ['main.py', '--check'], { cwd, env: childEnv(base, extraEnv) }, 'main.py --check');
				expectLine(out, /^ok\s+gateway leg is live/m, 'the check did not reach the three.ws tools through the gateway');
				return [
					{ leg: 'three.ws', note: 'MCP gateway + catalog live through the proxy' },
					await xaiLeg(py, ['main.py'], { cwd, base, threeWsKey, extraEnv, xaiKeyHolder: 'server' }),
				];
			} finally {
				proxy.kill('SIGTERM');
			}
		},
	},
	{
		name: 'metagpt-3d-studio',
		extra: true,
		async run({ cwd, base, threeWsKey }) {
			const py = join(cwd, '.venv', 'bin', 'python');
			const uv = await uvBin(cwd, base);
			await must(uv, ['venv', '--quiet', '--python', '3.11', '.venv'], { cwd, env: base, timeoutMs: 300_000 }, 'uv venv');
			await must(uv, ['pip', 'install', '--quiet', '--no-deps', '--python', py, '-r', 'requirements.txt'], { cwd, env: base, timeoutMs: 900_000 }, 'uv pip install');
			const out = await must(py, ['main.py', '--check'], { cwd, env: childEnv(base) }, 'main.py --check');
			expectLine(out, /^ok\s+three\.ws leg is live/m, 'the signed-out check did not finish');
			let views = 'poster render';
			if (threeWsKey) {
				const signedIn = await must(py, ['main.py', '--check'], { cwd, env: childEnv(base, { THREE_WS_API_KEY: threeWsKey }) }, 'main.py --check (signed in)');
				expectLine(signedIn, /^render\s+look_at_model on .+: [1-9]\d* frames/m, 'look_at_model returned no frames for a signed-in account');
				views = 'poster render + signed-in look_at_model views';
			}
			// Exit 3 is a delivered model the Reviewer failed: the team still ran end to end.
			return [
				{ leg: 'three.ws', note: `MCP tools + catalog + ${views} live` },
				await xaiLeg(py, ['main.py', 'a vintage wooden armchair'], { cwd, base, threeWsKey, okCodes: [0, 3] }),
			];
		},
	},
];

const STARTER_DEFAULT_GLB = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb';

async function main() {
	const { values } = parseArgs({
		options: {
			only: { type: 'string' },
			all: { type: 'boolean', default: false },
			'no-generate': { type: 'boolean', default: false },
			keep: { type: 'boolean', default: false },
			'mcp-url': { type: 'string' },
			'save-output': { type: 'string' },
		},
	});
	const mcpUrl = values['mcp-url'] || null;
	const saveDir = values['save-output'] ? resolve(values['save-output']) : null;
	if (saveDir) mkdirSync(saveDir, { recursive: true });
	if (mcpUrl && !/^https:\/\//.test(mcpUrl)) throw new Error('--mcp-url must be an https URL that xAI can reach from the internet');
	const only = values.only ? new Set(values.only.split(',').map((s) => s.trim())) : null;
	const selected = selectExamples(EXAMPLES, { only, all: values.all });
	if (!selected.length) throw new Error(`--only matched nothing; examples: ${EXAMPLES.map((e) => e.name).join(', ')}`);
	const generate = !values['no-generate'] && selected.some((e) => e.name === 'grok-x-search-to-3d');

	let threeWsKey = process.env.THREE_WS_API_KEY || null;
	let minted = null;
	const needsAccount = !values['no-generate'] && selected.some((e) => SIGNED_IN_EXAMPLES.has(e.name));
	if (needsAccount && !threeWsKey) {
		minted = await mintQaKey({ name: 'grok examples smoke', ttlMs: 3600_000 });
		threeWsKey = minted?.token ?? null;
	}
	const base = childEnv(process.env, { npm_config_update_notifier: 'false' });

	console.log(`grok examples smoke: ${selected.length} example(s), xAI key ${process.env.XAI_API_KEY || process.env.GROK_API_KEY ? 'set (full runs)' : 'not set (invalid-key proof)'}, three.ws key ${threeWsKey ? (minted ? 'minted for this run' : 'set') : 'not set'}`);
	if (mcpUrl) console.log(`remote MCP examples (${[...REMOTE_MCP_EXAMPLES].join(', ')}) use ${mcpUrl} and send no three.ws key`);
	const results = [];
	try {
		for (const example of selected) {
			const started = Date.now();
			const timing = { copiedAt: started };
			const cwd = workspace(example.name);
			transcript = saveDir ? [] : null;
			let result;
			try {
				const legs = await example.run({ cwd, ...legContext({ name: example.name, base, threeWsKey, mcpUrl }), generate, timing });
				result = { name: example.name, ok: true, legs };
			} catch (err) {
				result = { name: example.name, ok: false, legs: [], error: err?.message || String(err) };
			} finally {
				if (!values.keep) rmSync(cwd, { recursive: true, force: true });
			}
			result.seconds = (Date.now() - started) / 1000;
			results.push(result);
			const line = `${resultLine(result)}  (${result.seconds.toFixed(1)}s)`;
			console.log(line);
			if (saveDir) {
				const secrets = { '<XAI_API_KEY>': process.env.XAI_API_KEY || process.env.GROK_API_KEY, '<THREE_WS_API_KEY>': threeWsKey };
				writeFileSync(join(saveDir, `${example.name}.txt`), `${redact([...transcript, line].join('\n\n'), secrets)}\n`);
			}
		}
	} finally {
		if (minted) console.log(`three.ws key ${(await revokeQaKey(minted)) ? 'revoked' : 'NOT revoked: delete "grok examples smoke" at https://three.ws/dashboard/api-keys'}`);
	}
	const failed = results.filter((r) => !r.ok).length;
	console.log(failed ? `${failed} of ${results.length} example(s) failed` : `all ${results.length} example(s) passed`);
	process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((err) => {
		console.error(`error: ${err?.message || err}`);
		process.exitCode = 1;
	});
}
