// packages/README.md must list every directory under packages/, in the right
// table, linking a README that exists. Guards against the index going stale as
// packages land (18 were missing when this check was written).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	packagesIndexGaps,
	packageDirs,
	parseIndex,
	PUBLISHABLE_HEADING,
	INTERNAL_HEADING,
} from '../scripts/lib/packages-index.mjs';

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages');

function fixture(files) {
	const dir = mkdtempSync(join(tmpdir(), 'pkg-index-'));
	for (const [rel, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), body);
	}
	return dir;
}

const INDEX = (pub, internal) =>
	[
		'# packages/',
		'',
		PUBLISHABLE_HEADING,
		'',
		'| Package | Description |',
		'| --- | --- |',
		...pub.map((n) => `| [${n}](${n}/README.md) | x |`),
		'',
		INTERNAL_HEADING,
		'',
		'| Package | Description |',
		'| --- | --- |',
		...internal.map((n) => `| [${n}](${n}/README.md) | x |`),
		'',
	].join('\n');

describe('packages/README.md index', () => {
	it('lists every package directory, each in its correct table, linking a real README', () => {
		const gaps = packagesIndexGaps(PACKAGES);
		expect(gaps.map((g) => `${g.name}: ${g.detail}`)).toEqual([]);
	});

	it('has at least one row per package directory', () => {
		const rows = [...parseIndex(readFileSync(join(PACKAGES, 'README.md'), 'utf8')).values()].flat();
		expect(rows.length).toBeGreaterThanOrEqual(packageDirs(PACKAGES).length);
	});
});

describe('packagesIndexGaps', () => {
	it('is clean for a complete, correctly split, sorted index', () => {
		const dir = fixture({
			'README.md': INDEX(['alpha', 'beta'], ['gamma', 'zeta']),
			'alpha/README.md': '#',
			'alpha/package.json': '{"name":"alpha"}',
			'beta/README.md': '#',
			'beta/package.json': '{"name":"beta"}',
			'gamma/README.md': '#',
			'gamma/package.json': '{"name":"gamma","private":true}',
			'zeta/README.md': '#',
		});
		try {
			expect(packagesIndexGaps(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reports a missing directory with the table it belongs in', () => {
		const dir = fixture({
			'README.md': INDEX(['alpha'], []),
			'alpha/README.md': '#',
			'alpha/package.json': '{}',
			'beta/README.md': '#',
			'beta/package.json': '{}',
			'gamma/README.md': '#',
		});
		try {
			const gaps = packagesIndexGaps(dir);
			expect(gaps).toContainEqual({ name: 'beta', line: 0, detail: `not in the index; add a row under "${PUBLISHABLE_HEADING}"` });
			expect(gaps).toContainEqual({ name: 'gamma', line: 0, detail: `not in the index; add a row under "${INTERNAL_HEADING}"` });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('flags a private package in the publishable table, a dead README link, a stray row, a duplicate and bad order', () => {
		const dir = fixture({
			'README.md': INDEX(['beta', 'alpha', 'ghost', 'secret', 'beta'], ['nodoc']),
			'alpha/README.md': '#',
			'alpha/package.json': '{}',
			'beta/README.md': '#',
			'beta/package.json': '{}',
			'secret/README.md': '#',
			'secret/package.json': '{"private":true}',
			'nodoc/package.json': '{"private":true}',
		});
		try {
			const details = packagesIndexGaps(dir).map((g) => `${g.name}: ${g.detail}`);
			expect(details).toContain(`secret: belongs under "${INTERNAL_HEADING}", found under "${PUBLISHABLE_HEADING}"`);
			expect(details).toContain('nodoc: linked README nodoc/README.md does not exist');
			expect(details).toContain('ghost: no such directory under packages/');
			expect(details.some((d) => d.startsWith('beta: listed twice'))).toBe(true);
			expect(details.some((d) => d.startsWith('beta: out of alphabetical order'))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reports a missing section heading', () => {
		const dir = fixture({ 'README.md': '# packages/\n', 'alpha/README.md': '#', 'alpha/package.json': '{}' });
		try {
			const details = packagesIndexGaps(dir).map((g) => g.detail);
			expect(details).toContain(`section "${PUBLISHABLE_HEADING}" is missing`);
			expect(details).toContain(`section "${INTERNAL_HEADING}" is missing`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
