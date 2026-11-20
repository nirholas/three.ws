// Grok Imagine provider (api/_lib/xai-image.js): request shape, the two
// documented answer shapes (verbatim docs examples in the fixture module), the
// typed errors the forge lane switches on, and the usage record.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const recorded = [];
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: (evt) => recorded.push(evt) }));
const ledger = [];
vi.mock('../api/_lib/xai-usage.js', () => ({ recordXaiUsage: (row) => ledger.push(row) }));

import {
	generateXaiImage,
	classifyXaiImageFailure,
	parseXaiImageResponse,
	xaiAspect,
	XaiImageError,
	XAI_IMAGINE_CLIENT_ID,
} from '../api/_lib/xai-image.js';
import { XAI_IMAGE_GENERATIONS_URL, XAI_IMAGINE_IMAGE_MODEL } from '../api/_lib/chat-models.js';
import {
	REST_RESPONSE_EXAMPLE,
	DEFERRED_DONE_EXAMPLE_PREFIX,
	LIVE_NO_CREDENTIALS,
	LIVE_INCORRECT_KEY,
} from './fixtures/xai/images-generations.js';

// A real 1x1 PNG, so mime sniffing and byte counts run on genuine image bytes.
const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);
// $0.04 (one Image 2.0 render at the list price) in ticks: 1 cent = 100,000,000.
const FOUR_CENTS_TICKS = 400_000_000;

const json = (status, body) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});

let fetchMock;
const savedKeys = { GROK_API_KEY: process.env.GROK_API_KEY, XAI_API_KEY: process.env.XAI_API_KEY };

beforeEach(() => {
	recorded.length = 0;
	ledger.length = 0;
	process.env.GROK_API_KEY = 'xai-test-key';
	delete process.env.XAI_API_KEY;
	fetchMock = vi.fn();
	globalThis.fetch = fetchMock;
});

