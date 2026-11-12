// Sign language packs and the review rule that gates every pack but ASL.
//
// The promise under test: no sign in a pack that is not native is ever
// performed unless enough fluent signers approved its exact current content.
// One approval is not enough when two are required, an edit invalidates every
// earlier approval, a reject holds a sign back however many approvals it has,
// and a word a pack cannot sign is reported as unsupported rather than quietly
// fingerspelled in another language's alphabet. Requests that name no language
// must keep returning exactly what they returned before packs existed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const signCompileIp = vi.fn(async () => ({ success: true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		get signCompileIp() {
			return signCompileIp;
		},
	},
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const { default: handler, compile, readParams } = await import('../api/sign.js');
const { canonicalJson, signContentHash } = await import('../src/sign-packs/hash.js');
const { signReviewState, packReview, DEFAULT_REQUIRED_APPROVALS } = await import('../src/sign-packs/review.js');
const { getPack, listPacks, servablePack, servablePacks, DEFAULT_PACK_ID } = await import('../src/sign-packs/index.js');
const { default: ASL } = await import('../src/sign-packs/asl.js');
const { default: FIXTURE } = await import('../src/sign-packs/review-fixture.js');
const { default: TEMPLATE } = await import('../src/sign-packs/_template.js');
const { SIGNABLE_WORDS, SIGNS, buildSignClip, lookupSign, signableWords } = await import('../src/sign-dictionary.js');
const { compileUtterance } = await import('../src/sign-speech.js');
const { signLookup } = await import('../src/sign-dictionary.js');

function mockReq(search = '', method = 'GET', body = null) {
	const req = { method, headers: { host: 'localhost' }, url: `/api/sign${search}` };
	if (body != null) {
		req.headers['content-type'] = 'application/json';
		req.rawBody = Buffer.from(JSON.stringify(body));
	}
	return req;
}

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
		},
	};
}

const json = (res) => JSON.parse(String(res.body));

/** The fixture pack with a given committed ledger. */
function withLedger(reviews, overrides = {}) {
	return Object.freeze({ ...FIXTURE, ...overrides, reviews: Object.freeze(reviews) });
}

const approve = (sign, reviewer, hash = signContentHash(FIXTURE.signs[sign])) => ({
	sign,
	hash,
	reviewer,
	verdict: 'approve',
});

beforeEach(() => {
	signCompileIp.mockClear();
});

describe('content hash', () => {
	it('ignores key order and changes on any real edit', () => {
		const a = { gloss: 'x', phases: [{ t: 0.3, right: { shape: 'A', palm: 'up' } }] };
		const b = { phases: [{ right: { palm: 'up', shape: 'A' }, t: 0.3 }], gloss: 'x' };
		expect(canonicalJson(a)).toBe(canonicalJson(b));
		expect(signContentHash(a)).toBe(signContentHash(b));
		expect(signContentHash(a)).toMatch(/^[0-9a-f]{64}$/);
		const edited = { ...a, phases: [{ t: 0.31, right: { shape: 'A', palm: 'up' } }] };
		expect(signContentHash(edited)).not.toBe(signContentHash(a));
	});
});

