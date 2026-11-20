#!/usr/bin/env node
// End-to-end session check for the three.ws Cursor plugin, run the way a
// Marketplace reviewer's Cursor would run it: read the plugin's own mcp.json,
// connect without credentials and follow the OAuth discovery chain the 401 hands
// back, then sign in (with a free account's API key standing in for the browser
// sign-in), list tools, search the free catalog and finish one free generation.
// Every step is timed and printed as a PASS/FAIL table.
//
//   node --env-file=.env scripts/cursor-plugin-session-check.mjs
//     [--plugin integrations/cursor/three-ws]   plugin directory (default)
//     [--prompt "a small wooden stool"]         prompt for the free generation
//     [--json <file>]                           also write the results as JSON
//     [--skip-generation]                       stop after the catalog search
//
// Needs THREE_WS_API_KEY from a free three.ws account (never commit it). Exit 0
// when every row passes, 1 otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, pluginMcpConfig, probeUnauthenticated, readMcpServers, spendSurfaceHits, toolPayload } from './lib/plugin-mcp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PLUGIN = 'integrations/cursor/three-ws';
const DEFAULT_PROMPT = 'a small wooden three-legged stool';
const GENERATION_BUDGET_MS = 15 * 60_000;

// Scopes a 3D studio has no business asking for on a coding agent's consent
// screen. The studio's own resource document must not advertise them.
const WALLET_SCOPE = /^(wallet|pay|payments?|x402|trade|launch)(:|$)/i;

