// @solana/web3.js 2.x/3.x reuse the package name for an incompatible library:
// Keypair.generate() returns a Promise there, so code written for 1.x reads
// `.publicKey` off a Promise and gets undefined, and the 1.x-only dependencies
// (spl-token, anchor, bonfida) are handed the hoisted 3.x copy. A Dependabot
// bump to 3.2.1 merged on 2026-11-25 and broke every Solana suite that builds
// a keypair. This keeps every manifest and the installed copy on 1.x until a
// deliberate move to @solana/kit.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const MANIFESTS = [
	'package.json',
	'agent-payments-sdk/package.json',
	'character-studio/package.json',
	'mcp-server/package.json',
	'packages/agent-sniper/package.json',
	'packages/agora-mcp/package.json',
	'packages/avatar-agent-mcp/package.json',
	'packages/metaplex-agent-mcp/package.json',
	'packages/portfolio-mcp/package.json',
	'packages/skill-import/package.json',
	'packages/three-token-mcp/package.json',
	'packages/wallet-linkage/package.json',
	'packages/x402-mcp/package.json',
	'services/pump-claims/package.json',
];

describe('@solana/web3.js stays on 1.x', () => {
	it.each(MANIFESTS.filter((m) => existsSync(m)))('%s asks for a 1.x range', (manifest) => {
		const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
		const range = pkg.dependencies?.['@solana/web3.js'] ?? pkg.devDependencies?.['@solana/web3.js'] ?? pkg.peerDependencies?.['@solana/web3.js'];
		if (range === undefined) return;
		expect(range).toMatch(/^[\^~]?1\./);
	});

	it('the installed copy builds a keypair synchronously', () => {
		const require = createRequire(import.meta.url);
		const web3 = require('@solana/web3.js');
		expect(require('@solana/web3.js/package.json').version).toMatch(/^1\./);
		expect(web3.Keypair.generate().publicKey.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
	});
});
