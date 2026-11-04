import { describe, it, expect } from 'vitest';
import { inviteUrl, qrUrl, coinLabel, inviteSheetModel, EVENT_LEAD_MS } from '../src/game/invite-link.js';
import { coinWorldUrl } from '../src/fits-lib.js';
import { parseEventConfig } from '../src/shared/event-config.js';

const ORIGIN = 'https://three.ws';
const THREE = {
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	name: 'three.ws',
	symbol: 'three',
	image: '/api/img?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafy&seed=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&w=512',
};

// The shape of public/event.json, pointed at the $THREE world.
const EVENT = parseEventConfig({
	name: '$THREE Community Meetup #3',
	startsAt: '2026-11-06T16:00:00Z',
	endsAt: '2026-11-06T17:00:00Z',
	link: '/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three',
});
const START = Date.parse('2026-11-06T16:00:00Z');
const END = Date.parse('2026-11-06T17:00:00Z');

describe('inviteUrl', () => {
	it('always carries coin, name, symbol and image', () => {
		const u = new URL(inviteUrl(THREE, ORIGIN));
		expect(u.origin + u.pathname).toBe('https://three.ws/play');
		expect(u.searchParams.get('coin')).toBe(THREE.mint);
		expect(u.searchParams.get('name')).toBe('three.ws');
		expect(u.searchParams.get('symbol')).toBe('three');
		expect(u.searchParams.get('image')).toBe(THREE.image);
	});

	it('never copies session, auth or tracking params from the world it was opened in', () => {
		const coin = {
			...THREE,
			tier: 'holders', ui: 'zen', session: 'abc', token: 'secret', code: 'oauth', ref: 'x',
		};
		const u = new URL(inviteUrl(coin, ORIGIN));
		expect([...u.searchParams.keys()].sort()).toEqual(['coin', 'image', 'name', 'symbol']);
	});

	it('drops an image that is neither our proxy nor https', () => {
		for (const image of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://evil.example/a.png', '/admin']) {
			const u = new URL(inviteUrl({ ...THREE, image }, ORIGIN));
			expect(u.searchParams.has('image')).toBe(false);
		}
		const https = new URL(inviteUrl({ ...THREE, image: 'https://ipfs.io/ipfs/bafy' }, ORIGIN));
		expect(https.searchParams.get('image')).toBe('https://ipfs.io/ipfs/bafy');
	});

	it('clamps name and symbol, strips a leading $ and control characters', () => {
		const u = new URL(inviteUrl({ mint: THREE.mint, name: 'n'.repeat(80), symbol: '$SYM\u0007BOL' }, ORIGIN));
		expect(u.searchParams.get('name')).toHaveLength(48);
		expect(u.searchParams.get('symbol')).toBe('SYMBOL');
	});

	it('returns null without a mint', () => {
		expect(inviteUrl({ name: 'x' }, ORIGIN)).toBeNull();
		expect(inviteUrl(null, ORIGIN)).toBeNull();
	});
});

describe('qrUrl', () => {
	it('is exactly the canonical coinWorldUrl() made absolute', () => {
		expect(qrUrl(THREE, ORIGIN)).toBe(ORIGIN + coinWorldUrl(THREE.mint));
		expect(qrUrl(THREE, ORIGIN)).toBe('https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
	});
});

describe('coinLabel', () => {
	it('prefers the ticker, then the name, then a neutral noun', () => {
		expect(coinLabel(THREE)).toBe('$THREE');
		expect(coinLabel({ name: 'Some Coin' })).toBe('Some Coin');
		expect(coinLabel({})).toBe('this world');
	});
});

describe('inviteSheetModel', () => {
	it('leads with the event name and a start countdown inside the lead window', () => {
		const now = START - (26 * 3600 + 5 * 60 + 9) * 1000;
		const m = inviteSheetModel({ coin: THREE, origin: ORIGIN, event: EVENT, now });
		expect(m.event).toEqual({
			name: '$THREE Community Meetup #3',
			state: 'upcoming',
			countdown: 'Starts in 1d 02:05:09',
			clock: '1d 02:05:09',
			remainingMs: (26 * 3600 + 5 * 60 + 9) * 1000,
		});
		expect(m.heading).toBe('Invite a friend to $THREE Community Meetup #3');
		expect(m.shareText).toContain('$THREE Community Meetup #3');
	});

	it('counts down to the end while the event is live', () => {
		const m = inviteSheetModel({ coin: THREE, origin: ORIGIN, event: EVENT, now: START + 15 * 60 * 1000 });
		expect(m.event.state).toBe('live');
		expect(m.event.countdown).toBe('Live now, ends in 00:45:00');
		expect(m.shareText).toContain('live right now');
	});

	it('is the plain invite outside the window', () => {
		const early = inviteSheetModel({ coin: THREE, origin: ORIGIN, event: EVENT, now: START - EVENT_LEAD_MS - 1000 });
		const after = inviteSheetModel({ coin: THREE, origin: ORIGIN, event: EVENT, now: END + 1000 });
		for (const m of [early, after]) {
			expect(m.event).toBeNull();
			expect(m.heading).toBe('Invite a friend to $THREE');
		}
	});

	it('is the plain invite in a world the event is not held in', () => {
		const other = { mint: 'THREEsynthetic1111111111111111111111111111', symbol: 'OTHR' };
		const m = inviteSheetModel({ coin: other, origin: ORIGIN, event: EVENT, now: START + 1000 });
		expect(m.event).toBeNull();
		expect(m.heading).toBe('Invite a friend to $OTHR');
	});

	it('is the plain invite with no event configured', () => {
		const m = inviteSheetModel({ coin: THREE, origin: ORIGIN, event: null, now: START });
		expect(m.event).toBeNull();
		expect(m.link).toBe(inviteUrl(THREE, ORIGIN));
		expect(m.qr).toBe(qrUrl(THREE, ORIGIN));
	});
});
