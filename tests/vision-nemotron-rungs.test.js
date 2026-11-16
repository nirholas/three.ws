// The vision chain's NVIDIA rungs: order, reasoning stripping, and failover.
//
// The NIM lane leads with Nemotron VL models chosen by the measured eval in
// docs/nvidia/evals/ (npm run nvidia:vision-eval). These tests pin what that
// eval decided and how the chain behaves when a rung fails: a retired model
// (404, 410), a throttled host (429) and a hung model (timeout) must each hand
// the request to the next rung instead of failing it.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

let vision;
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;
const PNG_1PX =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.NVIDIA_API_KEY = 'test-nvidia-key';
	process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
	delete process.env.OPENAI_API_KEY;
	delete process.env.GOOGLE_CLOUD_PROJECT;
	delete process.env.CLOUDFLARE_ACCOUNT_ID;
	delete process.env.CLOUDFLARE_AI_API_TOKEN;
	globalThis.fetch = fetchSpy;
	vision = await import('../api/_lib/vision.js');
});

afterAll(() => {
	globalThis.fetch = realFetch;
	delete process.env.NVIDIA_API_KEY;
	delete process.env.OPENROUTER_API_KEY;
});

// Cooldowns live in the in-memory cache across tests; a lane cooled by one
// failover test would otherwise start the next test at the back of the chain.
beforeEach(async () => {
	fetchSpy.mockReset();
	const { clearProviderCooldown } = await import('../api/_lib/provider-health.js');
	await Promise.all(vision.visionChain().map((p) => clearProviderCooldown(`vision:${p.name}:${p.model}`)));
});

function hang() {
	return (_url, opts) =>
		new Promise((_resolve, reject) => {
			opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
		});
}

function reply(content, extra = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			choices: [{ message: { content, ...extra } }],
			usage: { prompt_tokens: 10, completion_tokens: 10 },
		}),
	};
}

function failure(status, body = '') {
	return { ok: false, status, text: async () => body, json: async () => ({}) };
}

function modelOf(callIndex) {
	return JSON.parse(fetchSpy.mock.calls[callIndex][1].body).model;
}

describe('leadWith routes a task to a provider or a model', () => {
	const rung = (name, model) => ({ name, model });
	const chain = [rung('nvidia', 'a'), rung('nvidia', 'b'), rung('nvidia#2', 'a'), rung('nvidia#2', 'b'), rung('openrouter', 'c'), rung('cloudflare', 'd')];
	const order = (c) => c.map((p) => `${p.name}:${p.model}`);

	it('leaves the chain alone without a lead', () => {
		expect(vision.leadWith(chain, null)).toBe(chain);
		expect(vision.leadWith(chain, [])).toBe(chain);
	});

	it('moves every key lane of a lead model to the front, chain order kept within it', () => {
		expect(order(vision.leadWith(chain, ['b']))).toEqual(['nvidia:b', 'nvidia#2:b', 'nvidia:a', 'nvidia#2:a', 'openrouter:c', 'cloudflare:d']);
	});

	it('still matches by provider name', () => {
		expect(order(vision.leadWith(chain, ['cloudflare']))[0]).toBe('cloudflare:d');
	});

	it('puts lead entries in lead order and never duplicates a rung', () => {
		const out = vision.leadWith(chain, ['cloudflare', 'b', 'nvidia#2']);
		expect(order(out)).toEqual(['cloudflare:d', 'nvidia:b', 'nvidia#2:b', 'nvidia#2:a', 'nvidia:a', 'openrouter:c']);
		expect(out).toHaveLength(chain.length);
	});

	it('ignores a lead entry no rung matches', () => {
		expect(order(vision.leadWith(chain, ['retired-model']))).toEqual(order(chain));
	});
});

