// Legal fix H6: the Microsoft Edge Read Aloud lane (TRUSTED_CLIENT_TOKEN,
// spoofed Edge UA, Sec-MS-GEC) is removed. Stored Edge voice ids must map to a
// licensed lane instead of erroring, and nothing may reach speech.platform.bing.com.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const ORIGINAL_FETCH = globalThis.fetch;
let calls = [];

beforeEach(() => {
	calls = [];
	process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
	vi.resetModules();
	vi.doMock('../../api/_lib/gcp-auth.js', () => ({ getGcpAccessToken: async () => 'tok' }));
	globalThis.fetch = vi.fn(async (url, opts = {}) => {
		calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
		const pcm = Buffer.alloc(480).toString('base64');
		return new Response(
			JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm } }] } }] }),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	});
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	delete process.env.GOOGLE_CLOUD_PROJECT;
	vi.doUnmock('../../api/_lib/gcp-auth.js');
});

describe('Edge TTS removal', () => {
	it('deletes the Edge protocol modules', () => {
		expect(existsSync('api/_lib/tts-edge.js')).toBe(false);
		expect(existsSync('api/_lib/tts-edge-gec.js')).toBe(false);
	});

	it('no source file references the Edge Read Aloud host or token', () => {
		for (const f of ['api/_lib/voice-providers.js', 'api/tts/edge.js', 'api/tts/synthesize.js']) {
			const src = readFileSync(f, 'utf8');
			expect(src).not.toMatch(/speech\.platform\.bing\.com|TrustedClientToken|Sec-MS-GEC/i);
		}
	});

	it('is not in the provider registry', async () => {
		const { PROVIDER_IDS } = await import('../../api/_lib/voice-providers.js');
		expect(PROVIDER_IDS).not.toContain('edge');
		expect(PROVIDER_IDS[0]).toBe('gemini');
	});

	it('defaults to the Google Gemini lane', async () => {
		const { providerDefaultVoice, DEFAULT_PROVIDER_ID } = await import('../../api/_lib/voice-providers.js');
		expect(DEFAULT_PROVIDER_ID).toBe('gemini');
		expect(providerDefaultVoice(DEFAULT_PROVIDER_ID)).toBe('Kore');
	});
});

describe('legacy Edge voice ids', () => {
	it('map to a real Gemini voice, deterministically', async () => {
		const { mapLegacyEdgeVoice } = await import('../../api/_lib/tts-voice-map.js');
		const { GEMINI_VOICES } = await import('../../api/_lib/tts-gemini.js');
		const ids = new Set(GEMINI_VOICES.map((v) => v.id));
		for (const v of ['en-US-AriaNeural', 'en-GB-RyanNeural', 'zh-CN-XiaoxiaoNeural', 'xx-YY-WeirdNeural']) {
			expect(ids.has(mapLegacyEdgeVoice(v))).toBe(true);
			expect(mapLegacyEdgeVoice(v)).toBe(mapLegacyEdgeVoice(v));
		}
		expect(mapLegacyEdgeVoice('not a voice')).toBe('Kore');
	});

	it('are accepted by isKnownVoice on the gemini lane and the legacy edge alias', async () => {
		const { isKnownVoice } = await import('../../api/_lib/voice-providers.js');
		expect(await isKnownVoice('gemini', 'en-US-AndrewMultilingualNeural')).toBe(true);
		expect(await isKnownVoice('edge', 'en-US-AriaNeural')).toBe(true);
	});

	it('synthesize as Gemini and never call speech.platform.bing.com', async () => {
		const { synthesizeVoice } = await import('../../api/_lib/voice-providers.js');
		for (const provider of ['edge', 'gemini']) {
			const out = await synthesizeVoice({ provider, voiceId: 'en-US-AriaNeural', text: 'Hello there.' });
			expect(out.provider).toBe('gemini');
			expect(out.audio.length).toBeGreaterThan(0);
		}
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) {
			expect(c.url).not.toContain('bing.com');
			expect(c.url).toContain('aiplatform.googleapis.com');
			expect(c.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).not.toMatch(/Neural/);
		}
	});
});
