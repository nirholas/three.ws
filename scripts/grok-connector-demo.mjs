#!/usr/bin/env node
// "Give Grok a body", run end to end against the Grok Bot connector.
//
// Drives the official MCP SDK client over Streamable HTTP, the transport Grok
// Bot's custom MCP connector uses, against /api/mcp-grok and walks the flow the
// surface's instructions tell Grok to follow:
//
//   1. forge_avatar(prompt)            a rigged humanoid GLB, or a pending job
//   2. check_job(job_id) until done    honouring the suggested wait, then
//      rig_mesh when the pending handle said the rig comes next
//   3. create_agent_persona(glb, name) a persistent body with a persona_id
//   4. persona_say(persona_id, text)   the body speaks a line, returns embed_url
//
// Every request carries the Mcp-Session-Id the server issued on initialize, the
// same id Grok Bot echoes, so this run is metered exactly like a Grok user.
// The transcript (each call, its arguments, elapsed time, and the links it
// returned) is written as JSON for the announcement that cites it.
//
//   node scripts/grok-connector-demo.mjs --prompt "..." --name "..." --say "..."
//   node scripts/grok-connector-demo.mjs --base http://localhost:3000 --json out.json
//   node scripts/grok-connector-demo.mjs --path /api/mcp-studio ...   (same tools, no session caps)
//   node scripts/grok-connector-demo.mjs --job <job_id> --rig-after-job ... (resume a pending avatar)
//
// Exit code 0 when the persona spoke, 1 on any failed step.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { values: opts } = parseArgs({
	options: {
		base: { type: 'string', default: 'https://three.ws' },
		path: { type: 'string', default: '/api/mcp-grok' },
		prompt: { type: 'string' },
		name: { type: 'string' },
		say: { type: 'string' },
		json: { type: 'string' },
		job: { type: 'string' },
		'rig-after-job': { type: 'boolean', default: false },
		'max-wait': { type: 'string', default: '900' },
	},
});

for (const key of ['prompt', 'name', 'say']) {
	if (!opts[key]) {
		console.error(`missing --${key}`);
		process.exit(2);
	}
}

const endpoint = new URL(opts.path, opts.base);
const maxWaitMs = Number(opts['max-wait']) * 1000;
const transcript = { endpoint: endpoint.href, startedAt: new Date().toISOString(), steps: [] };

// A tool result's links, from structuredContent first, then any URL in the text.
function linksOf(result) {
	const sc = result?.structuredContent || {};
	const out = {};
	const walk = (obj, depth = 0) => {
		if (!obj || typeof obj !== 'object' || depth > 3) return;
		for (const [k, v] of Object.entries(obj)) {
			if (typeof v === 'string' && /^https?:\/\//.test(v)) out[k] = v;
			else if (typeof v === 'object') walk(v, depth + 1);
		}
	};
	walk(sc);
	return out;
}

function textOf(result) {
	return (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(client, name, args, { retryable = false } = {}) {
	const t0 = Date.now();
	const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
	const step = {
		tool: name,
		arguments: args,
		elapsedMs: Date.now() - t0,
		isError: !!result.isError,
		status: result.structuredContent?.status ?? null,
		links: linksOf(result),
		structured: result.structuredContent ?? null,
		text: textOf(result).slice(0, 2000),
	};
	transcript.steps.push(step);
	console.log(`${name.padEnd(22)} ${String(step.elapsedMs).padStart(6)} ms  ${step.status || (step.isError ? 'error' : 'ok')}`);
	if (result.isError && !(retryable && result.structuredContent?.retryable)) throw new Error(`${name} failed: ${step.text.slice(0, 400)}`);
	return result;
}

// A generation answers inside the surface's call budget with the model or a
// pending handle; collect it the way the instructions tell Grok to. A retryable
// check error (a slow poll, a busy bucket) leaves the job running, so the same
// handle is checked again rather than abandoned.
async function collect(client, first) {
	let result = first;
	let handle = first.structuredContent;
	const deadline = Date.now() + maxWaitMs;
	while (result.structuredContent?.status === 'pending' || result.isError) {
		if (Date.now() > deadline) throw new Error(`job still pending after ${opts['max-wait']} s`);
		if (!result.isError) handle = result.structuredContent;
		const sc = handle;
		const waitS = Math.min(Math.max(Number(sc.coldStartRemainingSeconds || sc.etaRemainingSeconds || 10), 5), 30);
		await sleep(waitS * 1000);
		result = await call(client, 'check_job', { job_id: sc.job_id || sc.jobId }, { retryable: true });
	}
	return { result, stage: handle?.stage ?? null, next: handle?.next ?? null };
}

function glbOf(result) {
	const sc = result.structuredContent || {};
	return sc.glb_url || sc.glbUrl || sc.model?.glb_url || sc.model?.glbUrl || linksOf(result).glb_url || linksOf(result).glbUrl;
}

async function main() {
	const client = new Client({ name: 'grok-connector-demo', version: '1.0.0' });
	const transport = new StreamableHTTPClientTransport(endpoint);
	await client.connect(transport);
	transcript.sessionId = transport.sessionId ?? null;
	transcript.server = client.getServerVersion();
	const { tools } = await client.listTools();
	transcript.toolCount = tools.length;
	console.log(`connected ${endpoint.href} session=${transcript.sessionId} tools=${tools.length}`);

	const first = opts.job
		? await call(client, 'check_job', { job_id: opts.job }, { retryable: true })
		: await call(client, 'forge_avatar', { prompt: opts.prompt });
	const forged = await collect(client, first);
	let glbUrl = glbOf(forged.result);
	if (!glbUrl) throw new Error('forge_avatar finished without a GLB url');
	transcript.meshUrl = glbUrl;

	// A pending avatar is collected as its bare mesh; the rig is the second half.
	if (forged.next === 'rig' || (opts.job && opts['rig-after-job'])) {
		const rigged = await collect(client, await call(client, 'rig_mesh', { glb_url: glbUrl }));
		glbUrl = glbOf(rigged.result);
		if (!glbUrl) throw new Error('rig_mesh finished without a GLB url');
	}
	transcript.glbUrl = glbUrl;

	const persona = await call(client, 'create_agent_persona', { glb_url: glbUrl, name: opts.name, source_prompt: opts.prompt });
	const personaId = persona.structuredContent?.persona_id || persona.structuredContent?.persona?.persona_id;
	if (!personaId) throw new Error('create_agent_persona returned no persona_id');
	transcript.personaId = personaId;

	const said = await call(client, 'persona_say', { persona_id: personaId, text: opts.say });
	transcript.embedUrl = said.structuredContent?.embed_url || linksOf(said).embed_url || null;
	transcript.finishedAt = new Date().toISOString();
	await client.close();
}

let code = 0;
try {
	await main();
} catch (err) {
	transcript.error = err.message;
	console.error(err.message);
	code = 1;
}
if (opts.json) {
	const out = resolve(opts.json);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(transcript, null, '\t') + '\n');
	console.log(`transcript: ${out}`);
}
process.exit(code);
