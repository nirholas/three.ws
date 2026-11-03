// @vitest-environment jsdom
//
// Meetup #3 client audit (failure states): the Jobs Board asked the server for
// its snapshot and for Accept/Abandon through a socket that may be down. The
// send was dropped, the board sat on "Loading the jobs board…" and the status
// on "Accepting…" forever. Every send now reports delivery: a dropped one says
// so plainly, and the board reloads itself the moment the world is back.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeNet() {
	const handlers = new Map();
	return {
		live: false,
		sent: [],
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(fn);
			return () => handlers.get(event)?.delete(fn);
		},
		emit(event, ...args) { for (const fn of [...(handlers.get(event) || [])]) fn(...args); },
		_s(type) { if (!this.live) return false; this.sent.push(type); return true; },
		requestQuests() { return this._s('questReq'); },
		requestEventBoard() { return this._s('eventBoardReq'); },
		questAccept() { return this._s('questAccept'); },
		questAbandon() { return this._s('questAbandon'); },
	};
}

const OFFER = { id: 'm1', title: 'Courier run', giver: 'Ada', summary: 'Carry a parcel', kind: 'daily', objectives: [{ label: 'Pick up' }], reward: { gold: 10 } };

let mod;
beforeEach(async () => {
	document.body.innerHTML = '';
	vi.resetModules();
	mod = await import('../src/game/quests-ui.js');
});

const text = () => document.body.textContent;
const status = () => document.querySelector('.ec-status')?.textContent || '';

describe('Jobs Board with the room socket down', () => {
	it('says it is reconnecting instead of loading forever, then loads on reconnect', () => {
		const net = makeNet();
		mod.openQuestsPanel({ net });
		expect(text()).toMatch(/reconnecting/i);
		expect(text()).not.toMatch(/Loading the jobs board/);

		net.live = true;
		net.emit('status', { status: 'online' });
		expect(net.sent).toContain('questReq');
		expect(net.sent).toContain('eventBoardReq');
	});

	it('an Accept that never left says so instead of "Accepting…"', () => {
		const net = makeNet();
		net.live = true;
		mod.openQuestsPanel({ net });
		net.emit('quests', { offers: [OFFER], active: [], day: 'd' });
		net.live = false;
		document.querySelector('.qb-row .ec-row-btn').click();
		expect(status()).not.toMatch(/Accepting/);
		expect(status()).toMatch(/not connected|reconnecting/i);
	});
});
