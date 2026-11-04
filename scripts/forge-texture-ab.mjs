#!/usr/bin/env node
// A/B harness: run the same meshes through the SDXL texture worker and the
// UltraTex worker, record what each really returned, and write
// docs/research/forge-texture-ab.md from the measured results only.
//
// Usage:
//   node scripts/forge-texture-ab.mjs --manifest meshes.json \
//     --sdxl-url https://... --ultratex-url https://... --key <bearer> \
//     [--scorer "python3 score.py {glb} {prompt} {out_dir}"] [--out-dir ab-out] [--write-doc]
//
// meshes.json: [{ "id": "chair", "mesh": "https://.../chair.glb", "prompt": "weathered oak chair" }, ...]
// (20 entries for the full study). --scorer is any argv template run once per
// result GLB; it must print one JSON object on stdout:
//   { "clip": <number>, "consistency": <number>, "views": ["front.png", ...] }
// where views are the 4 saved renders. Without --scorer the report states that
// no quality metric was computed; nothing is ever estimated or filled in.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);

export function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) out[key] = true;
		else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

export function mean(xs) {
	const v = xs.filter((x) => Number.isFinite(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function summarize(rows) {
	const done = rows.filter((r) => r.status === 'done');
	return {
		runs: rows.length,
		done: done.length,
		failed: rows.length - done.length,
		meanElapsedMs: mean(done.map((r) => r.elapsedMs)),
		meanClip: mean(done.map((r) => r.score?.clip)),
		meanConsistency: mean(done.map((r) => r.score?.consistency)),
		scored: done.filter((r) => r.score).length,
	};
}

export function renderReport({ date, workers, summaries, rows, scorerUsed }) {
	const fmt = (n, d = 2) => (n == null ? 'not measured' : Number(n).toFixed(d));
	const lines = [
		'# Forge texture A/B: SDXL worker vs UltraTex',
		'',
		`Run on ${date}. Every number below was produced by \`scripts/forge-texture-ab.mjs\` against the workers listed; nothing is estimated.`,
		'',
		`Scorer: ${scorerUsed ? 'external scorer supplied (CLIP score and cross-view consistency per result)' : 'none supplied, so only completion and latency are recorded; no quality claim is made'}.`,
		'',
		'| Worker | Runs | Completed | Failed | Mean seconds | Mean CLIP | Mean consistency |',
		'|---|---|---|---|---|---|---|',
	];
	for (const w of workers) {
		const s = summaries[w];
		lines.push(`| ${w} | ${s.runs} | ${s.done} | ${s.failed} | ${s.meanElapsedMs == null ? 'not measured' : fmt(s.meanElapsedMs / 1000, 1)} | ${fmt(s.meanClip, 3)} | ${fmt(s.meanConsistency, 3)} |`);
	}
	lines.push('', '## Per mesh', '', '| Mesh | Worker | Status | Seconds | CLIP | Consistency | Error |', '|---|---|---|---|---|---|---|');
	for (const r of rows) {
		lines.push(`| ${r.id} | ${r.worker} | ${r.status} | ${r.elapsedMs == null ? '-' : (r.elapsedMs / 1000).toFixed(1)} | ${fmt(r.score?.clip, 3)} | ${fmt(r.score?.consistency, 3)} | ${r.error ? String(r.error).replace(/\|/g, '/').slice(0, 120) : ''} |`);
	}
	return lines.join('\n') + '\n';
}

async function call(url, path, key, init = {}) {
	const res = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
		...init,
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers || {}) },
	});
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = { raw: text.slice(0, 300) };
	}
	return { status: res.status, body };
}

async function runOne({ url, key, item, timeoutMs }) {
	const t0 = Date.now();
	const submit = await call(url, '/texture', key, {
		method: 'POST',
		body: JSON.stringify({ mesh: item.mesh, prompt: item.prompt, num_views: 8, texture_size: 1024 }),
	});
	if (submit.status !== 202) {
		const detail = submit.body?.detail;
		return { status: 'failed', error: `submit HTTP ${submit.status} ${typeof detail === 'string' ? detail : detail?.error || ''}`.trim(), elapsedMs: Date.now() - t0 };
	}
	const taskId = submit.body.task_id;
	while (Date.now() - t0 < timeoutMs) {
		await new Promise((r) => setTimeout(r, 5000));
		const poll = await call(url, `/tasks/${taskId}`, key);
		if (poll.body?.status === 'done') return { status: 'done', resultUrl: poll.body.result_url, bytes: poll.body.bytes, elapsedMs: Date.now() - t0 };
		if (poll.body?.status === 'failed') return { status: 'failed', error: poll.body.error, elapsedMs: Date.now() - t0 };
	}
	return { status: 'failed', error: `no terminal status within ${timeoutMs / 1000}s`, elapsedMs: Date.now() - t0 };
}

async function score({ scorer, glbPath, prompt, outDir }) {
	const argv = scorer.split(/\s+/).map((p) => p.replace('{glb}', glbPath).replace('{prompt}', prompt).replace('{out_dir}', outDir));
	const { stdout } = await run(argv[0], argv.slice(1), { maxBuffer: 1 << 20, timeout: 600000 });
	return JSON.parse(stdout);
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	for (const need of ['manifest', 'sdxl-url', 'ultratex-url', 'key']) {
		if (!a[need] || a[need] === true) {
			console.error(`missing --${need}`);
			process.exit(2);
		}
	}
	const items = JSON.parse(await readFile(a.manifest, 'utf8'));
	const outDir = a['out-dir'] && a['out-dir'] !== true ? a['out-dir'] : 'ab-out';
	await mkdir(outDir, { recursive: true });
	const workers = { sdxl: a['sdxl-url'], ultratex: a['ultratex-url'] };
	const rows = [];
	for (const item of items) {
		for (const [worker, url] of Object.entries(workers)) {
			const r = await runOne({ url, key: a.key, item, timeoutMs: 600000 });
			const row = { id: item.id, worker, ...r };
			if (r.status === 'done') {
				const res = await fetch(r.resultUrl);
				if (res.ok) {
					const dir = join(outDir, item.id, worker);
					await mkdir(dir, { recursive: true });
					const glbPath = join(dir, 'result.glb');
					await writeFile(glbPath, Buffer.from(await res.arrayBuffer()));
					if (a.scorer && a.scorer !== true) {
						try {
							row.score = await score({ scorer: a.scorer, glbPath, prompt: item.prompt, outDir: dir });
						} catch (err) {
							row.scoreError = err.message;
						}
					}
				} else {
					row.status = 'failed';
					row.error = `result download HTTP ${res.status}`;
				}
			}
			console.log(`${item.id} ${worker}: ${row.status}${row.error ? ` (${row.error})` : ''}`);
			rows.push(row);
		}
	}
	const summaries = Object.fromEntries(Object.keys(workers).map((w) => [w, summarize(rows.filter((r) => r.worker === w))]));
	await writeFile(join(outDir, 'results.json'), JSON.stringify({ rows, summaries }, null, 2));
	const report = renderReport({ date: new Date().toISOString().slice(0, 10), workers: Object.keys(workers), summaries, rows, scorerUsed: Boolean(a.scorer && a.scorer !== true) });
	if (a['write-doc']) await writeFile('docs/research/forge-texture-ab.md', report);
	else console.log('\n' + report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
