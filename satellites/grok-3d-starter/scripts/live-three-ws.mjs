#!/usr/bin/env node
// Live check of the three.ws half, with no xAI key needed. It sends the same
// MCP calls Grok sends through the server (same URL, same key, same tools)
// and follows renders with the server's own followJob, then prints a link
// that opens the finished model on this starter's page.
//
//   THREE_WS_API_KEY=sk_live_... npm run live:three-ws
//   npm run live:three-ws -- --quick           catalog + sign-in check only
//   npm run live:three-ws -- --capture DIR     also write each raw MCP answer to DIR
//
// The key is read from the environment or .env and is never printed.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { followJob } from '../lib/chat.mjs';
import { ALLOWED_TOOLS, loadConfig, missingKeys } from '../lib/config.mjs';
import { mapToolProblem } from '../lib/errors.mjs';
import { callTool, listTools } from '../lib/mcp.mjs';
import { interpretToolResult } from '../lib/tool-results.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const captureIndex = args.indexOf('--capture');
const captureDir = captureIndex >= 0 ? resolve(args[captureIndex + 1] || 'captures') : null;

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const config = loadConfig();
if (missingKeys(config).some((m) => m.name === 'THREE_WS_API_KEY')) {
	console.error('THREE_WS_API_KEY is missing or malformed. Create one at https://three.ws/dashboard/api-keys (a free account is enough).');
	process.exit(2);
}

const started = Date.now();
const seconds = () => Math.round((Date.now() - started) / 1000);
const log = (line) => console.log(`[${String(seconds()).padStart(4)}s] ${line}`);
const report = { mcpUrl: config.mcpUrl, steps: [] };

// Wrap fetch so --capture can keep each raw answer, exactly as it arrived.
let lastRaw = null;
async function recordingFetch(url, init) {
	const res = await fetch(url, init);
	const text = await res.clone().text();
	lastRaw = { status: res.status, body: text };
	return res;
}

async function capture(name, meta) {
	if (!captureDir || !lastRaw) return;
	await mkdir(captureDir, { recursive: true });
	const header = {
		_fixture: {
			source: 'captured',
			from: `${config.mcpUrl} ${meta.method}${meta.tool ? ` ${meta.tool}` : ''}`,
			capturedAt: new Date().toISOString(),
			by: 'scripts/live-three-ws.mjs',
			httpStatus: lastRaw.status,
			...(meta.note ? { note: meta.note } : {}),
		},
	};
	let body;
	try {
		body = JSON.parse(lastRaw.body);
	} catch {
		body = { raw: lastRaw.body };
	}
	await writeFile(join(captureDir, `${name}.json`), `${JSON.stringify({ ...header, response: body }, null, '\t')}\n`);
	log(`  captured ${name}.json`);
}

async function call(tool, toolArgs, { apiKey = config.threeWsApiKey } = {}) {
	const raw = await callTool({ url: config.mcpUrl, apiKey, name: tool, args: toolArgs, fetchImpl: recordingFetch, signal: AbortSignal.timeout(120_000) });
	return interpretToolResult({ name: tool, output: raw });
}

function emit(event, data) {
	if (event === 'job') {
		const pct = Number.isFinite(data.progress) ? `${Math.round(data.progress <= 1 ? data.progress * 100 : data.progress)}%` : '';
		log(`  render ${data.phase || 'running'} ${pct}`.trimEnd());
	} else if (event === 'notice') {
		log(`  note: ${data.message}`);
	}
}

