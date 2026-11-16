#!/usr/bin/env node
// Verify every vision consumer with one real request on the live chain, and
// record which rung answered it.
//
//   PORT=3353 node server/index.mjs                       # local API, with the vision keys
//   DEV_API_PROXY=http://localhost:3353 npx vite --port 3252
//   node scripts/nvidia-vision-verify.mjs --base http://localhost:3252 --date 2026-11-16
//
// The vite dev server does not run api/ itself: it forwards /api/* to
// DEV_API_PROXY, which defaults to production. Without the local API server
// above, the HTTP rows would measure the deployed chain, not this checkout.
//
// Consumers with a side-effect-free HTTP route are called through the dev
// server (POST /api/vision, /api/diorama compose-photo, /api/forge-quality-check).
// The rest have no route that would not also start a GPU job or post to X, so
// their exported consumer function runs in this process against the same
// providers; a fetch wrapper records the rung each provider call went to. Needs
// the same vision keys the dev server runs with (NVIDIA_API_KEY and friends).
//
// The result table replaces the verify:begin / verify:end block of
// docs/nvidia/evals/vision-<date>.md.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = (id) => readFileSync(join(ROOT, 'data/evals/vision/images', `${id}.jpg`));
// A CC0 platform catalog thumbnail, for the consumers that take a public URL.
const PUBLIC_IMAGE_URL = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/thumbs/alarm_clock_01.png';
const VISION_HOSTS = ['integrate.api.nvidia.com', 'openrouter.ai', 'api.cloudflare.com', 'aiplatform.googleapis.com', 'api.openai.com'];

const realFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
	const u = String(url?.url || url);
	const host = VISION_HOSTS.find((h) => u.includes(h));
	if (!host || !/chat\/completions/.test(u)) return realFetch(url, opts);
	let model = null;
	try {
		model = JSON.parse(opts.body).model;
	} catch {
		model = null;
	}
	const started = Date.now();
	try {
		const res = await realFetch(url, opts);
		calls.push({ host, model, status: res.status, ms: Date.now() - started });
		return res;
	} catch (e) {
		calls.push({ host, model, status: e.name === 'TimeoutError' ? 'timeout' : 'error', ms: Date.now() - started });
		throw e;
	}
};

async function inProcess(name, consumer, fn) {
	calls = [];
	const started = Date.now();
	try {
		const out = await fn();
		return { name, consumer, via: 'in-process', ms: Date.now() - started, rungs: calls, out };
	} catch (e) {
		return { name, consumer, via: 'in-process', ms: Date.now() - started, rungs: calls, error: String(e?.message || e).slice(0, 200) };
	}
}

