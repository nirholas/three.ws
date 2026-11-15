// The site CSP has no 'unsafe-eval' outside /scene. Some CDN libraries need
// eval to work at all: MathJax 2 evaluates its `text/x-mathjax-config` block
// and its extension loader through eval, so every page that includes it files
// a `script-src blocked eval` report and its config never runs.
// scripts/audit-csp.mjs caught it on /cookbook/self-correcting-3d, a notebook
// export whose nbconvert template pulled in MathJax 2 although the notebook has
// no math. This test keeps eval-only libraries out of every static page.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const EVAL_ONLY = [
	{ name: 'MathJax 2', pattern: /mathjax\/2\.\d|text\/x-mathjax-config/i },
];

function htmlFiles(dir) {
	const out = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...htmlFiles(full));
		else if (ent.name.endsWith('.html')) out.push(full);
	}
	return out;
}

describe('static pages load no eval-only CDN library', () => {
	const files = [...htmlFiles(path.join(root, 'public')), ...htmlFiles(path.join(root, 'pages'))];

	it('scans the static pages (so the next test is not vacuous)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('no page includes a library that needs eval under the no-eval CSP', () => {
		const hits = [];
		for (const file of files) {
			const html = readFileSync(file, 'utf8');
			for (const lib of EVAL_ONLY) {
				if (lib.pattern.test(html)) hits.push(`${path.relative(root, file)}: ${lib.name}`);
			}
		}
		expect(hits).toEqual([]);
	});
});