function parseArgs(argv) {
	const opts = { plugin: DEFAULT_PLUGIN, prompt: DEFAULT_PROMPT, json: null, skipGeneration: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--plugin') opts.plugin = argv[++i];
		else if (a === '--prompt') opts.prompt = argv[++i];
		else if (a === '--json') opts.json = argv[++i];
		else if (a === '--skip-generation') opts.skipGeneration = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	return opts;
}

const glbOf = (p) => p?.glb_url || p?.glbUrl || null;
const viewerOf = (p) => p?.viewer_url || p?.viewerUrl || null;
const jobOf = (p) => p?.job_id || p?.jobId || null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run every step in order, timing each. A failed step stops the steps that depend on it. */
export async function runSessionCheck({ plugin = DEFAULT_PLUGIN, prompt = DEFAULT_PROMPT, apiKey, skipGeneration = false, log = () => {} }) {
	const rows = [];
	const facts = {};
	const step = async (name, fn) => {
		const t0 = performance.now();
		let pass = false;
		let detail = '';
		try {
			const out = await fn();
			pass = out.pass;
			detail = out.detail;
		} catch (err) {
			detail = err?.message || String(err);
		}
		const row = { step: name, pass, ms: Math.round(performance.now() - t0), detail };
		rows.push(row);
		log(row);
		return pass;
	};

	const pluginDir = path.resolve(ROOT, plugin);
	let server = null;
	const configOk = await step('read plugin mcp.json', async () => {
		const configPath = pluginMcpConfig(pluginDir);
		const servers = readMcpServers(configPath);
		server = servers[0] || null;
		return {
			pass: servers.length === 1 && /^https:\/\//.test(server?.url || ''),
			detail: `${path.relative(ROOT, configPath)}: ${servers.map((s) => `${s.name} -> ${s.url}`).join(', ') || 'no servers'}`,
		};
	});
	if (!configOk) return { rows, facts };
	facts.serverUrl = server.url;

	let probe = null;
	await step('connect without sign-in: 401 + resource_metadata', async () => {
		probe = await probeUnauthenticated(server.url);
		const rm = probe.challenge?.params?.resourceMetadataUrl?.href || null;
		return {
			pass: probe.unauthorized && probe.challenge?.status === 401 && Boolean(rm),
			detail: probe.challenge ? `401, resource_metadata=${rm}` : `no 401: ${probe.error}`,
		};
	});

	if (probe?.resourceMetadata) {
		const rmd = probe.resourceMetadata;
		await step('protected-resource metadata (RFC 9728)', async () => {
			const expected = new URL(server.url);
			const resourceMatches = rmd.resource === `${expected.origin}${expected.pathname}`;
			return {
				pass: resourceMatches && Array.isArray(rmd.authorization_servers) && rmd.authorization_servers.length > 0,
				detail: `resource=${rmd.resource}, authorization_servers=${(rmd.authorization_servers || []).join(',')}`,
			};
		});
		await step('consent screen asks for no wallet scopes', async () => {
			const scopes = rmd.scopes_supported || [];
			const wallet = scopes.filter((s) => WALLET_SCOPE.test(s));
			facts.advertisedScopes = scopes;
			return {
				pass: scopes.length > 0 && wallet.length === 0,
				detail: wallet.length ? `advertises ${wallet.join(', ')} (${scopes.length} scopes)` : `${scopes.length} scopes: ${scopes.join(', ')}`,
			};
		});
	}

	if (probe?.authServer) {
		const as = probe.authServer;
		await step('authorization-server metadata (RFC 8414)', async () => {
			const missing = ['authorization_endpoint', 'token_endpoint', 'registration_endpoint'].filter((k) => !as[k]);
			const s256 = (as.code_challenge_methods_supported || []).includes('S256');
			return {
				pass: missing.length === 0 && s256,
				detail: missing.length
					? `missing ${missing.join(', ')}`
					: `issuer=${as.issuer}, dynamic client registration=yes, PKCE S256=${s256 ? 'yes' : 'no'}`,
			};
		});
	}

	if (!apiKey) {
		rows.push({ step: 'sign in', pass: false, ms: 0, detail: 'THREE_WS_API_KEY is not set (run with node --env-file=.env)' });
		return { rows, facts };
	}

	let session = null;
	try {
		const signedIn = await step('sign in and initialize', async () => {
			session = await openSession(server.url, apiKey);
			const info = session.client.getServerVersion();
			return { pass: Boolean(info?.name), detail: `server ${info?.name} ${info?.version || ''}`.trim() };
		});
		if (!signedIn) return { rows, facts };

		await step('tools/list: no spend surface', async () => {
			const { tools } = await session.client.listTools();
			const hits = spendSurfaceHits(tools);
			facts.tools = tools.map((t) => t.name);
			return {
				pass: tools.length > 0 && hits.length === 0,
				detail: hits.length ? `spend words: ${hits.map((h) => `${h.tool}(${h.word})`).join(', ')}` : `${tools.length} tools, 0 spend words`,
			};
		});

		await step('search_catalog (free)', async () => {
			const res = await session.client.callTool({ name: 'search_catalog', arguments: { q: 'chair', kind: 'object', limit: 3 } });
			const payload = toolPayload(res);
			const items = payload?.items || payload?.results || [];
			facts.catalogFirst = items[0]?.name || items[0]?.title || null;
			return {
				pass: !res.isError && items.length > 0,
				detail: res.isError ? `error: ${payload?.text || JSON.stringify(payload).slice(0, 200)}` : `${items.length} results, first: ${facts.catalogFirst}`,
			};
		});

		if (skipGeneration) return { rows, facts };

		let generated = null;
		await step(`forge_free draft "${prompt}"`, async () => {
			const deadline = Date.now() + GENERATION_BUDGET_MS;
			let res = await session.client.callTool({ name: 'forge_free', arguments: { prompt, tier: 'draft' } }, undefined, { timeout: 300_000 });
			let payload = toolPayload(res);
			let polls = 0;
			while (!res.isError && !glbOf(payload) && payload?.status === 'pending' && Date.now() < deadline) {
				const jobId = jobOf(payload);
				if (!jobId) break;
				const eta = Number(payload.etaRemainingSeconds || payload.eta_seconds || payload.coldStartRemainingSeconds || 10);
				await wait(Math.min(20, Math.max(5, eta)) * 1000);
				polls++;
				res = await session.client.callTool({ name: 'check_job', arguments: { job_id: jobId } }, undefined, { timeout: 120_000 });
				payload = toolPayload(res);
			}
			generated = payload;
			const glb = glbOf(payload);
			facts.glbUrl = glb;
			facts.viewerUrl = viewerOf(payload);
			facts.receiptUrl = payload?.receipt?.url || null;
			facts.receiptOutcome = payload?.receipt?.outcome || null;
			facts.generationPolls = polls;
			return {
				pass: !res.isError && /^https:\/\/.+/.test(glb || ''),
				detail: glb ? `glb=${glb} (${polls} check_job polls)` : `no GLB: ${res.isError ? (payload?.text || '').slice(0, 300) : `status ${payload?.status}`}`,
			};
		});
		facts.generationMs = rows.at(-1).ms;

		if (glbOf(generated)) {
			await step('look_at_model (free)', async () => {
				const res = await session.client.callTool({ name: 'look_at_model', arguments: { glb_url: glbOf(generated) } }, undefined, { timeout: 180_000 });
				const images = (res.content || []).filter((c) => c.type === 'image').length;
				return { pass: !res.isError && images > 0, detail: res.isError ? 'error rendering the model' : `${images} rendered views` };
			});
		}
	} finally {
		if (session) await session.close().catch(() => {});
	}
	return { rows, facts };
}

function printTable(rows) {
	const w = Math.max(...rows.map((r) => r.step.length), 4);
	console.log(`\n${'step'.padEnd(w)}  result  ${'ms'.padStart(7)}  detail`);
	console.log(`${'-'.repeat(w)}  ------  ${'-'.repeat(7)}  ------`);
	for (const r of rows) console.log(`${r.step.padEnd(w)}  ${r.pass ? 'PASS  ' : 'FAIL  '}  ${String(r.ms).padStart(7)}  ${r.detail}`);
	const failed = rows.filter((r) => !r.pass).length;
	const total = rows.reduce((n, r) => n + r.ms, 0);
	console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${rows.length - failed}/${rows.length} steps passed in ${(total / 1000).toFixed(1)} s`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const opts = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const { rows, facts } = await runSessionCheck({
		...opts,
		apiKey: process.env.THREE_WS_API_KEY,
		log: (r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.step}  (${r.ms} ms)`),
	});
	printTable(rows);
	if (opts.json) {
		fs.writeFileSync(opts.json, `${JSON.stringify({ startedAt, plugin: opts.plugin, prompt: opts.prompt, rows, facts }, null, 2)}\n`);
		console.log(`wrote ${opts.json}`);
	}
	process.exitCode = rows.every((r) => r.pass) ? 0 : 1;
}
