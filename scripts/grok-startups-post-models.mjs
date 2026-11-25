#!/usr/bin/env node
// Real models for the Grok for Startups thread graphics, made through the same
// endpoint Grok calls (/api/mcp-grok), with a short-lived QA key minted from
// AUDIT_EMAIL / AUDIT_PASSWORD in .env and revoked afterwards.
//
//   node scripts/grok-startups-post-models.mjs [--base https://three.ws]
//
// Steps, each one a real tool call:
//   prop       forge_free     a textured model from a sentence (post 2)
//   chrome     refine_model   the same model, "make it chrome" (post 2)
//   character  forge_avatar   a rigged character (post 2)
//   character_rig  rig_mesh   rigs that mesh when forge_avatar returned it unrigged
//   look       look_at_model  the render check on the prop (post 3)
//
// Writes public/x-media/grok-startups-announce/src/models.json (tool, prompt,
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
const outDir = resolve('public/x-media/grok-startups-announce/src');
const manifestPath = join(outDir, 'models.json');
mkdirSync(outDir, { recursive: true });

const PROMPTS = {
	prop: 'a retro tin toy robot with round glass eyes, a boxy body, riveted panels and a small antenna',
	chrome: 'make it chrome',
	character: 'a mountain explorer in a red insulated jacket, dark trousers, hiking boots and a small backpack, full body',
};
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

const call = async (name, args) => {
	const result = await rpc('tools/call', { name, arguments: args });
	if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent || result.content).slice(0, 400)}`);
	return result;
};

const glbOf = (sc) => sc?.glb_url || sc?.glbUrl || sc?.model?.glb_url || sc?.result?.glb_url || null;
const jobOf = (sc) => sc?.job_id || sc?.jobId || null;

// A generation either finishes inside its call or returns a job to poll.
async function generate(name, args) {
	const started = Date.now();
	let sc = (await call(name, args)).structuredContent || {};
	while (!glbOf(sc)) {
		const job = jobOf(sc);
		if (!job) throw new Error(`${name} returned neither a model nor a job: ${JSON.stringify(sc).slice(0, 400)}`);
		if (sc.status === 'failed') throw new Error(`${name} job ${job} failed: ${sc.error || sc.message || ''}`);
		const wait = Math.min(Math.max(Number(sc.eta_seconds) || 15, 5), 30);
		process.stdout.write(`  ${name}: ${sc.status || 'pending'} ${sc.phase || ''} ${sc.progress != null ? Math.round(sc.progress * 100) + '%' : ''}, next check in ${wait}s\n`);
		await new Promise((r) => setTimeout(r, wait * 1000));
		sc = (await call('get_job', { job_id: job })).structuredContent || {};
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
} finally {
	console.log(`key ${(await revokeQaKey(minted)) ? 'revoked' : 'NOT revoked (it expires in 2 hours)'}`);
}
console.log(`manifest: ${manifestPath}`);
