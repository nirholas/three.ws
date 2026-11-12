// The gateway's ffmpeg lookup: a declared ffmpeg-static whose binary was never
// downloaded (its install script skipped) must not be handed to spawn.

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
	vi.doUnmock('ffmpeg-static');
	vi.resetModules();
	delete process.env.FFMPEG_PATH;
});

describe('gateway ffmpegPath', () => {
	it('uses FFMPEG_PATH when set', async () => {
		process.env.FFMPEG_PATH = '/opt/ffmpeg/bin/ffmpeg';
		const { ffmpegPath } = await import('../api/_lib/gateway/audio.js');
		expect(ffmpegPath()).toBe('/opt/ffmpeg/bin/ffmpeg');
	});

	it('falls back to ffmpeg on PATH when the ffmpeg-static binary is missing on disk', async () => {
		vi.doMock('node:module', async (orig) => {
			const actual = await orig();
			return { ...actual, createRequire: () => (id) => (id === 'ffmpeg-static' ? '/nonexistent/ffmpeg-static/ffmpeg' : actual.createRequire(import.meta.url)(id)) };
		});
		const { ffmpegPath } = await import('../api/_lib/gateway/audio.js');
		expect(ffmpegPath()).toBe('ffmpeg');
		vi.doUnmock('node:module');
	});
});
