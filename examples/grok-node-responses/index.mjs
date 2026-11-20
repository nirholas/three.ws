#!/usr/bin/env node
// Grok finds or makes a 3D chair through the three.ws studio server, then the
// script renders the GLB to a PNG.
//
// The official OpenAI Node client pointed at https://api.x.ai/v1, the Responses
// API, and the three.ws studio server as a remote MCP tool. xAI connects to the
// server and runs the tool calls on its own side.
//
//   XAI_API_KEY=... THREE_WS_API_KEY=... node index.mjs
//   node index.mjs --check      three.ws leg only: catalog search plus a render (no xAI key)
//   node index.mjs --dry-run    print the exact request (no key, no call)
//   node index.mjs "a brass desk lamp" --out lamp.png
//
// Keys are read from the environment only and are never printed.

import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';

const MCP_URL = process.env.THREE_WS_MCP_URL || 'https://three.ws/api/mcp-studio';
const RENDER_URL = process.env.THREE_WS_RENDER_URL || 'https://three.ws/api/render/glb';
const MODEL = process.env.XAI_MODEL || 'grok-4.7';
const ALLOWED_TOOLS = ['search_catalog', 'forge_free', 'check_job'];
const DEFAULT_TASK = 'find a chair in the free catalog, and if none fits, make a low-poly wooden chair';
const MAX_ROUNDS = 8;
const WAIT_BETWEEN_ROUNDS_MS = 20_000;
const GLB_URL = /https?:\/\/[^\s)"'\]<>]+?\.glb(?:\?[^\s)"'\]<>]*)?/;

const EXIT = { ok: 0, failed: 1, noKey: 2 };

function parseArgs(argv) {
	const out = { check: false, dryRun: false, out: 'model.png', words: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--check') out.check = true;
		else if (a === '--dry-run') out.dryRun = true;
		else if (a === '--out') out.out = argv[++i];
		else out.words.push(a);
	}
	out.task = out.words.join(' ') || DEFAULT_TASK;
	return out;
}

function mcpTool() {
	return {
		type: 'mcp',
		server_url: MCP_URL,
		server_label: 'three-ws',
		server_description: 'Free 3D studio: search CC0 3D assets, or make a textured GLB from one sentence.',
		allowed_tools: ALLOWED_TOOLS,
		...(process.env.THREE_WS_API_KEY ? { authorization: process.env.THREE_WS_API_KEY } : {}),
	};
}

function firstRequest(task) {
	return {
		model: MODEL,
		input: [
			{
				role: 'user',
				content:
					`Use three-ws to ${task}. A generation can come back pending with a job_id: collect it with check_job. ` +
					"When you have the model, reply with one line per field: 'GLB: <url>' and 'Viewer: <url>'.",
			},
		],
		tools: [mcpTool()],
	};
}

// The tool calls Grok made on xAI's side, as Responses API output items.
function printToolCalls(response) {
	for (const item of response.output || []) {
		if (item.type !== 'mcp_call') continue;
		const status = item.error ? `error: ${String(item.error).slice(0, 120)}` : 'ok';
		console.log(`tool     ${item.name} ${String(item.arguments || '').slice(0, 200)} (${status})`);
	}
}

async function renderPng(glbUrl, outPath) {
	const url = `${RENDER_URL}?${new URLSearchParams({ glbUrl, width: '1024', height: '1024' })}`;
	const res = await fetch(url);
	const type = res.headers.get('content-type') || '';
	if (!res.ok || !type.startsWith('image/png')) {
		throw new Error(`render answered HTTP ${res.status} (${type}): ${(await res.text()).slice(0, 200)}`);
	}
	const bytes = Buffer.from(await res.arrayBuffer());
	await writeFile(outPath, bytes);
	console.log(`png      ${outPath} (${bytes.length} bytes, rendered by ${RENDER_URL})`);
}

async function mcp(method, params, sessionId) {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	if (!res.ok) throw new Error(`${MCP_URL} answered HTTP ${res.status} to ${method}`);
	return { body: await res.json(), sessionId: res.headers.get('mcp-session-id') || sessionId };
}

// The three.ws leg without Grok: the same server Grok calls, then the renderer.
async function check(outPath) {
	const init = await mcp('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'grok-node-responses-example', version: '1.0.0' },
	});
	const list = await mcp('tools/list', {}, init.sessionId);
	const names = list.body.result.tools.map((t) => t.name);
	const missing = ALLOWED_TOOLS.filter((n) => !names.includes(n));
	console.log(`server   ${init.body.result.serverInfo.name} (${MCP_URL})`);
	if (missing.length) throw new Error(`the server does not offer: ${missing.join(', ')}`);
	const found = await mcp('tools/call', { name: 'search_catalog', arguments: { q: 'chair', kind: 'object', limit: 1 } }, init.sessionId);
	const item = found.body.result.structuredContent?.items?.[0];
	if (!item) throw new Error('search_catalog returned no chairs');
	console.log(`catalog  ${item.title}  ${item.url}`);
	await renderPng(item.url, outPath);
	console.log('ok       three.ws leg is live');
}

async function run(task, outPath) {
	const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
	if (!apiKey) {
		console.error('error    set XAI_API_KEY (create one at https://console.x.ai), or run with --check or --dry-run');
		return EXIT.noKey;
	}
	if (!process.env.THREE_WS_API_KEY) {
		console.error('note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys');
	}
	const client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1', timeout: 240_000 });

	let response = await client.responses.create(firstRequest(task));
	for (let round = 1; round <= MAX_ROUNDS; round++) {
		printToolCalls(response);
		const text = response.output_text || '';
		const match = text.match(GLB_URL);
		if (match) {
			console.log(`\n${text.trim()}\n`);
			console.log(`glb      ${match[0]}`);
			await renderPng(match[0], outPath);
			return EXIT.ok;
		}
		console.log(`round ${round}: no GLB yet, asking Grok to collect the job again in ${WAIT_BETWEEN_ROUNDS_MS / 1000}s`);
		await new Promise((r) => setTimeout(r, WAIT_BETWEEN_ROUNDS_MS));
		response = await client.responses.create({
			model: MODEL,
			previous_response_id: response.id,
			input: [{ role: 'user', content: "Call check_job on that job again. When it is done, reply with 'GLB: <url>' and 'Viewer: <url>'." }],
			tools: [mcpTool()],
		});
	}
	console.error(`error    no GLB after ${MAX_ROUNDS} rounds; the last reply was:\n${response.output_text || ''}`);
	return EXIT.failed;
}

const args = parseArgs(process.argv.slice(2));
try {
	if (args.dryRun) {
		const shown = firstRequest(args.task);
		if (shown.tools[0].authorization) shown.tools[0].authorization = '<THREE_WS_API_KEY>';
		console.log(`POST https://api.x.ai/v1/responses\nauthorization: Bearer <XAI_API_KEY>\n${JSON.stringify(shown, null, 2)}`);
	} else if (args.check) {
		await check(args.out);
	} else {
		process.exitCode = await run(args.task, args.out);
	}
} catch (err) {
	// The OpenAI client puts xAI's own error text in err.error and the HTTP status in err.status.
	const detail = typeof err?.error === 'string' ? err.error : err?.error?.error || err?.message || String(err);
	console.error(`error    ${err?.status ? `HTTP ${err.status}: ` : ''}${detail}`);
	process.exitCode = EXIT.failed;
}
