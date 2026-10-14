// data/standalone-mirrors.json is the single source of truth every standalone-mirror
// exporter (sync-standalone-repos.mjs, export-growth-satellites.mjs, build-awesome.mjs
// --standalone, build-standalone-skill-repos.mjs) reads instead of hardcoding repo
// names. These tests lock down the shape so a bad hand-edit cannot silently break an
// exporter: the manifest must validate against its own schema, every path must exist
// on disk, and every non-null repo slug must be unique (two entries claiming the same
// mirror would make one of them silently overwrite the other on the next sync).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data/standalone-mirrors.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(ROOT, 'data/standalone-mirrors.schema.json'), 'utf8'));

describe('data/standalone-mirrors.json', () => {
	it('validates against its schema', () => {
		const ajv = new Ajv({ allErrors: true, strict: false });
		const validate = ajv.compile(schema);
		const valid = validate(manifest);
		expect(validate.errors, JSON.stringify(validate.errors)).toBeFalsy();
		expect(valid).toBe(true);
	});

	it('has at least one mirror entry', () => {
		expect(manifest.mirrors.length).toBeGreaterThan(0);
	});

	it('every path exists on disk', () => {
		const missing = manifest.mirrors.filter((m) => !existsSync(resolve(ROOT, m.path)));
		expect(missing.map((m) => m.path)).toEqual([]);
	});

	it('every non-null repo slug is unique', () => {
		const repos = manifest.mirrors.map((m) => m.repo).filter(Boolean);
		const dupes = repos.filter((r, i) => repos.indexOf(r) !== i);
		expect(dupes).toEqual([]);
	});

	it('a repeated path only ever repeats for the skill-repos exporter', () => {
		// skill-repos is the one legitimate 1-path-to-many-repos case: three
		// plugin marketplaces are cut from the same .agents/skills tree.
		const byPath = new Map();
		for (const m of manifest.mirrors) byPath.set(m.path, (byPath.get(m.path) || 0) + 1);
		const unexpectedDupes = manifest.mirrors.filter((m) => byPath.get(m.path) > 1 && m.exporter !== 'skill-repos');
		expect(unexpectedDupes.map((m) => m.path)).toEqual([]);
	});
});