async function http(base, name, consumer, path, body, pick) {
	const started = Date.now();
	try {
		const res = await realFetch(`${base}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': 'three.ws-vision-eval/1.0 (https://three.ws)' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(90_000),
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) return { name, consumer, via: `dev server ${path}`, ms: Date.now() - started, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
		return { name, consumer, via: `dev server ${path}`, ms: Date.now() - started, ...pick(data) };
	} catch (e) {
		return { name, consumer, via: `dev server ${path}`, ms: Date.now() - started, error: String(e?.message || e).slice(0, 200) };
	}
}

const short = (v, n = 160) => String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, n);

function answeredBy(r) {
	if (r.provider) return `${r.provider} \`${r.model}\``;
	if (!r.rungs) return 'answered (the route does not report the rung)';
	const ok = (r.rungs || []).filter((c) => c.status === 200);
	if (!ok.length) return 'none';
	const last = ok[ok.length - 1];
	const before = (r.rungs || []).slice(0, (r.rungs || []).lastIndexOf(last)).map((c) => `${c.model} ${c.status}`);
	return `${last.host} \`${last.model}\`${before.length ? ` (after ${before.join(', ')})` : ''}`;
}

async function main() {
	const { values } = parseArgs({
		options: {
			base: { type: 'string', default: 'http://localhost:3252' },
			date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
		},
	});
	const base = values.base.replace(/\/+$/, '');
	const clock = IMG('r-alarm-clock');
	const results = [];

	results.push(await http(base, 'Image describe (public endpoint)', 'api/vision.js', '/api/vision',
		{ image: clock.toString('base64'), prompt: 'Describe this image in one sentence.' },
		(d) => ({ provider: d.provider, model: d.model, out: d.text })));

	results.push(await http(base, 'Photo to diorama plan', 'api/_lib/diorama-photo.js', '/api/diorama',
		{ action: 'compose-photo', imageBase64: `data:image/jpeg;base64,${IMG('c-apartment-granada').toString('base64')}` },
		(d) => {
			const plan = d.diorama || d.plan || d;
			const objs = plan.objects || [];
			return { provider: d.provider || plan.provider || null, model: d.model || plan.model || null, out: `mood ${plan.mood}, ground ${plan.ground}, ${objs.length} objects: ${objs.map((o) => o.label).join(', ')}` };
		}));

	results.push(await http(base, 'Forge quality gate', 'api/_lib/forge-quality-gate.js', '/api/forge-quality-check',
		{ image: IMG('r-alarm-clock').toString('base64'), imageType: 'image/jpeg', prompt: 'a vintage twin bell alarm clock' },
		(d) => ({ provider: d.verdict?.provider, model: d.verdict?.model, out: `score ${d.verdict?.score}, pass ${d.verdict?.pass}, ${d.verdict?.reason}` })));

	const { validateForgeImage } = await import('../api/_lib/forge-image-validate.js');
	results.push(await inProcess('Forge photo precheck', 'api/_lib/forge-image-validate.js', () => validateForgeImage(PUBLIC_IMAGE_URL)));

	const { generateAltText } = await import('../api/_lib/avatar-alt-text.js');
	results.push(await inProcess('Avatar alt text', 'api/_lib/avatar-alt-text.js', () => generateAltText({ imageBase64: IMG('c-samoyed-teddy').toString('base64'), mimeType: 'image/jpeg' })));

	const { detectObjectBoxes } = await import('../api/_lib/forge-objects.js');
	results.push(await inProcess('Scene object detection', 'api/_lib/forge-objects.js', () => detectObjectBoxes(PUBLIC_IMAGE_URL)));

	const { reviewImage } = await import('../api/_lib/x-mention-image3d.js');
	results.push(await inProcess('X image-to-3D review', 'api/_lib/x-mention-image3d.js', () => reviewImage(IMG('r-apple'), 'image/jpeg')));

	const { reviewProfileImage } = await import('../api/_lib/x-mention-avatar.js');
	results.push(await inProcess('X avatar review', 'api/_lib/x-mention-avatar.js', () => reviewProfileImage(IMG('c-astronaut-baker'), 'image/jpeg')));

	const { describePhoto } = await import('../api/_lib/gateway/media.js');
	results.push(await inProcess('Gateway photo describe', 'api/_lib/gateway/media.js', () => describePhoto({ buffer: IMG('r-lemon'), mimeType: 'image/jpeg', caption: 'what fruit is this?' })));

	const { inProcessTransport } = await import('../api/_lib/seed-quality.js');
	results.push(await inProcess('Catalog seed judge', 'api/_lib/seed-quality.js', () =>
		inProcessTransport().judgeRealism({ png: IMG('r-alarm-clock'), prompt: 'a vintage twin bell alarm clock', viewLabel: 'three-quarter' })));

	const L = [];
	L.push(`Verified ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC with \`node scripts/nvidia-vision-verify.mjs --base ${base} --date ${values.date}\` (dev server on port ${new URL(base).port}, its /api/* served by this checkout's server/index.mjs). Every row is one live request.`);
	L.push('');
	L.push('| Consumer | How | Answered by | Time | Output |');
	L.push('|---|---|---|---|---|');
	for (const r of results) {
		L.push(`| ${r.name} (\`${r.consumer}\`) | ${r.via} | ${r.error ? 'failed' : answeredBy(r)} | ${(r.ms / 1000).toFixed(1)} s | ${short(r.error || r.out)} |`);
	}
	const table = L.join('\n');
	console.log(table);

	const file = join(ROOT, 'docs/nvidia/evals', `vision-${values.date}.md`);
	if (existsSync(file)) {
		const doc = readFileSync(file, 'utf8');
		const begin = '<!-- verify:begin -->';
		const end = '<!-- verify:end -->';
		if (doc.includes(begin) && doc.includes(end)) {
			writeFileSync(file, doc.slice(0, doc.indexOf(begin)) + `${begin}\n${table}\n${end}` + doc.slice(doc.indexOf(end) + end.length));
			console.log(`wrote ${file}`);
		}
	}
	process.exitCode = results.some((r) => r.error) ? 1 : 0;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
