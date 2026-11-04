import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { builtinModules } from 'node:module';

// 0.1.0 shipped the CLI with its packer's imports declared only as optional
// peers, so `npx @three-ws/avatar-stream pack` died with ERR_MODULE_NOT_FOUND.
// Every bare specifier the published code imports must be a real dependency.
const root = join(import.meta.dirname, '..', 'packages', 'avatar-stream');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function bareImports() {
	const found = new Set();
	for (const dir of ['src', 'bin']) {
		for (const f of readdirSync(join(root, dir))) {
			if (!f.endsWith('.js')) continue;
			const src = readFileSync(join(root, dir, f), 'utf8');
			for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) found.add(m[1]);
			for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.add(m[1]);
		}
	}
	return [...found].filter((s) => !s.startsWith('.') && !s.startsWith('node:') && !builtinModules.includes(s));
}

const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

describe('@three-ws/avatar-stream package.json', () => {
	it('declares every bare import of the published code as a dependency', () => {
		const declared = new Set(Object.keys(pkg.dependencies || {}));
		const missing = bareImports().map(pkgName).filter((n) => n !== pkg.name && !declared.has(n));
		expect(missing).toEqual([]);
	});
});
