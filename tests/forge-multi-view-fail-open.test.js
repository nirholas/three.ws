/**
 * Multi-view inputs for Forge: the optional view step fails open within a
 * bounded time, painted views are vetted before they join the fusion, a set of
 * photos that mixes objects is pruned with a named reason, and a lane that
 * reads one image is given one image and the response says so.
 *
 * Two layers. The first drives api/_lib/forge-views.js with real image bytes
 * (made with sharp, the same decoder production uses). The second drives the
 * real api/forge.js handler and stubs only the network boundary: the gcp worker
 * call, the image painter, and the byte fetch of a view URL.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-views-user' }),
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

// ---------------------------------------------------------------------------
// Real pictures
// ---------------------------------------------------------------------------

async function picture({ width = 512, height = 512, background = '#ffffff', shape = null }) {
	let img = sharp({ create: { width, height, channels: 3, background } });
	if (shape) {
		const w = Math.round(width * 0.5);
		const h = Math.round(height * 0.6);
		const svg = Buffer.from(
			`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
				`<ellipse cx="${width / 2}" cy="${height / 2}" rx="${w / 2}" ry="${h / 2}" fill="${shape.fill}"/>` +
				(shape.accent
					? `<rect x="${width * 0.4}" y="${height * 0.35}" width="${width * 0.2}" height="${height * 0.3}" fill="${shape.accent}"/>`
					: '') +
				`</svg>`,
		);
		img = img.composite([{ input: svg }]);
	}
	return img.png().toBuffer();
}

const RED_SHOE = { fill: '#c0392b', accent: '#f1c40f' };
const BLUE_CAR = { fill: '#1f4fd8', accent: '#0a1a66' };

let FRONT; // the subject, white studio background
let SIDE; // the same subject from the side, on a grey backdrop
let BACK; // the same subject from behind
let BLANK; // an empty frame
let OTHER; // a different object
let TINY; // a sane picture, far too small
let WIDE; // the right subject on a canvas of the wrong shape

beforeAll(async () => {
	FRONT = await picture({ shape: RED_SHOE });
	SIDE = await picture({ shape: { fill: '#c0392b', accent: '#f1c40f' }, background: '#d0d0d0' });
	BACK = await picture({ shape: { fill: '#b03a2e', accent: '#f4d03f' } });
	BLANK = await picture({ background: '#808080' });
	OTHER = await picture({ shape: BLUE_CAR });
	TINY = await picture({ width: 64, height: 64, shape: RED_SHOE });
	WIDE = await picture({ width: 1400, height: 400, shape: RED_SHOE });
});

function bytesFor(map) {
	return async (url) => {
		if (!(url in map)) throw new Error(`no such view: ${url}`);
		return map[url];
	};
}

const { extendWithTurnaroundViews, vetViews, judgeView, describeView, pruneMismatchedPhotos, narrowToSingleView, pickPrimaryIndex, droppedViewsNote } =
	await import('../api/_lib/forge-views.js');

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

describe('vetting a painted view', () => {
	it('keeps the same subject seen from another side, even on a different backdrop', async () => {
		const load = bytesFor({ front: FRONT, side: SIDE, back: BACK });
		const verdicts = await vetViews('front', ['side', 'back'], { loadBytes: load });
		expect(verdicts.map((v) => v.ok)).toEqual([true, true]);
	});

	it('drops a blank frame, a different object, a tiny picture and a wrong-shaped canvas', async () => {
		const load = bytesFor({ front: FRONT, blank: BLANK, other: OTHER, tiny: TINY, wide: WIDE });
		const verdicts = await vetViews('front', ['blank', 'other', 'tiny', 'wide'], { loadBytes: load });
		expect(verdicts.map((v) => [v.ok, v.reason])).toEqual([
			[false, 'blank'],
			[false, 'different_subject'],
			[false, 'too_small'],
			[false, 'wrong_shape'],
		]);
	});

	it('drops a view it cannot read, because the worker would fail on the same address', async () => {
		const verdicts = await vetViews('front', ['gone'], { loadBytes: bytesFor({ front: FRONT }) });
		expect(verdicts[0]).toMatchObject({ ok: false, reason: 'unreadable' });
	});

	it('judges on its own when the primary cannot be read, never guessing a subject match', async () => {
		const verdicts = await vetViews('missing', ['other', 'blank'], { loadBytes: bytesFor({ other: OTHER, blank: BLANK }) });
		expect(verdicts.map((v) => v.ok)).toEqual([true, false]);
	});

	it('describes a flat frame as flat and a subject as foreground', async () => {
		expect((await describeView(BLANK)).flat).toBe(true);
		const subject = await describeView(FRONT);
		expect(subject.flat).toBe(false);
		expect(subject.foregroundFraction).toBeGreaterThan(0.2);
		expect(judgeView(subject, subject).ok).toBe(true);
	});
});

describe('a set of the person\'s own photos', () => {
	it('names a photo of a different object by its position and keeps the rest', async () => {
		const urls = ['p1', 'p2', 'p3', 'p4'];
		const load = bytesFor({ p1: FRONT, p2: SIDE, p3: OTHER, p4: BACK });
		const out = await pruneMismatchedPhotos(urls, { loadBytes: load });
		expect(out.urls).toEqual(['p1', 'p2', 'p4']);
		expect(out.dropped).toEqual([{ position: 3, url: 'p3', reason: 'different_subject' }]);
		expect(droppedViewsNote(out.dropped, { total: 4 })).toBe(
			'Left out of the set: photo 3 did not look like the same object as the first view. Building from the other 3 photos.',
		);
	});

	it('keeps every photo when a photo cannot be read or the first one is the only photo', async () => {
		const out = await pruneMismatchedPhotos(['p1', 'p2'], { loadBytes: bytesFor({ p1: FRONT }) });
		expect(out.urls).toEqual(['p1', 'p2']);
		expect(out.dropped).toEqual([]);
		expect((await pruneMismatchedPhotos(['p1'], { loadBytes: bytesFor({}) })).urls).toEqual(['p1']);
	});
});

// ---------------------------------------------------------------------------
// The optional step fails open, in bounded time
// ---------------------------------------------------------------------------

const PRIMARY = 'https://cdn.example/photo.png';
const base = { views: [PRIMARY], referenceImageUrl: PRIMARY, backendId: 'trellis_selfhost', tierId: 'standard' };
function load(map) {
	return bytesFor({ [PRIMARY]: FRONT, ...map });
}

describe('turnaround views fail open', () => {
	it('continues with the single view when the painter throws', async () => {
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: async () => {
				throw new Error('vertex edit lane down');
			},
			loadBytes: load({}),
		});
		expect(out.views).toEqual([PRIMARY]);
		expect(out.outcome).toBe('failed');
	});

	it('continues with the single view when the painter is throttled', async () => {
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: async () => {
				throw Object.assign(new Error('rate limited'), { providerStatus: 429, retryAfter: 45 });
			},
			loadBytes: load({}),
		});
		expect(out.views).toEqual([PRIMARY]);
		expect(out.outcome).toBe('failed');
	});

	it('continues with the single view when the painter answers with nothing', async () => {
		const out = await extendWithTurnaroundViews({ ...base, synthesize: async () => [], loadBytes: load({}) });
		expect(out.views).toEqual([PRIMARY]);
		expect(out.outcome).toBe('none');
	});

	it('stops waiting for a painter that never answers, inside the budget', async () => {
		const started = Date.now();
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: () => new Promise(() => {}),
			budgetMs: 150,
			loadBytes: load({}),
		});
		const elapsed = Date.now() - started;
		expect(out.views).toEqual([PRIMARY]);
		expect(out.outcome).toBe('timed_out');
		expect(elapsed).toBeGreaterThanOrEqual(140);
		expect(elapsed).toBeLessThan(1500);
	});

	it('survives a painter that rejects after the budget ran out (no unhandled rejection)', async () => {
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 300)),
			budgetMs: 100,
			loadBytes: load({}),
		});
		expect(out.outcome).toBe('timed_out');
		await new Promise((r) => setTimeout(r, 400));
	});

	it('adds the painted views that pass the checks and drops the ones that do not', async () => {
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: async () => ['https://cdn.example/side.png', 'https://cdn.example/back.png'],
			loadBytes: load({ 'https://cdn.example/side.png': SIDE, 'https://cdn.example/back.png': OTHER }),
		});
		expect(out.views).toEqual([PRIMARY, 'https://cdn.example/side.png']);
		expect(out.outcome).toBe('added');
		expect(out.dropped).toEqual([{ url: 'https://cdn.example/back.png', reason: 'different_subject' }]);
	});

	it('continues with the single view when every painted view fails the checks', async () => {
		const out = await extendWithTurnaroundViews({
			...base,
			synthesize: async () => ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
			loadBytes: load({ 'https://cdn.example/a.png': BLANK, 'https://cdn.example/b.png': BLANK }),
		});
		expect(out.views).toEqual([PRIMARY]);
		expect(out.outcome).toBe('rejected');
	});

	it('does not call the painter for a lane, tier or view count that cannot use it', async () => {
		const synthesize = vi.fn(async () => ['x']);
		for (const skip of [
			{ backendId: 'trellis2' },
			{ backendId: 'pixal3d' },
			{ tierId: 'draft' },
			{ views: [PRIMARY, 'https://cdn.example/two.png'] },
			{ referenceImageUrl: 'data:image/png;base64,AAAA', views: ['data:image/png;base64,AAAA'] },
		]) {
			const out = await extendWithTurnaroundViews({ ...base, ...skip, synthesize, loadBytes: load({}) });
			expect(out.outcome).toBe('skipped');
		}
		expect(synthesize).not.toHaveBeenCalled();
	});
});

describe('one image for the lanes that read one image', () => {
	const three = ['https://cdn.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png'];

	it('sends a single-view lane its front view and says the others were not used', () => {
		const out = narrowToSingleView({ views: three, labels: null, backendId: 'trellis2', engineLabel: 'TRELLIS.2' });
		expect(out.views).toEqual([three[0]]);
		expect(out.supplied).toBe(3);
		expect(out.used).toBe(1);
		expect(out.note).toMatch(/TRELLIS\.2 builds from a single photo/);
		expect(out.note).toMatch(/all 3 photos/);
	});

	it('picks the photo labeled front when the labels name one', () => {
		expect(pickPrimaryIndex(three, ['back', 'Front', 'left'])).toBe(1);
		expect(pickPrimaryIndex(three, ['back', 'side', 'left'])).toBe(0);
		expect(pickPrimaryIndex(three, ['front'])).toBe(0);
	});

	it('leaves the fusing lanes and single photos exactly as they were', () => {
		for (const backendId of ['trellis_selfhost', 'pixal3d', 'trellis', 'replicate_byok']) {
			const out = narrowToSingleView({ views: three, labels: null, backendId });
			expect(out.views).toBe(three);
			expect(out.note).toBe('');
		}
		const one = narrowToSingleView({ views: [three[0]], labels: null, backendId: 'trellis2' });
		expect(one.views).toEqual([three[0]]);
		expect(one.note).toBe('');
	});
});

// ---------------------------------------------------------------------------
// The real handler
// ---------------------------------------------------------------------------

const gcpSubmit = vi.fn(async ({ mode, params }) => ({
	extJobId: `gcpjob-${mode}`,
	viewsUsed: mode === 'trellis' || mode === 'pixal3d' ? params.images.length : 1,
	multiview: (mode === 'trellis' || mode === 'pixal3d') && params.images.length > 1,
}));
vi.mock('../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

const synthesizeTurnaroundViews = vi.fn(async () => []);
vi.mock('../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews,
}));

const createCreation = vi.fn(async () => 'creation-views-1');
vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation,
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-views-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

const validateForgeImage = vi.fn(async () => ({ ok: true }));
vi.mock('../api/_lib/forge-image-validate.js', () => ({ validateForgeImage }));

vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

// The byte fetch of a view URL is the network boundary: serve real pictures.
const served = new Map();
vi.mock('../api/_lib/ssrf-guard.js', async (orig) => ({
	...(await orig()),
	fetchSafePublicUrl: vi.fn(async (url) => {
		const bytes = served.get(String(url));
		if (!bytes) return new Response('not found', { status: 404 });
		return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
	}),
}));

const { default: handler } = await import('../api/forge.js');

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

const PHOTO = 'https://cdn.example/photo.png';
const SIDE_URL = 'https://cdn.example/photo-side.png';
const BACK_URL = 'https://cdn.example/photo-back.png';

beforeEach(() => {
	gcpSubmit.mockClear();
	createCreation.mockClear();
	synthesizeTurnaroundViews.mockReset();
	synthesizeTurnaroundViews.mockResolvedValue([]);
	validateForgeImage.mockReset();
	validateForgeImage.mockResolvedValue({ ok: true });
	served.clear();
	served.set(PHOTO, FRONT);
	delete process.env.FORGE_VIEWS_BUDGET_MS;
});

afterEach(() => {
	delete process.env.FORGE_VIEWS_BUDGET_MS;
});

async function submit(body) {
	const res = makeRes();
	await handler(makeReq(body), res);
	return res;
}

describe('handler: the protected TRELLIS lane gets the same request for one photo', () => {
	it('sends exactly the single image, whatever the painter does', async () => {
		const received = [];
		for (const painter of [
			async () => [],
			async () => {
				throw new Error('painter down');
			},
		]) {
			synthesizeTurnaroundViews.mockImplementation(painter);
			gcpSubmit.mockClear();
			const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
			expect(res.statusCode).toBe(200);
			expect(res.body.backend).toBe('trellis_selfhost');
			received.push(gcpSubmit.mock.calls[0][0]);
		}
		expect(received[0]).toEqual(received[1]);
		const call = received[0];
		expect(call.mode).toBe('trellis');
		expect(call.sourceUrl).toBe(PHOTO);
		expect(call.params.images).toEqual([PHOTO]);
		expect(call.params.matte).toBe(true);
		expect(Object.keys(call.params).sort()).toEqual(['images', 'matte', 'quality', 'seed'].sort());
	});
});

describe('handler: the optional view step cannot cost the model', () => {
	it('submits the single photo within the budget when the painter never answers', async () => {
		process.env.FORGE_VIEWS_BUDGET_MS = '1000';
		synthesizeTurnaroundViews.mockImplementation(() => new Promise(() => {}));
		const started = Date.now();
		const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
		const elapsed = Date.now() - started;
		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('queued');
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
		expect(elapsed).toBeGreaterThanOrEqual(950);
		expect(elapsed).toBeLessThan(6000);
	}, 15_000);

	it('submits the single photo when the painter throws', async () => {
		synthesizeTurnaroundViews.mockRejectedValue(new Error('vertex edit lane down'));
		const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
		expect(res.body.views_used).toBe(1);
	});

	it('submits the single photo when the painter is throttled', async () => {
		synthesizeTurnaroundViews.mockRejectedValue(Object.assign(new Error('429'), { providerStatus: 429, retryAfter: 45 }));
		const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
	});

	it('drops a blank or foreign painted view and fuses only the real one', async () => {
		served.set(SIDE_URL, SIDE);
		served.set(BACK_URL, BLANK);
		synthesizeTurnaroundViews.mockResolvedValue([SIDE_URL, BACK_URL]);
		const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO, SIDE_URL]);
		expect(res.body.reference_image_urls).toEqual([PHOTO, SIDE_URL]);
	});

	it('fuses both painted views when both pass', async () => {
		served.set(SIDE_URL, SIDE);
		served.set(BACK_URL, BACK);
		synthesizeTurnaroundViews.mockResolvedValue([SIDE_URL, BACK_URL]);
		const res = await submit({ image_urls: [PHOTO], tier: 'standard', path: 'image', skip_validation: true });
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO, SIDE_URL, BACK_URL]);
		expect(res.body.views_used).toBe(3);
		expect(res.body.multiview).toBe(true);
	});
});

describe('handler: a set of photos with a stranger in it', () => {
	const P2 = 'https://cdn.example/photo-2.png';
	const P3 = 'https://cdn.example/photo-3.png';

	it('leaves the other object out, tells the person which photo, and builds from the rest', async () => {
		served.set(P2, SIDE);
		served.set(P3, OTHER);
		const res = await submit({ image_urls: [PHOTO, P2, P3], tier: 'standard', path: 'image' });
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO, P2]);
		expect(res.body.views_requested).toBe(3);
		expect(res.body.views_used).toBe(2);
		expect(res.body.views_note).toMatch(/photo 3 did not look like the same object/);
		expect(res.body.views_dropped).toEqual([{ position: 3, reason: 'different_subject' }]);
	});

	it('honours skip_validation: the person said generate anyway', async () => {
		served.set(P2, OTHER);
		const res = await submit({ image_urls: [PHOTO, P2], tier: 'standard', path: 'image', skip_validation: true });
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO, P2]);
		expect(res.body.views_dropped).toBeUndefined();
	});
});

describe('handler: a lane that reads one photo is given one photo', () => {
	const photos = [PHOTO, 'https://cdn.example/photo-2.png', 'https://cdn.example/photo-3.png'];

	it('sends TRELLIS.2 the front photo only and reports one view used of three', async () => {
		photos.forEach((u) => served.set(u, FRONT));
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		const res = await submit({ image_urls: photos, tier: 'standard', path: 'image', backend: 'trellis2', skip_validation: true });
		delete process.env.MODEL_TRELLIS2_URL;
		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('trellis2');
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTO]);
		expect(res.body.reference_image_urls).toEqual([PHOTO]);
		expect(res.body.views_requested).toBe(3);
		expect(res.body.views_used).toBe(1);
		expect(res.body.multiview).toBe(false);
		expect(res.body.views_note).toMatch(/builds from a single photo, so only your front view was used/);
		expect(createCreation.mock.calls[0][0].viewsRequested).toBe(3);
		expect(createCreation.mock.calls[0][0].viewsUsed).toBe(1);
	});

	it('still fuses every photo on the multi-view lane', async () => {
		photos.forEach((u) => served.set(u, FRONT));
		const res = await submit({ image_urls: photos, tier: 'standard', path: 'image', skip_validation: true });
		expect(res.body.backend).toBe('trellis_selfhost');
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual(photos);
		expect(res.body.views_requested).toBe(3);
		expect(res.body.views_used).toBe(3);
		expect(res.body.views_note).toBeUndefined();
	});
});

// api/gpt-forge.js is a clone of api/forge.js and shares this step's module, so
// the same bound, checks and honest counts apply on the ChatGPT surface.
describe('the ChatGPT clone runs the same bounded view step', () => {
	it('routes its turnaround views, photo checks and counts through forge-views', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('../api/gpt-forge.js', import.meta.url), 'utf8');
		expect(src).toContain("from './_lib/forge-views.js'");
		expect(src).toMatch(/await extendWithTurnaroundViews\(/);
		expect(src).toMatch(/await pruneMismatchedPhotos\(/);
		expect(src).toMatch(/narrowToSingleView\(/);
		expect(src).toMatch(/\.\.\.viewsReport\(/);
		expect(src).not.toMatch(/await synthesizeTurnaroundViews\(/);
	});
});
