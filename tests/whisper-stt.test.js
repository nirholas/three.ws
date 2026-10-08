import { describe, it, expect } from 'vitest';
import { createSTT, BrowserSTT } from '../src/runtime/speech.js';
import {
	ON_DEVICE_MODELS,
	MAX_UTTERANCE_SAMPLES,
	WhisperSTT,
	concatFrames,
	onDeviceModelFor,
	onDeviceSupported,
	primaryLanguage,
	transcribeWithFallback,
} from '../src/runtime/whisper-stt.js';

describe('createSTT("whisper")', () => {
	it('no longer throws for the provider the manifest spec has always listed', () => {
		expect(() => createSTT({ provider: 'whisper' })).not.toThrow();
	});

	it('falls back to the browser recognizer where audio capture is impossible', () => {
		// Node has no window, mic or AudioContext: the honest answer is BrowserSTT.
		expect(onDeviceSupported()).toBe(false);
		expect(createSTT({ provider: 'whisper' })).toBeInstanceOf(BrowserSTT);
	});
});

describe('language routing', () => {
	it('reduces a BCP-47 tag to its primary subtag', () => {
		expect(primaryLanguage('pt-BR')).toBe('pt');
		expect(primaryLanguage('zh_Hans')).toBe('zh');
		expect(primaryLanguage('')).toBe('en');
		expect(primaryLanguage(undefined)).toBe('en');
	});

	it('sends English to Moonshine with no language hint', () => {
		expect(onDeviceModelFor('en-US')).toEqual({ model: ON_DEVICE_MODELS.english, options: {} });
		expect(onDeviceModelFor('en-GB').model).toBe(ON_DEVICE_MODELS.english);
	});

	it('sends every other language to Whisper pinned to that language', () => {
		expect(onDeviceModelFor('fr-FR')).toEqual({
			model: ON_DEVICE_MODELS.multilingual,
			options: { language: 'fr', task: 'transcribe' },
		});
		expect(onDeviceModelFor('ja').options.language).toBe('ja');
	});

	it('keeps an utterance inside the 30 s Whisper window', () => {
		expect(MAX_UTTERANCE_SAMPLES).toBeLessThan(30 * 16000);
	});
});

describe('transcribeWithFallback', () => {
	const audio = new Float32Array(16000);

	it('returns the first engine that answers, trimmed, with its id', async () => {
		const out = await transcribeWithFallback(audio, [
			{ id: 'on-device', transcribe: async () => '  hello there ' },
			{ id: 'server', transcribe: async () => 'never reached' },
		]);
		expect(out).toEqual({ text: 'hello there', engine: 'on-device' });
	});

	it('hands over to the next engine when one throws', async () => {
		const out = await transcribeWithFallback(audio, [
			{ id: 'on-device', transcribe: async () => { throw new Error('wasm failed'); } },
			{ id: 'server', transcribe: async () => 'from the server' },
		]);
		expect(out).toEqual({ text: 'from the server', engine: 'server' });
	});

	it('surfaces the last error only when every engine fails', async () => {
		await expect(
			transcribeWithFallback(audio, [
				{ id: 'on-device', transcribe: async () => { throw new Error('first'); } },
				{ id: 'server', transcribe: async () => { throw new Error('/api/asr answered 503'); } },
			]),
		).rejects.toThrow('/api/asr answered 503');
	});

	it('treats silence as an empty transcript, not a failure', async () => {
		const out = await transcribeWithFallback(audio, [{ id: 'on-device', transcribe: async () => null }]);
		expect(out.text).toBe('');
	});
});

describe('WhisperSTT', () => {
	it('tries on-device first and the /api/asr lane second', () => {
		expect(new WhisperSTT().engines().map((e) => e.id)).toEqual(['on-device', 'server']);
	});

	it('normalizes the API origin so the fallback URL never doubles a slash', () => {
		expect(new WhisperSTT({ apiOrigin: 'https://three.ws/' }).apiOrigin).toBe('https://three.ws');
	});

	it('is idle until listen() is called', () => {
		expect(new WhisperSTT().listening).toBe(false);
	});
});

describe('concatFrames', () => {
	it('joins frames in order', () => {
		const out = concatFrames([Float32Array.of(1, 2), Float32Array.of(3), new Float32Array(0)]);
		expect(Array.from(out)).toEqual([1, 2, 3]);
	});
});
