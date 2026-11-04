// Every patched dependency copy under a package's vendor/ directory must ship the
// files its package.json points at. npm links node_modules/<name> to the vendored
// folder, so a copy committed without its dist/ breaks every require/import of it
// after a fresh install, even though the lockfile looks correct.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 256 * 1024 * 1024 })
	.toString()
	.split('\0');
const trackedSet = new Set(tracked);

const vendoredManifests = tracked.filter((f) => /(^|\/)vendor\/[^/]+\/package\.json$/.test(f) && !f.includes('node_modules/'));

function collectTargets(exportsField, out) {
	if (typeof exportsField === 'string') out.push(exportsField);
	else if (exportsField && typeof exportsField === 'object') {
		for (const value of Object.values(exportsField)) collectTargets(value, out);
	}
	return out;
}

function entryFiles(pkg) {
	const files = [];
	if (pkg.main) files.push(pkg.main);
	if (pkg.module) files.push(pkg.module);
	if (pkg.types) files.push(pkg.types);
	collectTargets(pkg.exports, files);
	if (!pkg.main && !pkg.exports) files.push('index.js');
	return [...new Set(files.filter((f) => !f.includes('*')).map((f) => f.replace(/^\.\//, '')))];
}

describe('vendored dependency copies', () => {
	it('finds the vendored packages', () => {
		expect(vendoredManifests.length).toBeGreaterThan(0);
	});

	it.each(vendoredManifests)('%s ships every file its manifest points at', (manifest) => {
		const dir = dirname(manifest);
		const pkg = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
		const missing = entryFiles(pkg)
			.map((f) => join(dir, f))
			.filter((f) => !trackedSet.has(f) || !existsSync(join(root, f)));
		expect(missing).toEqual([]);
	});
});
