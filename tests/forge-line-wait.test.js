// @vitest-environment jsdom
//
// The page's half of the Forge waiting line (src/forge-line-wait.js): reading
// the server's line answers, keeping a place by checking in, and the card.
// Server answers are built with the real api/_lib/forge-line.js helpers, so a
// change to the server's wording or fields breaks this suite, not the page.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	lineAnswerFrom,
	waitText,
	waitInLine,
	createLineCard,
	createLineWaiter,
	LINE_URL,
} from '../src/forge-line-wait.js';
import { classifyThrottle, describeThrottle } from '../src/forge-throttle.js';
import { lineAnswer, lineStatusBody } from '../api/_lib/forge-line.js';

const queuedDecision = (over = {}) => ({
	action: 'queued',
	position: 3,
	ahead: 2,
	depth: 5,
	etaSeconds: 130,
	intervalSeconds: 45,
	checkAgainSeconds: 15,
	...over,
});

function signal() {
	return new AbortController().signal;
}

// A sleep that records what it was asked to wait and returns at once.
function recordingSleep() {
	const waits = [];
	return { waits, sleep: async (ms) => void waits.push(ms / 1000) };
}

describe('reading the server answers', () => {
	it('a queued answer becomes a place with the server numbers', () => {
		const a = lineAnswer(queuedDecision());
		const line = lineAnswerFrom(a.status, a.body);
		expect(line).toMatchObject({
			kind: 'queued',
			position: 3,
			ahead: 2,
			depth: 5,
			etaSeconds: 130,
			intervalSeconds: 45,
			checkAgainSeconds: 15,
		});
		expect(line.message).toBe(a.body.message);
	});

	it('a full answer keeps the server message and its wait', () => {
		const a = lineAnswer({ action: 'full', depth: 20, maxDepth: 20, retryAfterSeconds: 240 });
		const line = lineAnswerFrom(a.status, a.body);
		expect(line).toMatchObject({ kind: 'full', depth: 20, maxDepth: 20, retryAfter: 240 });
		expect(line.message).toMatch(/^Forge is full right now: 20 people/);
	});

	it('a full line is described as full, with the server depth and wait', () => {
		const a = lineAnswer({ action: 'full', depth: 20, maxDepth: 20, retryAfterSeconds: 240 });
		const throttle = classifyThrottle({ status: a.status, body: a.body });
		expect(throttle).toMatchObject({ kind: 'provider_busy', source: 'line_full', waitSeconds: 240, autoRetry: false });
		const copy = describeThrottle(throttle, { canUsePhoto: true });
		expect(copy.title).toBe('Forge is full right now');
		expect(copy.lead).toBe(a.body.message);
		expect(copy.actions).toEqual(['photo']);
	});

	it('anything else is not a line answer', () => {
		expect(lineAnswerFrom(429, { error: 'rate_limited', message: 'Generation limit reached. Try again shortly.' })).toBeNull();
		expect(lineAnswerFrom(503, { error: 'generation_unavailable' })).toBeNull();
		expect(lineAnswerFrom(200, { error: 'forge_queued' })).toBeNull();
		expect(lineAnswerFrom(429, null)).toBeNull();
	});

	it('a check-in later than the server hold allows is never asked for', () => {
		const a = lineAnswer(queuedDecision({ checkAgainSeconds: 600 }));
		expect(lineAnswerFrom(a.status, a.body).checkAgainSeconds).toBe(15);
	});

	it('wait wording matches what the server writes', () => {
		for (const eta of [3, 12, 44, 59, 60, 89, 130, 600, 855]) {
			const body = lineAnswer(queuedDecision({ position: 2, etaSeconds: eta })).body;
			expect(body.message).toContain(`starts in ${waitText(eta)}.`);
		}
	});
});

