// Walks a browser entry's STATIC import graph offline and reports every chain
// that reaches a bare package. Dynamic `import()` is deliberately not followed:
// Vite emits it as a separate chunk the page only downloads when that code runs,
// which is exactly how a page keeps a heavy library off its first load.
//
// Used by tests that pin "this page's first load never pays for X" (for
// example, the agent profile must not download three.js just to show a
// <model-viewer>). No bundler, no network, so the check is fast and exact.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { init, parse } from 'es-module-lexer';

// A real lexer, not a regex: comments, strings and template literals that
// merely contain the word "import" (or a "/*" inside a line comment) are
// handled the way the browser handles them.
await init;

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function resolveRelative(root, fromFile, spec) {
	const base = spec.startsWith('/') ? path.join(root, spec.slice(1)) : path.resolve(path.dirname(fromFile), spec);
	for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
		if (isFile(candidate)) return candidate;
	}
	return null;
}

/** The static import and re-export specifiers of one source file. */
export function staticImportsOf(source) {
	const [imports] = parse(source);
	return imports.filter((i) => i.type === 'static' && i.specifier).map((i) => i.specifier);
}

/**
 * Every static import chain from `entry` to a bare specifier accepted by
 * `matchesPackage` (e.g. `(s) => s === 'three' || s.startsWith('three/')`).
 * Each chain is a list of repo-relative paths ending in the bare specifier.
 */
export function staticChainsTo(root, entry, matchesPackage) {
	const chains = [];
	const visited = new Set();
	const walk = (file, trail) => {
		if (visited.has(file)) return;
		visited.add(file);
		let source;
		try {
			source = readFileSync(file, 'utf8');
		} catch {
			return;
		}
		const here = [...trail, path.relative(root, file)];
		for (const spec of staticImportsOf(source)) {
			if (spec.startsWith('.') || spec.startsWith('/')) {
				const next = resolveRelative(root, file, spec);
				if (next && !next.includes(`${path.sep}node_modules${path.sep}`)) walk(next, here);
			} else if (matchesPackage(spec)) {
				chains.push([...here, spec]);
			}
		}
	};
	walk(path.resolve(root, entry), []);
	return chains;
}
