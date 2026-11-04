// api/_lib/og-image.js replaced @vercel/og (whose only release on a patched
// satori crashes under plain-Node ESM with "Dynamic require of fs"). These
// tests drive the real satori + sharp pipeline, no mocks.

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageResponse, renderPng, twemojiCode } from '../api/_lib/og-image.js';

const card = {
	type: 'div',
	props: {
		style: { display: 'flex', width: '100%', height: '100%', background: '#0b0b0f', color: '#fff', fontSize: 72 },
		children: 'three.ws',
	},
};

describe('og-image renderer', () => {
	it('renders a 1200x630 PNG with the default Geist font when no fonts are passed', async () => {
		const png = await renderPng(card);
		const meta = await sharp(png).metadata();
		expect(meta.format).toBe('png');
		expect(meta.width).toBe(1200);
		expect(meta.height).toBe(630);
	});

	it('honors a custom size', async () => {
		const meta = await sharp(await renderPng(card, { width: 600, height: 315 })).metadata();
		expect([meta.width, meta.height]).toEqual([600, 315]);
	});

	it('ImageResponse is a Web Response carrying PNG bytes and merged headers', async () => {
		const res = new ImageResponse(card, { headers: { 'cache-control': 'public, max-age=60' }, status: 200 });
		expect(res).toBeInstanceOf(Response);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toBe('public, max-age=60');
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	});

	it('ImageResponse surfaces a render failure as a stream error instead of hanging', async () => {
		const res = new ImageResponse({ type: 'div', props: { style: { display: 'block' }, children: [{ type: 'span', props: { children: 'a' } }, { type: 'span', props: { children: 'b' } }] } });
		await expect(res.arrayBuffer()).rejects.toThrow();
	});
});

describe('twemojiCode', () => {
	it('drops the variation selector on single emoji', () => {
		expect(twemojiCode('\u2764\ufe0f')).toBe('2764');
	});
	it('keeps the full sequence for ZWJ composites', () => {
		expect(twemojiCode('\u{1F469}\u200d\u{1F4BB}')).toBe('1f469-200d-1f4bb');
	});
	it('encodes astral code points', () => {
		expect(twemojiCode('\u{1F680}')).toBe('1f680');
	});
});
