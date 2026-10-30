// A SIWE/SIWS message whose time fields do not parse must be rejected by the
// parser. Callers compare Date.parse(field) against now, and NaN compares false
// both ways, so an unparseable Expiration Time silently meant "never expires".
import { describe, it, expect } from 'vitest';
import { parseSiweMessage } from '../api/_lib/siwe.js';
import { parseSiwsMessage } from '../api/_lib/siws.js';

const EVM = '0x' + 'a'.repeat(40);
const SOL = '11111111111111111111111111111111';

function siwe(extra) {
	return [
		'three.ws wants you to sign in with your Ethereum account:',
		EVM, '', 'Sign in.', '',
		'URI: https://three.ws', 'Version: 1', 'Chain ID: 1', 'Nonce: abc123',
		'Issued At: 2026-10-30T00:00:00.000Z', ...extra,
	].join('\n');
}
function siws(extra) {
	return [
		'three.ws wants you to sign in with your Solana account:',
		SOL, '', 'Sign in.', '',
		'URI: https://three.ws', 'Version: 1', 'Chain ID: mainnet', 'Nonce: abc123',
		'Issued At: 2026-10-30T00:00:00.000Z', ...extra,
	].join('\n');
}

describe.each([
	['siwe', parseSiweMessage, siwe],
	['siws', parseSiwsMessage, siws],
])('%s time fields', (_n, parse, build) => {
	it('accepts valid ISO timestamps', () => {
		expect(parse(build(['Expiration Time: 2026-10-30T00:05:00.000Z']))).not.toBeNull();
	});
	it('rejects an unparseable Expiration Time', () => {
		expect(parse(build(['Expiration Time: never']))).toBeNull();
	});
	it('rejects an unparseable Not Before', () => {
		expect(parse(build(['Not Before: soon']))).toBeNull();
	});
	it('rejects an unparseable Issued At', () => {
		expect(parse(build(['Issued At: yesterday']))).toBeNull();
	});
});
