// src/shared/upload-sign-in.js decides, when a visitor adds a photo, whether to
// show the sign-in prompt before the on-device photo check runs. /api/auth/me
// answers 200 for everyone and carries the answer in the body ({"user":null}
// when signed out), so the check must read the body, not the status. Reading
// only the status reported every visitor as signed in, and the prompt only
// appeared after the photo check, when the upload itself was refused.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function response(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function freshModule() {
	vi.resetModules();
	return import('../src/shared/upload-sign-in.js');
}

describe('signedInForUploads', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is false for a signed-out visitor (200 with user null)', async () => {
		fetch.mockResolvedValue(response(200, { user: null }));
		const { signedInForUploads } = await freshModule();
		expect(await signedInForUploads()).toBe(false);
	});

	it('is true for a signed-in visitor', async () => {
		fetch.mockResolvedValue(response(200, { user: { id: 'u1' } }));
		const { signedInForUploads } = await freshModule();
		expect(await signedInForUploads()).toBe(true);
	});

	it('is false on a 401', async () => {
		fetch.mockResolvedValue(response(401, { error: 'unauthorized' }));
		const { signedInForUploads } = await freshModule();
		expect(await signedInForUploads()).toBe(false);
	});

	// An unknowable answer must not block a signed-in visitor: the upload
	// endpoint is the authority and answers sign_in_required itself.
	it('lets the upload endpoint decide when auth is erroring or unreachable', async () => {
		fetch.mockResolvedValue(response(503, { error: 'unavailable' }));
		let mod = await freshModule();
		expect(await mod.signedInForUploads()).toBe(true);

		fetch.mockRejectedValue(new TypeError('Failed to fetch'));
		mod = await freshModule();
		expect(await mod.signedInForUploads()).toBe(true);
	});

	it('asks once per page load', async () => {
		fetch.mockResolvedValue(response(200, { user: null }));
		const { signedInForUploads } = await freshModule();
		await signedInForUploads();
		await signedInForUploads();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('isSignInRequired', () => {
	it('matches only the upload gate refusal', async () => {
		const { isSignInRequired } = await freshModule();
		expect(isSignInRequired(401, { error: 'sign_in_required' })).toBe(true);
		expect(isSignInRequired(401, { error: 'unauthorized' })).toBe(false);
		expect(isSignInRequired(403, { error: 'sign_in_required' })).toBe(false);
		expect(isSignInRequired(401, null)).toBe(false);
	});
});
