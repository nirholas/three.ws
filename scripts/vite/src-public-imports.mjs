// The build copies src/ verbatim to dist/src/ so the <agent-3d> element and its
// lazy modules can be served unbundled. A src module may reach into public/ by
// a relative path ('../../public/load-module.js'); that resolves inside Vite,
// but dist/ serves public/ at its root, so the raw copy would ask for
// /public/load-module.js and get a 404. These helpers rewrite such specifiers
// in the copy to where the file actually lives in dist/, and stay relative so
// the copy still works when an embed loads it from another origin.
//
// Pinned by tests/vite-src-public-imports.test.js.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Rewrite relative imports that climb exactly to the repo root and then enter
 * public/, dropping the `public/` segment. Deeper or shallower climbs are not
 * repo-root public/ paths and are left alone.
 *
 * @param {string} code    module source
 * @param {string} relPath the module's path from the repo root, '/'-separated (e.g. 'src/shared/x.js')
 */
export function rewritePublicImports(code, relPath) {
	const depth = relPath.split('/').length - 1;
	if (depth < 1) return code;
	const climb = '../'.repeat(depth);
	return code.replace(
		/((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"]))((?:\.\.\/)+)public\/([^'"]+)\2/g,
		(whole, lead, quote, ups, rest) => (ups === climb ? `${lead}${climb}${rest}${quote}` : whole),
	);
}

/**
 * Apply rewritePublicImports to every JS module in a copied src tree.
 *
 * @param {string} distSrc   absolute path of dist/src
 * @param {string} prefix    the tree's path from the dist root ('src')
 * @returns {string[]} the dist-relative paths that were rewritten
 */
export function rewriteCopiedSrc(distSrc, prefix = 'src') {
	const changed = [];
	const walk = (dir, rel) => {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, ent.name);
			const relPath = `${rel}/${ent.name}`;
			if (ent.isDirectory()) {
				walk(full, relPath);
			} else if (/\.m?js$/.test(ent.name)) {
				const code = readFileSync(full, 'utf8');
				if (!code.includes('public/')) continue;
				const out = rewritePublicImports(code, relPath);
				if (out !== code) {
					writeFileSync(full, out);
					changed.push(relPath);
				}
			}
		}
	};
	walk(distSrc, prefix);
	return changed;
}
