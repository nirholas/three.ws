// Nothing a stranger sends to Forge may reach inside our systems.
//
// Every Forge endpoint that takes an address is driven here with the same table
// of hostile spellings (loopback in every encoding, the cloud metadata IP,
// private and link-local ranges, IPv6 forms that wrap an IPv4, hostnames whose
// DNS answer is private, a host that answers one public and one private
// address). The REAL SSRF policy runs: only DNS, the worker provider, the
// database and the rate limiter are stubbed. The assertion is the same for all
// of them: the request is refused with a 400 and no job reaches a worker.
//
// The remaining sections cover what the address guard cannot: a redirect that
// walks off a public host, the DNS-rebinding pin, the fetch limits, and the
// reference-image bytes (type from content, pixel dimensions).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import zlib from 'node:zlib';

// POST /api/forge and /api/gpt-forge need an account; this suite exercises what
// happens past that gate.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
	getSessionUser: async () => ({ id: 'forge-test-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		MODEL_TRELLIS_URL: 'https://trellis.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		NVIDIA_API_KEY: 'nvapi-test',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

// Deterministic DNS. A name with no entry resolves to a public address, so the
// ordinary https://cdn.example/... references the rest of the suite uses keep
// working; hostile names are listed explicitly.
const dnsState = vi.hoisted(() => {
	const answers = new Map();
	const calls = [];
	// Mirrors getaddrinfo: an IP literal answers itself, a bracketed IPv6 literal
	// is not a hostname (ENOTFOUND), a listed name answers its records, and any
	// other name resolves to a public address.
	const lookup = async (host) => {
		calls.push(host);
		const literal = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 4 : /^[0-9a-f:]+$/i.test(host) && host.includes(':') ? 6 : 0;
		if (literal) return [{ address: host, family: literal }];
		if (host.startsWith('[')) {
			const err = new Error(`getaddrinfo ENOTFOUND ${host}`);
			err.code = 'ENOTFOUND';
			throw err;
		}
		const hit = answers.get(host);
		if (hit instanceof Error) throw hit;
		return hit || [{ address: '93.184.216.34', family: 4 }];
	};
	return { answers, calls, lookup };
});
vi.mock('node:dns', async (importActual) => {
	const actual = await importActual();
	const { lookup } = dnsState;
	return { ...actual, default: { ...actual, promises: { ...actual.promises, lookup } }, promises: { ...actual.promises, lookup } };
});
vi.mock('node:dns/promises', async () => {
	const { lookup } = dnsState;
	return { lookup, default: { lookup } };
});

const submitted = [];
const providerState = { configured: true };
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => {
		if (!providerState.configured) throw new Error('no gcp worker configured');
		return {
			supportsMode: () => true,
			async submit(job) {
				submitted.push(job);
				return { extJobId: 'j'.repeat(40), eta: 30 };
			},
			async status() {
				return { status: 'running' };
			},
		};
	},
}));
vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		supportsMode: () => false,
		async submit(job) {
			submitted.push(job);
			return { extJobId: 'r'.repeat(40) };
		},
	}),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

vi.mock('../../api/_lib/forge-store.js', () => ({
	forgeStoreEnabled: () => true,
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../api/_lib/db.js', () => ({
	sql: async () => [],
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const allow = async () => ({ success: true, reset: Date.now() + 1000, limit: 10, remaining: 9 });
	return {
		...actual,
		limits: new Proxy(actual.limits, {
			get: (target, prop) => (typeof target[prop] === 'function' ? allow : target[prop]),
		}),
		clientIp: () => '203.0.113.9',
	};
});

// Game-Ready export is $THREE-gated before it reads its address; the gate is not
// what is under test, so a holder passes it.
vi.mock('../../api/_lib/require-three.js', async (importActual) => ({
	...(await importActual()),
	requireFeatureAccess: vi.fn(async () => ({ ok: true })),
}));

// The rig handler now downloads the model and checks it before any worker
// call (api/_lib/rig-preflight.js); the control URL serves a standing figure, and
// every other URL still goes through the real guarded fetch.
vi.mock('../../api/_lib/fetch-model.js', async (importActual) => {
	const actual = await importActual();
	const { figureFetchResult } = await import('../helpers/rig-box-glb.js');
	return {
		...actual,
		fetchModel: async (url, opts) => (url === 'https://cdn.example/model.png' ? figureFetchResult(url) : actual.fetchModel(url, opts)),
	};
});

vi.mock('../../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dailyPaidAllowed: vi.fn(async () => ({ ok: true })) };
});

