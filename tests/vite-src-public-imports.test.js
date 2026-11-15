// The build copies src/ verbatim to dist/src/ so the <agent-3d> element and its
// lazy modules can be served unbundled (/src/element.js dynamically imports
// /src/runtime/livekit-voice.js, and so on). A src module that reaches into
// public/ by a relative path ('../../public/load-module.js') resolves inside
// Vite, but dist/ serves public/ at its root, so the raw copy asked for
// /public/load-module.js and got a 404: the voice runtime failed to load on
// every page that runs the element unbundled (scripts/audit-csp.mjs caught it
// on /cz). The copy step rewrites those specifiers to where the file lives in
// dist/. This test resolves every such import the way a browser does against
// the dist/ layout and asserts it lands on a real file.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { rewritePublicImports } from '../scripts/vite/src-public-imports.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SPEC = /(?:from\s*|import\s*\(\s*)(['"])((?:\.\.\/)+public\/[^'"]+)\1/g;

function srcModules(dir = path.join(root, 'src')) {
	const out = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name !== 'node_modules') out.push(...srcModules(full));
		} else if (/\.m?js$/.test(ent.name)) out.push(full);
	}
	return out;
}

/** Where a dist/ URL path is served from: public/ files sit at the dist root. */
function servedFile(urlPath) {
	const rel = decodeURIComponent(urlPath).replace(/^\//, '');
	if (rel.startsWith('src/')) return path.join(root, rel);
	return path.join(root, 'public', rel);
}

const importers = srcModules()
	.map((file) => ({ file, rel: path.relative(root, file).split(path.sep).join('/') }))
	.filter(({ file }) => /(?:\.\.\/)+public\//.test(readFileSync(file, 'utf8')));

describe('src/ modules served raw from dist/src', () => {
	it('finds the src modules that import from public/ (so the next test is not vacuous)', () => {
		expect(importers.map((i) => i.rel)).toContain('src/shared/load-module.js');
	});

	for (const { file, rel } of importers) {
		it(`${rel}: every public/ import resolves to a real file in the dist layout`, () => {
			const code = rewritePublicImports(readFileSync(file, 'utf8'), rel);
			const base = new URL(`https://three.ws/${rel}`);
			const broken = [];
			for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
				const target = new URL(m[2], base).pathname;
				if (!existsSync(servedFile(target))) broken.push(`${m[2]} -> ${target}`);
			}
			expect(broken).toEqual([]);
		});
	}

	it('leaves specifiers that do not climb out to the repo root untouched', () => {
		const code = "import { a } from '../lib/public/x.js';\nimport('./public/y.js');";
		expect(rewritePublicImports(code, 'src/feature/mod.js')).toBe(code);
	});

	it('rewrites static and dynamic imports at the exact repo-root depth', () => {
		const code = "export * from '../../public/load-module.js';\nconst m = await import('../../public/a/b.js');";
		expect(rewritePublicImports(code, 'src/shared/x.js')).toBe(
			"export * from '../../load-module.js';\nconst m = await import('../../a/b.js');",
		);
		expect(SPEC.test(rewritePublicImports(code, 'src/shared/x.js'))).toBe(false);
	});
});
