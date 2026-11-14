import { describe, expect, it } from 'vitest';
import {
	ASSETS,
	BLOCK_END,
	BLOCK_START,
	STORES,
	SCENES,
	SUBMISSION_FILES,
	TRAILER,
	bannedTextIn,
	cuesFor,
	dimensionProblems,
	findBinary,
	listingSafeAgent,
	pickShowcaseAgent,
	submissionBlock,
	timestamp,
	toSrt,
	toVtt,
	trailerEncodeArgs,
	trailerProblems,
	upsertBlock,
	x264Options,
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
		expect(listingSafeAgent({ ...base, name: 'Bridge Monitor 5', description: '' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'Chappie-the-robot-from-the-movie-Chappie', description: 'An agent voiced by the "Chappie-the-robot-from-the-movie-Chappie" voice.' })).toBe(false);
		expect(listingSafeAgent({ ...base, name: 'Harbor', description: 'Sounds like the captain from the film.' })).toBe(false);
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
		expect(bannedTextIn('Launch a coin')).toEqual(['coin']);
		expect(bannedTextIn('No coins launched yet')).toEqual(['coins']);
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

describe('findBinary', () => {
	it('probes each tool with the version flag it accepts', () => {
		// node, like gcloud, rejects the single-dash `-version` that ffmpeg uses.
		expect(findBinary('node', { probe: ['--version'] })).toMatch(/node$/);
	});

	it('names the missing tool and how to get it', () => {
		expect(() => findBinary('gcloud-missing-xyz', { probe: ['--version'], hint: 'Install the Google Cloud CLI.' }))
			.toThrow(/gcloud-missing-xyz not found\. Install the Google Cloud CLI\./);
	});
});

describe('Microsoft Store trailer conformance', () => {
	// What ffprobe and the x264 SEI string report for a cut. The first is the
	// 2026-11-12 upload (three-ws-demo-a9ba45979ad6.mp4), measured from its bytes.
	const stream = { codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080, pix_fmt: 'yuv420p', field_order: 'progressive', r_frame_rate: '30/1' };
	const audio = { codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2 };
	const keyframesEvery = (gop, frames) => Array.from({ length: Math.ceil(frames / gop) }, (_, i) => i * gop);
	const published = {
		probe: { streams: [stream, audio], format: { duration: '64.000000' } },
		x264: x264Options('x264 - core 164 r3191 4613ac3 - H.264/MPEG-4 AVC codec - options: cabac=1 ref=4 bframes=3 b_adapt=1 open_gop=0 keyint=250 keyint_min=25 scenecut=40 rc=crf crf=18.0'),
		keyframes: [0, 250, 500, 750, 1000, 1250, 1500, 1750],
		frames: 1920,
	};
	const conforming = {
		probe: { streams: [stream, audio], format: { duration: '60.000000' } },
		x264: x264Options('x264 - core 164 - options: cabac=1 bframes=2 b_adapt=0 open_gop=0 keyint=15 keyint_min=8 scenecut=0 rc=crf'),
		keyframes: keyframesEvery(15, 1800),
		frames: 1800,
	};

	it('reads the encoder settings x264 writes into the stream', () => {
		expect(x264Options('junk x264 - core 164 - options: cabac=1 bframes=2 open_gop=0 keyint=15\0trailing')).toEqual({ cabac: '1', bframes: '2', open_gop: '0', keyint: '15' });
		expect(x264Options('no encoder string here')).toBeNull();
	});

	it('rejects the 2026-11-12 cut: 3 B-frames, a 250-frame GOP, scene-cut keyframes and 64 seconds', () => {
		const problems = trailerProblems(published).join('\n');
		expect(problems).toMatch(/2 consecutive B-frames/);
		expect(problems).toMatch(/GOP of 15 frames/);
		expect(problems).toMatch(/scene-cut/);
		expect(problems).toMatch(/64\.0 s/);
	});

	it('passes a cut encoded to the published MP4 spec', () => {
		expect(trailerProblems(conforming)).toEqual([]);
	});

	it('flags an open GOP, a missing encoder string, interlacing and the wrong audio', () => {
		const problems = trailerProblems({
			...conforming,
			probe: { streams: [{ ...stream, field_order: 'tt' }, { ...audio, profile: 'HE-AAC', sample_rate: '44100', channels: 1 }], format: { duration: '60' } },
			x264: null,
		}).join('\n');
		expect(problems).toMatch(/x264 settings/);
		expect(problems).toMatch(/progressive/);
		expect(problems).toMatch(/AAC-LC/);
		expect(problems).toMatch(/48 kHz/);
		expect(problems).toMatch(/stereo/);
		expect(trailerProblems({ ...conforming, x264: { ...conforming.x264, open_gop: '1' } }).join()).toMatch(/closed GOP/);
		expect(trailerProblems({ ...conforming, keyframes: [0, 15, 31] }).join()).toMatch(/keyframe at frame 31/);
	});

	it('encodes with the settings the spec names', () => {
		const { video, audio: a } = trailerEncodeArgs();
		const arg = (list, flag) => list[list.indexOf(flag) + 1];
		expect(arg(video, '-c:v')).toBe('libx264');
		expect(arg(video, '-profile:v')).toBe('high');
		expect(arg(video, '-bf')).toBe(String(TRAILER.bFrames));
		expect(arg(video, '-g')).toBe(String(TRAILER.gop));
		expect(arg(video, '-sc_threshold')).toBe('0');
		expect(arg(video, '-flags')).toBe('+cgop');
		expect(arg(video, '-pix_fmt')).toBe('yuv420p');
		expect(arg(a, '-profile:a')).toBe('aac_low');
		expect(arg(a, '-b:a')).toBe('384k');
		expect(arg(a, '-ar')).toBe('48000');
		expect(arg(a, '-ac')).toBe('2');
		expect(TRAILER.gop * 2).toBe(TRAILER.fps);
		expect(TRAILER.seconds).toBe(60);
	});
});
