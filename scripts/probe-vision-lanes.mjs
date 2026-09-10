#!/usr/bin/env node
// Probe every free vision route with the payload the pipeline actually sends,
// and rank them by whether they return parseable JSON and how fast.
//
// Why this exists: the vision chain's lane order was a guess, and a guess is how
// a rung that answers HTTP 200 with an empty message.content sat at the front of
// the chain eating a slice of every request's deadline. A model list is only as
// good as the payload it was checked against, so this sends the real thing: an
// image plus a scoring rubric that demands a JSON object back.
//
//   node scripts/probe-vision-lanes.mjs                  # OpenRouter free routes
//   node scripts/probe-vision-lanes.mjs --all            # also re-probe configured lanes
//   node scripts/probe-vision-lanes.mjs --image <url>
//
// Needs OPENROUTER_API_KEY. On a machine without it:
//   OPENROUTER_API_KEY=$(node scripts/read-service-env.mjs '^OPENROUTER_API_KEY$' --raw) \
//     node scripts/probe-vision-lanes.mjs
//
// Output is a table ordered best-first. Feed that order straight back into
// OPENROUTER_VISION_MODELS in api/_lib/vision.js.

import { parseArgs } from 'node:util';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_IMAGE = 'https://three.ws/partners/openai/social-card-studio.png';
const PER_LANE_TIMEOUT_MS = 30_000;

// The shape api/_lib/forge-quality-gate.js asks for. Anything that cannot answer
// this cannot serve the quality gate, whatever it scores on a toy prompt.
const RUBRIC = [
	'You are scoring a render of a generated 3D asset.',
	'Judge realism, completeness, and visible defects.',
	'Reply with ONLY a JSON object, no prose and no code fence:',
	'{"score":<0-100>,"realism":<0-100>,"completeness":<0-100>,"defects":[<strings>],"reason":"<one sentence>"}',
].join(' ');

const { values } = parseArgs({
	options: {
		image: { type: 'string', default: DEFAULT_IMAGE },
		all: { type: 'boolean', default: false },
		json: { type: 'boolean', default: false },
	},
	strict: false,
});

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
	console.error('OPENROUTER_API_KEY is not set. See the header of this file for how to resolve it.');
	process.exit(2);
}

/** Same tolerance the runtime applies, so a pass here means a pass there. */
function parseJsonLoose(text) {
	const trimmed = String(text || '').trim();
	const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	const start = fenced.search(/[[{]/);
	const candidate = start >= 0 ? fenced.slice(start) : fenced;
	try {
		return JSON.parse(candidate);
	} catch {
		const m = candidate.match(/[{[][\s\S]*[}\]]/);
		if (m) return JSON.parse(m[0]);
		throw new Error('not valid JSON');
	}
}

async function freeVisionRoutes() {
	const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`models list ${res.status}`);
	const { data } = await res.json();
	return data
		.filter((m) => m.id.endsWith(':free'))
		.filter((m) => (m.architecture?.input_modalities || []).includes('image'))
		.map((m) => ({ id: m.id, reasoning: m.reasoning || {} }));
}

async function probe(route, imageUrl) {
	const body = {
		model: route.id,
		max_tokens: 1536,
		temperature: 0,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: RUBRIC },
					{ type: 'image_url', image_url: { url: imageUrl } },
				],
			},
		],
	};
	// A model that reasons by default will spend the budget narrating unless it
	// is told not to, and its record says whether it accepts being told.
	if (route.reasoning?.default_enabled && route.reasoning?.mandatory === false) {
		body.reasoning = { effort: 'none' };
	}
	const startedAt = Date.now();
	try {
		const res = await fetch(CHAT_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(PER_LANE_TIMEOUT_MS),
		});
		const ms = Date.now() - startedAt;
		if (!res.ok) {
			const detail = (await res.text().catch(() => '')).slice(0, 90).replace(/\s+/g, ' ');
			return { ...route, ok: false, ms, verdict: `http ${res.status}`, detail };
		}
		const data = await res.json();
		const text = (data.choices?.[0]?.message?.content || '').trim();
		if (!text) return { ...route, ok: false, ms, verdict: 'empty content', detail: 'reasoned instead of answering' };
		try {
			const json = parseJsonLoose(text);
			const scored = typeof json.score === 'number';
			return { ...route, ok: scored, ms, verdict: scored ? 'json ok' : 'json without score', detail: text.slice(0, 60).replace(/\s+/g, ' ') };
		} catch {
			return { ...route, ok: false, ms, verdict: 'unparseable', detail: text.slice(0, 60).replace(/\s+/g, ' ') };
		}
	} catch (e) {
		return { ...route, ok: false, ms: Date.now() - startedAt, verdict: 'unreachable', detail: String(e.message).slice(0, 60) };
	}
}

const routes = await freeVisionRoutes();
console.error(`probing ${routes.length} free vision route(s) against ${values.image}\n`);

const results = [];
for (const route of routes) {
	const r = await probe(route, values.image);
	results.push(r);
	console.error(`  ${r.ok ? 'PASS' : 'fail'}  ${String(r.ms).padStart(6)}ms  ${r.id}  ${r.verdict}`);
}

results.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1));

if (values.json) {
	console.log(JSON.stringify(results, null, 2));
} else {
	console.log('\nRanked best-first. Paste the passing ids into OPENROUTER_VISION_MODELS:\n');
	for (const r of results) {
		const think = r.reasoning?.default_enabled && r.reasoning?.mandatory === false
			? ", extraBody: { reasoning: { effort: 'none' } }"
			: '';
		const mark = r.ok ? ' ' : '// ';
		console.log(`\t${mark}{ model: '${r.id}'${think} },  // ${r.ms}ms ${r.verdict}`);
	}
}

const passed = results.filter((r) => r.ok).length;
console.error(`\n${passed}/${results.length} route(s) returned a usable score.`);
process.exit(passed > 0 ? 0 : 1);
