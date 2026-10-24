// Guard test for the /open-source credits page.
//
// buildCredits() is pure: it reads package.json and node_modules at call
// time and returns a deterministic object (sorted, no timestamp). This test
// re-runs it and deep-equals the result against the committed
// data/open-source-credits.json. A dependency added to package.json without
// running `node scripts/build-open-source-credits.mjs` and committing the
// regenerated file fails here, so the page can never silently drift out of
// sync with what three.ws actually ships.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCredits, normalizeRepoUrl, AREAS, ROOT } from '../scripts/lib/open-source-credits.mjs';

describe('open-source-credits dataset', () => {
	it('matches the committed data/open-source-credits.json exactly', () => {
		const fresh = buildCredits();
		const committed = JSON.parse(
			readFileSync(resolve(ROOT, 'data/open-source-credits.json'), 'utf8'),
		);
		expect(fresh).toEqual(committed);
	});

	it('every entry has an area that exists in AREAS', () => {
		const { entries } = buildCredits();
		const areaIds = new Set(AREAS.map((a) => a.id));
		for (const entry of entries) {
			expect(areaIds.has(entry.area), `${entry.id} has unknown area "${entry.area}"`).toBe(true);
		}
	});

	it('every entry has a name, license, and id', () => {
		const { entries } = buildCredits();
		for (const entry of entries) {
			expect(entry.id, 'missing id').toBeTruthy();
			expect(entry.name, `${entry.id} missing name`).toBeTruthy();
			expect(entry.license, `${entry.id} missing license`).toBeTruthy();
		}
	});

	it('includes every direct npm dependency from package.json', () => {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		const names = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
		const { entries } = buildCredits();
		const npmIds = new Set(entries.filter((e) => e.kind === 'npm').map((e) => e.id));
		for (const name of names) {
			expect(npmIds.has(`npm:${name}`), `package.json dependency "${name}" has no credits entry`).toBe(
				true,
			);
		}
	});

	it('contains no em dash or en dash characters anywhere in the dataset', () => {
		const text = JSON.stringify(buildCredits());
		const emDash = String.fromCharCode(8212);
		const enDash = String.fromCharCode(8211);
		expect(text.includes(emDash)).toBe(false);
		expect(text.includes(enDash)).toBe(false);
	});

	it('every entry with a repo field has an http(s) URL, never a three.ws-relative or ssh path', () => {
		const { entries } = buildCredits();
		for (const entry of entries) {
			if (entry.repo) {
				expect(entry.repo, `${entry.id} has a non-http(s) repo "${entry.repo}"`).toMatch(
					/^https?:\/\//,
				);
			}
		}
	});
});

describe('normalizeRepoUrl', () => {
	it('returns null for a missing repo field', () => {
		expect(normalizeRepoUrl(null)).toBe(null);
		expect(normalizeRepoUrl(undefined)).toBe(null);
	});

	it('leaves a full https URL unchanged', () => {
		expect(normalizeRepoUrl('https://github.com/mrdoob/three.js')).toBe(
			'https://github.com/mrdoob/three.js',
		);
	});

	it('strips a leading git+ and trailing .git', () => {
		expect(normalizeRepoUrl('git+https://github.com/foo/bar.git')).toBe(
			'https://github.com/foo/bar',
		);
	});

	it('converts git:// to https://', () => {
		expect(normalizeRepoUrl('git://github.com/foo/bar.git')).toBe('https://github.com/foo/bar');
	});

	it('converts github: shorthand to a full URL', () => {
		expect(normalizeRepoUrl('github:foo/bar')).toBe('https://github.com/foo/bar');
	});

	it('converts bare owner/repo shorthand to a GitHub URL', () => {
		expect(normalizeRepoUrl('ajv-validator/ajv')).toBe('https://github.com/ajv-validator/ajv');
		expect(normalizeRepoUrl('expressjs/express')).toBe('https://github.com/expressjs/express');
		expect(normalizeRepoUrl('panva/jose')).toBe('https://github.com/panva/jose');
		expect(normalizeRepoUrl('sindresorhus/p-limit')).toBe(
			'https://github.com/sindresorhus/p-limit',
		);
		expect(normalizeRepoUrl('sparkjsdev/spark')).toBe('https://github.com/sparkjsdev/spark');
		expect(normalizeRepoUrl('ai/nanoid')).toBe('https://github.com/ai/nanoid');
	});

	it('converts git@host:owner/repo SSH shorthand to a full URL', () => {
		expect(normalizeRepoUrl('git@github.com:upstash/redis-js')).toBe(
			'https://github.com/upstash/redis-js',
		);
		expect(normalizeRepoUrl('git@github.com:isaacs/node-glob')).toBe(
			'https://github.com/isaacs/node-glob',
		);
	});

	it('converts a scheme-less host:owner/repo form to a full URL', () => {
		expect(normalizeRepoUrl('github.com:Kamino-Finance/klend-sdk')).toBe(
			'https://github.com/Kamino-Finance/klend-sdk',
		);
	});

	it('converts an explicit ssh://git@host/owner/repo URL to a full URL', () => {
		expect(normalizeRepoUrl('ssh://git@github.com/isaacs/node-lru-cache')).toBe(
			'https://github.com/isaacs/node-lru-cache',
		);
	});
});
