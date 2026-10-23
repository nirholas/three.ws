// Static import-graph check for the research/live wall.
//
// Starting from each research module, follow every relative static import,
// re-export and dynamic import('...') with a literal path. Report any reachable
// file whose repo-relative path matches a live-execution pattern, with the import
// chain that reaches it. Bare package specifiers that can sign or send are checked
// by name.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';

/** Repo-relative path patterns of modules that can sign, hold keys, send or order. */
export const LIVE_PATH_PATTERNS = [
	/(^|\/)execution-engine\.js$/,
	/(^|\/)(landing-race|tx-landing|jito|send-transaction)[^/]*\.js$/,
	/(^|\/)(agent-)?wallet[^/]*\.js$/,
	/(^|\/)custody[^/]*\.js$/,
	/(^|\/)(signer|signing|sign-[^/]*|keypair[^/]*)\.js$/,
	/(^|\/)workers\/agent-sniper\/(executor|buyer|seller|position-loop|index|run|trade|swap)[^/]*\.js$/,
	/(^|\/)api\/_lib\/pump\.js$/,
	/(^|\/)api\/_lib\/(order|orders|swap|jupiter-swap|trade)[^/]*\.js$/,
	/(^|\/)api\/_lib\/x402-pay[^/]*\.js$/,
];

/** Bare specifiers that give a module the ability to sign or send. */
export const LIVE_PACKAGE_PATTERNS = [/^@solana\/web3\.js$/, /^@solana\/kit$/, /^ethers$/, /^viem(\/|$)/, /^tweetnacl$/, /^@coral-xyz\/anchor$/];

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function resolveRel(fromFile, spec) {
	const base = resolve(dirname(fromFile), spec);
	for (const cand of [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')]) {
		if (existsSync(cand) && statSync(cand).isFile()) return cand;
	}
	return null;
}

/**
 * @param {string[]} entries  Repo-relative research module paths.
 * @param {{ root: string, patterns?: RegExp[], packages?: RegExp[] }} opts
 * @returns {{ violations: { entry: string, target: string, chain: string[] }[], visited: number }}
 */
export function findWallViolations(entries, { root, patterns = LIVE_PATH_PATTERNS, packages = LIVE_PACKAGE_PATTERNS }) {
	const violations = [];
	const seenAll = new Set();
	for (const entry of entries) {
		const start = resolve(root, entry);
		const seen = new Set([start]);
		const queue = [[start, [entry]]];
		while (queue.length) {
			const [file, chain] = queue.shift();
			seenAll.add(file);
			const rel = relative(root, file);
			if (file !== start && patterns.some((p) => p.test(rel))) {
				violations.push({ entry, target: rel, chain });
				continue;
			}
			let src;
			try {
				src = stripComments(readFileSync(file, 'utf8'));
			} catch {
				continue;
			}
			for (const m of src.matchAll(IMPORT_RE)) {
				const spec = m[1] || m[2];
				if (!spec) continue;
				if (spec.startsWith('.')) {
					const next = resolveRel(file, spec);
					if (next && !seen.has(next)) {
						seen.add(next);
						queue.push([next, [...chain, relative(root, next)]]);
					}
				} else if (!spec.startsWith('node:') && packages.some((p) => p.test(spec))) {
					violations.push({ entry, target: spec, chain: [...chain, spec] });
				}
			}
		}
	}
	return { violations, visited: seenAll.size };
}
