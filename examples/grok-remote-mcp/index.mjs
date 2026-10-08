#!/usr/bin/env node
// Grok makes a 3D model through three.ws, over xAI's Responses API.
//
//   XAI_API_KEY=xai-... node index.mjs "a lunar lander with gold foil legs"
//   node index.mjs --check      verify the three.ws MCP server answers (no key)
//   node index.mjs --dry-run    print the exact xAI request (no key, no call)
//
// xAI connects to the remote MCP server and runs the tool calls on its side.
// A render can outlast one response (a cold GPU boots for a minute or more), in
// which case the three.ws server answers with a pending job instead of hanging.
// Grok cannot wait inside a single response, so this script continues the same
// conversation with previous_response_id until Grok hands back a viewer link.

const XAI_URL = 'https://api.x.ai/v1/responses';
const MCP_URL = process.env.THREE_WS_MCP_URL || 'https://three.ws/api/mcp-grok';
const MODEL = process.env.XAI_MODEL || 'grok-4.7';
const MAX_ROUNDS = 12;
const WAIT_BETWEEN_ROUNDS_MS = 30_000;
const VIEWER_LINK = /https:\/\/three\.ws\/viewer\?src=[^\s)"'\]]+/;

// Only the tools this task needs: less context for the model, and nothing it
// can call by surprise. Drop allowed_tools to expose the whole catalog.
const ALLOWED_TOOLS = ['search_catalog', 'forge_free', 'forge_avatar', 'check_job'];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const prompt = args.filter((a) => !a.startsWith('--')).join(' ') || 'a lunar lander with gold foil legs';

function request(input, previousResponseId) {
	return {
		model: MODEL,
		input,
		...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
		tools: [
			{
				type: 'mcp',
				server_url: MCP_URL,
				server_label: 'three-ws',
				server_description: 'Free 3D studio: text or image to textured 3D models, rigged avatars and talking personas.',
				allowed_tools: ALLOWED_TOOLS,
			},
		],
	};
}

// The assistant's text, from the message items of a Responses API output.
function outputText(response) {
	if (typeof response.output_text === 'string') return response.output_text;
	return (response.output || [])
		.filter((item) => item.type === 'message')
		.flatMap((item) => item.content || [])
		.filter((part) => part.type === 'output_text')
		.map((part) => part.text)
		.join('\n');
}

async function callXai(body) {
	const res = await fetch(XAI_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${process.env.XAI_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`xAI answered ${res.status}: ${json?.error?.message || json?.error || JSON.stringify(json).slice(0, 300)}`);
	return json;
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
	if (!res.ok) throw new Error(`${MCP_URL} answered ${res.status} to ${method}`);
	return { body: await res.json(), sessionId: res.headers.get('mcp-session-id') || sessionId };
}

async function check() {
	const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok-remote-mcp-example', version: '0.1.0' } });
	const list = await mcp('tools/list', {}, init.sessionId);
	const names = list.body.result.tools.map((t) => t.name);
	console.log(`server   ${init.body.result.serverInfo.name} (${MCP_URL})`);
	console.log(`session  ${init.sessionId || 'none issued'}`);
	console.log(`tools    ${names.length}: ${names.join(', ')}`);
	const missing = ALLOWED_TOOLS.filter((n) => !names.includes(n));
	if (missing.length) throw new Error(`the server does not offer: ${missing.join(', ')}`);
	console.log('ok       every allowed tool is offered');
}

async function run() {
	if (!process.env.XAI_API_KEY) throw new Error('Set XAI_API_KEY (console.x.ai), or run with --check or --dry-run.');
	const ask = `Use three-ws to make a 3D model of ${prompt}. When it is done, reply with the viewer link and the GLB link.`;
	let response = await callXai(request([{ role: 'user', content: ask }]));
	for (let round = 1; round <= MAX_ROUNDS; round++) {
		const text = outputText(response);
		const link = text.match(VIEWER_LINK);
		if (link) {
			console.log(text.trim());
			console.log(`\nviewer   ${link[0]}`);
			return;
		}
		console.log(`round ${round}: the model is still rendering, asking Grok to collect it in ${WAIT_BETWEEN_ROUNDS_MS / 1000}s`);
		await new Promise((r) => setTimeout(r, WAIT_BETWEEN_ROUNDS_MS));
		response = await callXai(
			request([{ role: 'user', content: 'Call check_job on that job again. When it is done, reply with the viewer link and the GLB link.' }], response.id),
		);
	}
	throw new Error(`no finished model after ${MAX_ROUNDS} rounds; the last reply was:\n${outputText(response)}`);
}

try {
	if (flags.has('--check')) await check();
	else if (flags.has('--dry-run')) console.log(`POST ${XAI_URL}\n${JSON.stringify(request([{ role: 'user', content: `Use three-ws to make a 3D model of ${prompt}.` }]), null, 2)}`);
	else await run();
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exit(1);
}
