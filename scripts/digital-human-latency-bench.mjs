#!/usr/bin/env node
// Per-stage latency of the browser digital human, measured with the exact
// client and turn pipeline the page runs (src/voice/digital-human-pipeline.js),
// against a real deployment: a spoken question (WAV) goes to Riva ASR, the
// reply streams from /api/chat, and each sentence is voiced by Magpie and
// animated by Audio2Face-3D.
//
//   node scripts/digital-human-latency-bench.mjs --base https://three.ws --strategy serial --runs 20 --label before
//   node scripts/digital-human-latency-bench.mjs --base http://localhost:3266 --strategy pipelined --runs 20 --label after
//
// Every stage is measured in ms from the moment the question audio is complete
// (the visitor released the talk button). `ttsFirstAudio` is the first sound
// the visitor can hear; on the serial strategy (the page before pipelining)
// that is when the single blocking /api/a2f call returns.
//
// Options:
//   --base <origin>        deployment to measure (default http://localhost:3266)
//   --strategy <s>         pipelined | serial (default pipelined)
//   --runs <n>             turns to run (default 20)
//   --gap <ms>             pause between turns (default 2500)
//   --audio <wav>          question fixture (default data/digital-human/question-16k.wav)
//   --login                sign in with AUDIT_EMAIL / AUDIT_PASSWORD (per-account limits)
//   --kiosk-key-file <f>   send the booth key from this file (x-kiosk-key)
//   --label <name>         store the summary under this name in --out
//   --out <file>           JSON results file (default docs/digital-human-latency.json)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	createDigitalHumanClient,
	runTurn,
	summarizeTimings,
	STAGES,
	STAGE_LABELS,
} from '../src/voice/digital-human-pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
	const o = {
		base: 'http://localhost:3266',
		strategy: 'pipelined',
		runs: 20,
		gap: 2500,
		audio: path.join(ROOT, 'data/digital-human/question-16k.wav'),
		login: false,
		kioskKeyFile: null,
		label: null,
		out: path.join(ROOT, 'docs/digital-human-latency.json'),
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === '--base') o.base = next().replace(/\/$/, '');
		else if (a === '--strategy') o.strategy = next();
		else if (a === '--runs') o.runs = Number(next());
		else if (a === '--gap') o.gap = Number(next());
		else if (a === '--audio') o.audio = next();
		else if (a === '--login') o.login = true;
		else if (a === '--kiosk-key-file') o.kioskKeyFile = next();
		else if (a === '--label') o.label = next();
		else if (a === '--out') o.out = next();
		else throw new Error(`unknown option ${a}`);
	}
	if (!['pipelined', 'serial'].includes(o.strategy)) throw new Error('--strategy is pipelined or serial');
	return o;
}

async function signIn(base) {
	const email = process.env.AUDIT_EMAIL;
	const password = process.env.AUDIT_PASSWORD;
	if (!email || !password) throw new Error('--login needs AUDIT_EMAIL and AUDIT_PASSWORD in the environment');
	const res = await fetch(`${base}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: base },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
	const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
	if (!cookies.length) throw new Error('login returned no session cookie');
	return cookies.join('; ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bench(opts) {
	const headers = { origin: opts.base };
	if (opts.login) headers.cookie = await signIn(opts.base);
	if (opts.kioskKeyFile) headers['x-kiosk-key'] = readFileSync(opts.kioskKeyFile, 'utf8').trim();
	const client = createDigitalHumanClient({ origin: opts.base, headers });
	const audio = new Uint8Array(readFileSync(opts.audio));

	const runs = [];
	for (let i = 0; i < opts.runs; i++) {
		const t0 = performance.now();
		let out;
		try {
			out = await runTurn({
				client,
				audio,
				strategy: opts.strategy,
				systemPrompt:
					'You are a friendly 3D digital human talking out loud. Answer in one to three short spoken sentences, no markdown.',
				sink: {},
				t0,
				now: () => performance.now(),
			});
		} catch (err) {
			out = { timings: {}, lanes: [], degraded: 'error', errors: [{ code: err.code, message: err.message }] };
		}
		const ok = !out.failedStage && out.degraded !== 'error' && out.degraded !== 'llm';
		runs.push({ ok, timings: out.timings, lanes: out.lanes, degraded: out.degraded, errors: out.errors });
		const t = out.timings;
		console.log(
			`run ${String(i + 1).padStart(2)} ${ok ? 'ok ' : 'ERR'} asr ${t.asrText ?? '-'} llm1 ${t.llmFirstToken ?? '-'} audio1 ${t.ttsFirstAudio ?? '-'} face1 ${t.a2fFirstFrame ?? '-'} done ${t.total ?? '-'} lanes ${[...new Set(out.lanes)].join(',') || '-'}${ok ? '' : ` ${JSON.stringify(out.errors?.[0] || out.failedStage)}`}`,
		);
		if (i < opts.runs - 1) await sleep(opts.gap);
	}
	const good = runs.filter((r) => r.ok).map((r) => r.timings);
	return {
		base: opts.base,
		strategy: opts.strategy,
		at: new Date().toISOString(),
		runs: runs.length,
		succeeded: good.length,
		summary: summarizeTimings(good),
		samples: runs,
	};
}

function printSummary(r) {
	console.log(`\n${r.base} · ${r.strategy} · ${r.succeeded}/${r.runs} turns ok (ms from end of speech)`);
	for (const s of STAGES) {
		const v = r.summary[s];
		console.log(`  ${STAGE_LABELS[s].padEnd(22)} p50 ${String(v.p50 ?? '-').padStart(6)}   p95 ${String(v.p95 ?? '-').padStart(6)}   n ${v.n}`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const opts = parseArgs(process.argv.slice(2));
	const result = await bench(opts);
	printSummary(result);
	if (opts.label) {
		const all = existsSync(opts.out) ? JSON.parse(readFileSync(opts.out, 'utf8')) : {};
		all[opts.label] = result;
		writeFileSync(opts.out, `${JSON.stringify(all, null, '\t')}\n`);
		console.log(`\nstored as "${opts.label}" in ${path.relative(ROOT, opts.out)}`);
	}
	process.exit(result.succeeded ? 0 : 1);
}
