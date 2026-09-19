#!/usr/bin/env node
// Feature-trial driver for MCP servers we ship on npm.
//
// A post that says "any AI agent can do X over MCP" is only true if a stock MCP
// client can install the PUBLISHED package, start it over stdio, and get a real
// answer to tools/call against production. This does exactly that, the way a
// reader's assistant would, and exits non-zero unless every answer is the one
// the post promises. Trial specs (data/x-content/trials/<id>.json) run it as a
// `command` step.
//
//   node scripts/x-content-mcp-call.mjs [--login] <npm spec> '<plan json>'
//
// The plan is an array of calls made in order over ONE server session:
//
//   { "tool": "get_wallet_portfolio",
//     "args": { "wallet": "..." },
//     "expect": "d.ok && d.portfolio_value_usd > 0",   // JS over d, the parsed result
//     "until": { "timeoutMs": 600000, "intervalMs": 30000 },   // optional: repeat until expect holds
//     "always": true }                                  // optional: run even after a failure (cleanup)
//
// A string argument of the form "$N.path.to.value" is replaced with that value
// from the result of call N (0-based), so a created id can be read back and
// deleted. `d` is the tool's structuredContent, else its text parsed as JSON.
//
// --login signs in to production as the QA account (AUDIT_EMAIL / AUDIT_PASSWORD
// from .env, see docs/ops/page-audit.md) and hands the session to the server as
// THREE_WS_SESSION, for account-scoped servers. The session is never printed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE = process.env.THREE_WS_BASE || 'https://three.ws';
const argv = process.argv.slice(2);
const login = argv[0] === '--login';
const [spec, rawPlan] = login ? argv.slice(1) : argv;
if (!spec || !rawPlan) {
	console.error("usage: x-content-mcp-call.mjs [--login] <npm spec> '<plan json>'");
	process.exit(2);
}
const plan = JSON.parse(rawPlan);

const pathValue = (value, path) => path.split('.').reduce((node, key) => (node == null ? node : node[key]), value);

function dotEnv(name) {
	if (process.env[name]) return process.env[name];
	try {
		const line = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n').find((row) => row.startsWith(`${name}=`));
		return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
	} catch {
		return '';
	}
}

async function qaSession() {
	const email = dotEnv('AUDIT_EMAIL');
	const password = dotEnv('AUDIT_PASSWORD');
	if (!email || !password) throw new Error('--login needs AUDIT_EMAIL and AUDIT_PASSWORD in .env; run `npm run audit:web:provision`');
	const response = await fetch(`${BASE}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'user-agent': 'three.ws feature trial' },
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok) throw new Error(`QA login answered HTTP ${response.status}`);
	const cookie = response.headers.getSetCookie().find((row) => row.startsWith('__Host-sid='));
	if (!cookie) throw new Error('QA login set no __Host-sid cookie');
	return cookie.split(';')[0].slice('__Host-sid='.length);
}

function resolveArgs(args, results) {
	return JSON.parse(JSON.stringify(args ?? {}), (_key, value) =>
		typeof value === 'string' && /^\$\d+\./.test(value) ? pathValue(results[Number(value.slice(1, value.indexOf('.')))], value.slice(value.indexOf('.') + 1)) : value,
	);
}

function parseResult(result) {
	if (result.structuredContent) return result.structuredContent;
	const text = (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
	try {
		return JSON.parse(text);
	} catch {
		return { text };
	}
}

async function runCall(client, call, results) {
	const holds = new Function('d', `return (${call.expect || 'true'});`);
	const deadline = Date.now() + (call.until?.timeoutMs || 0);
	for (;;) {
		const result = await client.callTool({ name: call.tool, arguments: resolveArgs(call.args, results) }, undefined, { timeout: 120_000 });
		const data = parseResult(result);
		const summary = JSON.stringify(data).slice(0, 400);
		const ok = !result.isError && holds(data);
		if (ok) return { data, summary };
		if (!call.until || Date.now() + (call.until.intervalMs || 30_000) > deadline) {
			throw new Error(`${call.tool} ${result.isError ? 'answered an error' : `does not satisfy ${call.expect}`}: ${summary}`);
		}
		await new Promise((wait) => setTimeout(wait, call.until.intervalMs || 30_000));
	}
}

const env = { ...process.env };
let client;
let failure = null;
try {
	if (login) env.THREE_WS_SESSION = await qaSession();
	client = new Client({ name: 'three-ws-feature-trial', version: '1.0.0' });
	await client.connect(new StdioClientTransport({ command: 'npx', args: ['-y', spec], env, stderr: 'pipe' }));
	const { tools } = await client.listTools();
	const missing = plan.map((call) => call.tool).filter((name) => !tools.some((row) => row.name === name));
	if (missing.length) throw new Error(`${spec} does not expose ${missing.join(', ')}`);
	const results = [];
	for (const [index, call] of plan.entries()) {
		if (failure && !call.always) continue;
		const started = Date.now();
		try {
			const { data, summary } = await runCall(client, call, results);
			results[index] = data;
			console.log(`ok ${call.tool} (${Math.round((Date.now() - started) / 1000)}s): ${summary}`);
		} catch (err) {
			failure ||= err;
			console.error(`FAILED ${err.message}`);
		}
	}
} catch (err) {
	failure ||= err;
	console.error(`FAILED ${err.message}`);
} finally {
	await client?.close().catch(() => {});
}
process.exitCode = failure ? 1 : 0;
