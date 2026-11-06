// The world server image runs `npm ci` on multiplayer/package-lock.json alone
// (multiplayer/Dockerfile), with npm's default strict peer resolution. The repo
// root sets legacy-peer-deps=true, and multiplayer is a root workspace, so a lock
// regenerated from inside the monorepo silently drops every peer dependency. The
// image build then fails with "package.json and package-lock.json are not in
// sync" and the world server cannot be deployed at all. These checks catch that
// lock before it reaches Cloud Build.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const lockPath = fileURLToPath(new URL('../multiplayer/package-lock.json', import.meta.url));
const pkgPath = fileURLToPath(new URL('../multiplayer/package.json', import.meta.url));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const entries = lock.packages || {};

// npm resolves a dependency by walking up node_modules directories from the
// dependent's own path, so a peer counts as present if any ancestor level has it.
function resolvedEntry(fromPath, name) {
	let base = fromPath;
	for (;;) {
		const entry = entries[`${base ? `${base}/` : ''}node_modules/${name}`];
		if (entry) return entry;
		if (!base) return null;
		const cut = base.lastIndexOf('/node_modules/');
		base = cut < 0 ? '' : base.slice(0, cut);
	}
}
const resolves = (fromPath, name) => Boolean(resolvedEntry(fromPath, name));

describe('multiplayer/package-lock.json (world server image)', () => {
	it('is a standalone lock for the multiplayer package', () => {
		expect(entries[''].name).toBe(pkg.name);
		expect(entries[''].dependencies).toEqual(pkg.dependencies);
	});

	it('carries every required peer dependency, so strict npm ci accepts it', () => {
		const missing = [];
		for (const [path, meta] of Object.entries(entries)) {
			if (!path || meta.optional || meta.dev) continue;
			for (const name of Object.keys(meta.peerDependencies || {})) {
				if (meta.peerDependenciesMeta?.[name]?.optional) continue;
				if (!resolves(path, name)) missing.push(`${path} -> ${name}`);
			}
		}
		expect(missing).toEqual([]);
	});

	// An optional peer may be absent, but once npm places any copy within
	// reach it must satisfy the range. npm 10 (the node:22-slim image) wants a
	// nested in-range copy and refuses the lock without one, while npm 11
	// accepts it, so this passes locally and fails only in Cloud Build. That is
	// how 2410fc752 shipped a lock with utf-8-validate 6.0.6 hoisted under
	// ws@7's ^5.0.2 peer, and the world server could not be built.
	it('resolves every present peer, optional or not, to an in-range version', () => {
		const outOfRange = [];
		for (const [path, meta] of Object.entries(entries)) {
			if (!path || meta.dev) continue;
			for (const [name, range] of Object.entries(meta.peerDependencies || {})) {
				const found = resolvedEntry(path, name);
				if (!found?.version) continue;
				if (!semver.satisfies(found.version, range, { includePrerelease: true })) {
					outOfRange.push(`${path} -> ${name}@${range} (resolves ${found.version})`);
				}
			}
		}
		expect(outOfRange).toEqual([]);
	});
});