// Uploaded reference photos live in object storage. The tests drive the bytes the
// bucket holds, so a case can plant an oversized or mislabeled file under the key
// the upload endpoint would have minted.
const bucket = vi.hoisted(() => ({ objects: new Map(), failWith: null, presigned: [] }));
vi.mock('../../api/_lib/r2.js', async (importActual) => ({
	...(await importActual()),
	objectStorageUsable: async () => ({ ok: true }),
	presignUpload: async ({ key, contentType }) => {
		bucket.presigned.push({ key, contentType });
		return `https://bucket.example/upload/${key}?sig=1`;
	},
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
	headObject: async (key) => {
		if (bucket.failWith) throw bucket.failWith;
		const body = bucket.objects.get(key);
		return body ? { ContentLength: body.declaredSize ?? body.bytes.length } : null;
	},
	getObjectRange: async (key, length) => {
		if (bucket.failWith) throw bucket.failWith;
		return Buffer.from(bucket.objects.get(key).bytes.subarray(0, length));
	},
}));

const forge = (await import('../../api/forge.js')).default;
const gptForge = (await import('../../api/gpt-forge.js')).default;
const forgeUpload = (await import('../../api/forge-upload.js')).default;
const rembg = (await import('../../api/forge-rembg.js')).default;
const remesh = (await import('../../api/forge-remesh.js')).default;
const segment = (await import('../../api/forge-segment.js')).default;
const stylize = (await import('../../api/forge-stylize.js')).default;
const holopart = (await import('../../api/forge-holopart.js')).default;
const gameready = (await import('../../api/forge-gameready.js')).default;
const splat = (await import('../../api/forge-splat.js')).default;
const sceneObjects = (await import('../../api/forge-scene-objects.js')).default;
const {
	assertSafePublicUrl,
	fetchSafePublicUrl,
	fetchSafePublicUrlPinned,
	SsrfBlockedError,
} = await import('../../api/_lib/ssrf-guard.js');
const { assertPublicHttpsUrl } = await import('../../api/_lib/ssrf.js');
const { inspectGlb, glbJsonChunkEnd, isValidGlbHeader } = await import('../../api/_lib/glb-inspect.js');
const { findUnsafeUrl, verifyUploadedReferences } = await import('../../api/_lib/forge-input-guard.js');

// Hostile hosts. Each is the authority part of a URL.
const HOSTILE_LITERALS = [
	// loopback, every spelling the URL parser folds to 127.0.0.1
	['loopback dotted', '127.0.0.1'],
	['loopback short form', '127.1'],
	['loopback decimal', '2130706433'],
	['loopback hex', '0x7f000001'],
	['loopback octal', '0177.0.0.1'],
	['loopback mixed hex dotted', '0x7f.1'],
	['loopback trailing dot', '127.0.0.1.'],
	['loopback whole /8', '127.255.255.254'],
	['unspecified', '0.0.0.0'],
	['unspecified decimal', '0'],
	// cloud metadata
	['metadata', '169.254.169.254'],
	['metadata decimal', '2852039166'],
	['metadata hex', '0xa9fea9fe'],
	['metadata octal', '0251.0376.0251.0376'],
	['metadata behind userinfo', 'public.example@169.254.169.254'],
	['alibaba metadata', '100.100.100.200'],
	// private and reserved IPv4
	['10/8', '10.0.0.1'],
	['172.16/12 low', '172.16.0.1'],
	['172.16/12 high', '172.31.255.255'],
	['192.168/16', '192.168.1.1'],
	['carrier-grade NAT', '100.64.0.1'],
	['benchmarking', '198.18.0.1'],
	['multicast', '224.0.0.1'],
	['broadcast', '255.255.255.255'],
	// IPv6, native and wrapping an IPv4
	['v6 loopback', '[::1]'],
	['v6 unspecified', '[::]'],
	['v4-mapped loopback', '[::ffff:127.0.0.1]'],
	['v4-mapped loopback hex', '[::ffff:7f00:1]'],
	['v4-mapped expanded', '[0:0:0:0:0:ffff:7f00:1]'],
	['v4-mapped metadata', '[::ffff:169.254.169.254]'],
	['v4-compatible loopback', '[::127.0.0.1]'],
	['NAT64 loopback', '[64:ff9b::7f00:1]'],
	['6to4 loopback', '[2002:7f00:1::]'],
	['v6 link-local', '[fe80::1]'],
	['v6 unique-local', '[fc00::1]'],
	['aws v6 metadata', '[fd00:ec2::254]'],
];
const HOSTILE_NAMES = {
	'localhost': [{ address: '127.0.0.1', family: 4 }],
	'sub.localhost': [{ address: '127.0.0.1', family: 4 }],
	'metadata.google.internal': [{ address: '169.254.169.254', family: 4 }],
	'rebind.test': [{ address: '10.0.0.5', family: 4 }],
	'v6only.test': [{ address: '::1', family: 6 }],
	'mapped.test': [{ address: '::ffff:10.0.0.5', family: 6 }],
	// One public and one private answer: the whole set must be clean.
	'dual.test': [
		{ address: '93.184.216.34', family: 4 },
		{ address: '10.0.0.5', family: 4 },
	],
};
const HOSTILE_HOSTS = [
	...HOSTILE_LITERALS,
	...Object.keys(HOSTILE_NAMES).map((h) => [`hostname ${h}`, h]),
];
const HOSTILE_URLS = [];
for (const [label, host] of HOSTILE_HOSTS) {
	for (const scheme of ['https', 'http']) {
		HOSTILE_URLS.push([`${scheme}://${host} (${label})`, `${scheme}://${host}/model.png`]);
	}
}
// Other schemes never carry a fetch.
const HOSTILE_SCHEMES = [
	['file', 'file:///etc/passwd'],
	['ftp', 'ftp://example.com/model.png'],
	['gopher', 'gopher://127.0.0.1:6379/_PING'],
	['javascript', 'javascript:alert(1)'],
	['data', 'data:text/html,<script>1</script>'],
];

