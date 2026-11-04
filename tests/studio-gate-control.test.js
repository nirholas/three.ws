// Pure logic behind Widget Studio's "Holders only" control
// (public/studio/gate-panel.js). The panel turns an avatar the creator owns into
// a holder-only embed through POST /api/embed/gate-create, so every rule that
// decides what gets sent, and what a failure tells the creator, lives here where
// it can be pinned without a browser.
//
// The default token is $THREE. A creator may name another SPL mint in the
// advanced field; that mint is runtime data passed straight through, so the
// fixtures below use only $THREE or a clearly synthetic placeholder.

import { describe, it, expect } from 'vitest';
import {
	THREE_MINT,
	gateAssetId,
	shortMint,
	isSolanaMint,
	parseMinAmount,
	buildGateRequest,
	tierShortcuts,
	gateErrorState,
	gateResultView,
	formatTokenAmount,
} from '../public/studio/gate-panel.js';

const AVATAR = '8e3f1c22-0000-4000-8000-0000000000c1';
const SYNTHETIC_MINT = 'THREEsynthetic1111111111111111111111111111';

describe('gateAssetId', () => {
	it('turns a library avatar id into the avatar:<id> asset spec the endpoint expects', () => {
		expect(gateAssetId(AVATAR)).toBe(`avatar:${AVATAR}`);
	});
	it('returns null when no avatar is picked, so the panel can show its empty state', () => {
		expect(gateAssetId(null)).toBeNull();
		expect(gateAssetId('')).toBeNull();
	});
	it('refuses an id the endpoint would reject rather than sending a doomed request', () => {
		expect(gateAssetId('a b')).toBeNull();
		expect(gateAssetId('x'.repeat(65))).toBeNull();
	});
});

describe('shortMint and isSolanaMint', () => {
	it('shortens a mint to its first and last four characters', () => {
		expect(shortMint(THREE_MINT)).toBe('FeMb...pump');
	});
	it('accepts a base58 address and rejects anything else', () => {
		expect(isSolanaMint(THREE_MINT)).toBe(true);
		expect(isSolanaMint(SYNTHETIC_MINT)).toBe(true);
		expect(isSolanaMint('0xabc')).toBe(false);
		expect(isSolanaMint('O0Il'.repeat(10))).toBe(false);
		expect(isSolanaMint('')).toBe(false);
	});
});

describe('parseMinAmount', () => {
	it('parses a plain or comma-grouped positive number', () => {
		expect(parseMinAmount('5000')).toEqual({ ok: true, value: 5000 });
		expect(parseMinAmount(' 1,250,000 ')).toEqual({ ok: true, value: 1250000 });
		expect(parseMinAmount('0.5')).toEqual({ ok: true, value: 0.5 });
	});
	it('asks for a value when the field is empty', () => {
		const r = parseMinAmount('  ');
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/how many tokens/i);
	});
	it('rejects zero, negatives and text, because a zero bar would be an open gate', () => {
		for (const raw of ['0', '-5', 'lots', '1e', 'NaN', 'Infinity']) {
			const r = parseMinAmount(raw);
			expect(r.ok, raw).toBe(false);
			expect(r.message).toMatch(/above zero/i);
		}
	});
	it('rejects a value above the server ceiling instead of letting it be clamped silently', () => {
		const r = parseMinAmount('2000000000000000');
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/too large/i);
	});
	it('rejects more decimal places than an SPL token can carry', () => {
		const r = parseMinAmount('1.0000000001');
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/9 decimal places/);
	});
});

describe('buildGateRequest', () => {
	it('builds the documented body and omits mint when the token is $THREE', () => {
		const r = buildGateRequest({ avatarId: AVATAR, minAmount: '5000', mint: THREE_MINT });
		expect(r).toEqual({
			ok: true,
			body: { assetId: `avatar:${AVATAR}`, gate: { minAmount: 5000, chain: 'solana' } },
		});
	});
	it('omits mint when the advanced field is left empty', () => {
		const r = buildGateRequest({ avatarId: AVATAR, minAmount: '1', mint: '  ' });
		expect(r.ok).toBe(true);
		expect(r.body.gate).not.toHaveProperty('mint');
	});
	it('passes another SPL mint through as runtime data', () => {
		const r = buildGateRequest({ avatarId: AVATAR, minAmount: '10', mint: ` ${SYNTHETIC_MINT} ` });
		expect(r.ok).toBe(true);
		expect(r.body.gate.mint).toBe(SYNTHETIC_MINT);
	});
	it('reports each invalid field by name so the form can mark it', () => {
		const r = buildGateRequest({ avatarId: null, minAmount: '0', mint: 'not-a-mint' });
		expect(r.ok).toBe(false);
		expect(Object.keys(r.errors).sort()).toEqual(['avatar', 'minAmount', 'mint']);
		expect(r.errors.avatar).toMatch(/pick an avatar/i);
		expect(r.errors.mint).toMatch(/solana token mint/i);
	});
});

