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

const lockPath = fileURLToPath(new URL('../multiplayer/package-lock.json', import.meta.url));
const pkgPath = fileURLToPath(new URL('../multiplayer/package.json', import.meta.url));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const entries = lock.packages || {};

// npm resolves a dependency by walking up node_modules directories from the
// dependent's own path, so a peer counts as present if any ancestor level has it.
function resolves(fromPath, name) {
	let base = fromPath;
	for (;;) {
		if (entries[`${base ? `${base}/` : ''}node_modules/${name}`]) return true;
		if (!base) return false;
		const cut = base.lastIndexOf('/node_modules/');
		base = cut < 0 ? '' : base.slice(0, cut);
	}
}

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
});
