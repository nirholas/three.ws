// A package that ships to npm must be installable outside this monorepo.
//
// `@three-ws/naming-mcp` is published (`npx @three-ws/naming-mcp`), yet its
// package.json once declared `"@three-ws/tool-sdk": "file:../tool-sdk"`, and
// tool-sdk is private and unpublished. The next `npm publish` would have shipped
// a package nobody could install, and nothing in the repo noticed. The fix was to
// vendor the SDK (packages/naming-mcp/src/vendor/tool-sdk, guarded by
// `npm run check:vendored`). This test makes the whole class of mistake fail in
// `npm test`: no publishable package may resolve a runtime dependency through
// the local filesystem or the workspace protocol.
//
// Scope is every package this repo publishes from its own tree: each root
// `workspaces` entry plus every `packages/*` directory. A package is publishable
// unless it says `"private": true`. devDependencies are excluded on purpose: npm
// never installs them for a consumer.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const LOCAL_SPEC = /^(file:|link:|workspace:|portal:)/;

function packageDirs() {
	const dirs = new Set();
	const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	for (const ws of rootPkg.workspaces || []) {
		if (!ws.includes('*')) dirs.add(ws);
	}
	const packagesDir = path.join(ROOT, 'packages');
	for (const name of readdirSync(packagesDir)) {
		if (statSync(path.join(packagesDir, name)).isDirectory()) dirs.add(`packages/${name}`);
	}
	return [...dirs].filter((d) => existsSync(path.join(ROOT, d, 'package.json'))).sort();
}

function findLocalRuntimeDeps() {
	const found = [];
	for (const dir of packageDirs()) {
		const pkg = JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
		if (pkg.private === true) continue;
		for (const field of RUNTIME_FIELDS) {
			for (const [name, spec] of Object.entries(pkg[field] || {})) {
				if (LOCAL_SPEC.test(String(spec))) found.push(`${dir} ${field} ${name} ${spec}`);
			}
		}
	}
	return found;
}

describe('publishable packages resolve every runtime dependency from the registry', () => {
	it('scans a real set of packages', () => {
		const dirs = packageDirs();
		expect(dirs).toContain('packages/naming-mcp');
		expect(dirs.length).toBeGreaterThan(20);
	});

	it('no non-private package depends on file:, link:, workspace: or portal:', () => {
		expect(
			findLocalRuntimeDeps(),
			'vendor the code (see packages/naming-mcp/scripts/vendor-tool-sdk.mjs) or publish the dependency first',
		).toEqual([]);
	});
});
