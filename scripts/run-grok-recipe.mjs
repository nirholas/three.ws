#!/usr/bin/env node
// Runs one named Grok Bot recipe end to end against a live three.ws MCP
// server and prints the real tool-call sequence and output. Companion to
// scripts/mcp-client-probe.mjs: same SDK client, same Streamable HTTP
// transport, same .env/.env.local API key loading, but it drives a full
// recipe (several ordered tool calls, with job polling) instead of a single
// compatibility check.
//
//   node scripts/run-grok-recipe.mjs --list
//   node scripts/run-grok-recipe.mjs daily-3d-brief
//   node scripts/run-grok-recipe.mjs agent-report --base https://three.ws
//
// Every call is a real network request against production (or --base). No
// recipe here spends money or writes anything other than a 3D Studio
// generation already covered by the free tier; agent-report and
// three-market-brief are read-only.
//
// Prints one JSON object to stdout: { recipe, steps: [{tool, args, ms,
// isError, structuredContent, text}], prompt }. --quiet suppresses the
// human-readable log and prints only that JSON.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_INFO = { name: 'three-ws-grok-recipe-runner', version: '1.0.0' };

// A late response for an already-timed-out request can throw from inside the
// MCP SDK's own message-handling code, outside any call() try/catch. Surface
// that instead of letting Node's default unhandled-rejection exit stay silent.
process.on('unhandledRejection', (err) => {
	console.error('unhandledRejection:', err?.stack || err);
	process.exitCode = 1;
});
process.on('uncaughtException', (err) => {
	console.error('uncaughtException:', err?.stack || err);
	process.exitCode = 1;
});

function loadApiKey() {
	if (process.env.THREE_WS_API_KEY) return process.env.THREE_WS_API_KEY;
	for (const f of ['.env', '.env.local']) {
		const p = resolve(ROOT, f);
		if (!existsSync(p)) continue;
		try {
			process.loadEnvFile(p);
		} catch {
			continue;
		}
		if (process.env.THREE_WS_API_KEY) return process.env.THREE_WS_API_KEY;
	}
	return null;
}

