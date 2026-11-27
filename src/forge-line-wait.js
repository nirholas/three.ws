// Forge: the waiting line in front of the image step, on the page.
//
// When the shared text-to-image step is saturated, /api/forge answers a text
// request with a place in line (429 forge_queued) or, once the line is at its
// depth, with "full" (503 forge_full). See api/_lib/forge-line.js. This module
// is the page's half of that contract, shared by /forge and /forge-studio:
//
//   - lineAnswerFrom() reads those two answers out of a submit response.
//   - createLineWaiter() keeps the place: it checks in at /api/forge?line=1
//     as often as the server asks (the server frees a place that stops
//     checking in), shows the position and the server's own wait estimate,
//     and resolves the moment it is this person's turn so the page resubmits.
//     Leaving (Cancel, closing the page) hands the place to the next person.
//   - upstreamBusy() tells the generator's "busy" answer apart from a
//     person's own allowance, so busy is never reported as "limit reached".
//
// Every number shown comes from the server's answers. The countdown between
// check-ins only ticks the server's estimate down; the next check-in replaces it.

export const LINE_URL = '/api/forge?line=1';

// The server's LINE_LIMITS.maxCheckS. A check-in later than three of these
// lets the place lapse (LINE_LIMITS.holdMs), so the page never waits longer.
const MAX_CHECK_S = 15;
// After a failed check-in: try again soon, then back off to the ceiling.
const RETRY_STEPS_S = [3, 6, 10, MAX_CHECK_S];
// A place that lapsed this recently means the next queued answer is a rejoin.
const REJOIN_NOTE_MS = 2 * 60 * 1000;

function count(value) {
	const n = Math.floor(Number(value));
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

function checkSeconds(value) {
	const n = Math.ceil(Number(value));
	if (!Number.isFinite(n) || n <= 0) return MAX_CHECK_S;
	return Math.min(MAX_CHECK_S, n);
}

// The same phrasing the server uses for its own messages (forge-line.js
// minutesText), so the card and the server never disagree in wording.
export function waitText(seconds) {
	const s = Math.max(0, Number(seconds) || 0);
	if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)} seconds`;
	const m = Math.round(s / 60);
	return m <= 1 ? 'about a minute' : `about ${m} minutes`;
}

// "45s" under a minute, "3:59" above it: a countdown to a retry.
export function countdownText(seconds) {
	const s = Math.max(0, Math.ceil(Number(seconds) || 0));
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function placeFrom(data) {
	return {
		position: Math.max(1, count(data.position)),
		ahead: count(data.ahead),
		depth: count(data.depth),
		etaSeconds: count(data.eta_seconds),
		intervalSeconds: count(data.interval_seconds),
		checkAgainSeconds: checkSeconds(data.check_again_seconds ?? data.retry_after),
	};
}

/**
 * Read a waiting-line answer out of a /api/forge submit response.
 * @returns {null | {kind:'queued', message:string, position:number, ahead:number, depth:number, etaSeconds:number, intervalSeconds:number, checkAgainSeconds:number} | {kind:'full', message:string, depth:number, maxDepth:number, retryAfter:number}}
 */
export function lineAnswerFrom(status, data) {
	if (!data || typeof data !== 'object') return null;
	if (status === 429 && data.error === 'forge_queued') {
		const place = placeFrom(data);
		return {
			kind: 'queued',
			message:
				data.message ||
				`You're number ${place.position} in line. Your generation starts in ${waitText(place.etaSeconds)}.`,
			...place,
		};
	}
	if (status === 503 && data.error === 'forge_full') {
		const retryAfter = Math.max(1, Math.ceil(Number(data.retry_after)) || 60);
		return {
			kind: 'full',
			message:
				data.message ||
				`Forge is full right now: people are already waiting for the image step. Come back in ${waitText(retryAfter)}.`,
			depth: count(data.depth),
			maxDepth: count(data.max_depth),
			retryAfter,
		};
	}
	return null;
}

// The submit handler's answer when a generator throttled the request carries a
// boolean `queued` (api/forge.js, api/gpt-forge.js). The per-account allowance
// answer (api/_lib/http.js rateLimited) never does. The first is "busy", only
// the second is "you've reached your limit".
export function upstreamBusy(data) {
	return Boolean(data) && data.error === 'rate_limited' && typeof data.queued === 'boolean';
}

