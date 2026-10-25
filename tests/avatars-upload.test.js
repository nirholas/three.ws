// The URL-import flow (api/avatars/_actions.js fetchRemoteGlb) fetches an
// attacker-chosen URL from inside the platform. It must connect through the
// IP-pinned helper so the address that passed the private-range check is the
// address the socket uses (no DNS-rebinding window between check and connect).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const pinned = vi.hoisted(() => ({ impl: null, calls: [] }));
vi.mock('../api/_lib/ssrf-guard.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		fetchSafePublicUrlPinned: (...args) => {
			pinned.calls.push(args);
			return pinned.impl(...args);
		},
	};
});

const { fetchRemoteGlb } = await import('../api/avatars/_actions.js');
const { SsrfBlockedError, MaxBytesExceededError } = await import('../api/_lib/ssrf-guard.js');

describe('fetchRemoteGlb', () => {
	beforeEach(() => {
		pinned.calls = [];
	});

	it('fetches through the IP-pinned helper with a byte cap', async () => {
		pinned.impl = async () => new Response(Buffer.from('glTF'), { status: 200 });
		const buf = await fetchRemoteGlb('https://cdn.example/a.glb', 1024);
		expect(buf.toString()).toBe('glTF');
		expect(pinned.calls).toHaveLength(1);
		expect(pinned.calls[0][0]).toBe('https://cdn.example/a.glb');
		expect(pinned.calls[0][2]).toMatchObject({ maxBytes: 1024 });
	});

	it('maps a blocked host to 400 blocked_host', async () => {
		pinned.impl = async () => {
			throw new SsrfBlockedError('host x resolves to a blocked range');
		};
		await expect(fetchRemoteGlb('http://rebind.example/a.glb', 1024)).rejects.toMatchObject({ status: 400, code: 'blocked_host' });
	});

	it('maps an oversize body to 413 payload_too_large', async () => {
		pinned.impl = async () => {
			throw new MaxBytesExceededError(2048, 1024);
		};
		await expect(fetchRemoteGlb('https://cdn.example/a.glb', 1024)).rejects.toMatchObject({ status: 413, code: 'payload_too_large' });
	});

	it('rejects a non-http scheme before any request', async () => {
		pinned.impl = async () => new Response('x');
		await expect(fetchRemoteGlb('file:///etc/passwd', 1024)).rejects.toMatchObject({ status: 400 });
		expect(pinned.calls).toHaveLength(0);
	});
});
