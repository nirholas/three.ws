import { describe, expect, it } from 'vitest';
import {
	ASSETS,
	BLOCK_END,
	BLOCK_START,
	STORES,
	SCENES,
	SUBMISSION_FILES,
	bannedTextIn,
	cuesFor,
	dimensionProblems,
	listingSafeAgent,
	pickShowcaseAgent,
	submissionBlock,
	timestamp,
	toSrt,
	toVtt,
	upsertBlock,
} from '../scripts/lib/microsoft-listing-media.mjs';

describe('store requirements', () => {
	it('fills every published slot size with an exact asset', () => {
		const sizes = (store) => ASSETS.filter((a) => a.store === store).map((a) => `${a.width}x${a.height}`);
		expect(sizes('marketplace').filter((s) => s === '1280x720').length).toBeGreaterThanOrEqual(5);
		expect(sizes('teams').every((s) => s === '1366x768')).toBe(true);
		expect(sizes('msstore')).toContain('300x300');
		expect(sizes('msstore')).toContain('1920x1080');
		expect(sizes('edge')).toEqual(expect.arrayContaining(['300x300', '440x280', '1400x560']));
	});

	it('stays inside each store count limit', () => {
		const count = (store) => ASSETS.filter((a) => a.store === store && /^screenshot-/.test(a.file)).length;
		expect(count('marketplace')).toBeLessThanOrEqual(5);
		expect(count('teams')).toBeLessThanOrEqual(5);
		expect(count('msstore')).toBeLessThanOrEqual(10);
	});

	it('names a source page for every store and a caption for every scene an asset uses', () => {
		for (const spec of Object.values(STORES)) expect(spec.source).toMatch(/^https:\/\/(learn\.microsoft\.com|code\.visualstudio\.com)\//);
		const artwork = new Set(['logo', 'edge-logo', 'tile-small', 'tile-large', 'video-thumbnail']);
		for (const a of ASSETS) expect(artwork.has(a.from) || Boolean(SCENES[a.from])).toBe(true);
		const files = ASSETS.map((a) => `${a.store}/${a.file}`);
		expect(new Set(files).size).toBe(files.length);
	});

	it('references every store from at least one submission file', () => {
		const covered = new Set(Object.values(SUBMISSION_FILES).flat());
		for (const store of Object.keys(STORES)) expect(covered.has(store)).toBe(true);
	});

	it('caps Teams screenshots at the published 1,024 KB', () => {
		for (const a of ASSETS.filter((x) => x.store === 'teams')) expect(a.maxBytes).toBe(1024 * 1024);
	});
});

describe('dimensionProblems', () => {
	const slot = { store: 'teams', file: 'a.png', width: 1366, height: 768, format: 'png', maxBytes: 1000, opaque: true };

	it('passes an exact, opaque, small file', () => {
		expect(dimensionProblems(slot, { width: 1366, height: 768, format: 'png', hasAlpha: false }, 999)).toEqual([]);
	});

	it('names every way a file misses its slot', () => {
		const problems = dimensionProblems(slot, { width: 1280, height: 720, format: 'jpeg', hasAlpha: true }, 5000);
		expect(problems).toHaveLength(4);
		expect(problems[0]).toContain('1280x720');
		expect(problems[0]).toContain('1366x768');
	});

	it('checks minimum and square slots for referenced images', () => {
		const icon = { store: 'vscode', file: 'icon.png', minWidth: 128, minHeight: 128, square: true, format: 'png' };
		expect(dimensionProblems(icon, { width: 256, height: 256, format: 'png', hasAlpha: true }, 10)).toEqual([]);
		expect(dimensionProblems(icon, { width: 96, height: 128, format: 'png' }, 10)).toHaveLength(2);
	});
});

describe('listing-safe agents', () => {
	const base = { id: 'a', avatar_thumbnail: 'https://three.ws/t.png', skills: ['greet', 'web-search'] };

	it('keeps a named agent with a body and plain skills', () => {
		expect(listingSafeAgent({ ...base, name: 'Reeza', description: 'A helpful, honest assistant.' })).toBe(true);
	});

	it('drops crypto agents, placeholder names and bodiless agents', () => {
		expect(listingSafeAgent({ ...base, name: 'Market Oracle', description: 'Monitors funding rates and flags elevated liquidation risk.' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'Patchwork', skills: ['greet', 'pump-fun-trade'] })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'Sunshine Trader', description: 'Expert crypto investment advice' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'probe21c7ca' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'My First Agent' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'Agent' })).toBe(false);
		expect(listingSafeAgent({ id: 'b', name: 'Ghost', skills: [] })).toBe(false);
	});

	it('picks the safe agent with the most chats', () => {
		const pick = pickShowcaseAgent([
			{ ...base, id: '1', name: 'Patchwork', chat_count: 90, skills: ['pump-fun-monitor'] },
			{ ...base, id: '2', name: 'Reeza', chat_count: 37 },
			{ ...base, id: '3', name: 'Sherlox', chat_count: 5 },
		]);
		expect(pick.id).toBe('2');
		expect(pickShowcaseAgent([])).toBeNull();
	});
});