// ── Keeping the place ───────────────────────────────────────────────────────

/** A sleep that a wake() or an abort ends early. */
export function wakeableSleep() {
	let wakeNow = null;
	return {
		sleep(ms, signal) {
			return new Promise((resolve) => {
				if (signal?.aborted) return resolve();
				const done = () => {
					clearTimeout(timer);
					signal?.removeEventListener('abort', done);
					wakeNow = null;
					resolve();
				};
				const timer = setTimeout(done, Math.max(0, ms));
				signal?.addEventListener('abort', done, { once: true });
				wakeNow = done;
			});
		},
		wake() {
			if (wakeNow) wakeNow();
		},
	};
}

/**
 * Check in until it is this person's turn.
 * @param {object} o
 * @param {object} o.first          the queued answer (lineAnswerFrom)
 * @param {(signal:AbortSignal)=>Promise<{body?:object, retryAfter?:number}>} o.checkIn
 *        resolves { body } with the server's check-in answer, or { retryAfter }
 *        when the check-in itself was throttled; rejects on a network failure.
 * @param {(ms:number, signal:AbortSignal)=>Promise<void>} o.sleep
 * @param {(state:object)=>void} [o.onState]
 * @param {AbortSignal} o.signal
 * @returns {Promise<'turn'|'lapsed'|'left'>}
 */
export async function waitInLine({ first, checkIn, sleep, onState = () => {}, signal }) {
	let place = { ...first };
	let failures = 0;
	let nextS = place.checkAgainSeconds;
	while (!signal.aborted) {
		await sleep(nextS * 1000, signal);
		if (signal.aborted) break;
		let answer;
		try {
			answer = await checkIn(signal);
		} catch {
			if (signal.aborted) break;
			nextS = RETRY_STEPS_S[Math.min(failures, RETRY_STEPS_S.length - 1)];
			failures += 1;
			onState({ ...place, trouble: true, retryInSeconds: nextS });
			continue;
		}
		failures = 0;
		if (answer.retryAfter) {
			// The check-in was refused with a stated wait: believe it.
			nextS = Math.max(1, Math.ceil(answer.retryAfter));
			continue;
		}
		const body = answer.body || {};
		if (!body.in_line) return 'lapsed';
		if (body.your_turn) return 'turn';
		place = placeFrom(body);
		nextS = place.checkAgainSeconds;
		onState({ ...place, trouble: false });
	}
	return 'left';
}

async function fetchCheckIn(headers, signal) {
	const res = await fetch(LINE_URL, {
		headers: { accept: 'application/json', ...headers },
		credentials: 'same-origin',
		cache: 'no-store',
		signal,
	});
	if (res.status === 429) return { retryAfter: Number(res.headers.get('retry-after')) || MAX_CHECK_S };
	if (!res.ok) throw new Error(`check-in answered ${res.status}`);
	return { body: await res.json() };
}

// Give the place up. keepalive lets it outlive a page that is closing; a lost
// DELETE only means the place lapses on its own after the server's hold.
function sendLeave(headers) {
	try {
		fetch(LINE_URL, { method: 'DELETE', headers, credentials: 'same-origin', keepalive: true }).catch(() => {});
	} catch {
		// fetch itself threw (page tearing down): the hold expires server-side.
	}
}

// ── The card ────────────────────────────────────────────────────────────────

const STYLE_ID = 'forge-line-styles';
const MAX_DOTS = 20;

