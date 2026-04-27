import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dist = resolve(repoRoot, 'dist');

// Guards against the regression where /style.css 404'd in production
// because public/* HTML rollup inputs collide with the public-dir copy.
// If you see this fail, the deployed site is likely about to break the
// same way studio did on 2026-04-27.
describe('build asset paths', () => {
	beforeAll(() => {
		if (!existsSync(dist)) {
			throw new Error(`dist/ not found — run \`npm run build\` before running this test.`);
		}
	});

	it('serves /style.css from dist root', () => {
		expect(existsSync(resolve(dist, 'style.css'))).toBe(true);
	});

	const pagesReferencingStyleCss = [
		'studio/index.html',
		'discover/index.html',
		'widgets-gallery/index.html',
		'docs-widgets.html',
	];

	for (const rel of pagesReferencingStyleCss) {
		it(`${rel} references a resolvable stylesheet`, () => {
			const file = resolve(dist, rel);
			if (!existsSync(file)) return; // page may not exist in this build target
			const html = readFileSync(file, 'utf8');
			const refs = [...html.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
			for (const href of refs) {
				if (!href.startsWith('/')) continue;
				const local = resolve(dist, href.slice(1));
				expect(
					existsSync(local),
					`${rel} references ${href} which is not present in dist/`,
				).toBe(true);
			}
		});
	}
});