beforeEach(() => {
	submitted.length = 0;
	providerState.configured = true;
	dnsState.calls.length = 0;
	bucket.objects.clear();
	bucket.failWith = null;
	bucket.presigned.length = 0;
	dnsState.answers.clear();
	for (const [host, answers] of Object.entries(HOSTILE_NAMES)) dnsState.answers.set(host, answers);
});

function mkReq({ method = 'POST', url = '/', body } = {}) {
	const rawBody = Buffer.from(JSON.stringify(body ?? {}));
	return {
		method,
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester' },
		rawBody,
		on(event, cb) {
			if (event === 'data') cb(rawBody);
			if (event === 'end') cb();
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		end(b) {
			this.body = b === undefined ? '' : String(b);
			this.writableEnded = true;
		},
	};
}
async function call(handler, init) {
	const res = mkRes();
	await handler(mkReq(init), res);
	return res;
}
const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

describe('the address guard judges where a URL goes, not how it is spelled', () => {
	it.each(HOSTILE_URLS)('assertSafePublicUrl refuses %s', async (_label, url) => {
		await expect(assertSafePublicUrl(url, { allowHttp: true })).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it.each(HOSTILE_URLS)('assertPublicHttpsUrl refuses %s', async (_label, url) => {
		await expect(assertPublicHttpsUrl(url, { allowHttp: true })).rejects.toMatchObject({ name: 'SsrfError' });
	});

	it.each(HOSTILE_SCHEMES)('refuses the %s scheme', async (_label, url) => {
		await expect(assertSafePublicUrl(url, { allowHttp: true })).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('refuses plain http when the caller asked for https only', async () => {
		await expect(assertSafePublicUrl('http://cdn.example/a.png')).rejects.toBeInstanceOf(SsrfBlockedError);
	});

	it('lets an ordinary public host through', async () => {
		const url = await assertSafePublicUrl('https://cdn.example/a.png');
		expect(url.hostname).toBe('cdn.example');
	});
});

describe('findUnsafeUrl, the shared boundary check', () => {
	const dnsError = (code) => Object.assign(new Error(`getaddrinfo ${code}`), { code });

	it('refuses a bracketed IPv6 literal by what it is, not by a failed lookup', async () => {
		// A resolver reports a bracketed literal as a name that does not exist. A
		// guard that lets "points nowhere" through must still classify the address.
		for (const host of ['[::1]', '[::ffff:7f00:1]', '[fe80::1]', '[fd00:ec2::254]', '[64:ff9b::a9fe:a9fe]']) {
			const verdict = await findUnsafeUrl([`http://${host}/a.png`]);
			expect(verdict, host).toMatchObject({ url: `http://${host}/a.png` });
			expect(verdict.reason, host).toMatch(/blocked address/);
		}
	});

	it('lets a public IPv6 literal through', async () => {
		expect(await findUnsafeUrl(['https://[2606:4700:4700::1111]/a.png'])).toBeNull();
	});

	it('lets a name that resolves nowhere through, since nothing internal is behind it', async () => {
		dnsState.answers.set('gone.test', dnsError('ENOTFOUND'));
		dnsState.answers.set('empty.test', dnsError('ENODATA'));
		expect(await findUnsafeUrl(['https://gone.test/a.png', 'https://empty.test/a.png'])).toBeNull();
	});

	it('refuses a name whose lookup failed for any other reason', async () => {
		for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED']) {
			dnsState.answers.set('flaky.test', dnsError(code));
			expect(await findUnsafeUrl(['https://flaky.test/a.png']), code).toMatchObject({ url: 'https://flaky.test/a.png' });
		}
	});

	it('names the offending address when only one of several is hostile', async () => {
		const verdict = await findUnsafeUrl(['https://cdn.example/a.png', 'http://10.0.0.1/b.png', 'https://cdn.example/c.png']);
		expect(verdict.url).toBe('http://10.0.0.1/b.png');
	});

	it('returns null for an empty list and for ordinary public addresses', async () => {
		expect(await findUnsafeUrl([])).toBeNull();
		expect(await findUnsafeUrl(['https://cdn.example/a.png', 'http://cdn.example/b.png'])).toBeNull();
	});
});

// Every Forge endpoint that takes an address. `build` places the hostile URL in
// the field the endpoint reads.
const ENDPOINTS = [
	{
		name: 'POST /api/forge image_urls',
		handler: () => forge,
		url: '/api/forge',
		build: (u) => ({ image_urls: [u], tier: 'standard', path: 'image', skip_validation: true }),
	},
	{
		name: 'POST /api/forge image_urls behind a good first image',
		handler: () => forge,
		url: '/api/forge',
		build: (u) => ({
			image_urls: ['https://cdn.example/front.png', u],
			tier: 'standard',
			path: 'image',
			skip_validation: true,
		}),
	},
	{
		name: 'POST /api/forge image_url',
		handler: () => forge,
		url: '/api/forge',
		build: (u) => ({ image_url: u, tier: 'draft', path: 'image', skip_validation: true }),
	},
	{
		name: 'POST /api/forge?action=rig glb_url',
		handler: () => forge,
		url: '/api/forge?action=rig',
		build: (u) => ({ glb_url: u }),
	},
	{
		name: 'POST /api/gpt-forge image_urls',
		handler: () => gptForge,
		url: '/api/gpt-forge',
		build: (u) => ({ image_urls: [u], tier: 'standard', path: 'image', skip_validation: true }),
	},
	{
		name: 'POST /api/gpt-forge?action=rig glb_url',
		handler: () => gptForge,
		url: '/api/gpt-forge?action=rig',
		build: (u) => ({ glb_url: u }),
	},
	{ name: 'POST /api/forge-rembg image_url', handler: () => rembg, url: '/api/forge-rembg', build: (u) => ({ image_url: u }) },
	{ name: 'POST /api/forge-remesh mesh_url', handler: () => remesh, url: '/api/forge-remesh', build: (u) => ({ mesh_url: u }) },
	{ name: 'POST /api/forge-segment mesh_url', handler: () => segment, url: '/api/forge-segment', build: (u) => ({ mesh_url: u }) },
	{ name: 'POST /api/forge-stylize mesh_url', handler: () => stylize, url: '/api/forge-stylize', build: (u) => ({ mesh_url: u }) },
	{ name: 'POST /api/forge-holopart mesh_url', handler: () => holopart, url: '/api/forge-holopart', build: (u) => ({ mesh_url: u }) },
	{ name: 'POST /api/forge-gameready mesh_url', handler: () => gameready, url: '/api/forge-gameready', build: (u) => ({ mesh_url: u }) },
	{ name: 'POST /api/forge-splat image_url', handler: () => splat, url: '/api/forge-splat', build: (u) => ({ image_url: u }) },
	{
		name: 'POST /api/forge-scene-objects image_url',
		handler: () => sceneObjects,
		url: '/api/forge-scene-objects',
		build: (u) => ({ image_url: u, mask_urls: ['https://cdn.example/mask.png'] }),
	},
	{
		name: 'POST /api/forge-scene-objects mask_urls',
		handler: () => sceneObjects,
		url: '/api/forge-scene-objects',
		build: (u) => ({ image_url: 'https://cdn.example/scene.png', mask_urls: [u] }),
	},
];

describe.each(ENDPOINTS)('$name', (endpoint) => {
	it('queues a job for an ordinary public address (the control)', async () => {
		const res = await call(endpoint.handler(), {
			url: endpoint.url,
			body: endpoint.build('https://cdn.example/model.png'),
		});
		expect(res.statusCode, res.body).toBeLessThan(300);
		expect(submitted.length).toBeGreaterThan(0);
	});

	it.each([...HOSTILE_URLS, ...HOSTILE_SCHEMES.map(([l, u]) => [`${l} scheme`, u])])(
		'refuses %s before any worker is reached',
		async (_label, hostile) => {
			const res = await call(endpoint.handler(), { url: endpoint.url, body: endpoint.build(hostile) });
			expect(res.statusCode, `${hostile} => ${res.statusCode} ${res.body}`).toBe(400);
			expect(submitted).toHaveLength(0);
		},
	);
});

describe('a redirect cannot walk a guarded fetch off a public host', () => {
	let realFetch;
	beforeEach(() => {
		realFetch = globalThis.fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const redirectTargets = [
		'http://169.254.169.254/latest/meta-data/',
		'http://127.0.0.1:8080/admin',
		'https://rebind.test/x',
		'http://[::ffff:7f00:1]/',
		'http://2130706433/',
		'http://user@10.0.0.1/',
	];
	it.each(redirectTargets)('refuses a 302 to %s and never requests it', async (target) => {
		const seen = [];
		globalThis.fetch = vi.fn(async (u) => {
			seen.push(String(u));
			return new Response(null, { status: 302, headers: { location: target } });
		});
		await expect(
			fetchSafePublicUrl('https://cdn.example/start.png', {}, { allowHttp: true }),
		).rejects.toBeInstanceOf(SsrfBlockedError);
		expect(seen).toEqual(['https://cdn.example/start.png']);
	});

	it('refuses a relative redirect that resolves onto a private host', async () => {
		dnsState.answers.set('flip.test', [{ address: '93.184.216.34', family: 4 }]);
		const seen = [];
		globalThis.fetch = vi.fn(async (u) => {
			seen.push(String(u));
			return new Response(null, { status: 302, headers: { location: '//10.0.0.9/secret' } });
		});
		await expect(fetchSafePublicUrl('https://flip.test/a', {}, { allowHttp: true })).rejects.toBeInstanceOf(
			SsrfBlockedError,
		);
		expect(seen).toEqual(['https://flip.test/a']);
	});

	it('stops a redirect loop at the redirect limit', async () => {
		let hops = 0;
		globalThis.fetch = vi.fn(async () => {
			hops += 1;
			return new Response(null, { status: 302, headers: { location: `https://cdn.example/hop-${hops}` } });
		});
		await expect(fetchSafePublicUrl('https://cdn.example/start', {})).rejects.toThrow(/too many redirects/);
		expect(hops).toBeLessThanOrEqual(6);
	});
});

describe('the pinned fetch connects to the address it validated (DNS rebinding)', () => {
	let requestSpy;
	afterEach(() => requestSpy?.mockRestore());

	function stubRequest(onRequest) {
		requestSpy = vi.spyOn(http, 'request').mockImplementation((opts, cb) => {
			onRequest(opts);
			const req = new EventEmitter();
			req.write = () => {};
			req.destroy = () => {};
			req.end = () => {
				const nodeRes = new EventEmitter();
				nodeRes.headers = { 'content-type': 'image/png' };
				nodeRes.statusCode = 200;
				nodeRes.destroy = () => {};
				cb(nodeRes);
				nodeRes.emit('data', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
				nodeRes.emit('end');
			};
			return req;
		});
	}

	it('serves the validated address even after DNS starts answering a private one', async () => {
		dnsState.answers.set('rebinder.test', [{ address: '93.184.216.34', family: 4 }]);
		let agent;
		stubRequest((opts) => {
			agent = opts.agent;
		});
		const res = await fetchSafePublicUrlPinned('http://rebinder.test/a.png', {}, { allowHttp: true });
		expect(res.status).toBe(200);
		// The host's DNS now flips to the metadata IP: a rebinding attack.
		dnsState.answers.set('rebinder.test', [{ address: '169.254.169.254', family: 4 }]);
		const before = dnsState.calls.length;
		const chosen = await new Promise((resolve, reject) =>
			agent.options.lookup('rebinder.test', { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
		);
		expect(chosen).toEqual([{ address: '93.184.216.34', family: 4 }]);
		// The connect never asked DNS again, so the flip cannot take effect.
		expect(dnsState.calls.length).toBe(before);
	});

	it('refuses a host that already answers a private address, with no request made', async () => {
		let requested = false;
		stubRequest(() => {
			requested = true;
		});
		await expect(fetchSafePublicUrlPinned('http://rebind.test/a.png', {}, { allowHttp: true })).rejects.toBeInstanceOf(
			SsrfBlockedError,
		);
		expect(requested).toBe(false);
	});

	it('re-validates the redirect hop before connecting to it', async () => {
		dnsState.answers.set('hop.test', [{ address: '93.184.216.34', family: 4 }]);
		const hosts = [];
		requestSpy = vi.spyOn(http, 'request').mockImplementation((opts, cb) => {
			hosts.push(opts.hostname);
			const req = new EventEmitter();
			req.write = () => {};
			req.destroy = () => {};
			req.end = () => {
				const nodeRes = new EventEmitter();
				nodeRes.headers = { location: 'http://169.254.169.254/latest/meta-data/' };
				nodeRes.statusCode = 302;
				nodeRes.destroy = () => {};
				cb(nodeRes);
				nodeRes.emit('end');
			};
			return req;
		});
		await expect(fetchSafePublicUrlPinned('http://hop.test/a.png', {}, { allowHttp: true })).rejects.toBeInstanceOf(
			SsrfBlockedError,
		);
		expect(hosts).toEqual(['hop.test']);
	});
});

describe('fetch limits: size, time, type', () => {
	let realFetch;
	beforeEach(() => {
		realFetch = globalThis.fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('stops reading a body that outgrows the cap, even when it never advertises a length', async () => {
		let pulled = 0;
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							pulled += 1;
							controller.enqueue(new Uint8Array(64 * 1024));
							if (pulled > 400) controller.close();
						},
					}),
					{ status: 200 },
				),
		);
		const res = await fetchSafePublicUrl('https://cdn.example/huge.bin', {}, { maxBytes: 256 * 1024 });
		await expect(res.arrayBuffer()).rejects.toMatchObject({ code: 'max_bytes_exceeded' });
		// Read roughly the cap, not the whole 25 MB stream.
		expect(pulled).toBeLessThan(40);
	});

	it('rejects up front on an advertised length over the cap', async () => {
		globalThis.fetch = vi.fn(
			async () => new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }),
		);
		const res = fetchSafePublicUrl('https://cdn.example/huge.bin', {}, { maxBytes: 1024 * 1024 });
		await expect(res).rejects.toMatchObject({ code: 'max_bytes_exceeded' });
	});

	it('aborts a decompression bomb at the byte ceiling', async () => {
		const bomb = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024));
		expect(bomb.length).toBeLessThan(64 * 1024);
		const { decodeContentEncoding } = await import('../../api/_lib/ssrf-guard.js');
		expect(() => decodeContentEncoding(bomb, 'gzip', 1024 * 1024)).toThrow();
	});

	it('times out a host that never answers instead of holding the request open', async () => {
		globalThis.fetch = vi.fn(
			(_u, init) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
				}),
		);
		await expect(
			fetchSafePublicUrl('https://cdn.example/slow.png', {}, { maxBytes: 1024, timeoutMs: 25 }),
		).rejects.toBeTruthy();
	});
});

