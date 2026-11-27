#!/usr/bin/env node
// Real models for the Grok for Startups thread graphics, made through the same
// endpoint Grok calls (/api/mcp-grok), with a short-lived QA key minted from
// AUDIT_EMAIL / AUDIT_PASSWORD in .env and revoked afterwards.
//
//   node scripts/grok-startups-post-models.mjs [--base https://three.ws]
//   node scripts/grok-startups-post-models.mjs --set repost   # the 2026-11-27 repost
//
// Steps, each one a real tool call:
//   prop       forge_free     a textured model from a sentence (post 2)
//   chrome     refine_model   the same model, "make it chrome" (post 2)
//   character  forge_avatar   a rigged character (post 2)
//   character_rig  rig_mesh   rigs that mesh when forge_avatar returned it unrigged
//   look       look_at_model  the render check on the prop (post 3)
//   pickup     forge_free     repost set only: the model on the Ask @grok card (post 17)
//
// Each set writes its own folder, so the repost never touches the 2026-11-25
// media: announce -> public/x-media/grok-startups-announce/src, repost ->
// public/x-media/grok-startups-repost/src. Each gets models.json (tool, prompt,
// GLB URL, seconds) and the look_at_model frames as look-<view>.png beside it.
// A step that already has a result in models.json is skipped, so a rerun only
// redoes what failed. Pass --fresh to redo everything.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mintQaKey, revokeQaKey } from './lib/qa-api-key.mjs';

const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const base = arg('base', 'https://three.ws');
const SETS = {
	announce: {
		dir: 'public/x-media/grok-startups-announce/src',
		prompts: {
			prop: 'a retro tin toy robot with round glass eyes, a boxy body, riveted panels and a small antenna',
			chrome: 'make it chrome',
			character: 'a mountain explorer in a red insulated jacket, dark trousers, hiking boots and a small backpack, full body',
		},
	},
	repost: {
		dir: 'public/x-media/grok-startups-repost/src',
		prompts: {
			prop: 'a sleek white electric sports car with a low glass roof, smooth curved body panels and aero wheels',
			chrome: 'make it chrome',
			character: 'a sleek humanoid robot with a white and black body, a glossy black face panel and slim jointed limbs, full body',
			pickup: 'a futuristic wedge-shaped electric pickup truck built from flat unpainted stainless steel panels, one sharp triangular roofline from the hood to the tailgate, no grille, a thin full-width light bar',
		},
	},
};
const setName = arg('set', 'announce');
const set = SETS[setName];
if (!set) throw new Error(`--set must be one of ${Object.keys(SETS).join(', ')}`);
const PROMPTS = set.prompts;
const outDir = resolve(set.dir);
const manifestPath = join(outDir, 'models.json');
mkdirSync(outDir, { recursive: true });
const LOOK_VIEWS = ['front', 'three-quarter', 'side', 'back'];

const manifest = !process.argv.includes('--fresh') && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const save = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let token;
let sessionId;
let rpcId = 0;

async function rpc(method, params) {
	const res = await fetch(`${base}/api/mcp-grok`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			authorization: `Bearer ${token}`,
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
	});
	sessionId = res.headers.get('mcp-session-id') || sessionId;
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} answered ${res.status}: ${text.slice(0, 300)}`);
	// The server may answer as a single SSE event; take the last data line.
	const body = text.trimStart().startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).pop().slice(5));
	if (body.error) throw new Error(`${method}: ${body.error.message}`);
	return body.result;
}

// The QA account's per-minute and per-hour generation limits answer with the
// reset time ("in 747 s"); wait just past it and send the same call again.
const call = async (name, args) => {
	for (let attempt = 1; ; attempt++) {
		let result;
		try {
			result = await rpc('tools/call', { name, arguments: args });
		} catch (err) {
			if (attempt >= 4 || !/rate limited/i.test(err.message)) throw err;
			const wait = Number(err.message.match(/in (\d+) s\b/)?.[1] || 60) + 5;
			console.log(`  ${name}: rate limited, sending again in ${wait}s`);
			await new Promise((r) => setTimeout(r, wait * 1000));
			continue;
		}
		if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent || result.content).slice(0, 400)}`);
		return result;
	}
};

const glbOf = (sc) => sc?.glb_url || sc?.glbUrl || sc?.model?.glb_url || sc?.result?.glb_url || null;
const jobOf = (sc) => sc?.job_id || sc?.jobId || null;

// get_job answers a slow check with isError plus retryable: true while the job
// keeps running; wait retry_after and ask again rather than abandoning the job.
async function pollJob(job) {
	for (let attempt = 1; ; attempt++) {
		const result = await rpc('tools/call', { name: 'get_job', arguments: { job_id: job } });
		const sc = result.structuredContent || {};
		if (!result.isError) return sc;
		if (!sc.retryable || attempt >= 20) throw new Error(`get_job failed: ${JSON.stringify(sc || result.content).slice(0, 400)}`);
		const wait = Math.min(Math.max(Number(sc.retry_after) || 10, 5), 30);
		process.stdout.write(`  get_job: ${sc.reason || 'retryable'}, asking again in ${wait}s\n`);
		await new Promise((r) => setTimeout(r, wait * 1000));
	}
}

