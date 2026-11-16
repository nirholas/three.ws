#!/usr/bin/env node
// Prove every conversation starter of the Microsoft 365 Copilot declarative agent
// (integrations/microsoft/copilot-teams/declarativeAgent.json) end to end.
//
// For each starter this runs the exact tool sequence the agent's instructions tell
// Copilot to use, over JSON-RPC against the studio MCP server the plugin points at
// (https://three.ws/api/mcp-studio by default), anonymously, as the plugin's
// `auth: None` runtime does. Generations are followed with check_job until the job
// is done; a failed or busy generation is retried with a new idempotency_key, as
// the instructions say. Nothing is staged: every id and URL printed came back from
// the server, and every GLB is fetched to confirm it is a real glTF binary.
//
//   node scripts/microsoft-copilot-agent-proof.mjs [--only "Starter title"] [--json out.json]
//   MCP_STUDIO_URL=http://localhost:3131/api/mcp-studio node scripts/microsoft-copilot-agent-proof.mjs

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseRpcReply } from './build-microsoft-app-package.mjs';

const MCP_URL = process.env.MCP_STUDIO_URL || JSON.parse(readFileSync(new URL('../integrations/microsoft/copilot-teams/ai-plugin.json', import.meta.url), 'utf8')).runtimes[0].spec.url;
const AGENT = JSON.parse(readFileSync(new URL('../integrations/microsoft/copilot-teams/declarativeAgent.json', import.meta.url), 'utf8'));
const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const GENERATION_ATTEMPTS = 6;

const log = (...m) => console.log(`[copilot-agent-proof ${new Date().toISOString().slice(11, 19)}]`, ...m);

/** Seconds the server asked us to wait (a studio rate limit or a busy generator), or null. */
export function retryAfterSeconds(text) {
	const m = /\(in (\d+) s\)|try again in about (\d+)\s*s/i.exec(text || '');
	return m ? Number(m[1] ?? m[2]) : null;
}

const RATE_LIMITED = /^Rate limited:/;

/** One tools/call. The starters share one IP quota, so a rate limit is waited out, never counted as a failure. */
async function call(name, args) {
	for (let attempt = 1; ; attempt++) {
		const r = await callOnce(name, args);
		if (!r.isError || !RATE_LIMITED.test(r.text) || attempt >= 10) return r;
		const wait = (retryAfterSeconds(r.text) ?? 30) + 2;
		log(`${name}: studio rate limit, waiting ${wait}s`);
		await sleep(wait * 1000);
	}
}

