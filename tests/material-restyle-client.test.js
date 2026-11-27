// The Forge Materials panel's AI restyle call (src/shared/material-restyle-client.js).
//
// Pins the two promises the panel makes when the server side cannot deliver:
//   - a down provider gives an honest message that offers the in-browser preset
//     looks, never the server's raw text,
//   - a request that never answers ends in a timeout with its own copy, not a
//     spinner that turns forever.

import { describe, it, expect, vi } from 'vitest';
import { RESTYLE_TIMEOUT_MS, requestServerRestyle } from '../src/shared/material-restyle-client.js';

const SRC = 'https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb';

function reply(status, body, headers = {}) {
	return vi.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		json: async () => body,
	}));
}

describe('requestServerRestyle: success', () => {
	it('posts the cleaned instruction and returns the restyled model', async () => {
		const fetchImpl = reply(200, {
			ok: true,
			glbUrl: 'https://three.ws/cdn/material-studio/restyle/abc.glb',
			factors: { name: 'Polished marble', notes: 'a bright stone' },
		});
		const out = await requestServerRestyle({ glbUrl: SRC, instruction: '  polished   marble ', fetchImpl, headers: { 'x-forge-client': 'c1' } });
		expect(out).toEqual({ glbUrl: 'https://three.ws/cdn/material-studio/restyle/abc.glb', name: 'Polished marble', notes: 'a bright stone' });
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('/api/material-studio?action=restyle');
		expect(JSON.parse(init.body)).toEqual({ glb_url: SRC, instruction: 'polished marble' });
		expect(init.headers['x-forge-client']).toBe('c1');
		expect(init.credentials).toBe('same-origin');
	});

	it('refuses a success body without an https model URL', async () => {
		const fetchImpl = reply(200, { ok: true, glbUrl: 'javascript:alert(1)' });
		await expect(requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl })).rejects.toMatchObject({ code: 'bad_response' });
	});
});

describe('requestServerRestyle: honest failures', () => {
	it('a down provider says so plainly, offers the preset looks, and hides the server text', async () => {
		const fetchImpl = reply(503, {
			error: 'no_provider',
			message: 'AI restyle could not reach a language model: upstream 429 from provider-x org_abc123',
		});
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl }).catch((e) => e);
		expect(err.code).toBe('no_provider');
		expect(err.offerPresets).toBe(true);
		expect(err.message).toMatch(/preset/i);
		expect(err.message).not.toMatch(/provider-x|org_abc123|upstream/);
	});

	it('any other 5xx without a code is treated the same way', async () => {
		const fetchImpl = reply(502, '<html>Bad gateway</html>');
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl }).catch((e) => e);
		expect(err.offerPresets).toBe(true);
		expect(err.message).not.toMatch(/html|gateway/i);
	});

	it('a request that never answers times out with its own copy instead of hanging', async () => {
		let seenSignal = null;
		const fetchImpl = vi.fn((_url, init) => {
			seenSignal = init.signal;
			return new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
			});
		});
		const started = Date.now();
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl, timeoutMs: 60 }).catch((e) => e);
		expect(Date.now() - started).toBeLessThan(2000);
		expect(err.code).toBe('timeout');
		expect(err.offerPresets).toBe(true);
		expect(err.message).toMatch(/stopped waiting/i);
		expect(seenSignal.aborted).toBe(true);
	});

	it('the default timeout is bounded (30 s), longer than the server’s 20 s author budget', () => {
		expect(RESTYLE_TIMEOUT_MS).toBe(30_000);
	});

	it('a caller abort (new model loaded) is reported as aborted, not as an error to show', async () => {
		const ctrl = new AbortController();
		const fetchImpl = vi.fn((_url, init) => new Promise((_r, reject) => {
			init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
		}));
		const pending = requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl, signal: ctrl.signal }).catch((e) => e);
		ctrl.abort();
		const err = await pending;
		expect(err.code).toBe('aborted');
	});

	it('a rate limit says how long to wait, from the body or the Retry-After header', async () => {
		const fromBody = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl: reply(429, { error: 'rate_limited', retry_after: 42 }) }).catch((e) => e);
		expect(fromBody.code).toBe('rate_limited');
		expect(fromBody.retryAfter).toBe(42);
		expect(fromBody.message).toMatch(/42 s/);
		expect(fromBody.offerPresets).toBe(true);
		const fromHeader = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl: reply(429, {}, { 'retry-after': '7' }) }).catch((e) => e);
		expect(fromHeader.retryAfter).toBe(7);
	});

	it('signed out gets a sign-in action, and the presets still work', async () => {
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl: reply(401, { error: 'sign_in_required' }) }).catch((e) => e);
		expect(err.code).toBe('sign_in_required');
		expect(err.action).toBe('sign_in');
		expect(err.message).toMatch(/preset/i);
	});

	it('a network failure gets connection copy', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'gold', fetchImpl }).catch((e) => e);
		expect(err.code).toBe('network');
		expect(err.message).toMatch(/connection/i);
	});

	it('an unknown code still gets our copy, never the server message', async () => {
		const err = await requestServerRestyle({
			glbUrl: SRC,
			instruction: 'gold',
			fetchImpl: reply(418, { error: 'teapot', message: 'secret internal detail at /srv/app.js:12' }),
		}).catch((e) => e);
		expect(err.message).not.toMatch(/secret|srv/);
		expect(err.message).toMatch(/418/);
	});

	it('checks the instruction before any request, with the shared checks', async () => {
		const fetchImpl = reply(200, {});
		const err = await requestServerRestyle({ glbUrl: SRC, instruction: 'ab', fetchImpl }).catch((e) => e);
		expect(err.code).toBe('instruction_too_short');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses a blob or non-https source before any request: the server cannot read it', async () => {
		const fetchImpl = reply(200, {});
		const err = await requestServerRestyle({ glbUrl: 'blob:https://three.ws/123', instruction: 'gold', fetchImpl }).catch((e) => e);
		expect(err.code).toBe('local_source');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