describe('the rung order the 2026-11-16 eval decided', () => {
	const BOLT = 'nvidia/nemotron-3.5-bolt-e4b';
	const SUPER_VL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

	it('bolt-e4b leads the NIM lane and the previous first rung stays right behind it', () => {
		expect(vision.NVIDIA_VISION_MODELS.map((m) => m.model)).toEqual([BOLT, SUPER_VL]);
		const nim = vision.visionChain().filter((p) => p.name === 'nvidia');
		expect(nim.map((p) => p.model)).toEqual([BOLT, SUPER_VL]);
		expect(vision.visionChain()[0].model).toBe(BOLT);
	});

	it('switches thinking off on both reasoning models', () => {
		for (const m of vision.NVIDIA_VISION_MODELS) expect(m.extraBody).toEqual({ chat_template_kwargs: { enable_thinking: false } });
	});

	it('routes each consumer task to the model that won it', () => {
		expect({ ...vision.VISION_TASK_LEAD }).toEqual({
			caption: [SUPER_VL],
			forge_precheck: [SUPER_VL],
			image3d_review: [SUPER_VL],
			object_detect: [SUPER_VL],
			diorama: [SUPER_VL],
			describe: [BOLT],
			avatar_review: [BOLT],
			quality_gate: [BOLT],
			seed_judge: [BOLT],
		});
	});

	it('a super-vl task asks super-vl first and keeps bolt-e4b behind it', async () => {
		fetchSpy.mockResolvedValueOnce(reply('{"usable":true,"subject":"clock"}'));
		await vision.describeImageJson({ prompt: 'check', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 5000, lead: vision.VISION_TASK_LEAD.forge_precheck });
		expect(modelOf(0)).toBe(SUPER_VL);
		const routed = vision.leadWith(vision.visionChain(), vision.VISION_TASK_LEAD.forge_precheck);
		expect(routed.slice(0, 2).map((p) => p.model)).toEqual([SUPER_VL, BOLT]);
	});

	it('a super-vl task falls to bolt-e4b when super-vl is retired', async () => {
		fetchSpy.mockResolvedValueOnce(failure(410, 'gone')).mockResolvedValueOnce(reply('{"objects":[]}'));
		await vision.describeImageJson({ prompt: 'boxes', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 5000, lead: vision.VISION_TASK_LEAD.object_detect });
		expect([modelOf(0), modelOf(1)]).toEqual([SUPER_VL, BOLT]);
	});

	it('the forge quality gate leads with bolt-e4b, not the Workers AI rung', async () => {
		const { QUALITY_GATE_VISION_LEAD } = await import('../api/_lib/forge-quality-gate.js');
		expect([...QUALITY_GATE_VISION_LEAD]).toEqual([BOLT]);
	});
});

describe('each consumer passes its task lead', () => {
	const PNG = Buffer.from(PNG_1PX, 'base64');

	it('the image-to-3D mention review asks with the image3d_review lead', async () => {
		const { reviewImage } = await import('../api/_lib/x-mention-image3d.js');
		const describe = vi.fn().mockResolvedValue({ json: { safe: true, usable: true, subject: 'clock' } });
		await reviewImage(PNG, 'image/png', { describe });
		expect(describe.mock.calls[0][0].lead).toBe(vision.VISION_TASK_LEAD.image3d_review);
	});

	it('the avatar mention review asks with the avatar_review lead', async () => {
		const { reviewProfileImage } = await import('../api/_lib/x-mention-avatar.js');
		const describe = vi.fn().mockResolvedValue({ json: { safe: true, usable: true } });
		await reviewProfileImage(PNG, 'image/png', { describe });
		expect(describe.mock.calls[0][0].lead).toBe(vision.VISION_TASK_LEAD.avatar_review);
	});
});

