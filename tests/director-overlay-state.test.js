import { describe, it, expect } from 'vitest';
import { MODE, parseDirectorEvent, overlayModel, formatLead } from '../src/game/director-overlay-state.js';

const START = Date.parse('2026-11-06T16:00:00Z');
const DOC = {
	id: 'three-community-meetup-3',
	name: '$THREE Community Meetup #3',
	tagline: 'The Three.ws User Group on IBM Community, meeting inside the world.',
	startsAt: '2026-11-06T16:00:00Z',
	endsAt: '2026-11-06T17:00:00Z',
	groupPhoto: { atMin: 58, emote: 'av-cheering' },
	agenda: [
		{ atMin: 0, title: 'Doors open in the plaza', detail: 'Welcome', icon: 'W' },
		{ atMin: 6, title: 'Live build', detail: 'Then we wear it', icon: 'B' },
	],
};
const world = { name: 'three.ws', symbol: 'three' };
const event = parseDirectorEvent(DOC);

describe('parseDirectorEvent', () => {
	it('treats the shipped no-event file (id: null) as no event, not an error', () => {
		expect(parseDirectorEvent({ id: null })).toBeNull();
		expect(parseDirectorEvent({ id: null, name: 'x', startsAt: '2026-11-06T16:00:00Z' })).toBeNull();
	});

	it('treats missing, malformed or start-less config as no event', () => {
		expect(parseDirectorEvent(null)).toBeNull();
		expect(parseDirectorEvent('nope')).toBeNull();
		expect(parseDirectorEvent({ id: 'a', startsAt: 'not a date' })).toBeNull();
	});

	it('honours the ?meetup= preview shift the rest of /play honours', () => {
		const shifted = parseDirectorEvent(DOC, '?meetup=2030-01-01T10:00:00Z');
		expect(shifted.startsAt).toBe(Date.parse('2030-01-01T10:00:00Z'));
		expect(shifted.endsAt - shifted.startsAt).toBe(3600_000);
	});
});

describe('overlayModel', () => {
	it('upcoming: shows the event name and a countdown', () => {
		const m = overlayModel({ event, now: START - 2 * 3600_000 - 14 * 60_000, world, online: 12 });
		expect(m.mode).toBe(MODE.UPCOMING);
		expect(m.eventName).toBe('$THREE Community Meetup #3');
		expect(m.badge).toBe('STARTS IN');
		expect(m.clock).toBe('2h 14m');
		expect(m.symbol).toBe('$THREE');
		expect(m.onlineLabel).toBe('12 online');
	});

	it('the final half hour reads as starting soon', () => {
		expect(overlayModel({ event, now: START - 5 * 60_000, world, online: 0 }).badge).toBe('STARTING SOON');
	});

	it('live: LIVE badge, the running segment, what is next and time left', () => {
		const m = overlayModel({ event, now: START + 7 * 60_000, world, online: 31 });
		expect(m.mode).toBe(MODE.LIVE);
		expect(m.badge).toBe('LIVE');
		expect(m.segment.title).toBe('Live build');
		expect(m.clock).toBe('53m left');
		expect(m.next).toBeNull();
		const earlier = overlayModel({ event, now: START + 2 * 60_000, world, online: 31 });
		expect(earlier.segment.title).toBe('Doors open in the plaza');
		expect(earlier.next.title).toBe('Live build');
		expect(earlier.next.in).toBe('4m 00s');
	});

	it('no event: world, symbol and online count only, no event chrome', () => {
		const m = overlayModel({ event: null, now: START, world, online: 1 });
		expect(m.mode).toBe(MODE.NONE);
		expect(m.eventName).toBe('');
		expect(m.badge).toBe('');
		expect(m.onlineLabel).toBe('1 online');
		expect(m.world).toBe('three.ws');
	});

	it('an event that has fully ended falls back to the no-event overlay', () => {
		expect(overlayModel({ event, now: START + 3 * 3600_000, world, online: 3 }).mode).toBe(MODE.NONE);
	});

	it('afterglow: thanks, with no countdown', () => {
		const m = overlayModel({ event, now: START + 70 * 60_000, world, online: 3 });
		expect(m.mode).toBe(MODE.AFTERGLOW);
		expect(m.clock).toBe('');
	});

	it('group photo: gather, then a per-second countdown, then gone', () => {
		const shutter = START + 58 * 60_000;
		expect(overlayModel({ event, now: shutter - 30_000, world, online: 9 }).photo.stage).toBe('gather');
		const cd = overlayModel({ event, now: shutter - 7_200, world, online: 9 }).photo;
		expect(cd.stage).toBe('countdown');
		expect(cd.seconds).toBe(8);
		expect(overlayModel({ event, now: shutter + 5_000, world, online: 9 }).photo).toBeNull();
		expect(overlayModel({ event, now: START + 10 * 60_000, world, online: 9 }).photo).toBeNull();
	});

	it('falls back to sane world text and clamps a bad online count', () => {
		const m = overlayModel({ event: null, now: 0, world: {}, online: -4 });
		expect(m.world).toBe('three.ws');
		expect(m.symbol).toBe('');
		expect(m.online).toBe(0);
		expect(overlayModel({ event: null, now: 0, world: { symbol: '$abc' }, online: 'x' }).symbol).toBe('$ABC');
	});

	it('the change key only moves when something visible moves', () => {
		const a = overlayModel({ event, now: START - 3 * 3600_000 - 1000, world, online: 5 });
		const b = overlayModel({ event, now: START - 3 * 3600_000 - 2000, world, online: 5 });
		expect(a.key).toBe(b.key);
		const c = overlayModel({ event, now: START - 3 * 3600_000 - 1000, world, online: 6 });
		expect(c.key).not.toBe(a.key);
	});
});

describe('formatLead', () => {
	it('uses days for far-off events and the shared wording nearby', () => {
		expect(formatLead(5 * 86_400_000 + 3 * 3_600_000)).toBe('5d 03h');
		expect(formatLead(3_600_000 + 5 * 60_000)).toBe('1h 05m');
		expect(formatLead(7_000)).toBe('0:07');
	});
});
