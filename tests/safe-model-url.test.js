import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isSafeQueryModelUrl } from '../src/shared/safe-model-url.js';

describe('isSafeQueryModelUrl', () => {
	beforeEach(() => vi.stubGlobal('location', { origin: 'https://three.ws' }));
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['/avatars/a.glb', true],
		['//evil.com/a.glb', false],
		['ipfs://bafy', true],
		['ar://abc123', true],
		['https://pub-x.r2.dev/a.glb', true],
		['https://three.ws.evil.com/a.glb', false],
		['https://evilr2.dev/a.glb', false],
		['http://three.ws/a.glb', false],
		['https://three.ws/x.glb', true],
		['https://cdn.three.ws/x.glb', true],
		['https://storage.googleapis.com/b/a.glb', true],
	])('%s -> %s', (url, expected) => expect(isSafeQueryModelUrl(url)).toBe(expected));

	it.each([
		'https://three.ws.evil.com/a.glb', 'https://evilthree.ws/a.glb',
		'https://r2.dev.evil.com/a.glb', 'https://evilr2.dev/a.glb',
		'https://ipfs.io.evil.com/a.glb', 'https://evilipfs.io/a.glb',
		'https://mypinata.cloud.evil.com/a.glb', 'https://evilarweave.net/a.glb',
	])('rejects look-alike host %s', (url) => expect(isSafeQueryModelUrl(url)).toBe(false));

	it.each([[null], [undefined], [42], [{}], [''], ['https://']])('rejects %j', (v) => expect(isSafeQueryModelUrl(v)).toBe(false));

	it('does not leave a location stub behind', () => {
		vi.unstubAllGlobals();
		expect(typeof globalThis.location === 'undefined' || globalThis.location.origin !== 'https://three.ws').toBe(true);
	});
});