const CSS = `
#state-generating[data-forge-line] .gen-stages,
#state-generating[data-forge-line] .step,
#state-generating[data-forge-line] .gen-progress,
#state-generating[data-forge-line] .gen-warming,
#state-generating[data-forge-line] .gen-meta,
#state-generating[data-forge-line] .gen-leave-hint,
#state-generating[data-forge-line] .gen-note,
#state-generating[data-forge-line] .forge-wait{display:none !important;}
.forge-line{margin:0 0 var(--space-sm,12px);padding:var(--space-md,16px);
	background:var(--surface-2,rgba(255,255,255,.04));border:1px solid var(--stroke,rgba(255,255,255,.12));
	border-radius:var(--radius-md,12px);animation:forge-line-in .28s ease both;}
.forge-line-eyebrow{display:block;font-family:var(--font-mono,ui-monospace,monospace);
	font-size:var(--text-2xs,11px);letter-spacing:.12em;text-transform:uppercase;
	color:var(--accent,#8ab4ff);margin-bottom:var(--space-2xs,4px);}
.forge-line-title{margin:0;font-size:var(--text-lg,18px);font-weight:600;line-height:1.3;color:var(--ink,#fff);}
.forge-line-eta{margin:var(--space-2xs,4px) 0 0;font-size:var(--text-sm,14px);color:var(--ink,#fff);}
.forge-line-eta strong{font-variant-numeric:tabular-nums;}
.forge-line-dots{display:flex;flex-wrap:wrap;gap:6px;margin:var(--space-sm,12px) 0;padding:0;list-style:none;}
.forge-line-dot{width:10px;height:10px;border-radius:50%;border:1px solid var(--stroke,rgba(255,255,255,.2));}
.forge-line-dot[data-who="ahead"]{background:var(--ink-dim,rgba(255,255,255,.45));border-color:transparent;}
.forge-line-dot[data-who="you"]{background:var(--accent,#8ab4ff);border-color:transparent;
	box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#8ab4ff) 30%,transparent);
	animation:forge-line-pulse 1.6s ease-in-out infinite;}
.forge-line-meta{margin:0;font-family:var(--font-mono,ui-monospace,monospace);
	font-size:var(--text-2xs,11px);color:var(--ink-dim,rgba(255,255,255,.6));font-variant-numeric:tabular-nums;}
.forge-line-note{margin:var(--space-sm,12px) 0 0;font-size:var(--text-xs,12px);line-height:1.5;color:var(--ink-dim,rgba(255,255,255,.6));}
.forge-line-note[data-tone="warn"]{color:var(--warn,#f2c46d);}
@keyframes forge-line-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
@keyframes forge-line-pulse{50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--accent,#8ab4ff) 10%,transparent);}}
@media (max-width:480px){.forge-line{padding:var(--space-sm,12px);}.forge-line-title{font-size:var(--text-md,16px);}}
@media (prefers-reduced-motion:reduce){.forge-line,.forge-line-dot[data-who="you"]{animation:none;}}`;

function ensureStyles(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	doc.head.appendChild(style);
}

function titleFor(position) {
	return position <= 1 ? "You're next in line" : `You're number ${position} in line`;
}

/**
 * The in-panel card. Inserted at the top of the generating panel's step column;
 * while it shows, the panel carries data-forge-line so the stage list, the
 * progress bar and the "feel free to leave" hint (all false while waiting) hide.
 */
export function createLineCard(panel, { doc = document } = {}) {
	ensureStyles(doc);
	const host = panel.querySelector('.gen-steps') || panel;
	const card = doc.createElement('section');
	card.className = 'forge-line';
	card.setAttribute('aria-label', 'Waiting line');
	card.innerHTML =
		'<span class="forge-line-eyebrow">// waiting for the image step</span>' +
		'<p class="forge-line-title" role="status" aria-live="polite" aria-atomic="true"></p>' +
		'<p class="forge-line-eta">Your generation starts in <strong></strong>.</p>' +
		'<ol class="forge-line-dots" aria-hidden="true"></ol>' +
		'<p class="forge-line-meta"></p>' +
		'<p class="forge-line-note"></p>';
	const el = {
		title: card.querySelector('.forge-line-title'),
		eta: card.querySelector('.forge-line-eta strong'),
		dots: card.querySelector('.forge-line-dots'),
		meta: card.querySelector('.forge-line-meta'),
		note: card.querySelector('.forge-line-note'),
	};

	let ticker = null;
	let etaLeft = 0;
	let baseNote = '';
	const renderEta = () => {
		el.eta.textContent = etaLeft > 0 ? waitText(etaLeft) : 'a moment';
	};
	const stopTicker = () => {
		if (ticker) clearInterval(ticker);
		ticker = null;
	};

	function render(state) {
		el.title.textContent = titleFor(state.position);
		etaLeft = state.etaSeconds;
		renderEta();
		const shown = Math.min(MAX_DOTS, Math.max(state.depth, state.position));
		const dots = [];
		for (let i = 1; i <= shown; i += 1) {
			const who = i < state.position ? 'ahead' : i === state.position ? 'you' : 'behind';
			dots.push(`<li class="forge-line-dot" data-who="${who}"></li>`);
		}
		el.dots.innerHTML = dots.join('');
		const parts = [state.ahead === 1 ? '1 ahead of you' : `${state.ahead} ahead of you`, `${state.depth} waiting`];
		if (state.intervalSeconds > 0) parts.push(`one image about every ${waitText(state.intervalSeconds).replace('about ', '')}`);
		el.meta.textContent = parts.join(' · ');
		if (state.trouble) {
			el.note.dataset.tone = 'warn';
			el.note.textContent = `Lost touch with Forge for a moment. Your place is still held; checking again in ${state.retryInSeconds}s.`;
		} else {
			delete el.note.dataset.tone;
			el.note.textContent = baseNote;
		}
	}

	return {
		el: card,
		show(state, { rejoined = false } = {}) {
			baseNote =
				(rejoined
					? 'Your earlier place lapsed while this page could not check in, so you rejoined the line. '
					: '') +
				'Keep this page open: it checks in to hold your place and starts your generation the moment it is your turn. Cancel gives your place to the next person.';
			if (!card.isConnected) host.insertBefore(card, host.firstChild);
			panel.setAttribute('data-forge-line', 'waiting');
			render(state);
			stopTicker();
			ticker = setInterval(() => {
				etaLeft = Math.max(0, etaLeft - 1);
				renderEta();
			}, 1000);
		},
		update(state) {
			render(state);
		},
		hide() {
			stopTicker();
			panel.removeAttribute('data-forge-line');
			card.remove();
		},
	};
}