describe('stripReasoning', () => {
	it('removes a closed think block and keeps the answer', () => {
		expect(vision.stripReasoning('<think>the user wants JSON</think>\n{"usable":true}')).toBe('{"usable":true}');
	});

	it('removes several blocks and the <thinking> spelling', () => {
		expect(vision.stripReasoning('<thinking>a</thinking>one <think>b</think>two')).toBe('one two');
	});

	it('keeps only what follows a stray closing tag (template ate the opening tag)', () => {
		expect(vision.stripReasoning('I should look at the clock.</think>A mint green alarm clock.')).toBe('A mint green alarm clock.');
	});

	it('returns empty for a reply that is all unfinished thinking', () => {
		expect(vision.stripReasoning('<think>first I will consider the bell, then')).toBe('');
	});

	it('leaves a plain answer untouched', () => {
		expect(vision.stripReasoning('A red apple on a gray backdrop.')).toBe('A red apple on a gray backdrop.');
	});
});

describe('reasoning never reaches a consumer', () => {
	it('describeImage returns the answer without the think block', async () => {
		fetchSpy.mockResolvedValueOnce(reply('<think>The image shows a clock with two bells.</think>A mint green twin bell alarm clock.'));
		const out = await vision.describeImage({ prompt: 'alt text', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 5000 });
		expect(out.text).toBe('A mint green twin bell alarm clock.');
	});

	it('describeImageJson accepts JSON that follows a think block on the first rung', async () => {
		fetchSpy.mockResolvedValueOnce(reply('<think>{maybe usable} let me check</think>{"usable":false,"issue":"text_screenshot"}'));
		const out = await vision.describeImageJson({ prompt: 'check', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 5000 });
		expect(out.json).toEqual({ usable: false, issue: 'text_screenshot' });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('never answers from reasoning_content when content is null', async () => {
		fetchSpy
			.mockResolvedValueOnce(reply(null, { reasoning_content: '{"usable":true} is what I would say' }))
			.mockResolvedValueOnce(reply('{"usable":true}'));
		const out = await vision.describeImageJson({ prompt: 'check', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 5000 });
		expect(out.json).toEqual({ usable: true });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe('a failing Nemotron rung hands the request on', () => {
	const ask = () => vision.describeImage({ prompt: 'alt text', imageBase64: PNG_1PX, mimeType: 'image/png', timeoutMs: 400 });

	it.each([
		[404, 'model not found'],
		[410, 'model has been retired'],
	])('falls to the next rung on %i from the first rung', async (status, body) => {
		const chain = vision.visionChain();
		fetchSpy.mockResolvedValueOnce(failure(status, body)).mockResolvedValueOnce(reply('A green clock.'));
		const out = await ask();
		expect(out.text).toBe('A green clock.');
		expect(modelOf(0)).toBe(chain[0].model);
		expect(modelOf(1)).toBe(chain[1].model);
	});

	it('a NIM 429 skips every remaining rung on the NIM host for this request', async () => {
		const chain = vision.visionChain();
		const firstOffHost = chain.find((p) => !p.url.includes('integrate.api.nvidia.com'));
		fetchSpy.mockResolvedValueOnce(failure(429, '{"status":429,"title":"Too Many Requests"}')).mockResolvedValueOnce(reply('A green clock.'));
		const out = await ask();
		expect(out.text).toBe('A green clock.');
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy.mock.calls[1][0]).toBe(firstOffHost.url);
		expect(modelOf(1)).toBe(firstOffHost.model);
	});

	it('a hung first rung times out and the next rung answers', async () => {
		const chain = vision.visionChain();
		fetchSpy.mockImplementationOnce(hang()).mockResolvedValueOnce(reply('A green clock.'));
		const out = await ask();
		expect(out.text).toBe('A green clock.');
		expect(modelOf(0)).toBe(chain[0].model);
		expect(modelOf(1)).toBe(chain[1].model);
	});

	it('a 410 parks the retired rung so the next request starts on a live one', async () => {
		const chain = vision.visionChain();
		fetchSpy.mockResolvedValueOnce(failure(410, 'gone')).mockResolvedValueOnce(reply('first'));
		await ask();
		fetchSpy.mockResolvedValueOnce(reply('second'));
		await ask();
		expect(modelOf(2)).not.toBe(chain[0].model);
	});
});
