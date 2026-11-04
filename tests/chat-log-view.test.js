// @vitest-environment jsdom
//
// The /play chat log with world scrollback (work order 727). The room hands an
// arrival the recent tail in one `chat_history` message; the log renders it as
// muted history above a "You're caught up" divider, dedupes it against the live
// relay by message id, never reads the whole tail aloud, never moves a reader
// who is scrolled up, and shows a real empty state with a next step.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatLogView, chatStamp } from '../src/game/chat-log-view.js';

const NOW = new Date(2026, 10, 4, 18, 30).getTime();

let log;
let empty;
let announce;
let view;

// jsdom does no layout, so give the scroller real geometry: every row is 20px
// tall and the viewport shows 100px.
function geometry(el) {
	let top = 0;
	Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
	Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => el.querySelectorAll('.cc-chat-msg, .cc-chat-divider').length * 20 });
	Object.defineProperty(el, 'scrollTop', {
		configurable: true,
		get: () => top,
		set: (v) => { top = Math.max(0, Math.min(v, Math.max(0, el.scrollHeight - 100))); },
	});
}

beforeEach(() => {
	document.body.replaceChildren();
	log = document.createElement('div');
	log.setAttribute('role', 'log');
	log.setAttribute('aria-live', 'polite');
	empty = document.createElement('div');
	document.body.append(empty, log);
	geometry(log);
	announce = vi.fn();
	view = new ChatLogView({ log, empty, announce, now: () => NOW });
});

const line = (i, extra = {}) => ({ mid: `m${String(i).padStart(8, '0')}`, name: 'nova', text: `line ${i}`, ts: NOW - (100 - i) * 1000, ...extra });
const texts = () => [...log.querySelectorAll('.cc-chat-text')].map((n) => n.textContent);

describe('empty state', () => {
	it('shows before anything arrives and after an empty scrollback', () => {
		expect(empty.hidden).toBe(false);
		view.addHistory([]);
		expect(empty.hidden).toBe(false);
		expect(log.querySelector('.cc-chat-divider')).toBeNull();
	});

	it('hides as soon as there is a line to read', () => {
		view.addLive({ name: 'nova', text: 'gm' });
		expect(empty.hidden).toBe(true);
	});
});

describe('scrollback', () => {
	it('renders the tail muted, oldest first, closed by the caught-up divider', () => {
		view.addHistory([line(1), line(2), line(3)]);
		const hist = log.querySelector('.cc-chat-hist');
		expect([...hist.querySelectorAll('.cc-chat-msg.cc-hist .cc-chat-text')].map((n) => n.textContent)).toEqual(['line 1', 'line 2', 'line 3']);
		expect(hist.lastElementChild.className).toBe('cc-chat-divider');
		expect(hist.lastElementChild.getAttribute('role')).toBe('separator');
		expect(hist.lastElementChild.textContent).toBe("You're caught up");
		expect(empty.hidden).toBe(true);
	});

	it('stamps each line with when it was said, not when it arrived', () => {
		view.addHistory([{ ...line(1), ts: new Date(2026, 10, 4, 9, 7).getTime() }]);
		const time = log.querySelector('.cc-hist time');
		expect(time.textContent).toBe('09:07');
		expect(time.getAttribute('datetime')).toBe(new Date(2026, 10, 4, 9, 7).toISOString());
	});

	it('keeps the tail out of the live region and announces it once', () => {
		view.addHistory([line(1), line(2), line(3)]);
		expect(log.querySelector('.cc-chat-hist').getAttribute('aria-live')).toBe('off');
		expect(announce).toHaveBeenCalledTimes(1);
		expect(announce).toHaveBeenCalledWith('3 earlier messages');
	});

	it('attaches the whole tail in one DOM append', () => {
		const hist = log.querySelector('.cc-chat-hist');
		const spy = vi.spyOn(hist, 'replaceChildren');
		const appends = vi.spyOn(log, 'appendChild');
		view.addHistory(Array.from({ length: 60 }, (_, i) => line(i)));
		expect(spy).toHaveBeenCalledTimes(1);
		expect(appends).not.toHaveBeenCalled();
		expect(hist.querySelectorAll('.cc-chat-msg')).toHaveLength(60);
	});

	it('sits above live lines that arrived before it', () => {
		view.addLive({ mid: 'live0001', name: 'orbit', text: 'just now', ts: NOW });
		view.addHistory([line(1), line(2)]);
		expect(texts()).toEqual(['line 1', 'line 2', 'just now']);
	});
});

