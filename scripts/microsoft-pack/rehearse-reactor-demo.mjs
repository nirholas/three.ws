#!/usr/bin/env node
/**
 * Rehearsal for the Reactor live build (docs/partners/microsoft/reactor-session.md).
 *
 * Runs the session's tool calls, in order, against the free three.ws MCP
 * endpoint and prints how long each one took, so the presenter knows before
 * going live whether the lane is warm and how long each beat really runs:
 *   1. tools/list                      (the 16 tools Copilot Studio will see)
 *   2. forge_free  tier=draft           (a prop from a sentence)
 *   3. forge_avatar                     (a rigged character in one call)
 *   4. create_agent_persona            (the character becomes a named agent)
 *   5. persona_say                      (the agent speaks one line)
 * Pending generations are polled with get_job, exactly as the agent would.
 *
 * Usage: node scripts/microsoft-pack/rehearse-reactor-demo.mjs [--base https://three.ws]
 * Exit code 1 when any step fails, with the step and the server's reason.
 */
const baseArg = process.argv.indexOf('--base');
const BASE = baseArg > -1 ? process.argv[baseArg + 1] : 'https://three.ws';
const ENDPOINT = new URL('/api/mcp-studio', BASE).toString();
const POLL_MS = 5000;
const STEP_LIMIT_MS = 15 * 60 * 1000;

let rpcId = 0;
async function rpc(method, params) {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
	const body = JSON.parse(text.replace(/^data: /m, ''));
	if (body.error) throw new Error(`${method}: ${body.error.message}`);
	return body.result;
}

// Tool results carry structuredContent; older clients read the JSON text part.
function payloadOf(result) {
	if (result.structuredContent) return result.structuredContent;
	const part = (result.content || []).find((c) => c.type === 'text');
	try {
		return JSON.parse(part?.text ?? '{}');
	} catch {
		return { text: part?.text };
	}
}

async function callTool(name, args) {
	const result = await rpc('tools/call', { name, arguments: args });
	const payload = payloadOf(result);
	if (result.isError) throw new Error(`${name}: ${JSON.stringify(payload).slice(0, 300)}`);
	return payload;
}

async function untilDone(name, args) {
	const started = Date.now();
	let payload = await callTool(name, args);
	const firstResponseMs = Date.now() - started;
	const jobId = payload.job_id;
	while (payload.status === 'pending') {
		if (Date.now() - started > STEP_LIMIT_MS) throw new Error(`${name}: still pending after ${STEP_LIMIT_MS / 60000} min (job ${jobId})`);
		await new Promise((r) => setTimeout(r, POLL_MS));
		payload = await callTool('get_job', { job_id: jobId });
	}
	if (payload.status === 'failed') throw new Error(`${name}: failed (job ${jobId}): ${payload.reason || payload.error || 'no reason given'}`);
	return { payload, jobId, firstResponseMs, totalMs: Date.now() - started };
}

const glbOf = (p) => p.glb_url || p.model?.glb_url || p.result?.glb_url;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const rows = [];
let failed = false;

async function step(label, fn) {
	const t0 = Date.now();
	try {
		const detail = await fn();
		rows.push({ step: label, ok: true, time: seconds(Date.now() - t0), ...detail });
		return detail;
	} catch (err) {
		failed = true;
		rows.push({ step: label, ok: false, time: seconds(Date.now() - t0), error: err.message });
		return null;
	}
}

const tag = `reactor-rehearsal-${new Date().toISOString().slice(0, 10)}`;
await step('tools/list', async () => ({ tools: (await rpc('tools/list', {})).tools.length }));

await step('forge_free draft', async () => {
	const r = await untilDone('forge_free', { prompt: 'a brass desk lamp with a green glass shade', tier: 'draft', idempotency_key: `${tag}-lamp-${Date.now()}` });
	return { job: r.jobId || 'inline', first_response: seconds(r.firstResponseMs), glb: glbOf(r.payload) };
});

const avatar = await step('forge_avatar', async () => {
	const r = await untilDone('forge_avatar', { prompt: 'a friendly lighthouse keeper in a yellow raincoat', idempotency_key: `${tag}-keeper-${Date.now()}` });
	return { job: r.jobId || 'inline', first_response: seconds(r.firstResponseMs), glb: glbOf(r.payload) };
});

const persona = avatar?.glb
	? await step('create_agent_persona', async () => {
			const p = await callTool('create_agent_persona', { glb_url: avatar.glb, name: 'Keeper', source_prompt: 'a friendly lighthouse keeper in a yellow raincoat' });
			return { persona_id: p.persona_id };
		})
	: null;

if (persona?.persona_id) {
	await step('persona_say', async () => {
		const p = await callTool('persona_say', { persona_id: persona.persona_id, text: 'Welcome aboard. The light has not missed a night in forty years.' });
		return { emotion: p.emotion || p.expression || 'detected' };
	});
}

console.log(`MCP endpoint: ${ENDPOINT}`);
console.table(rows);
if (failed) process.exit(1);
