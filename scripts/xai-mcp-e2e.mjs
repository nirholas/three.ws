#!/usr/bin/env node
// Prove a Grok model can find and call three.ws over xAI's Responses API.
//
// xAI's Responses API takes a remote MCP server as a tool
// (https://docs.x.ai/developers/tools/remote-mcp): `type: "mcp"`, `server_url`,
// `server_label`, optional `server_description` and `allowed_tools`. xAI connects
// to our server from its cloud and runs the tool calls itself, which is the same
// mechanic Grok Bot's custom connector uses. This script sends one request per
// surface with the instruction "find a ready-made chair in the three.ws catalog
// and give me its viewer link" and asserts that:
//
//   1. the response records an MCP call to search_catalog, and
//   2. the final text carries a three.ws viewer URL.
//
//   npm run e2e:xai-mcp                       # mcp-studio and mcp-grok
//   npm run e2e:xai-mcp -- --server studio    # one surface (studio | grok)
//   npm run e2e:xai-mcp -- --dry-run          # print the exact requests, send nothing
//   npm run e2e:xai-mcp -- --base https://three.ws --model grok-4.7 --json out.json
//
// The key is GROK_API_KEY or XAI_API_KEY from the environment, .env.local or .env.
// It is only ever sent to api.x.ai and never printed.
//
// Exit codes: 0 every surface passed (or a dry run), 1 an assertion failed,
// 2 no key or a transport error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GROK_MODELS, XAI_API_BASE } from '../api/_lib/chat-models.js';

const RESPONSES_URL = `${XAI_API_BASE}/responses`;
const PROMPT = 'Find a ready-made chair in the three.ws catalog and give me its viewer link.';
const TOOL = 'search_catalog';
const SERVERS = {
	studio: { path: '/api/mcp-studio', label: 'three-ws-studio', description: 'Free three.ws 3D studio: search the CC0 catalog, generate models and avatars.' },
	grok: { path: '/api/mcp-grok', label: 'three-ws-grok', description: 'three.ws for Grok Bot: search the CC0 catalog, generate models and avatars, give Grok a talking body.' },
};
const VIEWER_URL = /https:\/\/(?:www\.)?three\.ws\/(?:[a-z0-9/_-]*\/)?viewer[^\s)"'\]<>]*/i;
const TIMEOUT_MS = 240_000;

const { values: opts } = parseArgs({
	options: {
		base: { type: 'string', default: 'https://three.ws' },
		server: { type: 'string', default: 'all' },
		model: { type: 'string' },
		'dry-run': { type: 'boolean', default: false },
		json: { type: 'string' },
	},
});

const model = opts.model || GROK_MODELS.find((m) => m.tier === 'flagship' && m.tools)?.id || GROK_MODELS[0].id;
const surfaces = opts.server === 'all' ? Object.keys(SERVERS) : opts.server.split(',');
for (const s of surfaces) {
	if (!SERVERS[s]) {
		console.error(`unknown --server "${s}" (use studio, grok or all)`);
		process.exit(2);
	}
}

function readEnvFile(file) {
	const path = resolve(file);
	if (!existsSync(path)) return {};
	const out = {};
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
	}
	return out;
}

function findKey() {
	const files = { ...readEnvFile('.env'), ...readEnvFile('.env.local') };
	for (const name of ['GROK_API_KEY', 'XAI_API_KEY']) {
		const v = process.env[name] || files[name];
		if (v) return v;
	}
	return null;
}

// The exact body POSTed to /v1/responses. Field names follow the xAI remote MCP
// page: allowed_tools narrows what the model sees to the one tool under test.
function buildRequest(surface) {
	const s = SERVERS[surface];
	return {
		model,
		input: [{ role: 'user', content: PROMPT }],
		tools: [
			{
				type: 'mcp',
				server_url: new URL(s.path, opts.base).href,
				server_label: s.label,
				server_description: s.description,
			},
		],
	};
}

// Tool calls recorded in a Responses output. xAI runs MCP calls server side and
// lists them as output items; the name may carry the server label as a prefix.
function mcpCalls(response) {
	const calls = [];
	for (const item of response.output || []) {
		const type = String(item.type || '');
		if (!/call/.test(type) || type === 'reasoning') continue;
		const name = String(item.name || item.function?.name || item.tool_name || '');
		if (name) calls.push({ type, name, label: item.server_label || null, arguments: item.arguments ?? item.function?.arguments ?? null });
	}
	return calls;
}

function outputText(response) {
	if (typeof response.output_text === 'string' && response.output_text) return response.output_text;
	return (response.output || [])
		.filter((item) => item.type === 'message')
		.flatMap((item) => item.content || [])
		.filter((part) => part.type === 'output_text' || part.type === 'text')
		.map((part) => part.text)
		.join('\n');
}

async function send(key, body) {
	const res = await fetch(RESPONSES_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`xAI answered ${res.status}: ${json?.error?.message || json?.error || JSON.stringify(json).slice(0, 300)}`);
	return json;
}

function judge(response) {
	const calls = mcpCalls(response);
	const usedSearch = calls.some((c) => c.name === TOOL || c.name.endsWith(`.${TOOL}`) || c.name.endsWith(`_${TOOL}`) || c.name.endsWith(`-${TOOL}`) || c.name.endsWith(`__${TOOL}`));
	const text = outputText(response);
	const viewer = text.match(VIEWER_URL)?.[0] ?? null;
	const failures = [];
	if (!usedSearch) failures.push(`no MCP call to ${TOOL} (calls: ${calls.map((c) => c.name).join(', ') || 'none'})`);
	if (!viewer) failures.push('the final text has no three.ws viewer URL');
	return { calls, text, viewer, failures };
}

async function main() {
	if (opts['dry-run']) {
		for (const s of surfaces) console.log(`POST ${RESPONSES_URL}\nauthorization: Bearer <GROK_API_KEY or XAI_API_KEY>\n${JSON.stringify(buildRequest(s), null, 2)}\n`);
		if (!findKey()) console.log('No xAI key found in the environment, .env.local, .env or on the Cloud Run service. Order 927 (prompts/finish/927-x-grok-46-owner-grok-api-key.md) supplies it; then run this without --dry-run.');
		return 0;
	}
	const key = findKey();
	if (!key) {
		console.error('No GROK_API_KEY or XAI_API_KEY found. Order 927 supplies the key; use --dry-run to see the request.');
		return 2;
	}
	const report = { model, startedAt: new Date().toISOString(), results: [] };
	let code = 0;
	for (const s of surfaces) {
		const t0 = Date.now();
		try {
			const response = await send(key, buildRequest(s));
			const verdict = judge(response);
			report.results.push({ surface: s, ok: !verdict.failures.length, ms: Date.now() - t0, calls: verdict.calls, viewer: verdict.viewer, failures: verdict.failures, text: verdict.text.slice(0, 1500), usage: response.usage?.server_side_tool_usage_details ?? null });
			console.log(`${verdict.failures.length ? 'FAIL' : 'ok  '} ${s.padEnd(7)} ${Date.now() - t0} ms  calls=[${verdict.calls.map((c) => c.name).join(', ')}]  ${verdict.viewer || ''}`);
			for (const f of verdict.failures) console.log(`       ${f}`);
			if (verdict.failures.length) code = Math.max(code, 1);
		} catch (err) {
			report.results.push({ surface: s, ok: false, ms: Date.now() - t0, error: err.message });
			console.error(`ERR  ${s}: ${err.message}`);
			code = 2;
		}
	}
	if (opts.json) {
		const out = resolve(opts.json);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify(report, null, '\t') + '\n');
	}
	return code;
}

process.exit(await main());
