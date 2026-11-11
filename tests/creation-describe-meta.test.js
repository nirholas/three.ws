/**
 * Meta description and alt text fallback order for /m/:id (work order 819).
 *
 * Order: the Florence-2 detailed caption, then the short caption, then the
 * prompt. The server head (server/creation-head.mjs) and the client renderer
 * (src/model-page.js) both read the same helpers in src/model-lib.js.
 */
import { describe, it, expect } from 'vitest';
import { creationAltText, creationDescribedText } from '../src/model-lib.js';
import { creationMeta, rewriteCreationHead } from '../server/creation-head.mjs';

const base = {
	id: '0b9c1f3e-58f4-4b5e-9a39-2d7f5a1c0e11',
	prompt: 'a brass lantern with a glass chimney',
	glb_url: 'https://cdn.three.ws/forge/x.glb',
	size_bytes: 1000,
	created_at: '2026-11-01T00:00:00Z',
};
const detailed =
	'The image shows a brass lantern with a round glass chimney and a curved wire handle on top. The base is a flat disc.';
const caption = 'A brass lantern with a handle.';

describe('creationDescribedText', () => {
	it('prefers the detailed caption, then the caption, then nothing', () => {
		expect(creationDescribedText({ ...base, described: { detailed, caption } })).toBe(detailed);
		expect(creationDescribedText({ ...base, described: { detailed: '', caption } })).toBe(caption);
		expect(creationDescribedText({ ...base, described: null })).toBe('');
		expect(creationDescribedText(base)).toBe('');
	});
});

describe('creationAltText', () => {
	it('uses the detailed caption when present', () => {
		expect(creationAltText({ ...base, described: { detailed, caption } })).toBe(detailed);
	});

	it('falls back to the short caption', () => {
		expect(creationAltText({ ...base, described: { caption } })).toBe(caption);
	});

	it('falls back to the prompt title when the creation was never described', () => {
		expect(creationAltText(base)).toBe('A brass lantern with a glass chimney, a 3D model');
	});

	it('cuts a long caption on a sentence or word boundary', () => {
		const long = `${'A carved wooden chest with iron bands. '.repeat(20)}`.trim();
		const alt = creationAltText({ ...base, described: { detailed: long } });
		expect(alt.length).toBeLessThanOrEqual(250);
		expect(alt.endsWith('.')).toBe(true);
	});
});

describe('creationMeta / rewriteCreationHead', () => {
	it('leads the meta description with the detailed caption', () => {
		const m = creationMeta({ ...base, described: { detailed, caption } }, 'https://three.ws');
		expect(m.description.startsWith('The image shows a brass lantern')).toBe(true);
		expect(m.description).toContain('3D model on three.ws');
		expect(m.description).not.toContain('generated from the prompt');
	});

	it('falls back to the caption, then the prompt', () => {
		const c = creationMeta({ ...base, described: { caption } }, 'https://three.ws');
		expect(c.description.startsWith('A brass lantern with a handle.')).toBe(true);
		const p = creationMeta(base, 'https://three.ws');
		expect(p.description).toContain('generated from the prompt "a brass lantern with a glass chimney"');
	});

	it('writes the described alt text into og:image:alt and twitter:image:alt', () => {
		const shell = '<html><head><title>x</title><meta name="description" content="y" /></head><body></body></html>';
		const html = rewriteCreationHead(shell, { ...base, described: { detailed, caption } }, 'https://three.ws');
		expect(html).toContain(`<meta property="og:image:alt" content="${detailed}" />`);
		expect(html).toContain(`<meta name="twitter:image:alt" content="${detailed}" />`);
		const plain = rewriteCreationHead(shell, base, 'https://three.ws');
		expect(plain).toContain('<meta property="og:image:alt" content="A brass lantern with a glass chimney, a 3D model on three.ws" />');
	});
});