describe('approval rule', () => {
	const hash = signContentHash(FIXTURE.signs.HELLO);

	it('defaults to two required approvals', () => {
		expect(DEFAULT_REQUIRED_APPROVALS).toBe(2);
		expect(FIXTURE.requiredApprovals).toBe(2);
	});

	it('one approval stays unapproved when two are required', () => {
		expect(signReviewState([approve('HELLO', 'r1')], hash, 2).state).toBe('in_review');
		expect(signReviewState([approve('HELLO', 'r1'), approve('HELLO', 'r1')], hash, 2).state).toBe('in_review');
		expect(signReviewState([approve('HELLO', 'r1'), approve('HELLO', 'r2')], hash, 2).state).toBe('approved');
	});

	it('editing a sign invalidates its approvals', () => {
		const rows = [approve('HELLO', 'r1'), approve('HELLO', 'r2')];
		const edited = { ...FIXTURE.signs.HELLO, gloss: `${FIXTURE.signs.HELLO.gloss} Edited.` };
		expect(signReviewState(rows, signContentHash(edited), 2).state).toBe('unreviewed');
	});

	it('a reject or a change request holds a sign back whatever the count', () => {
		const rows = [approve('HELLO', 'r1'), approve('HELLO', 'r2'), approve('HELLO', 'r3')];
		expect(signReviewState([...rows, { ...approve('HELLO', 'r4'), verdict: 'reject' }], hash, 2).state).toBe('rejected');
		expect(signReviewState([...rows, { ...approve('HELLO', 'r4'), verdict: 'needs_change' }], hash, 2).state).toBe(
			'needs_change',
		);
	});

	it("a reviewer's latest verdict on a hash is their verdict", () => {
		const rows = [{ ...approve('HELLO', 'r1'), verdict: 'reject' }, approve('HELLO', 'r1'), approve('HELLO', 'r2')];
		expect(signReviewState(rows, hash, 2).state).toBe('approved');
	});

	it('reads database rows as well as ledger entries', () => {
		const rows = ['u1', 'u2'].map((id) => ({ sign_key: 'HELLO', content_hash: hash, reviewer_id: id, verdict: 'approve' }));
		expect(signReviewState(rows, hash, 2).state).toBe('approved');
	});
});

describe('pack registry', () => {
	it('ASL is the default and only native pack', () => {
		expect(DEFAULT_PACK_ID).toBe('ase');
		expect(getPack()).toBe(ASL);
		expect(getPack('ASE')).toBe(ASL);
		expect(ASL.signs).toBe(SIGNS);
		for (const pack of listPacks()) {
			if (pack.status === 'native') expect(pack.id, 'only ASL predates review').toBe('ase');
		}
	});

	it('never lists the template or the review fixture', () => {
		const ids = listPacks().map((p) => p.id);
		expect(ids).not.toContain(TEMPLATE.id);
		expect(ids).not.toContain(FIXTURE.id);
		expect(getPack('rms')).toBeNull();
		expect(getPack('qfx')).toBeNull();
	});

	it('a pack with no approved sign is not servable', () => {
		expect(servablePack(FIXTURE).review).toEqual({ approved: 0, total: 6, required: 2 });
		expect(servablePacks().map((p) => p.id)).toEqual(['ase']);
	});

	it('every registered pack that is not native ships only signs its committed ledger approves', () => {
		for (const pack of [...listPacks(), FIXTURE]) {
			if (pack.status === 'native') continue;
			const review = packReview(pack, pack.reviews);
			const served = Object.keys(servablePack(pack).signs);
			for (const key of served) {
				expect(review.signs[key].state, `${pack.id}:${key} is served without enough approvals`).toBe('approved');
			}
		}
	});
});