describe('the vision precheck bounds the reference image it downloads', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
		delete process.env.NVIDIA_API_KEY_VISION_TEST;
	});

	it('stops reading an image stream at the inline cap instead of buffering all of it', async () => {
		process.env.NVIDIA_API_KEY = 'nvapi-test';
		const { describeImage } = await import('../../api/_lib/vision.js');
		const CHUNK = 64 * 1024;
		let pulled = 0;
		globalThis.fetch = vi.fn(async (u) => {
			if (String(u) === 'https://cdn.example/huge.png') {
				// 40 MiB of image-looking bytes with no content-length.
				return new Response(
					new ReadableStream({
						pull(controller) {
							pulled += 1;
							const chunk = new Uint8Array(CHUNK);
							if (pulled === 1) chunk.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
							controller.enqueue(chunk);
							if (pulled >= 640) controller.close();
						},
					}),
					{ status: 200, headers: { 'content-type': 'image/png' } },
				);
			}
			return new Response(JSON.stringify({ choices: [{ message: { content: 'a thing' } }], usage: {} }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		await describeImage({ prompt: 'describe', imageUrl: 'https://cdn.example/huge.png', timeoutMs: 5000, deadlineMs: 9000 }).catch(() => {});
		// 12 MiB cap is 192 chunks; allow the in-flight tail, never the full 640.
		expect(pulled).toBeLessThan(260);
	});
});


// A reference photo uploaded to forge/uploads/ is a presigned PUT whose size and
// type the bucket never checks (the signature cannot pin Content-Length without
// breaking the browser preflight, and the hourly sweeper deletes an overage after
// the fact). So the bytes are judged when a job is submitted: by what they are,
// how large they are, and how many pixels they claim.
describe('uploaded reference photos are verified from their bytes at submit', () => {
	const key = (name) => `forge/uploads/owner/${name}`;
	const urlFor = (name) => `https://three.ws/cdn/${key(name)}`;

	const pngHeader = (w, h) => {
		const b = Buffer.alloc(64);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
		b.writeUInt32BE(13, 8);
		b.write('IHDR', 12, 'ascii');
		b.writeUInt32BE(w, 16);
		b.writeUInt32BE(h, 20);
		return b;
	};
	const put = (name, bytes, declaredSize) => bucket.objects.set(key(name), { bytes, declaredSize });

	it('lets a real PNG within the limits through', async () => {
		put('ok.png', pngHeader(1024, 768));
		expect(await verifyUploadedReferences([urlFor('ok.png')])).toBeNull();
	});

	it('ignores addresses that are not our upload bucket', async () => {
		expect(await verifyUploadedReferences(['https://cdn.example/photo.png', 'https://three.ws/cdn/other/prefix/x.png'])).toBeNull();
	});

	it('refuses a file that is HTML or a script however its name ends', async () => {
		put('evil.png', Buffer.from('<html><script>alert(1)</script></html>'));
		const verdict = await verifyUploadedReferences([urlFor('evil.png')]);
		expect(verdict).toMatchObject({ status: 415, code: 'invalid_image_type', url: urlFor('evil.png') });
	});

	it('refuses an image format Forge does not accept, such as a GIF or an SVG', async () => {
		put('anim.png', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'));
		put('vec.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
		expect(await verifyUploadedReferences([urlFor('anim.png')])).toMatchObject({ code: 'invalid_image_type' });
		expect(await verifyUploadedReferences([urlFor('vec.png')])).toMatchObject({ code: 'invalid_image_type' });
	});

	it('refuses a file over the upload ceiling, which presign could not enforce', async () => {
		put('big.png', pngHeader(1024, 768), 8 * 1024 * 1024 + 1);
		expect(await verifyUploadedReferences([urlFor('big.png')])).toMatchObject({ status: 413, code: 'image_too_large' });
	});

	it('refuses a decompression bomb: a small file that claims a huge canvas', async () => {
		put('bomb.png', pngHeader(60000, 60000));
		expect(await verifyUploadedReferences([urlFor('bomb.png')])).toMatchObject({ status: 422, code: 'invalid_image_dimensions' });
		put('wide.png', pngHeader(8193, 100));
		expect(await verifyUploadedReferences([urlFor('wide.png')])).toMatchObject({ code: 'invalid_image_dimensions' });
	});

	it('finds the bad file among several good ones', async () => {
		put('a.png', pngHeader(512, 512));
		put('b.png', Buffer.from('%PDF-1.7 not an image'));
		const verdict = await verifyUploadedReferences([urlFor('a.png'), urlFor('b.png')]);
		expect(verdict.url).toBe(urlFor('b.png'));
	});

	it('names which photo of a set is the problem, and stays plain for a single photo', async () => {
		put('a.png', pngHeader(512, 512));
		put('c.png', pngHeader(512, 512));
		put('b.png', Buffer.from('%PDF-1.7 not an image'));
		const among = await verifyUploadedReferences([urlFor('a.png'), urlFor('b.png'), urlFor('c.png')]);
		expect(among.message).toMatch(/^Photo 2 of 3: /);
		const alone = await verifyUploadedReferences([urlFor('b.png')]);
		expect(alone.message).not.toMatch(/^Photo /);
	});

	it('does not block a job when storage itself is down or the object is not there yet', async () => {
		put('ok.png', pngHeader(512, 512));
		bucket.failWith = Object.assign(new Error('connect ETIMEDOUT r2'), { code: 'ETIMEDOUT' });
		expect(await verifyUploadedReferences([urlFor('ok.png')])).toBeNull();
		bucket.failWith = null;
		expect(await verifyUploadedReferences([urlFor('missing.png')])).toBeNull();
	});

	describe.each([
		['POST /api/forge', () => forge, '/api/forge'],
		['POST /api/gpt-forge', () => gptForge, '/api/gpt-forge'],
	])('%s', (_name, handler, url) => {
		const body = (u) => ({ image_urls: [u], tier: 'standard', path: 'image', skip_validation: true });

		it('queues a job for a real uploaded photo', async () => {
			put('ok.png', pngHeader(1024, 768));
			const res = await call(handler(), { url, body: body(urlFor('ok.png')) });
			expect(res.statusCode, res.body).toBeLessThan(300);
			expect(submitted.length).toBeGreaterThan(0);
		});

		it('refuses an uploaded file whose bytes are not an image before any worker is reached', async () => {
			put('evil.png', Buffer.from('<html>nope</html>'));
			const res = await call(handler(), { url, body: body(urlFor('evil.png')) });
			expect(res.statusCode, res.body).toBe(415);
			expect(parse(res).error).toBe('invalid_image_type');
			expect(submitted).toHaveLength(0);
		});

		it('refuses an uploaded file with an absurd canvas', async () => {
			put('bomb.png', pngHeader(60000, 60000));
			const res = await call(handler(), { url, body: body(urlFor('bomb.png')) });
			expect(res.statusCode, res.body).toBe(422);
			expect(parse(res).error).toBe('invalid_image_dimensions');
			expect(submitted).toHaveLength(0);
		});
	});
});


// A GLB is a file a stranger controls end to end. The server reads its JSON chunk
// (avatar upload, the rig classifier, the studio save) and must never be taken
// down, or made to allocate, by what that chunk says.
describe('a hostile GLB is read safely', () => {
	function glb(json, { declared, chunkLen } = {}) {
		let j = Buffer.from(typeof json === 'string' ? json : JSON.stringify(json));
		while (j.length % 4) j = Buffer.concat([j, Buffer.from(' ')]);
		const h = Buffer.alloc(20);
		h.writeUInt32LE(0x46546c67, 0);
		h.writeUInt32LE(2, 4);
		h.writeUInt32LE(declared ?? 20 + j.length, 8);
		h.writeUInt32LE(chunkLen ?? j.length, 12);
		h.writeUInt32LE(0x4e4f534a, 16);
		return Buffer.concat([h, j]);
	}
	const HOSTILE = {
		'a null skin entry': glb({ skins: [null] }),
		'a numeric skin entry': glb({ skins: [5] }),
		'a root of JSON null': glb('null'),
		'a root of a JSON number': glb('5'),
		'a root of a JSON array': glb('[]'),
		'a root of a JSON string': glb('"x"'),
		'a null node and a null mesh': glb({ nodes: [null], meshes: [null, 7], skins: [{ joints: [0] }] }),
		'a null primitive': glb({ meshes: [{ primitives: [null] }] }),
		'null accessors behind a primitive': glb({ accessors: [null], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 0 }] }] }),
		'an astronomical accessor count': glb({ accessors: [{ count: 1e308 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 0 }] }] }),
		'null attributes': glb({ meshes: [{ primitives: [{ attributes: null }] }] }),
		'non-string target and animation names': glb({ meshes: [{ extras: { targetNames: [null, {}, 5] }, primitives: [{ targets: [{}, null] }] }], animations: [null, { name: 5 }] }),
		'a __proto__ key': glb('{"__proto__":{"x":1},"skins":[{"joints":[1]}]}'),
		'JSON nested five thousand deep': glb('['.repeat(5000) + ']'.repeat(5000)),
		'a chunk length of four billion': glb({}, { chunkLen: 0xffffffff }),
		'a declared file length of four billion': glb({}, { declared: 0xffffffff }),
		'a chunk that is not JSON': glb('{not json'),
		'a header and nothing else': Buffer.from('glTF'),
	};

	it.each(Object.entries(HOSTILE))('inspectGlb never throws on %s', (_label, bytes) => {
		const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(() => inspectGlb(bytes)).not.toThrow();
			expect(() => inspectGlb(bytes, { allowPartial: true })).not.toThrow();
			expect(() => glbJsonChunkEnd(bytes)).not.toThrow();
			expect(() => isValidGlbHeader(bytes)).not.toThrow();
		} finally {
			quiet.mockRestore();
		}
	});

	it('refuses a file whose JSON is not an object rather than reporting it as a model', () => {
		const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (const root of ['null', '5', '"x"', '[]']) expect(inspectGlb(glb(root)), root).toBeNull();
		} finally {
			quiet.mockRestore();
		}
	});

	it('still counts the joints of an ordinary rig and skips a malformed skin beside it', () => {
		const info = inspectGlb(glb({ skins: [null, { joints: [0, 1, 2] }], nodes: [{}, {}, {}] }));
		expect(info).toMatchObject({ skinCount: 2, skeletonJointCount: 3, isRigged: true });
	});

	it('answers fast even for a quarter of a million nodes', () => {
		const t = Date.now();
		inspectGlb(glb({ nodes: new Array(250000).fill({}) }));
		expect(Date.now() - t).toBeLessThan(2000);
	});
});


