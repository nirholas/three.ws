// The published facilitator package this deployment runs, read from its
// package.json so the discovery document can never drift from the code.

import { readFileSync } from 'node:fs';

let cached = null;

export function facilitatorPackage() {
	if (cached) return cached;
	try {
		const pkg = JSON.parse(readFileSync(new URL('../../../packages/x402-server/package.json', import.meta.url), 'utf8'));
		cached = { name: pkg.name, version: pkg.version };
	} catch {
		cached = { name: '@three-ws/x402-server', version: null };
	}
	return cached;
}
