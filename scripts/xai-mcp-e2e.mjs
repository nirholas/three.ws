#!/usr/bin/env node
// Prove a real Grok model drives three.ws end to end over the xAI Responses
// API's remote MCP tool, the same connector mechanics Grok Bot uses.
//
// We cannot script Grok Bot itself (it is a hosted, browser-driven agent with
// no API), but the Responses API lets any Grok model call a remote MCP server
// directly: same model family, same "type": "mcp" tool, same tool discovery
// and invocation path. A passing run here is evidence that a Grok model can
// find our tools, call one correctly, and return a working three.ws link.
//
// Request shape is xAI's documented one, field for field
// (https://docs.x.ai/developers/tools/remote-mcp): a "mcp" tool with
// server_url and server_label. Response shape is the OpenAI-compatible
// Responses API: output items of type "mcp_call" carry the tool name and
// server_label; a final "message" item carries the assistant's answer as
// "output_text" content parts.
//
// USAGE
//   npm run e2e:xai-mcp                 # send the real request, assert, exit non-zero on failure
//   npm run e2e:xai-mcp -- --dry-run    # print the exact request, send nothing, needs no key
//   node scripts/xai-mcp-e2e.mjs --server mcp-studio --base http://localhost:3107
//   node scripts/xai-mcp-e2e.mjs --prompt "..." --model grok-4.3
//
// The key (GROK_API_KEY or XAI_API_KEY) is read from this process's env, then
// from .env/.env.local (via --env-file in the npm script), then from the
// three-ws-api Cloud Run service. It is only ever sent to api.x.ai and is
// never printed.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { GROK_DEFAULT_MODEL } from '../api/_lib/chat-models.js';
import { serviceEnvValue } from './lib/service-env.mjs';

const RESPONSES_URL = 'https://api.x.ai/v1/responses';
const TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT = 'Find a ready-made chair in the three.ws catalog and give me its viewer link.';
const SERVER_LABEL = 'three-ws';
const SERVERS = {
	'mcp-grok': '/api/mcp-grok',
	'mcp-studio': '/api/mcp-studio',
};

export function parseArgs(argv) {
	const args = { dryRun: false, server: 'mcp-grok', base: 'https://three.ws', model: GROK_DEFAULT_MODEL, prompt: DEFAULT_PROMPT };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === '--dry-run') args.dryRun = true;
		else if (a === '--server') args.server = argv[++i];
		else if (a === '--base') args.base = argv[++i];
		else if (a === '--model') args.model = argv[++i];
		else if (a === '--prompt') args.prompt = argv[++i];
		else if (a === '--allow-tools') args.allowTools = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
	}
	if (!SERVERS[args.server]) {
		throw new Error(`unknown --server "${args.server}", expected one of: ${Object.keys(SERVERS).join(', ')}`);
	}
	return args;
}

export function buildRequest(args) {
	const serverUrl = `${args.base.replace(/\/$/, '')}${SERVERS[args.server]}`;
	const tool = {
		type: 'mcp',
		server_url: serverUrl,
		server_label: SERVER_LABEL,
		server_description: 'three.ws: ready-made 3D/avatar catalog, generation, agents and personas.',
	};
	if (args.allowTools?.length) tool.allowed_tools = args.allowTools;
	return {
		model: args.model,
		input: [{ role: 'user', content: args.prompt }],
		tools: [tool],
	};
}

export function resolveKey() {
	const fromEnv = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
	if (fromEnv) return { key: fromEnv, source: 'process.env' };
	const fromService = serviceEnvValue('GROK_API_KEY') || serviceEnvValue('XAI_API_KEY');
	if (fromService) return { key: fromService, source: 'cloud-run:three-ws-api' };
	return { key: null, source: null };
}

export function mcpCalls(output) {
	return (output || []).filter((item) => item?.type === 'mcp_call');
}

export function finalText(output) {
	return (output || [])
		.filter((item) => item?.type === 'message' && item?.role === 'assistant')
		.flatMap((item) => item.content || [])
		.filter((part) => part?.type === 'output_text')
		.map((part) => part.text || '')
		.join('\n')
		.trim();
}

export function matchesToolName(call, name) {
	return call.name === name || call.name === `${SERVER_LABEL}.${name}`;
}

async function sendRequest(body, key) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(RESPONSES_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await res.text();
		let json;
		try {
			json = JSON.parse(text);
		} catch {
			throw new Error(`xAI returned non-JSON (HTTP ${res.status}): ${text.slice(0, 500)}`);
		}
		return { status: res.status, json };
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const request = buildRequest(args);

	if (args.dryRun) {
		console.log('POST https://api.x.ai/v1/responses');
		console.log('content-type: application/json');
		console.log('authorization: Bearer <XAI_API_KEY>');
		console.log(JSON.stringify(request, null, '\t'));
		return 0;
	}

	const { key, source } = resolveKey();
	if (!key) {
		console.error('No GROK_API_KEY or XAI_API_KEY in process.env, .env/.env.local, or the three-ws-api Cloud Run service.');
		console.error('Order 927 (prompts/finish/927-x-grok-46-owner-grok-api-key.md) owns creating one.');
		console.error('Printing the dry-run request instead:');
		console.error(JSON.stringify(request, null, '\t'));
		return 1;
	}

	console.log(`sending request (key from ${source}, model ${request.model}, server ${args.server})`);
	const { status, json } = await sendRequest(request, key);

	if (status !== 200) {
		console.error(`xAI answered HTTP ${status}:`);
		console.error(JSON.stringify(json, null, '\t'));
		return 1;
	}

	const output = json.output || [];
	const calls = mcpCalls(output);
	const searchCall = calls.find((c) => matchesToolName(c, 'search_catalog'));
	const text = finalText(output);
	const urlMatch = text.match(/https?:\/\/[^\s)]*three\.ws[^\s)]*/i);

	console.log(`mcp_call items: ${calls.length} (${calls.map((c) => c.name).join(', ') || 'none'})`);
	console.log(`final text:\n${text || '(empty)'}`);

	const problems = [];
	if (!searchCall) problems.push('no mcp_call to search_catalog in response.output');
	if (!urlMatch) problems.push('final text has no three.ws viewer URL');

	if (problems.length) {
		console.error('FAILED:');
		for (const p of problems) console.error(`  - ${p}`);
		console.error('If the model never called the tool, tighten the tool description (a real defect for every agent client), not the prompt.');
		return 1;
	}

	console.log(`PASSED: search_catalog called (name "${searchCall.name}"), viewer link ${urlMatch[0]}`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error(err?.stack || String(err));
			process.exit(1);
		});
}
