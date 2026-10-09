#!/usr/bin/env node
// Run one Grok Bot recipe from docs/tutorials/grok-bot-recipes.md end to end.
//
// Drives the official MCP SDK client over Streamable HTTP, the transport Grok
// Bot's custom MCP connector uses, the same way scripts/mcp-client-probe.mjs
// does, and calls the tools a recipe names in the order the doc lists them.
// Each run prints a one-line-per-call log and the recipe's result block, and
// can write the full transcript as JSON. Nothing is simulated: every call is a
// real tools/call against the server, and a failed call fails the run.
//
//   node scripts/run-grok-recipe.mjs --list
//   node scripts/run-grok-recipe.mjs daily-brief --topic "lighthouse"
//   node scripts/run-grok-recipe.mjs asset-pack --topic "forest campsite"
//   node scripts/run-grok-recipe.mjs avatar-from-photo [--image <url>]
//   node scripts/run-grok-recipe.mjs post-image-to-3d [--image <url>]
//   node scripts/run-grok-recipe.mjs weekly-agent-report        (needs THREE_WS_API_KEY)
//   node scripts/run-grok-recipe.mjs three-market-brief
//   node scripts/run-grok-recipe.mjs <name> --base http://localhost:3000 --json out.json
//
// The two image recipes take the image URL Grok Bot would hand over after
// reading a photo or a post through its own X connection. Without --image they
// use a real portrait or object render from the public catalog, so the run is
// reproducible by anyone. weekly-agent-report reads the account behind
// THREE_WS_API_KEY (environment, .env or .env.local) with a read-only key.
//
// Exit code 0 when every step succeeded, 1 otherwise, 2 on bad usage.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const JAM_MAX_BYTES = 10_000_000;
const GROK_PATH = '/api/mcp-grok';
const ACCOUNT_PATH = '/api/mcp';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnvKey() {
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

const textOf = (result) =>
	(result?.content || [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('\n');

// A fresh MCP session. The key, when given, is sent the way a connector API
// key is: a bearer header on every request.
async function connect(base, path, apiKey) {
	const client = new Client({ name: 'run-grok-recipe', version: '1.0.0' });
	const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
	const transport = new StreamableHTTPClientTransport(new URL(path, base), { requestInit: { headers } });
	await client.connect(transport);
	return { client, sessionId: transport.sessionId ?? null, path };
}

function makeRunner(transcript) {
	return async function call(session, name, args, { retryable = false } = {}) {
		const t0 = Date.now();
		const result = await session.client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
		const step = {
			server: session.path,
			tool: name,
			arguments: args,
			elapsedMs: Date.now() - t0,
			isError: !!result.isError,
			status: result.structuredContent?.status ?? null,
			structured: result.structuredContent ?? null,
			text: textOf(result).slice(0, 4000),
		};
		transcript.steps.push(step);
		console.log(`${name.padEnd(22)} ${String(step.elapsedMs).padStart(6)} ms  ${step.status || (step.isError ? 'error' : 'ok')}`);
		if (result.isError && !(retryable && result.structuredContent?.retryable)) {
			throw new Error(`${name} failed: ${step.text.slice(0, 400)}`);
		}
		return result;
	};
}

// A generation answers inside the surface's call budget with the model or a
// pending handle; collect it the way the connector's instructions tell Grok to.
async function collect(call, session, first, maxWaitMs) {
	let result = first;
	let handle = first.structuredContent;
	const deadline = Date.now() + maxWaitMs;
	while (result.structuredContent?.status === 'pending' || result.isError) {
		if (Date.now() > deadline) throw new Error(`job still pending after ${Math.round(maxWaitMs / 1000)} s`);
		if (!result.isError) handle = result.structuredContent;
		const waitS = Math.min(Math.max(Number(handle.coldStartRemainingSeconds || handle.etaRemainingSeconds || 10), 5), 30);
		await sleep(waitS * 1000);
		result = await call(session, 'check_job', { job_id: handle.job_id || handle.jobId }, { retryable: true });
	}
	return { result, next: handle?.next ?? null };
}

function glbOf(result) {
	const sc = result.structuredContent || {};
	return sc.glb_url || sc.glbUrl || sc.model?.glb_url || sc.model?.glbUrl || null;
}

function linksOf(result) {
	const sc = result.structuredContent || {};
	const links = {};
	for (const source of [sc.model, sc]) {
		for (const key of ['viewer_url', 'glb_url', 'poster_png_url', 'embed_url']) {
			if (source?.[key] && !links[key]) links[key] = source[key];
		}
	}
	return links;
}

// Generate one model and wait for it, rigging in a second stage when the
// pending handle says the rig comes next.
async function generate(ctx, session, tool, args) {
	const first = await ctx.call(session, tool, args);
	const done = await collect(ctx.call, session, first, ctx.maxWaitMs);
	let result = done.result;
	// The pending handle tells the caller the rig comes next, as a `next` field
	// on newer builds and as a sentence naming rig_mesh on older ones.
	const rigNext = done.next === 'rig' || /rig_mesh/.test(textOf(first));
	if (tool === 'forge_avatar' && rigNext) {
		ctx.rigged = true;
		const rigged = await ctx.call(session, 'rig_mesh', { glb_url: glbOf(result) });
		result = (await collect(ctx.call, session, rigged, ctx.maxWaitMs)).result;
	}
	if (!glbOf(result)) throw new Error(`${tool} finished without a GLB url`);
	return result;
}

// A real image the public catalog serves, for recipes whose photo or post
// image Grok Bot would normally bring.
async function catalogImage(ctx, session, kind, q) {
	const found = await ctx.call(session, 'search_catalog', { q, kind, limit: 1 });
	const item = found.structuredContent?.items?.[0];
	const url = item?.poster_png_url || item?.thumb;
	if (!url) throw new Error(`the catalog returned no ${kind} image for "${q}"`);
	return { url, title: item.title };
}

const RECIPES = {
	'daily-brief': {
		title: 'Daily 3D brief on a topic',
		async run(ctx) {
			const topic = ctx.opts.topic || 'lighthouse';
			const s = await connect(ctx.base, GROK_PATH);
			ctx.sessions.push(s);
			const catalog = await ctx.call(s, 'search_catalog', { q: topic, kind: 'object', limit: 3 });
			const ready = (catalog.structuredContent?.items || []).map((i) => ({ title: i.title, viewer_url: i.viewer_url }));
			const prompt = `a small stylised ${topic}, clean silhouette, soft painted textures`;
			const model = await generate(ctx, s, 'forge_free', { prompt, tier: 'draft' });
			const looked = await ctx.call(s, 'look_at_model', { glb_url: glbOf(model), views: ['three-quarter', 'front', 'side'] });
			const frames = (looked.content || []).filter((c) => c.type === 'image').length;
			return { topic, ready_made: ready, prompt, generated: linksOf(model), look_at_model_frames: frames };
		},
	},

	'asset-pack': {
		title: 'Asset pack for a game jam',
		async run(ctx) {
			const theme = ctx.opts.topic || 'tree';
			const s = await connect(ctx.base, GROK_PATH);
			ctx.sessions.push(s);
			const found = await ctx.call(s, 'search_catalog', { q: theme, kind: 'object', limit: 12 });
			// A jam ships on a size budget: keep only models small enough to load fast.
			const items = (found.structuredContent?.items || []).filter((i) => (i.bytes ?? 0) <= JAM_MAX_BYTES);
			if (!items.length) throw new Error(`the catalog has no object under ${JAM_MAX_BYTES / 1e6} MB matching "${theme}"`);
			const pack = [];
			for (const item of items.slice(0, 4)) {
				const full = await ctx.call(s, 'get_catalog_item', { id: item.id });
				const it = full.structuredContent?.item || full.structuredContent || item;
				pack.push({
					id: item.id,
					title: it.title || item.title,
					license: it.license ?? item.license ?? null,
					bytes: it.bytes ?? item.bytes ?? null,
					glb_url: it.glb_url || it.url || item.glb_url,
					viewer_url: it.viewer_url || item.viewer_url,
				});
			}
			return { theme, matched: found.structuredContent?.matched ?? items.length, total_in_catalog: found.structuredContent?.total ?? null, pack };
		},
	},

	'avatar-from-photo': {
		title: 'Avatar from a teammate photo',
		async run(ctx) {
			const s = await connect(ctx.base, GROK_PATH);
			ctx.sessions.push(s);
			const image = ctx.opts.image ? { url: ctx.opts.image, title: 'supplied image' } : await catalogImage(ctx, s, 'character', 'adam');
			const avatar = await generate(ctx, s, 'forge_avatar', { image_url: image.url, prompt: 'full-body character that matches the photo' });
			return { photo: image, avatar: linksOf(avatar), rigged_with: ctx.rigged ? 'rig_mesh' : null };
		},
	},

	'post-image-to-3d': {
		title: "An X post's image turned into a 3D model",
		async run(ctx) {
			const s = await connect(ctx.base, GROK_PATH);
			ctx.sessions.push(s);
			const image = ctx.opts.image ? { url: ctx.opts.image, title: 'supplied image' } : await catalogImage(ctx, s, 'object', 'lantern');
			const model = await generate(ctx, s, 'mesh_forge', { image_url: image.url });
			const looked = await ctx.call(s, 'look_at_model', { glb_url: glbOf(model), views: ['three-quarter', 'back'] });
			return { source_image: image, model: linksOf(model), look_at_model_frames: (looked.content || []).filter((c) => c.type === 'image').length };
		},
	},

	'weekly-agent-report': {
		title: 'Weekly agent report',
		async run(ctx) {
			const key = loadEnvKey();
			if (!key) throw new Error('weekly-agent-report needs THREE_WS_API_KEY (a read-only connector key) in the environment, .env or .env.local');
			const s = await connect(ctx.base, ACCOUNT_PATH, key);
			ctx.sessions.push(s);
			const me = (await ctx.call(s, 'read_resource', { uri: 'three://me' })).structuredContent;
			const list = (await ctx.call(s, 'read_resource', { uri: 'three://agents' })).structuredContent;
			const agents = [];
			for (const agent of list.agents || []) {
				const trader = (await ctx.call(s, 'trader_profile', { agent_id: agent.id })).structuredContent;
				const memory = await ctx.call(s, 'recall', { agent_id: agent.id, query: 'this week', limit: 5 });
				agents.push({
					name: agent.name,
					page: agent.page,
					wallet: agent.solana_address,
					published: agent.is_published,
					has_avatar: Boolean(agent.avatar),
					trader: { score: trader.score, verified: trader.verified, closed_trades: trader.metrics?.closed_trades, open_positions: trader.metrics?.open_positions },
					memories_this_week: memory.structuredContent?.memories?.length ?? 0,
				});
			}
			return {
				account: me.account?.display_name,
				key_scopes: me.credential?.scopes,
				calls_remaining_today: me.rate_limits?.remaining_today,
				agent_count: list.count,
				agents,
			};
		},
	},

	'three-market-brief': {
		title: '$THREE market brief',
		async run(ctx) {
			const s = await connect(ctx.base, ACCOUNT_PATH, loadEnvKey());
			ctx.sessions.push(s);
			const snap = (await ctx.call(s, 'token_snapshot', { mint: THREE_MINT })).structuredContent;
			const sol = await ctx.call(s, 'crypto_data', { provider: 'coingecko', endpoint: 'price', params: { ids: 'solana', vs_currencies: 'usd', include_24hr_change: 'true' } });
			const pairs = (snap.dexscreener || []).map((p) => ({
				venue: p.dexId,
				quote: p.quoteToken?.symbol,
				price_usd: p.priceUsd,
				liquidity_usd: p.liquidity?.usd,
				market_cap_usd: p.marketCap,
				volume_24h_usd: p.volume?.h24,
				change_24h_pct: p.priceChange?.h24,
				buys_24h: p.txns?.h24?.buys,
				sells_24h: p.txns?.h24?.sells,
				url: p.url,
			}));
			return { mint: snap.mint, sources: snap.sources, failed: snap.failed, pairs, solana_spot: sol.structuredContent ?? textOf(sol).slice(0, 400) };
		},
	},
};

function usage(code) {
	console.error('usage: node scripts/run-grok-recipe.mjs <name> [--topic <text>] [--image <url>] [--base <origin>] [--json <path>] [--max-wait <s>]');
	console.error('       node scripts/run-grok-recipe.mjs --list');
	console.error(`recipes: ${Object.keys(RECIPES).join(', ')}`);
	process.exit(code);
}

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		base: { type: 'string', default: 'https://three.ws' },
		topic: { type: 'string' },
		image: { type: 'string' },
		json: { type: 'string' },
		'max-wait': { type: 'string', default: '600' },
		list: { type: 'boolean', default: false },
	},
});

if (opts.list) {
	for (const [name, r] of Object.entries(RECIPES)) console.log(`${name.padEnd(22)} ${r.title}`);
	process.exit(0);
}
const name = positionals[0];
if (!name || !RECIPES[name]) usage(2);

const transcript = { recipe: name, base: opts.base, startedAt: new Date().toISOString(), steps: [] };
const ctx = {
	base: opts.base,
	opts,
	sessions: [],
	maxWaitMs: Number(opts['max-wait']) * 1000,
	call: makeRunner(transcript),
};

let code = 0;
try {
	const result = await RECIPES[name].run(ctx);
	transcript.sessionIds = ctx.sessions.map((s) => s.sessionId);
	transcript.result = result;
	console.log('\nresult');
	console.log(JSON.stringify(result, null, 2));
} catch (err) {
	transcript.error = err.message;
	console.error(err.message);
	code = 1;
}
for (const s of ctx.sessions) await s.client.close().catch(() => {});
transcript.finishedAt = new Date().toISOString();
if (opts.json) {
	const out = resolve(opts.json);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(transcript, null, '\t') + '\n');
	console.log(`transcript: ${out}`);
}
process.exit(code);