describe('bannedTextIn', () => {
	it('flags the token, crypto vocabulary and transient prompts', () => {
		expect(bannedTextIn('High $THREE')).toEqual(['$THREE']);
		expect(bannedTextIn('Getting started 0/3')).toHaveLength(1);
		expect(bannedTextIn('Connect your Solana wallet')).toHaveLength(2);
	});

	it('leaves ordinary product copy alone', () => {
		expect(bannedTextIn('Describe an object. Forge turns it into a textured 3D model. Download GLB.')).toEqual([]);
	});
});

describe('captions', () => {
	const cues = cuesFor([
		{ start: 0, duration: 4, lines: ['One', 'Two'] },
		{ start: 4, duration: 0, lines: ['Skipped'] },
		{ start: 4, duration: 3, lines: ['Three'] },
	]);

	it('splits a segment evenly between its lines and skips empty segments', () => {
		expect(cues.map((c) => c.text)).toEqual(['One', 'Two', 'Three']);
		expect(cues[0]).toEqual({ start: 0, end: 1.9, text: 'One' });
		expect(cues[1]).toEqual({ start: 2, end: 3.9, text: 'Two' });
		expect(cues[2].start).toBe(4);
	});

	it('formats SRT and WebVTT timestamps', () => {
		expect(timestamp(3725.5)).toBe('01:02:05,500');
		expect(timestamp(1.25, '.')).toBe('00:00:01.250');
		expect(toSrt(cues).split('\n').slice(0, 3)).toEqual(['1', '00:00:00,000 --> 00:00:01,900', 'One']);
		expect(toVtt(cues).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.900\nOne\n')).toBe(true);
	});
});

describe('submission blocks', () => {
	const manifest = {
		capturedAt: '2026-11-11T12:00:00.000Z',
		base: 'https://three.ws',
		requirementsRead: '2026-11-11',
		assets: [{ store: 'msstore', path: 'marketing/microsoft/media/msstore/tile-icon-300x300.png', width: 300, height: 300, bytes: 2048 }],
		video: {
			url: 'https://storage.googleapis.com/b/v.mp4', width: 1920, height: 1080, durationSeconds: 64, bytes: 3 * 1024 * 1024, sha256: 'ab12',
			srt: 'marketing/microsoft/media/video/trailer.srt', vtt: 'marketing/microsoft/media/video/trailer.vtt',
		},
	};

	it('links each asset relative to the submission file and states the video handling per store', () => {
		const block = submissionBlock(manifest, ['msstore', 'teams'], '../../../../');
		expect(block.startsWith(BLOCK_START)).toBe(true);
		expect(block.endsWith(BLOCK_END)).toBe(true);
		expect(block).toContain('](../../../../marketing/microsoft/media/msstore/tile-icon-300x300.png): 300 x 300, 2 KB');
		expect(block).toContain('sha256 `ab12`');
		expect(block).toContain('trailer.vtt');
		expect(block).toContain('takes a YouTube or Vimeo link, not a file');
	});

	it('replaces an existing block in place and appends one otherwise', () => {
		const block = `${BLOCK_START}\nnew\n${BLOCK_END}`;
		expect(upsertBlock(`# T\n\n${BLOCK_START}\nold\n${BLOCK_END}\n\nTail\n`, block)).toBe(`# T\n\n${block}\n\nTail\n`);
		expect(upsertBlock('# T\n', block)).toBe(`# T\n\n${block}\n`);
	});
});