async function callOnce(name, args) {
	const started = Date.now();
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
		signal: AbortSignal.timeout(180_000),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 200)}`);
	const msg = parseRpcReply(text);
	if (msg.error) return { name, ms: Date.now() - started, rpcError: msg.error, sc: {}, text: msg.error.message, isError: true };
	const r = msg.result || {};
	return { name, ms: Date.now() - started, sc: r.structuredContent || {}, text: (r.content || []).map((c) => c.text || '').join('\n'), isError: !!r.isError };
}

/** First value for `key` anywhere in a tool result, so a nested model object still counts. */
function find(obj, key) {
	if (!obj || typeof obj !== 'object') return undefined;
	if (obj[key] != null) return obj[key];
	for (const v of Object.values(obj)) {
		const hit = find(v, key);
		if (hit != null) return hit;
	}
	return undefined;
}

/** Start a generation and follow it with check_job until done, retrying as the instructions say. */
async function generate(steps, tool, args) {
	for (let attempt = 1; attempt <= GENERATION_ATTEMPTS; attempt++) {
		const key = `copilot-proof-${randomUUID()}`;
		const first = await call(tool, { ...args, idempotency_key: key });
		steps.push(step(first));
		const wait = retryAfterSeconds(first.text);
		if (first.isError) {
			const pause = Math.max(wait ?? 0, 30 * attempt);
			log(`${tool} attempt ${attempt}: ${first.sc.message || first.text.split('\n')[0]}; retrying in ${pause}s`);
			await sleep(pause * 1000);
			continue;
		}
		const jobId = find(first.sc, 'job_id') || find(first.sc, 'jobId');
		let result = first;
		const deadline = Date.now() + JOB_TIMEOUT_MS;
		while (find(result.sc, 'status') === 'pending' && Date.now() < deadline) {
			const eta = Number(find(result.sc, 'eta_seconds'));
			await sleep(Math.min(Math.max(Number.isFinite(eta) ? eta : 20, 10), 30) * 1000);
			result = await call('check_job', { job_id: jobId });
			steps.push(step(result));
		}
		const glb = find(result.sc, 'glb_url');
		if (!result.isError && glb) return { jobId, glb, viewer: find(result.sc, 'viewer_url'), poster: find(result.sc, 'poster_png_url'), rigged: find(result.sc, 'rigged') === true, attempts: attempt };
		log(`${tool} attempt ${attempt} (job ${jobId}) ended ${find(result.sc, 'status') || 'without a model'}: ${(result.sc.message || result.text).split('\n')[0]}`);
		await sleep(30_000 * attempt);
	}
	throw new Error(`${tool} produced no model after ${GENERATION_ATTEMPTS} attempts`);
}

function step(r) {
	return { tool: r.name, ms: r.ms, status: find(r.sc, 'status') || (r.isError ? 'error' : 'ok'), job_id: find(r.sc, 'job_id') || find(r.sc, 'jobId') || null };
}

/** Fetch a GLB, confirm the glTF magic, and return its skeleton size (0 for a static mesh). */
async function confirmGlb(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	const buf = Buffer.from(await res.arrayBuffer());
	if (!res.ok || buf.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error(`${url} is not a glTF binary (HTTP ${res.status})`);
	const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
	return { bytes: buf.length, joints: json.skins?.[0]?.joints?.length ?? 0 };
}

/** The tool sequence for each starter, keyed by starter title, mirroring the agent instructions. */
export const STARTER_SEQUENCES = {
	'Product model for a deck': async (steps) => {
		const m = await generate(steps, 'forge_free', { prompt: 'a sleek wireless speaker, matte charcoal fabric with a brushed aluminum top' });
		await confirmGlb(m.glb);
		return { job_id: m.jobId, glb_url: m.glb, viewer_url: m.viewer, poster_png_url: m.poster, attempts: m.attempts };
	},
	'Rigged mascot': async (steps) => {
		const mesh = await generate(steps, 'forge_avatar', { prompt: 'a friendly round robot mascot in bright blue, standing upright with two arms and two legs' });
		// A forge_avatar that went pending hands back the unrigged mesh; the
		// instructions then call rig_mesh on it.
		const m = mesh.rigged ? mesh : await generate(steps, 'rig_mesh', { glb_url: mesh.glb });
		const { joints } = await confirmGlb(m.glb);
		if (!joints) throw new Error(`${m.glb} has no skeleton`);
		return { job_id: mesh.jobId, mesh_glb_url: mesh.glb, rig_job_id: m === mesh ? null : m.jobId, glb_url: m.glb, viewer_url: m.viewer, joints, attempts: mesh.attempts };
	},
	'Find a ready-made asset': async (steps) => {
		const search = await call('search_catalog', { q: 'office chair', limit: 5 });
		steps.push(step(search));
		const item = search.sc.items?.[0];
		if (!item) throw new Error('search_catalog returned no office chair');
		const detail = await call('get_catalog_item', { id: item.id });
		steps.push(step(detail));
		const glb = find(detail.sc, 'glb') || find(detail.sc, 'glb_url') || find(item, 'glb');
		if (glb) await confirmGlb(glb);
		return { id: item.id, title: item.title, license: find(detail.sc, 'license') || item.license, glb_url: glb };
	},
	'Put 3D on our website': async (steps) => {
		const search = await call('search_catalog', { q: 'armchair', limit: 5 });
		steps.push(step(search));
		const item = search.sc.items?.[0];
		if (!item) throw new Error('search_catalog returned no armchair');
		const src = await call('get_item_source', { id: item.id });
		steps.push(step(src));
		const code = find(src.sc, 'code') || src.text;
		if (!/<(model-viewer|agent-3d)\b|GLTFLoader/.test(code)) throw new Error('get_item_source returned no embed code');
		return { id: item.id, title: item.title, framework: find(src.sc, 'framework'), code_excerpt: code.match(/<(model-viewer|agent-3d)[^>]*>/)?.[0]?.slice(0, 160) };
	},
	'How auto-rigging works': async (steps) => {
		const docs = await call('search_docs', { query: 'how does auto-rigging work', limit: 3 });
		steps.push(step(docs));
		const top = docs.sc.results?.[0];
		if (!top) throw new Error('search_docs returned nothing');
		return { top_section: top.title, url: top.url };
	},
	'Inspect a model': async (steps) => {
		const m = await generate(steps, 'forge_free', { prompt: 'a glossy white ceramic coffee mug with a rounded handle' });
		await confirmGlb(m.glb);
		const look = await call('look_at_model', { glb_url: m.glb });
		steps.push(step(look));
		if (look.isError) throw new Error(`look_at_model failed: ${look.text.slice(0, 200)}`);
		return { job_id: m.jobId, glb_url: m.glb, viewer_url: m.viewer, triangles: find(look.sc, 'triangles'), views: find(look.sc, 'views')?.length ?? find(look.sc, 'frames')?.length, attempts: m.attempts };
	},
};

export function missingSequences(agent = AGENT) {
	return agent.conversation_starters.map((s) => s.title).filter((t) => !STARTER_SEQUENCES[t]);
}

async function main(argv) {
	const onlyAt = argv.indexOf('--only');
	const jsonAt = argv.indexOf('--json');
	const missing = missingSequences();
	if (missing.length) throw new Error(`No tool sequence for starter(s): ${missing.join(', ')}`);
	const starters = AGENT.conversation_starters.filter((s) => onlyAt < 0 || s.title === argv[onlyAt + 1]);
	log(`${starters.length} starter(s) against ${MCP_URL}`);
	const report = await Promise.all(
		starters.map(async (s) => {
			const steps = [];
			const started = Date.now();
			try {
				const result = await STARTER_SEQUENCES[s.title](steps);
				log(`PASS "${s.title}" in ${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(result)}`);
				return { title: s.title, text: s.text, ok: true, seconds: Math.round((Date.now() - started) / 1000), sequence: [...new Set(steps.map((x) => x.tool))], result, steps };
			} catch (err) {
				log(`FAIL "${s.title}": ${err.message}`);
				return { title: s.title, text: s.text, ok: false, error: err.message, steps };
			}
		}),
	);
	if (jsonAt >= 0) writeFileSync(argv[jsonAt + 1], `${JSON.stringify({ mcp_url: MCP_URL, ran_at: new Date().toISOString(), report }, null, 2)}\n`);
	return report.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(err.message);
			process.exit(1);
		},
	);
}
