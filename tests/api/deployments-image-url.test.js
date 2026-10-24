/**
 * api/deployments.js: shapeRow() image URL (prompt-402 "console errors" work
 * order). A Solana row's `image_key` (aliased from `avatars.thumbnail_key`)
 * was turned into a browser-facing `image` URL with the raw bucket domain
 * (publicUrl), the exact guard-evading pattern tests/thumbnail-url-guard.js
 * misses because the variable is named `image_key`, not "...thumb...". That
 * raw domain trips Chrome's Opaque Response Blocking on an <img> load; the
 * same-origin /cdn/ proxy (cdnUrl) is the ORB-safe form every other avatar
 * thumbnail already uses.
 */
import { describe, it, expect } from 'vitest';
import { shapeRow } from '../../api/deployments.js';

describe('shapeRow: ORB-safe image URL', () => {
	it('routes a Solana row image_key through cdnUrl(), not the raw bucket domain', () => {
		const row = {
			family: 'solana',
			chain_id: 101,
			agent_id: 'mint-abc',
			asset: 'mint-abc',
			name: 'Agent',
			description: null,
			image: null,
			image_key: 'thumb/abc-123.png',
			owner: 'owner-wallet',
			has_3d: true,
			x402_support: false,
			registered_at: new Date().toISOString(),
			registered_tx: 'tx-abc',
		};
		const shaped = shapeRow(row);
		expect(shaped.image).toBe('https://three.ws/cdn/thumb/abc-123.png');
		expect(shaped.image).not.toMatch(/r2\.dev/);
	});

	it('passes through an already-absolute r.image untouched', () => {
		const row = {
			family: 'solana',
			chain_id: 101,
			agent_id: 'mint-def',
			asset: 'mint-def',
			name: 'Agent',
			description: null,
			image: 'https://example.com/already-absolute.png',
			image_key: 'thumb/should-be-ignored.png',
			owner: 'owner-wallet',
			has_3d: true,
			x402_support: false,
			registered_at: new Date().toISOString(),
			registered_tx: 'tx-def',
		};
		const shaped = shapeRow(row);
		expect(shaped.image).toBe('https://example.com/already-absolute.png');
	});

	it('is null when neither image nor image_key is set', () => {
		const row = {
			family: 'solana',
			chain_id: 101,
			agent_id: 'mint-ghi',
			asset: 'mint-ghi',
			name: 'Agent',
			description: null,
			image: null,
			image_key: null,
			owner: 'owner-wallet',
			has_3d: false,
			x402_support: false,
			registered_at: new Date().toISOString(),
			registered_tx: null,
		};
		const shaped = shapeRow(row);
		expect(shaped.image).toBeNull();
	});
});