describe('keeping the place', () => {
	const first = lineAnswerFrom(429, lineAnswer(queuedDecision({ checkAgainSeconds: 10 })).body);

	it('checks in when asked, follows the position, and returns on the turn', async () => {
		const { waits, sleep } = recordingSleep();
		const answers = [
			lineStatusBody({ inLine: true, yourTurn: false, position: 2, ahead: 1, depth: 4, etaSeconds: 85, intervalSeconds: 45, checkAgainSeconds: 12 }),
			lineStatusBody({ inLine: true, yourTurn: true, position: 1, ahead: 0, depth: 3, etaSeconds: 0, intervalSeconds: 45, checkAgainSeconds: 0 }),
		];
		const states = [];
		const outcome = await waitInLine({
			first,
			checkIn: async () => ({ body: answers.shift() }),
			sleep,
			onState: (s) => states.push(s),
			signal: signal(),
		});
		expect(outcome).toBe('turn');
		expect(waits).toEqual([10, 12]);
		expect(states).toEqual([expect.objectContaining({ position: 2, ahead: 1, etaSeconds: 85, trouble: false })]);
	});

	it('a place the server no longer holds is reported, not waited on forever', async () => {
		const { sleep } = recordingSleep();
		const outcome = await waitInLine({
			first,
			checkIn: async () => ({ body: lineStatusBody({ inLine: false, depth: 2, active: true }) }),
			sleep,
			signal: signal(),
		});
		expect(outcome).toBe('lapsed');
	});

	it('a failed check-in retries soon and backs off inside the server hold', async () => {
		const { waits, sleep } = recordingSleep();
		let n = 0;
		const states = [];
		const outcome = await waitInLine({
			first,
			checkIn: async () => {
				n += 1;
				if (n <= 5) throw new TypeError('Failed to fetch');
				return { body: lineStatusBody({ inLine: true, yourTurn: true, position: 1, ahead: 0, depth: 1, etaSeconds: 0, intervalSeconds: 45, checkAgainSeconds: 0 }) };
			},
			sleep,
			onState: (s) => states.push(s),
			signal: signal(),
		});
		expect(outcome).toBe('turn');
		expect(waits).toEqual([10, 3, 6, 10, 15, 15]);
		expect(Math.max(...waits)).toBeLessThanOrEqual(15);
		expect(states.every((s) => s.trouble)).toBe(true);
	});

	it('a throttled check-in waits out the stated wait before asking again', async () => {
		const { waits, sleep } = recordingSleep();
		const answers = [
			{ retryAfter: 20 },
			{ body: lineStatusBody({ inLine: true, yourTurn: true, position: 1, ahead: 0, depth: 1, etaSeconds: 0, intervalSeconds: 45, checkAgainSeconds: 0 }) },
		];
		const outcome = await waitInLine({ first, checkIn: async () => answers.shift(), sleep, signal: signal() });
		expect(outcome).toBe('turn');
		expect(waits).toEqual([10, 20]);
	});

	it('leaving stops the check-ins', async () => {
		const ctrl = new AbortController();
		const checkIn = vi.fn(async () => {
			ctrl.abort();
			throw new DOMException('aborted', 'AbortError');
		});
		const outcome = await waitInLine({ first, checkIn, sleep: async () => {}, signal: ctrl.signal });
		expect(outcome).toBe('left');
		expect(checkIn).toHaveBeenCalledTimes(1);
	});
});

describe('the card', () => {
	afterEach(() => {
		document.body.innerHTML = '';
		document.title = '';
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	function panel() {
		document.body.innerHTML =
			'<div id="state-generating"><div class="gen-steps">' +
			'<ol class="gen-stages"></ol><p class="gen-leave-hint">Feel free to leave this page.</p>' +
			'<button id="cancel">Cancel</button></div></div>';
		return document.getElementById('state-generating');
	}

	it('shows the place and hides what is not true while waiting', () => {
		const p = panel();
		const card = createLineCard(p);
		const line = lineAnswerFrom(429, lineAnswer(queuedDecision()).body);
		card.show(line);
		expect(p.getAttribute('data-forge-line')).toBe('waiting');
		expect(p.querySelector('.forge-line-title').textContent).toBe("You're number 3 in line");
		expect(p.querySelector('.forge-line-title').getAttribute('role')).toBe('status');
		expect(p.querySelector('.forge-line-eta').textContent).toContain('about 2 minutes');
		expect(p.querySelector('.forge-line-meta').textContent).toBe('2 ahead of you · 5 waiting · one image about every 45 seconds');
		expect([...p.querySelectorAll('.forge-line-dot')].map((d) => d.dataset.who)).toEqual(['ahead', 'ahead', 'you', 'behind', 'behind']);
		expect(document.getElementById('forge-line-styles').textContent).toContain('[data-forge-line] .gen-leave-hint');
		card.hide();
		expect(p.hasAttribute('data-forge-line')).toBe(false);
		expect(p.querySelector('.forge-line')).toBeNull();
	});

	it('counts the estimate down between check-ins', () => {
		vi.useFakeTimers();
		const p = panel();
		const card = createLineCard(p);
		card.show(lineAnswerFrom(429, lineAnswer(queuedDecision({ etaSeconds: 70 })).body));
		expect(p.querySelector('.forge-line-eta strong').textContent).toBe('about a minute');
		vi.advanceTimersByTime(35_000);
		expect(p.querySelector('.forge-line-eta strong').textContent).toBe('about 35 seconds');
		card.hide();
	});

	it('the waiter checks in, leaves on Cancel and restores the tab title', async () => {
		const p = panel();
		document.title = 'Forge';
		const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const checkIn = vi.fn();
		const waiter = createLineWaiter({ panel: p, headers: () => ({ 'x-forge-client': 'c1' }), checkIn });
		const line = lineAnswerFrom(429, lineAnswer(queuedDecision({ checkAgainSeconds: 1 })).body);
		const done = waiter.wait(line);
		expect(waiter.waiting).toBe(true);
		expect(document.title).toBe('#3 in line · Forge');
		expect(waiter.leave()).toBe(true);
		expect(await done).toBe('left');
		expect(checkIn).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(LINE_URL, expect.objectContaining({ method: 'DELETE', keepalive: true }));
		expect(document.title).toBe('Forge');
		expect(p.querySelector('.forge-line')).toBeNull();
		expect(waiter.leave()).toBe(false);
		vi.unstubAllGlobals();
	});
});
