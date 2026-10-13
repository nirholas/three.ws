#!/usr/bin/env node
// Generates the public Postman collection from public/.well-known/openapi.yaml,
// the same spec the openapi-to-postmanv2 converter also powers for third-party
// tooling. Keeps the checked-in collection in sync with the spec: run this
// after editing the OpenAPI file, or check it stays in sync in CI.
//
// openapi-to-postmanv2 fakes two things on every run that have nothing to do
// with the spec: a random `_postman_id`/item `id` on every node, and a random
// example value for any schema with no fixed shape (free-form objects, and a
// few numeric/string fields the library fakes even with schemaFaker off). This
// script strips the ids (Postman assigns its own on import; the schema does
// not require them) and canonicalizes free-form example bodies to a fixed
// placeholder, and drops the auto-generated example responses entirely: they
// are fabricated data, not real API output, and shipping them as if real
// would violate this repo's no-fake-data rule. What is left (method, URL,
// path/query parameters, headers, auth, and real request body shapes from the
// spec) is byte-identical across runs for the same spec.
//
// Usage: node scripts/build-postman-collection.mjs [--check]
//   --check  exit 1 if the generated output differs from what is on disk

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { convert } from 'openapi-to-postmanv2';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(ROOT, 'public', '.well-known', 'openapi.yaml');
const OUT_PATH = path.join(ROOT, 'public', '.well-known', 'postman-collection.json');

function writeAtomic(filePath, contents) {
	const tmp = `${filePath}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, contents);
	fs.renameSync(tmp, filePath);
}

// Free-form (additionalProperties, no fixed shape) schemas fake a random
// number of randomly-named keys. Collapse any object whose every key matches
// that generated shape (key_0, key_1, ...) to one fixed placeholder.
function canonicalizeFreeform(value) {
	if (Array.isArray(value)) return value.map(canonicalizeFreeform);
	if (value && typeof value === 'object') {
		const keys = Object.keys(value);
		if (keys.length && keys.every((k) => /^key_\d+$/.test(k))) {
			return { additionalProperty: '<any>' };
		}
		const out = {};
		for (const k of keys) out[k] = canonicalizeFreeform(value[k]);
		return out;
	}
	return value;
}

function clean(node) {
	if (Array.isArray(node)) {
		node.forEach(clean);
		return;
	}
	if (node && typeof node === 'object') {
		delete node.id;
		delete node._postman_id;
		if (Array.isArray(node.response)) node.response = [];
		if (node.body && typeof node.body.raw === 'string') {
			try {
				const parsed = JSON.parse(node.body.raw);
				node.body.raw = JSON.stringify(canonicalizeFreeform(parsed), null, 2);
			} catch {
				// not JSON (form data, plain text): leave as-is
			}
		}
		for (const key of Object.keys(node)) clean(node[key]);
	}
}

function buildCollection() {
	const spec = fs.readFileSync(SPEC_PATH, 'utf8');
	return new Promise((resolve, reject) => {
		convert({ type: 'string', data: spec }, { schemaFaker: false, parametersResolution: 'Example' }, (err, result) => {
			if (err) return reject(err);
			if (!result.result) return reject(new Error(result.reason || 'conversion failed'));
			const collection = result.output[0].data;
			clean(collection);
			resolve(collection);
		});
	});
}

const collection = await buildCollection();
const output = `${JSON.stringify(collection, null, '\t')}\n`;

if (process.argv.includes('--check')) {
	const onDisk = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
	if (onDisk !== output) {
		console.error(`[build-postman-collection] ${path.relative(ROOT, OUT_PATH)} is out of date with ${path.relative(ROOT, SPEC_PATH)}; run: node scripts/build-postman-collection.mjs`);
		process.exit(1);
	}
	console.log('[build-postman-collection] up to date');
} else {
	writeAtomic(OUT_PATH, output);
	console.log(`[build-postman-collection] wrote ${collection.item.length} top-level item(s) to ${path.relative(ROOT, OUT_PATH)}`);
}
