#!/usr/bin/env node
/**
 * Validate every agent card in the repo against the three.ws Card v1 schema.
 *
 * Inputs:
 *   - public/.well-known/3d-agent-card.schema.json  (the schema)
 *   - public/.well-known/agent-registration.json     (canonical card, MUST conform)
 *   - any *.agent-card.json file under the repo      (optional examples)
 *
 * Exits non-zero on any validation failure. Used in CI.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const schemaPath = resolve(repoRoot, 'public/.well-known/3d-agent-card.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const targets = [resolve(repoRoot, 'public/.well-known/agent-registration.json')];

try {
	const tracked = execSync('git ls-files "*.agent-card.json"', {
		cwd: repoRoot,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean)
		.map((p) => resolve(repoRoot, p));
	targets.push(...tracked);
} catch {
	// not a git repo or git not available — only validate the canonical card
}

let failed = 0;
for (const file of targets) {
	try {
		statSync(file);
	} catch {
		console.error(`MISSING ${relative(repoRoot, file)}`);
		failed++;
		continue;
	}
	const data = JSON.parse(readFileSync(file, 'utf8'));
	const ok = validate(data);
	if (ok) {
		console.log(`OK      ${relative(repoRoot, file)}`);
	} else {
		failed++;
		console.error(`FAIL    ${relative(repoRoot, file)}`);
		for (const err of validate.errors) {
			console.error(`        ${err.instancePath || '/'} ${err.message}`);
		}
	}
}

if (failed > 0) {
	console.error(`\n${failed} file(s) failed schema validation.`);
	process.exit(1);
}
console.log(`\n${targets.length} file(s) passed.`);
