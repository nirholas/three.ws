// describeImage fetches a caller's imageUrl itself before any model runs. When
// that fetch failed for any reason, or "succeeded" on a page that is not an
// image, it handed the raw URL (or the HTML bytes relabelled image/jpeg) to all
// ten provider lanes, each failed with "media could not be downloaded" or
// "media could not be screened", and /api/vision answered 502 blaming the
// providers, sometimes under the code `rate_limited` borrowed from the paid
// backstop's billing reply. Production returned 42 such 502s and 15 504s in
// twelve hours, every one a caller-fault URL.
//
// A definitive answer from our own fetch (404/410, a host that does not
// resolve or resolves privately, a body that is not an image) is now a 400
// invalid_image_url before any lane is spent. An ambiguous one (403 hotlink
// block, 5xx, timeout) still falls back to provider-side fetching.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

const imageFetch = vi.fn();
vi.mock('../api/_lib/ssrf-guard.js', async (importActual) => ({
	...(await importActual()),
	fetchSafePublicUrl: (...a) => imageFetch(...a),
}));

const providerFetch = vi.fn();
const realFetch = globalThis.fetch;
let describeImage;

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.NVIDIA_API_KEY = 'test-nvidia-key';
	delete process.env.OPENROUTER_API_KEY;
	delete process.env.OPENAI_API_KEY;
	delete process.env.GOOGLE_CLOUD_PROJECT;
	globalThis.fetch = providerFetch;
	({ describeImage } = await import('../api/_lib/vision.js'));
});

afterAll(() => {
	globalThis.fetch = realFetch;
	delete process.env.NVIDIA_API_KEY;
});

beforeEach(() => {
	imageFetch.mockReset();
	providerFetch.mockReset().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content: 'a red square' } }], usage: {} }),
	});
});

function page(status, body, contentType) {
	return new Response(body, { status, headers: contentType ? { 'content-type': contentType } : {} });
}

function call(imageUrl = 'https://images.example.com/pic.png') {
	return describeImage({ prompt: 'describe', imageUrl, timeoutMs: 5000, deadlineMs: 9000 });
}

function sentImageUrl() {
	const body = JSON.parse(providerFetch.mock.calls[0][1].body);
	return body.messages.at(-1).content.find((p) => p.type === 'image_url').image_url.url;
}

describe('describeImage image URL preflight', () => {
	it('rejects a URL that serves an HTML page instead of an image, before any lane runs', async () => {
		imageFetch.mockResolvedValue(page(200, '<!doctype html><title>Home</title>', 'text/html; charset=utf-8'));
		await expect(call('https://images.example.com/')).rejects.toMatchObject({ status: 400, code: 'invalid_image_url' });
		expect(providerFetch).not.toHaveBeenCalled();
	});

	it('rejects a URL the host says does not exist', async () => {
		imageFetch.mockResolvedValue(page(404, 'not found', 'text/plain'));
		await expect(call()).rejects.toMatchObject({ status: 400, code: 'invalid_image_url' });
		expect(providerFetch).not.toHaveBeenCalled();
	});

	it('rejects a host that does not resolve', async () => {
		const { SsrfBlockedError } = await import('../api/_lib/ssrf-guard.js');
		imageFetch.mockRejectedValue(new SsrfBlockedError('dns lookup failed for nope.example: ENOTFOUND'));
		await expect(call('https://nope.example/x.png')).rejects.toMatchObject({ status: 400, code: 'invalid_image_url' });
		expect(providerFetch).not.toHaveBeenCalled();
	});

	it('still lets the providers try a host that blocked our fetch', async () => {
		imageFetch.mockResolvedValue(page(403, 'hotlink denied', 'text/html'));
		const out = await call();
		expect(out.text).toBe('a red square');
		expect(sentImageUrl()).toBe('https://images.example.com/pic.png');
	});

	it('inlines a real image served as octet-stream under its sniffed type', async () => {
		imageFetch.mockResolvedValue(page(200, PNG_1PX, 'application/octet-stream'));
		await call();
		expect(sentImageUrl()).toMatch(/^data:image\/png;base64,/);
	});
});
