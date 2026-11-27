import { describe, it, expect, vi } from 'vitest';
import { uploadForgePhoto, importForgeImageUrl } from '../src/shared/forge-upload-client.js';

// The photo upload both Forge pages share: presign at /api/forge-upload, then a
// PUT straight to object storage. Every way it can fail gets its own short
// line for the photo tile, and says whether pressing Retry (which re-sends the
// same photo, so the person never has to find it again) can help.

const PRESIGN_OK = { upload_url: 'https://storage.example/put?sig=1', public_url: 'https://cdn.example/forge/uploads/a/b.jpg' };
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'mug.jpg', { type: 'image/jpeg' });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A scripted network: the presign answer, then the storage answer.
function network({ presign = () => json(200, PRESIGN_OK), put = () => new Response(null, { status: 200 }) } = {}) {
	const calls = [];
	const fetchImpl = vi.fn(async (url, init = {}) => {
		calls.push({ url, init });
		return url === '/api/forge-upload' ? presign(init) : put(init);
	});
	return { fetchImpl, calls };
}

describe('uploadForgePhoto', () => {
	it('presigns with the real type and size, PUTs the same bytes, and returns the public URL', async () => {
		const file = photo();
		const { fetchImpl, calls } = network();
		const r = await uploadForgePhoto(file, { fetchImpl, headers: { 'x-forge-client': 'c1' } });
		expect(r).toEqual({ ok: true, url: PRESIGN_OK.public_url });
		expect(JSON.parse(calls[0].init.body)).toEqual({ content_type: 'image/jpeg', size_bytes: file.size });
		expect(calls[0].init.headers['x-forge-client']).toBe('c1');
		expect(calls[1].init.method).toBe('PUT');
		expect(calls[1].init.body).toBe(file);
	});

	it('the person is offline: says so and Retry can help', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		const r = await uploadForgePhoto(photo(), { fetchImpl, isOnline: () => false });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('network');
		expect(r.message).toMatch(/connection/i);
		expect(r.message).toMatch(/Retry/);
		expect(r.retryable).toBe(true);
	});

	it('the connection drops mid-upload: blames the connection, not our storage, when the browser is offline', async () => {
		const { fetchImpl } = network({
			put: () => {
				throw new TypeError('Failed to fetch');
			},
		});
		const r = await uploadForgePhoto(photo(), { fetchImpl, isOnline: () => false });
		expect(r.code).toBe('network');
		expect(r.retryable).toBe(true);
	});

	it('the upload stalls: gives up after the timeout instead of spinning forever', async () => {
		const { fetchImpl } = network({
			put: (init) =>
				new Promise((_, reject) => {
					init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				}),
		});
		const r = await uploadForgePhoto(photo(), { fetchImpl, timeoutMs: 30 });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('upload_timeout');
		expect(r.message).toMatch(/Retry/);
		expect(r.retryable).toBe(true);
	});

	it.each([500, 502, 503])('storage answers %s: the tile offers Retry, which keeps the photo', async (status) => {
		const { fetchImpl } = network({ put: () => new Response('err', { status }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('upload_rejected');
		expect(r.message).toMatch(/Retry/);
		expect(r.message).not.toMatch(/Add it again/);
		expect(r.retryable).toBe(true);
	});

	it('a 413 says the file is too large and that retrying the same file will not help', async () => {
		const { fetchImpl } = network({ presign: () => json(413, { error: 'payload_too_large' }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('payload_too_large');
		expect(r.message).toMatch(/too large/i);
		expect(r.retryable).toBe(false);
	});

	it('a 413 from storage itself is read the same way', async () => {
		const { fetchImpl } = network({ put: () => new Response('', { status: 413 }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl });
		expect(r.code).toBe('payload_too_large');
		expect(r.retryable).toBe(false);
	});

	it('an expired session asks the person to sign in and keeps the photo for after', async () => {
		const onSignIn = vi.fn();
		const { fetchImpl } = network({ presign: () => json(401, { error: 'sign_in_required' }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl, onSignIn });
		expect(onSignIn).toHaveBeenCalledOnce();
		expect(r.ok).toBe(false);
		expect(r.code).toBe('sign_in');
		expect(r.retryable).toBe(true);
	});

	it('storage paused on our side: says uploads are paused, Retry can help later', async () => {
		const { fetchImpl } = network({ presign: () => json(503, { error: 'storage_unavailable', retry_after: 60 }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl });
		expect(r.code).toBe('storage_unavailable');
		expect(r.message).toMatch(/paused/i);
		expect(r.retryable).toBe(true);
	});

	it('a deployment with no storage at all is not offered a Retry that cannot work', async () => {
		const { fetchImpl } = network({ presign: () => json(503, { error: 'unconfigured' }) });
		const r = await uploadForgePhoto(photo(), { fetchImpl });
		expect(r.code).toBe('unconfigured');
		expect(r.retryable).toBe(false);
	});
});

describe('importForgeImageUrl', () => {
	it('asks the server to fetch the link and returns a File named after it, typed from the bytes', async () => {
		const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
		const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'x-image-format': 'heic', 'content-type': 'application/octet-stream' } }));
		const r = await importForgeImageUrl('https://images.example/photos/IMG_0412.HEIC?w=1', { fetchImpl });
		expect(r.ok).toBe(true);
		expect(r.file.name).toBe('IMG_0412.heic');
		expect(r.file.type).toBe('image/heic');
		expect(r.file.size).toBe(bytes.length);
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ source_url: 'https://images.example/photos/IMG_0412.HEIC?w=1' });
	});

	it('shows the server\'s own sentence about the link when it is refused', async () => {
		const message = 'That link is a web page with no image Forge can find on it.';
		const fetchImpl = vi.fn(async () => json(415, { error: 'url_not_image', message }));
		const r = await importForgeImageUrl('https://blog.example/post', { fetchImpl });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('url_not_image');
		expect(r.message).toBe(message);
		expect(r.retryable).toBe(false);
	});

	it('an unreachable site can be retried', async () => {
		const fetchImpl = vi.fn(async () => json(502, { error: 'url_unreachable', message: 'Forge could not reach that link.' }));
		const r = await importForgeImageUrl('https://slow.example/a.jpg', { fetchImpl });
		expect(r.code).toBe('url_unreachable');
		expect(r.retryable).toBe(true);
	});

	it('a signed-out person is asked to sign in', async () => {
		const onSignIn = vi.fn();
		const fetchImpl = vi.fn(async () => json(401, { error: 'sign_in_required' }));
		const r = await importForgeImageUrl('https://images.example/a.jpg', { fetchImpl, onSignIn });
		expect(r.code).toBe('sign_in');
		expect(onSignIn).toHaveBeenCalledOnce();
	});
});