// ── The page's handle ───────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {HTMLElement} o.panel       #state-generating
 * @param {()=>object} [o.headers]    request headers (the page's forgeHeaders)
 * @returns {{ wait(answer:object): Promise<'turn'|'lapsed'|'left'>, leave(): boolean, readonly waiting: boolean }}
 */
export function createLineWaiter({ panel, headers = () => ({}), doc = document, win = window, checkIn = null }) {
	let controller = null;
	let card = null;
	let lapsedAt = 0;
	const originalTitle = { value: null };

	const setDocTitle = (position) => {
		if (originalTitle.value == null) originalTitle.value = doc.title;
		doc.title = `#${position} in line · ${originalTitle.value}`;
	};
	const restoreDocTitle = () => {
		if (originalTitle.value != null) doc.title = originalTitle.value;
		originalTitle.value = null;
	};

	return {
		get waiting() {
			return Boolean(controller);
		},

		async wait(answer) {
			if (controller) controller.abort();
			const own = new AbortController();
			controller = own;
			card ??= createLineCard(panel, { doc });
			card.show(answer, { rejoined: Date.now() - lapsedAt < REJOIN_NOTE_MS });
			setDocTitle(answer.position);

			const waker = wakeableSleep();
			// A tab that was in the background (timers throttled, or a phone that
			// suspended it) checks in the moment it is visible again.
			const onVisible = () => {
				if (doc.visibilityState === 'visible') waker.wake();
			};
			const onPageShow = () => waker.wake();
			// Closing the page gives the place up. The loop keeps running so a page
			// restored from the back/forward cache finds out on its next check-in.
			const onPageHide = () => sendLeave(headers());
			doc.addEventListener('visibilitychange', onVisible);
			win.addEventListener('pageshow', onPageShow);
			win.addEventListener('pagehide', onPageHide);
			try {
				const outcome = await waitInLine({
					first: answer,
					checkIn: (signal) => (checkIn ? checkIn(signal) : fetchCheckIn(headers(), signal)),
					sleep: waker.sleep,
					signal: own.signal,
					onState: (state) => {
						card.update(state);
						setDocTitle(state.position);
					},
				});
				if (outcome === 'lapsed') lapsedAt = Date.now();
				return outcome;
			} finally {
				doc.removeEventListener('visibilitychange', onVisible);
				win.removeEventListener('pageshow', onPageShow);
				win.removeEventListener('pagehide', onPageHide);
				if (controller === own) {
					controller = null;
					card.hide();
					restoreDocTitle();
				}
			}
		},

		// The person gave up their place (Cancel). Returns whether they held one.
		leave() {
			if (!controller) return false;
			controller.abort();
			sendLeave(headers());
			return true;
		},
	};
}
