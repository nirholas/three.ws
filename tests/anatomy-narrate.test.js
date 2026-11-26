// Anatomy tour narration (api/_lib/anatomy/narrate.js): the facts each step
// sends, the numeral guard, the Grok request (real llmComplete against a
// stubbed fetch that answers with xAI's documented chat completion shape),
// usage attribution to client_id xai-anatomy, and the no-key, 401 and 400 paths
// that read the authored text without ever crediting Grok.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: Object.assign(() => Promise.resolve([]), { unsafe: () => Promise.resolve([]) }) }));
vi.mock('../api/_lib/voice-providers.js', () => ({
	synthesizeVoice: vi.fn(async ({ text }) => ({ audio: Buffer.from(`mp3:${text.length}`), contentType: 'audio/mpeg' })),
}));
vi.mock('../api/_lib/r2.js', () => ({
	objectStorageConfigured: () => false,
	headObject: async () => null,
	getObjectBuffer: async () => Buffer.alloc(0),
	putObject: async () => ({}),
	publicUrl: (key) => `https://cdn.example.test/${key}`,
}));

const { featuredDesign } = await import('../api/_lib/anatomy/featured/index.js');
const narrate = await import('../api/_lib/anatomy/narrate.js');
const { GROK_DEFAULT_MODEL } = await import('../api/_lib/chat-models.js');
const { synthesizeVoice } = await import('../api/_lib/voice-providers.js');

const ENGINE = featuredDesign('85160213-4c15-4b00-ba96-5990b9385249');
const MAIN_CHAMBER_STEP = ENGINE.spec.steps.findIndex((s) => s.title === 'The main chamber');

// xAI's documented chat completion response (OpenAI-compatible), as returned
// by POST https://api.x.ai/v1/chat/completions.
function xaiCompletion(content, model = GROK_DEFAULT_MODEL) {
	return {
		id: 'chatcmpl-test',
		object: 'chat.completion',
		created: 1_763_600_000,
		model,
		choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
		usage: { prompt_tokens: 220, completion_tokens: 64, total_tokens: 284 },
	};
}
// xAI's error bodies, as captured live from api.x.ai on 2026-11-20: no key at
// all answers 401, a key xAI does not recognise answers 400.
const XAI_401_NO_KEY = { code: 'unauthenticated:no-credentials', error: 'No credentials presented.' };
const XAI_400_BAD_KEY = { code: 'invalid-argument', error: 'Incorrect API key provided. You can obtain an API key from https://console.x.ai.' };

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('narration facts and guard', () => {
	it('sends the step title, body and the descriptions of the parts it focuses on', () => {
		const facts = narrate.stepFacts(ENGINE.spec, MAIN_CHAMBER_STEP);
		expect(facts.title).toBe('The main chamber');
		expect(facts.body).toContain('300 bar');
		expect(facts.parts.length).toBeGreaterThan(0);
		const msg = narrate.narrationUserMessage(facts, ENGINE.title);
		expect(msg).toContain('Verified facts:');
		expect(msg).toContain(ENGINE.title);
	});

	it('returns null for a step that does not exist', () => {
		expect(narrate.stepFacts(ENGINE.spec, 99)).toBeNull();
	});

	it('forbids adding facts in the system prompt', () => {
		expect(narrate.NARRATION_SYSTEM_PROMPT).toMatch(/Use only the facts given\. Do not add any fact, number/);
	});

	it('flags numbers the answer invented and accepts ones from the facts', () => {
		const facts = narrate.stepFacts(ENGINE.spec, MAIN_CHAMBER_STEP);
		expect(narrate.inventedNumbers('It ran at 300 bar in 2022 and 350 bar in 2023.', facts)).toEqual([]);
		expect(narrate.inventedNumbers('It ran at 330 bar and made 280 tonnes.', facts)).toEqual(['330', '280']);
	});

	it('cleans markdown and dashes out of a model answer', () => {
		expect(narrate.cleanNarration('"**Hot gas** meets \u2014 hot gas."')).toBe('Hot gas meets, hot gas.');
		expect(narrate.cleanNarration('   ')).toBe('');
	});
});