describe('dedupe by message id', () => {
	it('drops a live line the scrollback already showed', () => {
		view.addHistory([line(1), line(2)]);
		expect(view.addLive({ ...line(2) })).toBe(false);
		expect(texts()).toEqual(['line 1', 'line 2']);
	});

	it('drops a scrollback line the live relay already showed', () => {
		view.addLive({ ...line(2) });
		view.addHistory([line(1), line(2)]);
		expect(texts()).toEqual(['line 1', 'line 2']);
	});

	it('keeps two lines with identical text and different ids', () => {
		view.addHistory([line(1, { text: 'gm' }), line(2, { text: 'gm' })]);
		expect(texts()).toEqual(['gm', 'gm']);
	});

	it('after a reconnect, adds only the lines missed while away', () => {
		view.addHistory([line(1), line(2)]);
		view.addLive({ ...line(3) });
		announce.mockClear();
		view.addHistory([line(1), line(2), line(3), line(4), line(5)]);
		expect(texts()).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
		expect(log.querySelectorAll('.cc-chat-divider')).toHaveLength(1);
	});
});

describe('the reader keeps their place', () => {
	it('stays at the bottom when they were at the bottom', () => {
		for (let i = 0; i < 8; i++) view.addLive({ name: 'nova', text: `live ${i}`, ts: NOW });
		expect(log.scrollTop).toBe(log.scrollHeight - 100);
		view.addHistory([line(1), line(2), line(3)]);
		expect(log.scrollTop).toBe(log.scrollHeight - 100);
	});

	it('keeps the same line under the eye when they were reading back', () => {
		for (let i = 0; i < 10; i++) view.addLive({ name: 'nova', text: `live ${i}`, ts: NOW });
		log.scrollTop = 40; // reading "live 2"
		const fromBottom = log.scrollHeight - log.scrollTop;
		view.addHistory([line(1), line(2), line(3)]);
		expect(log.scrollHeight - log.scrollTop).toBe(fromBottom);
	});

	it('does not touch focus', () => {
		const input = document.createElement('input');
		document.body.appendChild(input);
		input.focus();
		view.addHistory([line(1)]);
		view.addLive({ name: 'nova', text: 'gm' });
		expect(document.activeElement).toBe(input);
	});
});

describe('bounds', () => {
	it('caps the DOM, trimming history before live lines', () => {
		view = new ChatLogView({ log: (() => { const l = document.createElement('div'); geometry(l); return l; })(), empty, now: () => NOW, maxRows: 5 });
		view.addHistory([line(1), line(2), line(3)]);
		for (let i = 0; i < 4; i++) view.addLive({ mid: `live000${i}`, name: 'nova', text: `live ${i}`, ts: NOW });
		const shown = [...view.log.querySelectorAll('.cc-chat-text')].map((n) => n.textContent);
		expect(shown).toEqual(['line 3', 'live 0', 'live 1', 'live 2', 'live 3']);
		// A trimmed id is forgotten, so the set cannot grow without bound.
		expect(view.mids.has(line(1).mid)).toBe(false);
	});

	it('removes the divider once all history has been trimmed', () => {
		view = new ChatLogView({ log: (() => { const l = document.createElement('div'); geometry(l); return l; })(), empty, now: () => NOW, maxRows: 2 });
		view.addHistory([line(1)]);
		view.addLive({ name: 'nova', text: 'a' });
		view.addLive({ name: 'nova', text: 'b' });
		expect(view.log.querySelector('.cc-chat-divider')).toBeNull();
	});

	it('forgets a world entirely on reset', () => {
		view.addHistory([line(1)]);
		view.addLive({ ...line(2) });
		view.reset();
		expect(texts()).toEqual([]);
		expect(empty.hidden).toBe(false);
		view.addHistory([line(1)]);
		expect(texts()).toEqual(['line 1']);
	});
});

describe('chatStamp', () => {
	it('prints the time for today and the date for earlier days', () => {
		expect(chatStamp(new Date(2026, 10, 4, 7, 5).getTime(), NOW)).toBe('07:05');
		expect(chatStamp(new Date(2026, 10, 2, 23, 59).getTime(), NOW, 'en-US')).toBe('Nov 2, 23:59');
	});
});