async function forgeAndFollow(step, tool, toolArgs) {
	const t0 = Date.now();
	log(`${step}: ${tool} ${JSON.stringify(toolArgs)}`);
	let result = await call(tool, toolArgs);
	await capture(`${step}-start`, { method: 'tools/call', tool });
	const problem = mapToolProblem(result);
	if (problem) throw problem;
	if (result.kind === 'pending') {
		log(`  pending, job ${result.jobId.slice(0, 16)}...; following with get_job`);
		const outcome = await followJob({ config, job: result, emit, fetchImpl: recordingFetch });
		if (outcome.status !== 'done') throw new Error(`${tool} ${outcome.status}: ${outcome.message || 'no model'}`);
		await capture(`${step}-done`, { method: 'tools/call', tool: 'get_job' });
		result = outcome.model;
	}
	if (result.kind !== 'model') throw new Error(`${tool} returned ${result.kind}, not a model`);
	const entry = { step, tool, seconds: Math.round((Date.now() - t0) / 1000), glbUrl: result.glbUrl, viewerUrl: result.viewerUrl };
	report.steps.push(entry);
	log(`  model: ${result.glbUrl}`);
	return { ...result, prompt: result.prompt || toolArgs.prompt || toolArgs.instruction };
}

try {
	log(`tools/list on ${config.mcpUrl}`);
	const tools = await listTools({ url: config.mcpUrl, apiKey: config.threeWsApiKey, fetchImpl: recordingFetch, signal: AbortSignal.timeout(30_000) });
	await capture('tools-list', { method: 'tools/list' });
	const names = new Set(tools.map((t) => t.name));
	const missing = ALLOWED_TOOLS.filter((name) => !names.has(name));
	if (missing.length) throw new Error(`the MCP server does not offer: ${missing.join(', ')}`);
	report.steps.push({ step: 'tools', allowed: ALLOWED_TOOLS, offered: names.size });
	log(`  all ${ALLOWED_TOOLS.length} allowed tools are offered (${names.size} tools in total)`);

	log('search_catalog {"q":"wooden chair"}');
	const catalog = await call('search_catalog', { q: 'wooden chair', limit: 6 });
	await capture('search-catalog', { method: 'tools/call', tool: 'search_catalog' });
	if (catalog.kind !== 'catalog' || !catalog.items.length) throw new Error(`search_catalog returned ${catalog.kind}`);
	report.steps.push({ step: 'catalog', items: catalog.items.length, first: catalog.items[0].glbUrl });
	log(`  ${catalog.items.length} matches; first: ${catalog.items[0].title}`);

	log('forge_free without a key (expect sign_in_required)');
	const anon = await call('forge_free', { prompt: 'a small wooden stool', tier: 'draft' }, { apiKey: '' });
	await capture('forge-free-sign-in-required', { method: 'tools/call', tool: 'forge_free', note: 'sent with no Authorization header' });
	const signIn = mapToolProblem(anon);
	if (signIn?.code !== 'three_ws_sign_in') throw new Error(`expected sign_in_required, got ${anon.kind}`);
	report.steps.push({ step: 'sign_in_required', mapped: signIn.code });
	log(`  mapped to ${signIn.code}: "${signIn.title}"`);

	let last = { glbUrl: catalog.items[0].glbUrl, viewerUrl: catalog.items[0].viewerUrl, prompt: catalog.items[0].title };
	if (!quick) {
		const robot = await forgeAndFollow('forge', 'forge_free', { prompt: 'A friendly round robot mascot in glossy white plastic', tier: 'draft' });
		last = await forgeAndFollow('refine', 'refine_model', { glb_url: robot.glbUrl, instruction: 'make it chrome', parent_prompt: 'A friendly round robot mascot in glossy white plastic' });
		last.prompt = 'Robot mascot: make it chrome';
	}

	const port = config.port === 8080 && process.env.PORT === undefined ? 8080 : config.port;
	const page = `http://localhost:${port}/?glb=${encodeURIComponent(last.glbUrl)}&label=${encodeURIComponent(last.prompt || 'Model')}${last.viewerUrl ? `&viewer=${encodeURIComponent(last.viewerUrl)}` : ''}`;
	report.pageUrl = page;
	report.seconds = seconds();
	log(`done in ${report.seconds}s. Open on the stage: ${page}`);
	if (captureDir) await writeFile(join(captureDir, 'live-report.json'), `${JSON.stringify(report, null, '\t')}\n`);
	console.log(JSON.stringify(report));
} catch (err) {
	console.error(`live check failed: ${err.title ? `${err.title}: ` : ''}${err.message}`);
	process.exit(1);
}