describe('serving a pack under review', () => {
	const pack = withLedger([
		approve('HELLO', 'r1'),
		approve('HELLO', 'r2'),
		approve('THANK', 'r1'),
		approve('YES', 'r1'),
		approve('YES', 'r2'),
		{ ...approve('YES', 'r3'), verdict: 'reject' },
	]);

	it('serves only approved signs and aliases that point at them', () => {
		const view = servablePack(pack);
		expect(Object.keys(view.signs)).toEqual(['HELLO']);
		expect(view.aliases).toEqual({ HI: 'HELLO' });
		expect(lookupSign('hello', pack)?.name).toBe('HELLO');
		expect(lookupSign('thank', pack)).toBeNull();
		expect(lookupSign('yes', pack)).toBeNull();
		expect(buildSignClip('yes', { pack })).toBeNull();
		expect(signableWords(pack)).toEqual(['HELLO', 'HI']);
		// SIGNABLE_WORDS keeps its historical shape (AGAIN and YALL appear as both a
		// sign and an alias); signableWords() is the de-duplicated set.
		expect([...new Set(SIGNABLE_WORDS)]).toEqual(signableWords('ase'));
	});

	it('reports unsupported words instead of fingerspelling them in ASL', () => {
		const result = compileUtterance('hello thank you', {
			signs: signLookup({ pack }),
			spell: false,
			pack,
		});
		expect(result.signed).toEqual(['HELLO']);
		expect(result.spelled).toEqual([]);
		expect(result.unsupported).toEqual(['THANK', 'YOU']);
		const [hello, thank, you] = result.segments;
		expect(hello).toMatchObject({ word: 'HELLO', signed: true, letters: null });
		expect(thank).toMatchObject({ word: 'THANK', signed: false, unsupported: true, letters: null, gloss: null });
		expect(thank.start).toBe(hello.end);
		expect(thank.end).toBe(thank.start);
		expect(you.unsupported).toBe(true);
		// The clip is HELLO alone: led in and settled, with no spelled letters in it.
		const solo = buildSignClip('hello', { pack, lead: true, settle: true });
		expect(result.clip.duration).toBeCloseTo(solo.duration, 6);
	});

	it('compiles through the API with lang, review coverage and unsupported words', () => {
		const body = compile(readParams({ text: 'hi thank', format: 'timeline' }), 'https://three.ws', pack);
		expect(body.lang).toBe('qfx');
		expect(body.review).toEqual({ approved: 1, total: 6 });
		expect(body.signed).toEqual(['HI']);
		expect(body.unsupported).toEqual(['THANK']);
		expect(body.timeline[1]).toMatchObject({ word: 'THANK', signed: false, unsupported: true, letters: null });
		expect(body.clip).toBeUndefined();
	});

	it('answers with an empty performance when nothing in the text is approved', () => {
		const body = compile(readParams({ text: 'thank', format: 'clip' }), 'https://three.ws', pack);
		expect(body.signed).toEqual([]);
		expect(body.unsupported).toEqual(['THANK']);
		expect(body.duration).toBe(0);
		expect(body.clip.tracks).toEqual([]);
	});
});

describe('GET/POST /api/sign lang', () => {
	it('answers 400 unsupported_language for a pack that does not exist or has no approved sign', async () => {
		for (const lang of ['rms', 'qfx', 'xx-nope']) {
			const res = mockRes();
			await handler(mockReq(`?text=hello&lang=${lang}`), res);
			expect(res.statusCode, lang).toBe(400);
			const body = json(res);
			expect(body.error).toBe('unsupported_language');
			expect(body.available).toEqual([{ lang: 'ase', name: 'American Sign Language', approved: ASL_TOTAL(), total: ASL_TOTAL() }]);
		}
		const res = mockRes();
		await handler(mockReq('', 'POST', { text: 'hello', lang: 'rms' }), res);
		expect(res.statusCode).toBe(400);
		expect(json(res).error).toBe('unsupported_language');
	});

	it('a request without lang is byte-identical to before; lang=ase adds only lang and review', async () => {
		const bare = mockRes();
		await handler(mockReq('?text=happy+to+meet+you&format=timeline'), bare);
		const bareBody = json(bare);
		expect(bareBody).not.toHaveProperty('lang');
		expect(bareBody).not.toHaveProperty('review');
		expect(bareBody).not.toHaveProperty('unsupported');
		expect(bareBody.timeline.every((s) => !('unsupported' in s))).toBe(true);

		const named = mockRes();
		await handler(mockReq('?text=happy+to+meet+you&format=timeline&lang=ase'), named);
		const { lang, review, ...rest } = json(named);
		expect(lang).toBe('ase');
		expect(review).toEqual({ approved: ASL_TOTAL(), total: ASL_TOTAL() });
		expect(rest).toEqual(bareBody);
	});

	it('the discovery descriptor lists the servable languages', async () => {
		const res = mockRes();
		await handler(mockReq(''), res);
		const body = json(res);
		expect(body.languages).toEqual([{ lang: 'ase', name: 'American Sign Language', approved: ASL_TOTAL(), total: ASL_TOTAL() }]);
		expect(body.parameters.lang).toMatch(/ase/);
	});
});

function ASL_TOTAL() {
	return Object.keys(ASL.signs).length;
}
