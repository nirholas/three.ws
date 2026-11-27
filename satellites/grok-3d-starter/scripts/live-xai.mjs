#!/usr/bin/env node
// The full live run: Grok over the xAI Responses API calls the three.ws MCP
// server, a model renders, then a follow-up refines that same model. It runs
// the server's real chat turn (runTurn) twice, exactly as the page does, and
// records every raw xAI stream event so the documented fixture can be replaced
// by a capture. Needs both keys in the environment or .env; neither is printed.
//
//   npm run live:xai
//   npm run live:xai -- --capture DIR    also write the raw xAI rounds to DIR
//   npm run live:xai -- --prompt "a red fire hydrant" --follow-up "make it gold"

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTurn } from '../lib/chat.mjs';
import { XAI_RESPONSES_URL, loadConfig, missingKeys } from '../lib/config.mjs';
import { toAppError } from '../lib/errors.mjs';
import { toolLogLine } from '../lib/tool-log.mjs';
import { visitorId } from '../lib/xai.mjs';
import { readSSE } from '../shared/sse.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const captureDir = args.includes('--capture') ? resolve(option('--capture', 'captures')) : null;
const prompt = option('--prompt', 'A friendly round robot mascot in glossy white plastic');
const followUp = option('--follow-up', 'make it chrome');

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const config = loadConfig(process.env);
const missing = missingKeys(config);
if (missing.length) {
	for (const m of missing) console.error(`${m.name} is ${m.problem}. Create one at ${m.url} and add ${m.name}=... to .env.`);
	process.exit(2);
}

const started = Date.now();
const elapsed = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
const log = (line) => console.log(`[${elapsed()}] ${line}`);

// Every xAI stream is teed: one branch feeds the app, the other is recorded.
const rounds = [];
async function recordingFetch(url, init) {
	const res = await fetch(url, init);
	if (String(url) !== XAI_RESPONSES_URL || !res.ok || !res.body) return res;
	const [forApp, forRecord] = res.body.tee();
	const events = [];
	rounds.push(events);
	(async () => {
		for await (const sse of readSSE(forRecord)) {
			if (sse.data === '[DONE]') break;
			try {
				events.push(JSON.parse(sse.data));
			} catch {
				events.push({ unparsed: sse.data });
			}
		}
	})();
	return new Response(forApp, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function turn(label, input) {
	log(`${label}: ${input.message}`);
	const models = [];
	const emit = (event, data) => {
		if (event === 'tool') log(`  ${toolLogLine(data)}`);
		else if (event === 'tool_result') log(`  result ${data.name}: ${data.kind}`);
		else if (event === 'job') log(`  render ${data.status || 'started'} ${data.progress ?? ''}`);
		else if (event === 'model') {
			models.push(data);
			log(`  model ${data.glbUrl}`);
		} else if (event === 'notice') log(`  notice ${data.message}`);
	};
	const { responseId } = await runTurn({ config, input, emit, fetchImpl: recordingFetch, safetyIdentifier: visitorId('live-xai-script') });
	return { responseId, model: models.at(-1) || null, seconds: Math.round((Date.now() - started) / 1000) };
}

let first;
let second;
try {
	first = await turn('prompt', { message: prompt, previousResponseId: null, stage: null });
	if (!first.model) throw new Error('Grok finished the first turn without a model on the stage.');
	second = await turn('follow-up', { message: followUp, previousResponseId: first.responseId, stage: { glbUrl: first.model.glbUrl, label: prompt.slice(0, 80) } });
	if (!second.model || second.model.glbUrl === first.model.glbUrl) throw new Error('The follow-up did not produce a new model.');
} catch (err) {
	const e = toAppError(err);
	console.error(`FAIL: ${e.title}: ${e.message}${e.fix ? `\n${e.fix}` : ''}`);
	process.exit(1);
}

if (captureDir) {
	await mkdir(captureDir, { recursive: true });
	const fixture = {
		_fixture: {
			source: 'captured',
			from: `POST ${XAI_RESPONSES_URL} (stream: true) via runTurn, model ${config.model}`,
			capturedAt: new Date().toISOString(),
			by: 'scripts/live-xai.mjs',
			prompt,
			followUp,
		},
		rounds,
	};
	await writeFile(join(captureDir, 'responses-stream-live.json'), `${JSON.stringify(fixture, null, '\t')}\n`);
	log(`captured ${rounds.length} xAI rounds to ${join(captureDir, 'responses-stream-live.json')}`);
}

const page = `http://localhost:${config.port}/?glb=${encodeURIComponent(second.model.glbUrl)}`;
console.log(JSON.stringify({ model: config.model, rounds: rounds.length, first, second, page }, null, 2));
console.log(`PASS in ${Math.round((Date.now() - started) / 1000)}s: a model, then "${followUp}" refined it.`);