describe('tierShortcuts', () => {
	const ladder = [
		{ level: 0, id: 'member', label: 'Member', min_usd: 0 },
		{ level: 1, id: 'bronze', label: 'Bronze', min_usd: 25 },
		{ level: 2, id: 'silver', label: 'Silver', min_usd: 100 },
		{ level: 3, id: 'gold', label: 'Gold', min_usd: 500 },
		{ level: 4, id: 'genesis', label: 'Genesis', min_usd: 2500 },
	];

	it('converts every paid tier from its USD threshold at the live price, rounding up', () => {
		const out = tierShortcuts(ladder, 0.0005);
		expect(out.map((t) => t.id)).toEqual(['bronze', 'silver', 'gold', 'genesis']);
		expect(out[0]).toEqual({ id: 'bronze', label: 'Bronze', minUsd: 25, tokens: 50000 });
		expect(out[3].tokens).toBe(5000000);
	});
	it('never rounds a tier below its USD bar', () => {
		const price = 0.0005584992195547943;
		for (const t of tierShortcuts(ladder, price)) {
			expect(t.tokens * price).toBeGreaterThanOrEqual(t.minUsd);
			expect(Number.isInteger(t.tokens)).toBe(true);
		}
	});
	it('returns nothing without a usable price, so no shortcut shows a made-up number', () => {
		expect(tierShortcuts(ladder, null)).toEqual([]);
		expect(tierShortcuts(ladder, 0)).toEqual([]);
		expect(tierShortcuts(null, 0.001)).toEqual([]);
	});
});

describe('formatTokenAmount', () => {
	it('groups thousands and keeps meaningful decimals', () => {
		expect(formatTokenAmount(50000)).toBe('50,000');
		expect(formatTokenAmount(0.25)).toBe('0.25');
	});
});

describe('gateErrorState', () => {
	it('sends a signed-out creator to sign in and back to the studio', () => {
		const s = gateErrorState(401, { error: 'unauthorized' }, { returnTo: '/studio?avatar=x' });
		expect(s.kind).toBe('auth');
		expect(s.action).toEqual({ label: 'Sign in', href: '/login?next=%2Fstudio%3Favatar%3Dx' });
	});
	it('explains ownership on a 403 instead of echoing the server text', () => {
		const s = gateErrorState(403, { error: 'not_owner', error_description: 'you do not own this asset' });
		expect(s.kind).toBe('not_owner');
		expect(s.message).toMatch(/only gate an avatar you own/i);
		expect(s.action.label).toMatch(/pick/i);
	});
	it('tells a rate-limited creator how long to wait', () => {
		const s = gateErrorState(429, { error: 'rate_limited', retry_after: 90 });
		expect(s.kind).toBe('rate_limited');
		expect(s.message).toMatch(/2 minutes/);
		expect(s.action.label).toBe('Try again');
	});
	it('surfaces the server validation message, which names the bad field', () => {
		const s = gateErrorState(400, { error: 'validation_error', error_description: 'minAmount must be a positive number' });
		expect(s.kind).toBe('validation');
		expect(s.message).toBe('minAmount must be a positive number');
	});
	it('treats a dropped connection as retryable', () => {
		const s = gateErrorState(0, null);
		expect(s.kind).toBe('network');
		expect(s.action.label).toBe('Try again');
	});
	it('covers a missing avatar and a server failure with a recovery action', () => {
		expect(gateErrorState(404, { error: 'not_found' }).kind).toBe('not_found');
		const s = gateErrorState(503, { error: 'db_unavailable' });
		expect(s.kind).toBe('server');
		expect(s.action.label).toBe('Try again');
	});
});

describe('gateResultView', () => {
	const response = {
		gateId: 'AbCdEf123456',
		assetId: `avatar:${AVATAR}`,
		gate: { mint: THREE_MINT, minAmount: 50000, chain: 'solana' },
		name: 'Nova',
		embed: {
			scriptSrc: 'https://three.ws/embed/v1.js',
			snippet: `<script src="https://three.ws/embed/v1.js" async></script>\n<three-d agent="avatar:${AVATAR}" interactive></three-d>`,
			previewUrl: `https://three.ws/embed/v1/gated.html?asset=avatar%3A${AVATAR}`,
		},
	};

	it('reads the snippet, preview and requirement straight from the endpoint response', () => {
		const v = gateResultView(response);
		expect(v.snippet).toBe(response.embed.snippet);
		expect(v.previewUrl).toBe(response.embed.previewUrl);
		expect(v.requirement).toBe('Hold 50,000 $THREE to unlock');
		expect(v.isThree).toBe(true);
		expect(v.gateId).toBe('AbCdEf123456');
	});
	it('names another mint by its short form', () => {
		const v = gateResultView({ ...response, gate: { ...response.gate, mint: SYNTHETIC_MINT, minAmount: 1 } });
		expect(v.isThree).toBe(false);
		expect(v.requirement).toBe('Hold 1 THRE...1111 to unlock');
	});
	it('returns null for a response with no gate, so the panel shows the create form', () => {
		expect(gateResultView({ gate: null })).toBeNull();
		expect(gateResultView(null)).toBeNull();
	});
});
