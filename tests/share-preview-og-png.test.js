// LinkedIn and several other unfurlers do not render image/svg+xml og:images.
// The agent card must be deliverable as a PNG, and every head that points at it
// must ask for that PNG.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderCard, __testInternals } from '../api/og/agent.js';

describe('agent og card as PNG', () => {
	it('rasterizes the 1200x630 card to a real PNG', async () => {
		const svg = renderCard({ id: 'a1', row: { name: 'Ada', description: 'x', chain_id: 1 }, solAddress: null, balances: null, rep: null, pnl: { sol: 0, wins: 0 }, tipsCount: 0, achievements: null, avatarData: null });
		const png = await __testInternals.svgToPng(svg);
		expect(png.subarray(1, 4).toString()).toBe('PNG');
		expect(png.readUInt32BE(16)).toBe(1200);
		expect(png.readUInt32BE(20)).toBe(630);
	});

	it('serves PNG only when format=png is requested', () => {
		expect(__testInternals.wantsPng('/api/og/agent?id=x&format=png')).toBe(true);
		expect(__testInternals.wantsPng('/api/og/agent?id=x')).toBe(false);
	});

	it.each(['api/agent-share.js', 'api/spotlight-og.js', 'api/agent-detail-og.js'])('%s points og:image at the PNG form', (file) => {
		const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
		expect(src).toMatch(/\/api\/og\/agent\?id=\$\{encodeURIComponent\([^)]*\)\}&format=png/);
	});
});

describe('avatar og thumbnail as a 1200x630 PNG card', () => {
	it('letterboxes a square webp thumbnail into a PNG card', async () => {
		const { default: sharp } = await import('sharp');
		const { thumbnailToCard } = await import('../api/avatar-og.js');
		const webp = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#336699' } }).webp().toBuffer();
		const png = await thumbnailToCard(webp);
		expect(png.subarray(1, 4).toString()).toBe('PNG');
		expect(png.readUInt32BE(16)).toBe(1200);
		expect(png.readUInt32BE(20)).toBe(630);
	});
});
