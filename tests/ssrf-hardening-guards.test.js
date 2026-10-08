// SSRF and open-redirect regressions closed in the October 2026 audit.
//
// Each case here was a live path: an IPv6 spelling of loopback that the
// classifiers waved through, a metadata URI fetched with no guard, a forge
// self-call whose host came from `x-forwarded-host`, the NVIDIA key sent to a
// caller-chosen NIM, a headless browser that followed redirects into the VPC,
// and a Vertex model id that could walk an authenticated POST to another API.
// Everything runs offline: blocked targets are refused before a socket opens.

import { Readable } from 'node:stream';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { isPrivateIPv6, isPrivateAddress, parseIPv6Groups } from '../api/_lib/ssrf.js';
import { fetchSafePublicUrlPinned, SsrfBlockedError } from '../api/_lib/ssrf-guard.js';
import { fetchOgImage } from '../api/_lib/og-avatar.js';
import { fetchTokenImage } from '../api/_lib/solana-token-meta.js';
import { selfOrigin } from '../api/_lib/self-origin.js';
import { guardPageRequests } from '../api/_lib/embed-doctor.js';
import { vertexMessagesUrl, isVertexModelId } from '../api/_lib/vertex-claude.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('IPv6 classification judges the address, not its spelling', () => {
	it('blocks every spelling of an internal IPv4 carried in IPv6', () => {
		for (const ip of [
			'::ffff:7f00:1', // hex-mapped loopback, the form the URL parser emits
			'::ffff:127.0.0.1',
			'::ffff:a9fe:a9fe', // 169.254.169.254
			'::ffff:0:7f00:1', // IPv4-translated
			'::127.0.0.1', // IPv4-compatible
			'64:ff9b::a9fe:a9fe', // NAT64 of the metadata server
			'2002:7f00:1::1', // 6to4 of loopback
			'[::ffff:7f00:1]',
		]) {
			expect(isPrivateIPv6(ip), ip).toBe(true);
		}
	});

	it('blocks the native internal ranges and anything unparseable', () => {
		for (const ip of ['::1', '::', 'fe80::1%eth0', 'fd00:ec2::254', 'fc00::1', 'ff02::1', '2001:db8::1', 'not-an-ip', '1:2:3:4:5:6:7:8:9']) {
			expect(isPrivateIPv6(ip), ip).toBe(true);
		}
	});

	it('leaves public addresses alone', () => {
		for (const ip of ['2606:4700::1111', '2001:4860:4860::8888', '64:ff9b::808:808', '2002:808:808::1', '::ffff:8.8.8.8']) {
			expect(isPrivateIPv6(ip), ip).toBe(false);
		}
		expect(isPrivateAddress('8.8.8.8', 4)).toBe(false);
	});

	it('expands compressed forms to eight groups', () => {
		expect(parseIPv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
		expect(parseIPv6Groups('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
	});
});

describe('pinned guard refuses internal literals before connecting', () => {
	it.each(['http://127.0.0.1/', 'http://169.254.169.254/computeMetadata/v1/', 'https://10.0.0.5/x', 'http://0.0.0.0/'])(
		'%s',
		async (url) => {
			await expect(fetchSafePublicUrlPinned(url, {}, { allowHttp: true })).rejects.toBeInstanceOf(SsrfBlockedError);
		},
	);
});

describe('creator-chosen image and metadata URLs go through the guard', () => {
	it('fetchOgImage refuses an internal URL without touching the network', async () => {
		const spy = vi.fn();
		globalThis.fetch = spy;
		expect(await fetchOgImage('http://169.254.169.254/latest/meta-data/')).toBeNull();
		expect(await fetchOgImage('http://127.0.0.1:8080/api/healthz')).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it('fetchTokenImage refuses an internal URL without touching the network', async () => {
		const spy = vi.fn();
		globalThis.fetch = spy;
		expect(await fetchTokenImage('http://10.0.0.5/logo.png')).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('selfOrigin never trusts a forwarded host', () => {
	it('ignores x-forwarded-host and a foreign Host header', () => {
		vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://three.ws');
		expect(selfOrigin({ headers: { host: 'three.ws', 'x-forwarded-host': 'attacker.example' } })).toBe('https://three.ws');
		expect(selfOrigin({ headers: { host: '169.254.169.254' } })).toBe('https://three.ws');
	});

	it('honors a loopback Host only outside production', () => {
		vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://three.ws');
		vi.stubEnv('NODE_ENV', 'development');
		expect(selfOrigin({ headers: { host: 'localhost:3000' } })).toBe('http://localhost:3000');
		vi.stubEnv('NODE_ENV', 'production');
		expect(selfOrigin({ headers: { host: '127.0.0.1:8080' } })).toBe('https://three.ws');
	});
});

describe('forge-nim never sends the platform key to a caller-chosen NIM', () => {
	function makeReq(url) {
		const stream = Readable.from([]);
		stream.method = 'GET';
		stream.url = url;
		stream.headers = { host: 'three.ws' };
		return stream;
	}
	function makeRes() {
		return {
			statusCode: 200,
			_h: {},
			setHeader(k, v) {
				this._h[k.toLowerCase()] = v;
			},
			getHeader(k) {
				return this._h[k.toLowerCase()];
			},
			end(body) {
				this._body = body;
				this.writableEnded = true;
			},
		};
	}

	it('health against a caller baseUrl uses the guard with no authorization header', async () => {
		vi.stubEnv('NVIDIA_API_KEY', 'nvapi-secret-should-not-leak');
		const plain = vi.fn();
		globalThis.fetch = plain;
		const pinned = vi.fn(async () => new Response('', { status: 200 }));
		vi.resetModules();
		vi.doMock('../api/_lib/ssrf-guard.js', async (orig) => ({ ...(await orig()), fetchSafePublicUrlPinned: pinned }));
		const { default: handler } = await import('../api/forge-nim.js');
		const res = makeRes();
		await handler(makeReq('/api/forge-nim?action=health&baseUrl=https://attacker.example'), res);
		vi.doUnmock('../api/_lib/ssrf-guard.js');

		expect(plain).not.toHaveBeenCalled();
		expect(pinned).toHaveBeenCalledOnce();
		const [url, init] = pinned.mock.calls[0];
		expect(url).toBe('https://attacker.example/v1/health/ready');
		expect(JSON.stringify(init.headers || {})).not.toContain('nvapi-secret-should-not-leak');
	});
});

describe('embed doctor routes every page request through the guard', () => {
	function fakePage() {
		const handlers = [];
		return {
			handlers,
			setRequestInterception: vi.fn(async () => {}),
			on(event, fn) {
				if (event === 'request') handlers.push(fn);
			},
		};
	}
	function fakeReq(url) {
		return { url: () => url, continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
	}

	it('aborts internal hosts, redirects included, and lets the platform origin through', async () => {
		const page = fakePage();
		await guardPageRequests(page, { platformOrigin: 'http://localhost:3000' });
		expect(page.setRequestInterception).toHaveBeenCalledWith(true);
		const [handler] = page.handlers;

		const metadata = fakeReq('http://169.254.169.254/computeMetadata/v1/');
		await handler(metadata);
		expect(metadata.abort).toHaveBeenCalled();
		expect(metadata.continue).not.toHaveBeenCalled();

		const internal = fakeReq('http://10.0.0.5:8080/admin');
		await handler(internal);
		expect(internal.abort).toHaveBeenCalled();

		const file = fakeReq('file:///etc/passwd');
		await handler(file);
		expect(file.abort).toHaveBeenCalled();

		const platform = fakeReq('http://localhost:3000/agent-3d/latest/agent-3d.js');
		await handler(platform);
		expect(platform.continue).toHaveBeenCalled();

		const inline = fakeReq('data:image/png;base64,AAAA');
		await handler(inline);
		expect(inline.continue).toHaveBeenCalled();
	});

	it('lets a caller-provided responder claim a request first', async () => {
		const page = fakePage();
		const respond = vi.fn((req) => req.url() === 'https://three.ws/__embed-doctor-sandbox');
		await guardPageRequests(page, { platformOrigin: 'https://three.ws', respond });
		const req = fakeReq('https://three.ws/__embed-doctor-sandbox');
		await page.handlers[0](req);
		expect(respond).toHaveBeenCalled();
		expect(req.continue).not.toHaveBeenCalled();
		expect(req.abort).not.toHaveBeenCalled();
	});
});

describe('Vertex model ids cannot leave the model path', () => {
	it('accepts real model ids', () => {
		expect(isVertexModelId('claude-haiku-4-5-20251001')).toBe(true);
		expect(isVertexModelId('claude-sonnet-4-5')).toBe(true);
	});

	it('refuses traversal, query and fragment injection', () => {
		vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'p');
		for (const bad of ['../../../../datasets?a=', 'x/../../y', 'claude#frag', 'claude?x=1', '']) {
			expect(isVertexModelId(bad), bad).toBe(false);
			expect(() => vertexMessagesUrl(bad)).toThrow(/invalid Vertex model id/);
		}
	});
});

describe('avatar optimize keeps every redirect hop on a trusted host', () => {
	it('refuses a first-party URL that redirects off the allowlist', async () => {
		vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://three.ws');
		const { fetchTrustedSource } = await import('../api/avatar/optimize.js');
		const spy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/computeMetadata/v1/' } }));
		globalThis.fetch = spy;
		await expect(fetchTrustedSource('https://three.ws/api/agent-og?id=x', undefined)).rejects.toMatchObject({
			code: 'untrusted_redirect',
		});
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
	});

	it('follows a redirect that stays on the platform origin', async () => {
		vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://three.ws');
		const { fetchTrustedSource } = await import('../api/avatar/optimize.js');
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/cdn/u/1/a.glb' } }))
			.mockResolvedValueOnce(new Response('glb', { status: 200 }));
		const res = await fetchTrustedSource('https://three.ws/cdn/u/1/a.glb/', undefined);
		expect(res.status).toBe(200);
	});
});

describe('fetchUpstreamPublic re-checks every redirect hop', () => {
	it('refuses a public URL that 302s to the metadata server', async () => {
		const { fetchUpstreamPublic } = await import('../api/_lib/upstream-fetch.js');
		const spy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/computeMetadata/v1/' } }));
		globalThis.fetch = spy;
		await expect(fetchUpstreamPublic('https://8.8.8.8/logo.png', {}, { attempts: 1, allowHttp: true })).rejects.toMatchObject({ code: 'ssrf_blocked' });
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
	});

	it('refuses an internal first hop before any request', async () => {
		const { fetchUpstreamPublic } = await import('../api/_lib/upstream-fetch.js');
		const spy = vi.fn();
		globalThis.fetch = spy;
		await expect(fetchUpstreamPublic('http://10.1.2.3/x', {}, { allowHttp: true })).rejects.toMatchObject({ code: 'ssrf_blocked' });
		expect(spy).not.toHaveBeenCalled();
	});
});
