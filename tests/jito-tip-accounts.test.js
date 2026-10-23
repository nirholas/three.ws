import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Guard against a corrupted Jito tip account silently leaking real SOL.
//
// Every code path that pays a Jito tip hardcodes the block engine's tip-account
// list and picks one (random or by modulo of a wallet byte / attempt index). If
// a single address is mistyped, that fraction of tips is transferred to a pubkey
// nobody at Jito controls — real SOL burned AND the transaction gets no Jito
// priority / MEV protection. This exact bug shipped three times (two different
// mangled `Cw8C…` values and one mangled `ADaU…`), so it is worth pinning.
//
// The canonical set below is Jito's mainnet `getTipAccounts` response
// (https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts). It changes very
// rarely; if Jito ever rotates it, update this set (from the live endpoint) and
// the source lists together — the test failing is the signal to do exactly that.
const CANONICAL = new Set([
	'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
	'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
	'96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
	'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
	'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
	'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
	'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
	'3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every file that declares a `JITO_TIP_ACCOUNTS` array literal. Kept explicit
// (rather than a repo-wide grep) so a NEW copy of the list added somewhere is a
// deliberate act that also adds its path here — the reviewer's prompt to dedupe.
const SOURCES = [
	'packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js',
	'workers/oracle/executor.js',
	'packages/agent-sniper/src/adapters/solana/executor-web3.js',
];

/** Extract the addresses from the first `JITO_TIP_ACCOUNTS = [ … ]` literal. */
function extractTipAccounts(source) {
	const m = source.match(/JITO_TIP_ACCOUNTS\s*=\s*\[([\s\S]*?)\]/);
	if (!m) return null;
	return [...m[1].matchAll(/['"]([1-9A-HJ-NP-Za-km-z]{32,44})['"]/g)].map((x) => x[1]);
}

describe('Jito tip accounts are canonical (no leaked SOL)', () => {
	for (const rel of SOURCES) {
		it(`${rel} lists only real Jito tip accounts`, () => {
			const accounts = extractTipAccounts(readFileSync(resolve(ROOT, rel), 'utf8'));
			expect(accounts, `no JITO_TIP_ACCOUNTS array found in ${rel}`).not.toBeNull();
			// Every entry must be an address Jito actually controls.
			for (const addr of accounts) {
				expect(CANONICAL.has(addr), `${rel}: "${addr}" is not a canonical Jito tip account`).toBe(true);
			}
			// And no duplicates within a file (a paste error that skews the rotation).
			expect(new Set(accounts).size, `${rel} has duplicate tip accounts`).toBe(accounts.length);
		});
	}

	it('the canonical set is the full 8 Jito publishes', () => {
		expect(CANONICAL.size).toBe(8);
	});
});
