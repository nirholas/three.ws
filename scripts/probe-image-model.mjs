#!/usr/bin/env node
// Ask Vertex whether a Gemini image model id is callable on this project,
// without spending an image: `countTokens` runs the same project + publisher
// model path as a real `generateContent`, so it answers 404 for an id Vertex
// does not serve and 403 for a project-level denial (billing hold), and it is
// free. Pass --generate to make one real 1K generation and confirm the model
// actually returns an image (bills one image to GCP credits).
//
//   node scripts/probe-image-model.mjs                         # primary + fallback
//   node scripts/probe-image-model.mjs gemini-3.1-flash-image  # specific ids
//   node scripts/probe-image-model.mjs --generate
//   node scripts/probe-image-model.mjs --gemini-api            # Gemini API catalog
//
// --gemini-api asks the Gemini API (generativelanguage.googleapis.com, key in
// GOOGLE_API_KEY or GEMINI_API_KEY) which image models it lists and whether
// each id answers, for when Vertex is denied (a project billing hold denies
// every model alike, so Vertex cannot tell a live id from a retired one).
//
// Credentials come from api/_lib/gcp-auth.js (GCP_SERVICE_ACCOUNT_JSON, the
// metadata server, or `gcloud auth application-default login`). The token is
// never printed.

import { parseArgs } from 'node:util';
import { getGcpAccessToken } from '../api/_lib/gcp-auth.js';
import { IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK } from '../api/_lib/image-model.js';

const { values, positionals } = parseArgs({
	options: {
		generate: { type: 'boolean', default: false },
		'gemini-api': { type: 'boolean', default: false },
		location: { type: 'string', default: process.env.VERTEX_IMAGEN_LOCATION || 'global' },
		project: { type: 'string', default: process.env.GOOGLE_CLOUD_PROJECT || 'aerial-vehicle-466722-p5' },
	},
	allowPositionals: true,
});

const models = positionals.length ? positionals : [IMAGE_MODEL_PRIMARY, IMAGE_MODEL_FALLBACK];
const host =
	values.location === 'global'
		? 'https://aiplatform.googleapis.com'
		: `https://${values.location}-aiplatform.googleapis.com`;

if (values['gemini-api']) process.exit(await probeGeminiApi());

const token = await getGcpAccessToken();

async function call(model, method, body) {
	const url = `${host}/v1/projects/${values.project}/locations/${values.location}/publishers/google/models/${model}:${method}`;
	const t0 = Date.now();
	const res = await fetch(url, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(90_000),
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* HTML gateway bodies stay as text */
	}
	return { status: res.status, ms: Date.now() - t0, json, text };
}

let failed = 0;
for (const model of models) {
	const count = await call(model, 'countTokens', { contents: [{ role: 'user', parts: [{ text: 'x' }] }] });
	const message = count.json?.error?.message || (count.status === 200 ? 'ok' : count.text.slice(0, 160));
	console.log(`${model.padEnd(34)} countTokens ${count.status} (${count.ms} ms) ${message.slice(0, 160)}`);
	if (count.status !== 200) {
		failed += 1;
		continue;
	}
	if (!values.generate) continue;
	const gen = await call(model, 'generateContent', {
		contents: [{ role: 'user', parts: [{ text: 'A studio photograph of a ceramic mug on a plain grey sweep.' }] }],
		generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
	});
	const part = (gen.json?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data);
	const detail = part
		? `image ${part.inlineData.mimeType} ${Math.round((part.inlineData.data.length * 3) / 4 / 1024)} KiB`
		: gen.json?.error?.message || gen.text.slice(0, 160);
	console.log(`${''.padEnd(34)} generate    ${gen.status} (${gen.ms} ms) ${detail.slice(0, 160)}`);
	if (!part) failed += 1;
}
process.exit(failed ? 1 : 0);

async function probeGeminiApi() {
	const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
	if (!key) {
		console.error('GOOGLE_API_KEY (or GEMINI_API_KEY) is not set.');
		return 2;
	}
	const base = 'https://generativelanguage.googleapis.com/v1beta';
	const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };
	const listed = [];
	let pageToken = '';
	do {
		const res = await fetch(`${base}/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, {
			headers,
			signal: AbortSignal.timeout(30_000),
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			console.error(`models.list ${res.status}: ${json?.error?.message || ''}`);
			return 1;
		}
		for (const m of json.models || []) if (/image/i.test(m.name)) listed.push(m);
		pageToken = json.nextPageToken || '';
	} while (pageToken);
	console.log('Image models listed by the Gemini API:');
	for (const m of listed) console.log(`  ${m.name.replace(/^models\//, '').padEnd(40)} ${m.displayName || ''}`);
	let failed = 0;
	for (const model of models) {
		const res = await fetch(`${base}/models/${model}:countTokens`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }),
			signal: AbortSignal.timeout(30_000),
		});
		const json = await res.json().catch(() => ({}));
		console.log(`${model.padEnd(34)} countTokens ${res.status} ${(json?.error?.message || 'ok').slice(0, 140)}`);
		if (!res.ok) failed += 1;
	}
	return failed ? 1 : 0;
}
