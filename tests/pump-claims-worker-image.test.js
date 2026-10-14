/**
 * pump-claims container: does the image actually carry everything the
 * service imports?
 *
 * Mirrors tests/agora-worker-image.test.js's guard, but follows imports
 * TRANSITIVELY (not just one hop out of the service directory): pipeline.js
 * imports api/_lib/pump-claims.js, which imports api/_lib/pump-claims-github.js,
 * which imports api/_lib/pump-search.js, which imports src/ipfs.js. A one-hop
 * scan starting from services/pump-claims would miss that last link entirely,
 * and the image would build clean and crash on boot with "Cannot find module".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = join(ROOT, 'services', 'pump-claims');
const DOCKERFILE = join(SERVICE_DIR, 'Dockerfile');

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;

function resolveModule(specifierTarget) {
	if (existsSync(specifierTarget)) return specifierTarget;
	if (existsSync(`${specifierTarget}.js`)) return `${specifierTarget}.js`;
	return null;
}

/** BFS over every file reachable by relative import from the service's own source, skipping its own test files. */
function allReachableFiles() {
	const seeds = ['pipeline.js', 'listener.js', 'store.js', 'index.js', 'backfill.js', 'dedupe.js'].map((f) =>
		join(SERVICE_DIR, f),
	);
	const visited = new Set();
	const queue = [...seeds];
	while (queue.length) {
		const file = queue.pop();
		if (visited.has(file) || !existsSync(file)) continue;
		visited.add(file);
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(IMPORT_RE)) {
			const resolved = resolveModule(resolve(dirname(file), m[1]));
			if (resolved && !visited.has(resolved)) queue.push(resolved);
		}
	}
	return [...visited];
}

/** Repo-relative targets reachable from the service's source but living outside its own directory. */
function crossBoundaryImports() {
	const found = new Set();
	for (const file of allReachableFiles()) {
		const rel = relative(SERVICE_DIR, file);
		if (rel.startsWith('..')) found.add(relative(ROOT, file));
	}
	return [...found].sort();
}

/** Paths the Dockerfile COPYs out of the build context. */
function dockerfileCopies() {
	const copies = [];
	for (const line of readFileSync(DOCKERFILE, 'utf8').split('\n')) {
		const m = line.match(/^COPY\s+(.+)$/i);
		if (!m) continue;
		const parts = m[1].trim().split(/\s+/);
		for (const src of parts.slice(0, -1)) copies.push(src.replace(/^\.\//, ''));
	}
	return copies;
}

describe('pump-claims image carries the service dependencies', () => {
	const imports = crossBoundaryImports();
	const copies = dockerfileCopies();

	it('finds the cross-boundary imports it is meant to guard, including transitive ones', () => {
		expect(imports.length).toBeGreaterThan(0);
		expect(imports).toContain('api/_lib/pump-claims.js');
		// The transitive chain this test exists to catch: pipeline.js -> pump-claims.js
		// -> pump-claims-github.js -> pump-search.js -> src/ipfs.js.
		expect(imports).toContain('src/ipfs.js');
	});

	it.each(crossBoundaryImports())('Dockerfile COPYs the source for %s', (target) => {
		const covered = copies.some((c) => target === c || target.startsWith(`${c}/`));
		expect(
			covered,
			`services/pump-claims transitively imports ${target}, but no COPY in ` +
				`services/pump-claims/Dockerfile brings it into the image. The build will still succeed and the ` +
				`container will crash on boot with "Cannot find module". Add a COPY for it.\n` +
				`Current COPY sources: ${copies.join(', ')}`,
		).toBe(true);
	});
});