afterEach(() => {
	for (const [k, v] of Object.entries(savedKeys)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('parseXaiImageResponse on the docs examples', () => {
	it('reads the verbatim REST response example (url shape) as a URL to download', () => {
		const out = parseXaiImageResponse(JSON.parse(REST_RESPONSE_EXAMPLE));
		expect(out.bytes).toBeNull();
		expect(out.url).toBe('...');
		expect(out.revisedPrompt).toBeNull();
		expect(out.costMicroUsd).toBeNull();
	});

	it('reads mime_type and cost from the deferred poll example', () => {
		const body = JSON.parse(`${DEFERRED_DONE_EXAMPLE_PREFIX}, "usage": {"cost_in_usd_ticks": ${FOUR_CENTS_TICKS}}}`);
		const out = parseXaiImageResponse(body);
		expect(out.url).toBe('...');
		expect(out.mime).toBe('image/jpeg');
		expect(out.costMicroUsd).toBe(40_000);
	});

	it('decodes b64_json and surfaces a revised prompt only when present', () => {
		const out = parseXaiImageResponse({
			data: [{ b64_json: PNG_1PX.toString('base64'), mime_type: 'image/png', revised_prompt: 'a red chair, studio' }],
		});
		expect(out.bytes.equals(PNG_1PX)).toBe(true);
		expect(out.revisedPrompt).toBe('a red chair, studio');
	});

	it('throws bad_response on a body with no image and refused on a moderation flag', () => {
		expect(() => parseXaiImageResponse({ data: [] })).toThrow(expect.objectContaining({ kind: 'bad_response' }));
		expect(() => parseXaiImageResponse({ data: [{ url: '...', respect_moderation: false }] })).toThrow(
			expect.objectContaining({ kind: 'refused' }),
		);
	});
});

describe('classifyXaiImageFailure', () => {
	it('maps the live no-credentials 401 to auth', () => {
		const err = classifyXaiImageFailure(LIVE_NO_CREDENTIALS.status, LIVE_NO_CREDENTIALS.body);
		expect(err).toBeInstanceOf(XaiImageError);
		expect(err.kind).toBe('auth');
		expect(err.providerCode).toBe('unauthenticated:no-credentials');
	});

	it('maps the live 400 "Incorrect API key" answer to auth, not bad request', () => {
		expect(classifyXaiImageFailure(LIVE_INCORRECT_KEY.status, LIVE_INCORRECT_KEY.body).kind).toBe('auth');
	});

	it('maps 429 to rate_limited and a moderation 400 to refused', () => {
		expect(classifyXaiImageFailure(429, '{"code":"resource-exhausted","error":"Too many requests"}').kind).toBe(
			'rate_limited',
		);
		const refused = classifyXaiImageFailure(
			400,
			'{"code":"invalid-argument","error":"Generated image rejected by content moderation."}',
		);
		expect(refused.kind).toBe('refused');
		expect(refused.code).toBe('content_refused');
	});

	it('leaves an ordinary 400 and a 500 as provider_error', () => {
		expect(classifyXaiImageFailure(400, '{"code":"invalid-argument","error":"n must be <= 10"}').kind).toBe(
			'provider_error',
		);
		expect(classifyXaiImageFailure(500, 'upstream exploded').kind).toBe('provider_error');
	});
});

describe('xaiAspect', () => {
	it('passes supported ratios and maps the forge-only ones to the nearest supported', () => {
		expect(xaiAspect('16:9')).toBe('16:9');
		expect(xaiAspect('4:5')).toBe('3:4');
		expect(xaiAspect('')).toBe('1:1');
	});
});

describe('generateXaiImage', () => {
	it('throws no_key without making a request when neither key is set', async () => {
		delete process.env.GROK_API_KEY;
		await expect(generateXaiImage('a chair')).rejects.toMatchObject({ kind: 'no_key' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('falls back to XAI_API_KEY', async () => {
		delete process.env.GROK_API_KEY;
		process.env.XAI_API_KEY = 'xai-fallback-key';
		fetchMock.mockResolvedValueOnce(json(200, { data: [{ b64_json: PNG_1PX.toString('base64') }] }));
		await generateXaiImage('a chair');
		expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer xai-fallback-key');
	});

	it('posts the documented request and returns bytes, mime, cost and a usage row', async () => {
		fetchMock.mockResolvedValueOnce(
			json(200, {
				data: [{ b64_json: PNG_1PX.toString('base64'), mime_type: 'image/png' }],
				usage: { cost_in_usd_ticks: FOUR_CENTS_TICKS },
			}),
		);
		const out = await generateXaiImage('a red armchair', { aspectRatio: '1:1', quality: 'low' });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(XAI_IMAGE_GENERATIONS_URL);
		expect(init.headers.authorization).toBe('Bearer xai-test-key');
		expect(JSON.parse(init.body)).toEqual({
			model: XAI_IMAGINE_IMAGE_MODEL,
			prompt: 'a red armchair',
			n: 1,
			response_format: 'b64_json',
			aspect_ratio: '1:1',
			quality: 'low',
		});
		expect(out.bytes.equals(PNG_1PX)).toBe(true);
		expect(out.mime).toBe('image/png');
		expect(out.b64).toBe(PNG_1PX.toString('base64'));
		expect(out.revisedPrompt).toBeNull();
		expect(out.costMicroUsd).toBe(40_000);

		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			clientId: XAI_IMAGINE_CLIENT_ID,
			provider: 'xai',
			model: XAI_IMAGINE_IMAGE_MODEL,
			kind: 'image',
			status: 'ok',
			costMicroUsd: 40_000,
		});
		await vi.waitFor(() => expect(ledger).toHaveLength(1));
		expect(ledger[0]).toMatchObject({ lane: 'image', model: XAI_IMAGINE_IMAGE_MODEL, units: 1 });
	});

	it('downloads the image when xAI answers with the documented url shape', async () => {
		fetchMock
			.mockResolvedValueOnce(json(200, REST_RESPONSE_EXAMPLE))
			.mockResolvedValueOnce(new Response(PNG_1PX, { status: 200, headers: { 'content-type': 'image/png' } }));
		const out = await generateXaiImage('a teapot');
		expect(fetchMock.mock.calls[1][0]).toBe('...');
		expect(out.bytes.equals(PNG_1PX)).toBe(true);
		expect(out.mime).toBe('image/png');
	});

	it.each([
		['auth', LIVE_NO_CREDENTIALS.status, LIVE_NO_CREDENTIALS.body],
		['auth', LIVE_INCORRECT_KEY.status, LIVE_INCORRECT_KEY.body],
		['rate_limited', 429, '{"code":"resource-exhausted","error":"Too many requests"}'],
		['refused', 400, '{"code":"invalid-argument","error":"Prompt violates the content policy."}'],
	])('throws %s for HTTP %i and records the failed call', async (kind, status, body) => {
		fetchMock.mockResolvedValueOnce(json(status, body));
		await expect(generateXaiImage('a chair')).rejects.toMatchObject({ kind, providerStatus: status });
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({ clientId: XAI_IMAGINE_CLIENT_ID, status: kind, costMicroUsd: null });
		expect(ledger).toHaveLength(0);
	});

	it('throws timeout when xAI does not answer in time', async () => {
		fetchMock.mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => reject(init.signal.reason));
				}),
		);
		await expect(generateXaiImage('a chair', { timeoutMs: 1_000 })).rejects.toMatchObject({ kind: 'timeout' });
	});

	it('throws unreachable on a network failure', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
		await expect(generateXaiImage('a chair')).rejects.toMatchObject({ kind: 'unreachable' });
	});
});