// A busy engine fails the job with "start a new generation" (or a slow stage
// with "taking longer than expected, try again"); the retry is
// routed to a healthy engine, so start over, waiting longer each time.
const ATTEMPTS = 6;
async function generate(name, args) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await generateOnce(name, args);
		} catch (err) {
			if (attempt >= ATTEMPTS || !/start a new generation|generator is busy|taking longer than expected/i.test(err.message)) throw err;
			const wait = 20 * attempt;
			console.log(`  ${name}: engine busy, new generation in ${wait}s (attempt ${attempt + 1} of ${ATTEMPTS})`);
			await new Promise((r) => setTimeout(r, wait * 1000));
		}
	}
}

// A generation either finishes inside its call or returns a job to poll.
async function generateOnce(name, args) {
	const started = Date.now();
	let sc = (await call(name, args)).structuredContent || {};
	while (!glbOf(sc)) {
		const job = jobOf(sc);
		if (!job) throw new Error(`${name} returned neither a model nor a job: ${JSON.stringify(sc).slice(0, 400)}`);
		if (sc.status === 'failed') throw new Error(`${name} job ${job} failed: ${sc.error || sc.message || ''}`);
		const wait = Math.min(Math.max(Number(sc.eta_seconds) || 15, 5), 30);
		process.stdout.write(`  ${name}: ${sc.status || 'pending'} ${sc.phase || ''} ${sc.progress != null ? Math.round(sc.progress * 100) + '%' : ''}, next check in ${wait}s\n`);
		await new Promise((r) => setTimeout(r, wait * 1000));
		sc = await pollJob(job);
	}
	return { glb_url: glbOf(sc), seconds: Math.round((Date.now() - started) / 100) / 10, structured: sc };
}

async function step(key, fn) {
	if (manifest[key]?.glb_url || manifest[key]?.frames) {
		console.log(`${key}: kept from models.json`);
		return manifest[key];
	}
	console.log(`${key}: running`);
	manifest[key] = { ...(await fn()), made_at: new Date().toISOString() };
	save();
	console.log(`${key}: done`);
	return manifest[key];
}

const minted = await mintQaKey({ origin: base, name: 'grok startups post media', ttlMs: 2 * 3600_000 });
if (!minted) throw new Error('No AUDIT_EMAIL / AUDIT_PASSWORD in .env: run npm run audit:web:provision to create the QA account.');
token = minted.token;
try {
	await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-startups-post-models', version: '1.0.0' } });

	const prop = await step('prop', async () => {
		const r = await generate('forge_free', { prompt: PROMPTS.prop, tier: 'high' });
		return { tool: 'forge_free', prompt: PROMPTS.prop, glb_url: r.glb_url, seconds: r.seconds };
	});

	await step('chrome', async () => {
		const r = await generate('refine_model', { glb_url: prop.glb_url, instruction: PROMPTS.chrome, parent_prompt: PROMPTS.prop });
		return { tool: 'refine_model', prompt: PROMPTS.chrome, parent: prop.glb_url, glb_url: r.glb_url, seconds: r.seconds };
	});

	const character = await step('character', async () => {
		const r = await generate('forge_avatar', { prompt: PROMPTS.character });
		return { tool: 'forge_avatar', prompt: PROMPTS.character, glb_url: r.glb_url, seconds: r.seconds, next: r.structured.next || null };
	});

	// forge_avatar hands back the bare mesh with next: 'rig' when its budget
	// runs out before the rig stage (the viewer then rigs it itself), so finish
	// the job the same way: rig_mesh on that mesh.
	await step('character_rig', async () => {
		const r = await generate('rig_mesh', { glb_url: character.glb_url });
		return { tool: 'rig_mesh', parent: character.glb_url, glb_url: r.glb_url, seconds: r.seconds };
	});

	await step('look', async () => {
		const result = await call('look_at_model', { glb_url: prop.glb_url, views: LOOK_VIEWS });
		const images = (result.content || []).filter((c) => c.type === 'image');
		if (!images.length) throw new Error(`look_at_model returned no images: ${JSON.stringify(result.content).slice(0, 300)}`);
		const frames = images.map((img, i) => {
			const file = `look-${LOOK_VIEWS[i] || i}.png`;
			writeFileSync(join(outDir, file), Buffer.from(img.data, 'base64'));
			return file;
		});
		const sc = result.structuredContent || {};
		const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
		return { tool: 'look_at_model', glb_url: prop.glb_url, views: LOOK_VIEWS, frames, geometry: sc.geometry || sc.stats || null, reading: sc.reading || text.slice(0, 1200) };
	});

	if (PROMPTS.pickup) {
		await step('pickup', async () => {
			const r = await generate('forge_free', { prompt: PROMPTS.pickup, tier: 'high' });
			return { tool: 'forge_free', prompt: PROMPTS.pickup, glb_url: r.glb_url, seconds: r.seconds };
		});
	}
} finally {
	console.log(`key ${(await revokeQaKey(minted)) ? 'revoked' : 'NOT revoked (it expires in 2 hours)'}`);
}
console.log(`manifest: ${manifestPath}`);