// The upload endpoint mints the only storage key a caller will ever write to.
describe('POST /api/forge-upload mints the key and bounds the claim', () => {
	const upload = (body) => call(forgeUpload, { url: '/api/forge-upload', body });

	it('ignores every caller-chosen name, key, path or prefix', async () => {
		const res = await upload({
			content_type: 'image/png',
			size_bytes: 1024,
			storage_key: 'u/someone-else/avatar.glb',
			key: '../../etc/passwd',
			filename: '../../../x.png',
			path: 'forge/uploads/../../secrets',
			prefix: 'avatars/',
		});
		expect(res.statusCode, res.body).toBe(200);
		const out = parse(res);
		expect(out.storage_key).toMatch(/^forge\/uploads\/[^/]{1,12}\/[0-9a-f-]{36}\.png$/);
		expect(bucket.presigned).toHaveLength(1);
		expect(bucket.presigned[0].key).toBe(out.storage_key);
		expect(out.storage_key).not.toMatch(/\.\.|passwd|secrets|someone-else/);
	});

	it('gives two uploads of the same file two different keys', async () => {
		const a = parse(await upload({ content_type: 'image/jpeg', size_bytes: 10 })).storage_key;
		const b = parse(await upload({ content_type: 'image/jpeg', size_bytes: 10 })).storage_key;
		expect(a).not.toBe(b);
	});

	it.each(['text/html', 'image/svg+xml', 'image/gif', 'application/pdf', 'constructor', '__proto__', 'toString', ''])(
		'refuses the claimed type %j',
		async (content_type) => {
			const res = await upload({ content_type, size_bytes: 1024 });
			expect(res.statusCode).toBe(400);
			expect(parse(res).error).toBe('invalid_content_type');
			expect(bucket.presigned).toHaveLength(0);
		},
	);

	it.each([0, -1, 8 * 1024 * 1024 + 1, 1e12, 'NaN', null])('refuses the claimed size %j', async (size_bytes) => {
		const res = await upload({ content_type: 'image/png', size_bytes });
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('invalid_size');
		expect(bucket.presigned).toHaveLength(0);
	});
});