describe('grokNarration', () => {
	const facts = () => narrate.stepFacts(ENGINE.spec, MAIN_CHAMBER_STEP);

	it('calls xAI chat completions with the default Grok model and returns the answer', async () => {
		const calls = [];
		vi.stubGlobal('fetch', async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers?.Authorization || init.headers?.authorization });
			return jsonResponse(200, xaiCompletion('The two gases finish burning at very high pressure, reported at 300 bar in 2022.'));
		});
		try {
			const chain = (await import('../api/_lib/llm.js')).providerChain({ grokKey: 'xai-test-key', grokModel: GROK_DEFAULT_MODEL }).filter((p) => p.name === 'grok');
			const out = await narrate.grokNarration({ facts: facts(), designTitle: ENGINE.title, step: MAIN_CHAMBER_STEP, designId: ENGINE.id, chain });
			expect(out).toEqual({ text: 'The two gases finish burning at very high pressure, reported at 300 bar in 2022.', model: GROK_DEFAULT_MODEL });
			const xai = calls.find((c) => c.url === 'https://api.x.ai/v1/chat/completions');
			expect(xai, calls.map((c) => c.url).join(', ')).toBeTruthy();
			expect(xai.body.model).toBe(GROK_DEFAULT_MODEL);
			expect(xai.body.messages[0]).toEqual({ role: 'system', content: narrate.NARRATION_SYSTEM_PROMPT });
			expect(xai.auth).toBe('Bearer xai-test-key');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('attributes usage to client_id xai-anatomy', async () => {
		const complete = vi.fn(async () => ({ text: 'Both gases finish burning in the chamber.', model: GROK_DEFAULT_MODEL }));
		await narrate.grokNarration({ facts: facts(), designTitle: ENGINE.title, step: MAIN_CHAMBER_STEP, designId: ENGINE.id, complete, chain: [{ name: 'grok' }] });
		expect(complete.mock.calls[0][0].track).toEqual({ clientId: 'xai-anatomy', tool: 'anatomy_narrate' });
		expect(narrate.NARRATION_CLIENT_ID).toBe('xai-anatomy');
	});

	it('discards an answer that invents a number', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const complete = async () => ({ text: 'It runs at 330 bar today.', model: GROK_DEFAULT_MODEL });
		expect(await narrate.grokNarration({ facts: facts(), designTitle: ENGINE.title, step: MAIN_CHAMBER_STEP, designId: ENGINE.id, complete, chain: [{ name: 'grok' }] })).toBeNull();
		expect(warn.mock.calls.flat().join(' ')).toMatch(/guard rejected grok answer.*invented 330/);
		warn.mockRestore();
	});

	it('returns null without a configured chain', async () => {
		expect(await narrate.grokNarration({ facts: facts(), designTitle: ENGINE.title, step: 0, designId: ENGINE.id, chain: null })).toBeNull();
	});
});

describe('narrateStep', () => {
	const saved = { GROK_API_KEY: process.env.GROK_API_KEY, XAI_API_KEY: process.env.XAI_API_KEY };
	beforeEach(() => {
		synthesizeVoice.mockClear();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('reads the authored text with no Grok key, and never calls xAI', async () => {
		delete process.env.GROK_API_KEY;
		delete process.env.XAI_API_KEY;
		const fetchSpy = vi.fn(async () => jsonResponse(500, {}));
		vi.stubGlobal('fetch', fetchSpy);
		const out = await narrate.narrateStep({ design: ENGINE, step: 1, verified: true });
		expect(out.source).toBe('authored');
		expect(out.model).toBeNull();
		expect(out.text).toBe(narrate.authoredNarration(narrate.stepFacts(ENGINE.spec, 1)));
		expect(out.audio.contentType).toBe('audio/mpeg');
		expect(out.audio.base64.length).toBeGreaterThan(0);
		expect(out.audioUrl).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(synthesizeVoice).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', voiceId: narrate.NARRATION_VOICE }));
	});

	for (const [status, body] of [[401, XAI_401_NO_KEY], [400, XAI_400_BAD_KEY]]) {
		it(`falls back to the authored text when xAI answers ${status} ${body.code}`, async () => {
			process.env.GROK_API_KEY = 'xai-invalid-key';
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			vi.stubGlobal('fetch', async (url) => (String(url).startsWith('https://api.x.ai/') ? jsonResponse(status, body) : jsonResponse(500, {})));
			const out = await narrate.narrateStep({ design: ENGINE, step: 2, verified: true });
			expect(out.source).toBe('authored');
			expect(out.model).toBeNull();
			expect(warn.mock.calls.flat().join(' ')).toMatch(/grok failed/);
			warn.mockRestore();
		});
	}

	it('speaks the Grok narration for a featured design when xAI answers', async () => {
		process.env.GROK_API_KEY = 'xai-test-key';
		vi.stubGlobal('fetch', async (url) => (String(url).startsWith('https://api.x.ai/') ? jsonResponse(200, xaiCompletion('Methane soaks up heat in the wall channels before it reaches the preburner.')) : jsonResponse(500, {})));
		const out = await narrate.narrateStep({ design: ENGINE, step: 3, verified: true });
		expect(out.source).toBe('grok');
		expect(out.model).toBe(GROK_DEFAULT_MODEL);
		expect(out.text).toMatch(/^Methane soaks up heat/);
	});

	it('never sends a design that is not featured to Grok', async () => {
		process.env.GROK_API_KEY = 'xai-test-key';
		const fetchSpy = vi.fn(async () => jsonResponse(200, xaiCompletion('anything')));
		vi.stubGlobal('fetch', fetchSpy);
		const out = await narrate.narrateStep({ design: { ...ENGINE, id: '11111111-1111-4111-8111-111111111111' }, step: 0, verified: false });
		expect(out.source).toBe('authored');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a step outside the tour', async () => {
		await expect(narrate.narrateStep({ design: ENGINE, step: 40, verified: true })).rejects.toMatchObject({ code: 'invalid_step', status: 400 });
	});
});