function parseArgs(argv) {
	const out = { base: 'https://three.ws', recipe: null, list: false, quiet: false, timeout: 120_000, resumeJob: null, waitMs: 600_000 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${a} needs a value`);
			return v;
		};
		if (a === '--base') out.base = next().replace(/\/+$/, '');
		else if (a === '--timeout') out.timeout = Number(next());
		else if (a === '--wait') out.waitMs = Number(next());
		else if (a === '--resume-job') out.resumeJob = next();
		else if (a === '--quiet') out.quiet = true;
		else if (a === '--list') out.list = true;
		else if (a === '--help' || a === '-h') {
			console.log('usage: node scripts/run-grok-recipe.mjs <recipe> [--base <origin>] [--timeout <ms>] [--wait <ms>] [--resume-job <job_id>] [--quiet]');
			console.log('       node scripts/run-grok-recipe.mjs --list');
			process.exit(0);
		} else if (!a.startsWith('--') && !out.recipe) out.recipe = a;
		else throw new Error(`unknown argument ${a}`);
	}
	return out;
}

async function connect(base, path, { apiKey, timeout } = {}) {
	const url = new URL(path, base);
	const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
	const client = new Client(CLIENT_INFO, { capabilities: {} });
	client.onerror = () => {};
	const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
	await client.connect(transport, { timeout });
	return { client, transport };
}

function firstTextOf(result) {
	const item = Array.isArray(result.content) ? result.content.find((c) => c.type === 'text') : null;
	return item?.text ?? null;
}

async function call(client, log, name, args, { timeout, quiet, retries = 2 } = {}) {
	const started = Date.now();
	let result;
	for (let attempt = 0; ; attempt++) {
		try {
			result = await client.callTool({ name, arguments: args }, undefined, { timeout });
			break;
		} catch (err) {
			// The MCP SDK's own protocol-level request timeout (-32001) is transient
			// network noise, not a tool failure: the underlying work may have already
			// succeeded server-side. Retry a bounded number of times before giving up.
			const transient = err?.code === -32001 || /Request timed out/.test(err?.message || '');
			if (!transient || attempt >= retries) throw err;
			if (!quiet) console.error(`  ${name} timed out (attempt ${attempt + 1}), retrying`);
		}
	}
	const step = {
		tool: name,
		args,
		ms: Date.now() - started,
		isError: !!result.isError,
		structuredContent: result.structuredContent ?? null,
		text: firstTextOf(result),
	};
	log.push(step);
	if (!quiet) console.error(`  [${step.ms}ms] ${name}(${JSON.stringify(args)}) -> ${step.isError ? 'ERROR' : 'ok'}`);
	if (step.isError) throw new Error(`${name} failed: ${step.text || 'no text'}`);
	return step;
}

async function waitForJob(client, log, jobId, opts = {}) {
	const { timeoutMs = 600_000, intervalMs = 10_000, quiet } = opts;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		let step;
		try {
			step = await call(client, log, 'get_job', { job_id: jobId }, { timeout: 30_000, quiet });
		} catch (err) {
			// A single poll timing out is transient network noise, not a failed job: the
			// job itself keeps running server-side regardless of whether this poll landed.
			if (Date.now() > deadline) throw err;
			if (!quiet) console.error(`  poll failed (${err.message}), retrying`);
			await new Promise((r) => setTimeout(r, intervalMs));
			continue;
		}
		const status = step.structuredContent?.status;
		if (!quiet) {
			const phase = step.structuredContent?.phase;
			const progress = step.structuredContent?.progress;
			console.error(`  job ${jobId.slice(0, 12)}... status=${status} phase=${phase ?? '-'} progress=${progress ?? '-'}`);
		}
		if (status === 'done' || status === 'failed') return step;
		if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms`);
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

async function safeLookAtModel(client, log, glbUrl, { quiet } = {}) {
	if (!glbUrl) return;
	try {
		await call(client, log, 'look_at_model', { glb_url: glbUrl }, { timeout: 30_000, quiet });
	} catch (err) {
		// The render-check is a sanity pass on an already-finished generation, not
		// the deliverable itself: the glb/viewer/poster links are already in hand
		// from the job result regardless of whether this call lands.
		log.push({ tool: 'look_at_model', args: { glb_url: glbUrl }, structuredContent: null, text: null, isError: true, note: `skipped: ${err.message}` });
		if (!quiet) console.error(`  look_at_model failed (${err.message}), continuing without it`);
	}
}

async function getPrompt(client, name, args = {}) {
	const result = await client.getPrompt({ name, arguments: args });
	const text = result.messages?.map((m) => (typeof m.content === 'string' ? m.content : m.content?.text || '')).join('\n\n') ?? '';
	return { description: result.description ?? null, text };
}

// X post media, read from the public syndication API (no auth, no API key):
// https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=a
// Picked a real @trythreews post (the Animations & Poses Studio launch,
// 2026-06-02) whose image is a clean single subject: the chrome "#threews"
// 3D balloon-letter render above the clouds.
const X_POST_IMAGE = {
	tweetId: '2061713039624405062',
	tweetUrl: 'https://x.com/trythreews/status/2061713039624405062',
	imageUrl: 'https://pbs.twimg.com/amplify_video_thumb/2061712043120746496/img/ugo7mBYU2NyMBoF-.jpg',
};

// A real, licensable portrait stand-in for "a teammate's photo" (Unsplash,
// free-to-use license), since no actual teammate photo exists to run this
// recipe against in an unattended session.
const TEAMMATE_PHOTO_URL = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=800&q=80';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const RECIPES = {
	'daily-3d-brief': {
		server: '/api/mcp-grok',
		auth: 'none',
		async run(ctx) {
			const { client, log, quiet, resumeJobId, waitMs } = ctx;
			const prompt = await getPrompt(client, 'daily-3d-brief', { topic: 'a bioluminescent deep-sea creature' });
			let model;
			if (resumeJobId) {
				log.push({ tool: 'note', args: { resuming: resumeJobId }, structuredContent: null, text: 'resuming a forge_free job already queued earlier in this session' });
				model = await waitForJob(client, log, resumeJobId, { quiet, timeoutMs: waitMs });
			} else {
				const gen = await call(client, log, 'forge_free', { prompt: 'a bioluminescent deep-sea anglerfish, glowing lure, dark ocean backdrop' }, { timeout: 60_000, quiet });
				model = gen;
				if (gen.structuredContent?.status === 'pending') model = await waitForJob(client, log, gen.structuredContent.job_id, { quiet, timeoutMs: waitMs });
			}
			const glbUrl = model.structuredContent?.glbUrl || model.structuredContent?.glb_url;
			await safeLookAtModel(client, log, glbUrl, { quiet });
			return prompt;
		},
	},
	'asset-pack': {
		server: '/api/mcp-grok',
		auth: 'none',
		async run(ctx) {
			const { client, log, quiet, resumeJobId, waitMs } = ctx;
			const prompt = await getPrompt(client, 'asset-pack', { theme: 'cozy wizard tower', count: 5 });
			await call(client, log, 'search_catalog', { q: 'wizard tower', limit: 10 }, { timeout: 30_000, quiet });
			if (resumeJobId) {
				log.push({ tool: 'note', args: { resuming: resumeJobId }, structuredContent: null, text: 'resuming a forge_free job already queued earlier in this session' });
				await waitForJob(client, log, resumeJobId, { quiet, timeoutMs: waitMs });
			} else {
				const gen = await call(client, log, 'forge_free', { prompt: 'a cozy wizard tower bookshelf prop, low poly, warm lighting' }, { timeout: 60_000, quiet });
				if (gen.structuredContent?.status === 'pending') await waitForJob(client, log, gen.structuredContent.job_id, { quiet, timeoutMs: waitMs });
			}
			return prompt;
		},
	},
	'avatar-from-photo': {
		server: '/api/mcp-grok',
		auth: 'none',
		async run(ctx) {
			const { client, log, quiet, resumeJobId, waitMs } = ctx;
			const prompt = await getPrompt(client, 'avatar-from-photo', { image_url: TEAMMATE_PHOTO_URL });
			let model;
			if (resumeJobId) {
				log.push({ tool: 'note', args: { resuming: resumeJobId }, structuredContent: null, text: 'resuming a forge_avatar job already queued earlier in this session' });
				model = await waitForJob(client, log, resumeJobId, { quiet, timeoutMs: waitMs });
			} else {
				const gen = await call(client, log, 'forge_avatar', { image_url: TEAMMATE_PHOTO_URL }, { timeout: 60_000, quiet });
				model = gen;
				if (gen.structuredContent?.status === 'pending') model = await waitForJob(client, log, gen.structuredContent.job_id, { quiet, timeoutMs: waitMs });
			}
			const glbUrl = model.structuredContent?.glbUrl || model.structuredContent?.glb_url;
			await safeLookAtModel(client, log, glbUrl, { quiet });
			return prompt;
		},
	},
	'image-to-3d-from-x-post': {
		server: '/api/mcp-grok',
		auth: 'none',
		async run(ctx) {
			const { client, log, quiet, resumeJobId, waitMs } = ctx;
			let model;
			if (resumeJobId) {
				log.push({ tool: 'note', args: { resuming: resumeJobId }, structuredContent: null, text: 'resuming a mesh_forge job already queued earlier in this session' });
				model = await waitForJob(client, log, resumeJobId, { quiet, timeoutMs: waitMs });
			} else {
				const gen = await call(client, log, 'mesh_forge', { image_url: X_POST_IMAGE.imageUrl }, { timeout: 60_000, quiet });
				model = gen;
				if (gen.structuredContent?.status === 'pending') model = await waitForJob(client, log, gen.structuredContent.job_id, { quiet, timeoutMs: waitMs });
			}
			const glbUrl = model.structuredContent?.glbUrl || model.structuredContent?.glb_url;
			await safeLookAtModel(client, log, glbUrl, { quiet });
			return { description: 'no guided prompt yet: Grok Bot reads the X post and its image through its own X connection, then calls mesh_forge on the extracted image_url', text: null };
		},
	},
	'agent-report': {
		server: '/api/mcp',
		auth: 'key',
		async run(ctx) {
			const { client, log, quiet } = ctx;
			const prompt = await getPrompt(client, 'agent-report', {});
			const meRes = await client.readResource({ uri: 'three://me' });
			log.push({ tool: 'read_resource', args: { uri: 'three://me' }, structuredContent: null, text: meRes.contents?.[0]?.text ?? null });
			if (!quiet) console.error(`  [resource] three://me`);
			const listed = await call(client, log, 'list_my_agents', {}, { timeout: 30_000, quiet });
			const firstAgentId = listed.structuredContent?.agents?.[0]?.id || JSON.parse(listed.text || '{}')?.agents?.[0]?.id;
			if (firstAgentId) {
				await call(client, log, 'recall', { agent_id: firstAgentId, query: 'open tasks and follow-ups', limit: 5 }, { timeout: 30_000, quiet });
				await call(client, log, 'list_custom_skills', { agent_id: firstAgentId }, { timeout: 30_000, quiet });
			}
			return prompt;
		},
	},
	'three-market-brief': {
		server: '/api/mcp',
		auth: 'key',
		async run(ctx) {
			const { client, log, quiet } = ctx;
			await call(client, log, 'token_snapshot', { mint: THREE_MINT }, { timeout: 30_000, quiet });
			await call(
				client,
				log,
				'crypto_data',
				{ provider: 'jupiter', endpoint: 'price', params: { ids: SOL_MINT } },
				{ timeout: 30_000, quiet },
			);
			return {
				description: 'no guided prompt yet: hand-written to keep the Solana-first framing explicit',
				text:
					'Give me a $THREE market brief. Call token_snapshot with mint "' +
					THREE_MINT +
					'" (the $THREE Solana token) for price, liquidity and supply, then crypto_data with provider "jupiter" and ' +
					'endpoint "price" for SOL context. Lead with Solana; only mention other chains if I ask.',
			};
		},
	},
};

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.list || !args.recipe) {
		console.log(Object.keys(RECIPES).join('\n'));
		if (!args.recipe) process.exit(args.list ? 0 : 1);
		return;
	}
	const recipe = RECIPES[args.recipe];
	if (!recipe) {
		console.error(`unknown recipe "${args.recipe}". --list for the names.`);
		process.exit(1);
	}
	const apiKey = recipe.auth === 'key' ? loadApiKey() : null;
	if (recipe.auth === 'key' && !apiKey) {
		console.error('THREE_WS_API_KEY not found in env, .env or .env.local');
		process.exit(1);
	}
	const { client, transport } = await connect(args.base, recipe.server, { apiKey, timeout: args.timeout });
	const log = [];
	let prompt = null;
	try {
		if (!args.quiet) console.error(`running ${args.recipe} against ${args.base}${recipe.server}`);
		prompt = await recipe.run({ client, log, quiet: args.quiet, resumeJobId: args.resumeJob, waitMs: args.waitMs });
	} finally {
		await transport.terminateSession?.().catch(() => {});
		await client.close().catch(() => {});
	}
	console.log(JSON.stringify({ recipe: args.recipe, server: recipe.server, auth: recipe.auth, prompt, steps: log }, null, 2));
}

main().catch((err) => {
	console.error(err?.stack || err);
	// process.exit() can truncate a pending async stderr write when stderr is
	// piped to a file; setting exitCode and letting the event loop drain lets
	// the write flush before the process actually exits.
	process.exitCode = 1;
});
