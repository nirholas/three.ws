// Forge throttle honesty: tell the user which kind of "slow down" they hit.
//
// Several different refusals reach the Forge pages and they mean very different
// things to the person waiting:
//
// - provider_busy: a provider or engine is pacing us (the reference-image rung's
//   45 second slot or its full waiting line, an upstream 429, the free engines at
//   capacity, a worker still warming, our own limiter briefly down). Not the
//   user's allowance. The stated wait is real: retrying early is refused again
//   and restarts the window, so we count it down and retry once on the user's
//   behalf.
// - user_rate_limit: the account (or, signed out, the network) used its own
//   per-window allowance. Built by rateLimited() in api/_lib/http.js, which sets
//   the ratelimit-* headers.
// - daily_cap: today's paid-engine allowance is used up ({ error:
//   'daily_limit_reached' }). It resets at midnight UTC, the day key the server
//   counts against (api/_lib/forge-scale.js), and the free engines stay open.
// - unknown: some other 429 (a proxy, a body that is not JSON).
//
// Before this module both Forge pages titled every one of these "Generation
// limit reached", so a provider throttle read as the user's own limit and people
// left. The classifier is pure; the panel below is the one renderer both pages
// share (their error panels use the same element ids).

import './forge-throttle.css';

export const THROTTLE = Object.freeze({
	PROVIDER_BUSY: 'provider_busy',
	USER_RATE_LIMIT: 'user_rate_limit',
	DAILY_CAP: 'daily_cap',
	UNKNOWN: 'unknown',
});

// A stated wait longer than this is not retried automatically: the user is
// better served by a manual retry than by a tab that fires a request minutes
// after they stopped looking at it.
export const AUTO_RETRY_MAX_SECONDS = 180;

// Used only when neither the body nor the headers state a wait.
const DEFAULT_WAIT_SECONDS = Object.freeze({
	provider_busy: 15,
	user_rate_limit: 60,
	unknown: 30,
});

// 503 codes that have their own designed states on the page, not a countdown.
const NOT_A_THROTTLE = new Set(['unconfigured', 'storage_unavailable']);

function readHeader(headers, name) {
	if (!headers) return null;
	if (typeof headers.get === 'function') return headers.get(name);
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : null;
}

// Whole seconds from a positive number. Zero, negative, missing and junk all
// count as "not stated", so a zero never fires an instant retry loop.
function positiveSeconds(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * Seconds from a Retry-After header value: delta-seconds or an HTTP-date
 * (RFC 9110 section 10.2.3). Null when absent, zero, past or unparseable.
 */
export function retryAfterSeconds(value, now = Date.now()) {
	if (value == null) return null;
	const s = String(value).trim();
	if (!s) return null;
	if (/^\d+(\.\d+)?$/.test(s)) return positiveSeconds(s);
	const at = Date.parse(s);
	return Number.isFinite(at) ? positiveSeconds((at - now) / 1000) : null;
}

/** Epoch ms of the next midnight UTC after `now`. */
export function nextUtcMidnight(now = Date.now()) {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Classify a refused /api/forge response.
 *
 * @param {object} input
 * @param {number} input.status HTTP status
 * @param {object|null} [input.body] parsed JSON body ({} or null when it was not JSON)
 * @param {Headers|object} [input.headers] response headers
 * @param {number} [input.now] epoch ms, for tests
 * @returns {null | {
 *   kind: 'provider_busy'|'user_rate_limit'|'daily_cap'|'unknown',
 *   source: string,
 *   waitSeconds: number,
 *   resetAt: number,
 *   autoRetry: boolean,
 *   stated: boolean,
 *   serverMessage: string,
 *   status: number,
 * }} null when the response is not a throttle at all.
 */
export function classifyThrottle({ status, body, headers, now = Date.now() } = {}) {
	const data = body && typeof body === 'object' ? body : {};
	const code = typeof data.error === 'string' ? data.error : '';
	if (NOT_A_THROTTLE.has(code)) return null;
	const serverMessage = typeof data.message === 'string' ? data.message.trim() : '';
	const stated =
		positiveSeconds(data.retry_after) ??
		retryAfterSeconds(readHeader(headers, 'retry-after'), now) ??
		positiveSeconds(readHeader(headers, 'ratelimit-reset'));

	const make = (kind, source, waitOverride) => {
		const waitSeconds = waitOverride ?? stated ?? DEFAULT_WAIT_SECONDS[kind];
		return {
			kind,
			source,
			waitSeconds,
			resetAt: now + waitSeconds * 1000,
			autoRetry: kind === THROTTLE.PROVIDER_BUSY && waitSeconds <= AUTO_RETRY_MAX_SECONDS,
			stated: waitOverride != null || stated != null,
			serverMessage,
			status: Number(status) || 0,
		};
	};

	if (code === 'daily_limit_reached') {
		const resetAt = nextUtcMidnight(now);
		return make(THROTTLE.DAILY_CAP, 'paid_daily', Math.max(1, Math.ceil((resetAt - now) / 1000)));
	}
	// The free engines at capacity (a 503 from an explicit free pick, or the
	// Spaces chain briefly all down). Callers handle the variant that names
	// retry_backends first, since that one hops engines instead of waiting.
	if (code === 'provider_busy' || code === 'free_lane_unavailable') {
		return make(THROTTLE.PROVIDER_BUSY, 'free_engines');
	}
	// The image-step waiting line is at its depth (api/_lib/forge-line.js).
	if (code === 'forge_full') return make(THROTTLE.PROVIDER_BUSY, 'line_full');
	// Any other 503: transient upstream capacity, a worker still warming.
	if (status === 503) return make(THROTTLE.PROVIDER_BUSY, 'unavailable');
	if (status !== 429 && code !== 'rate_limited') return null;

	// The distributed limiter is down and failing closed: nobody spent anything.
	if (data.reason === 'rate_limiter_unavailable') return make(THROTTLE.PROVIDER_BUSY, 'limiter');
	// The provider-throttle shape from api/forge.js always carries `queued`: true
	// when our own gate is pacing the reference-image step, false for an upstream
	// 429 from the engine.
	if (typeof data.queued === 'boolean') {
		return make(THROTTLE.PROVIDER_BUSY, data.queued ? 'image' : 'engine');
	}
	// Forge-in-world admission (api/forge.js admitWorldForge).
	if (data.scope === 'world') return make(THROTTLE.PROVIDER_BUSY, 'world');
	if (data.scope === 'player') return make(THROTTLE.USER_RATE_LIMIT, 'world_player');

	const limiterHeaders =
		readHeader(headers, 'ratelimit-limit') != null || readHeader(headers, 'ratelimit-reset') != null;
	if (code === 'rate_limited' || limiterHeaders) return make(THROTTLE.USER_RATE_LIMIT, 'account');
	return make(THROTTLE.UNKNOWN, 'unknown');
}

// ── Copy ──────────────────────────────────────────────────────────────────────

/** "45s", "4:05", "1 h 12 min": compact, for the live countdown line. */
export function formatCountdown(seconds) {
	const s = Math.max(0, Math.ceil(seconds));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return m ? `${h} h ${m} min` : `${h} h`;
}

/** "in about 45 seconds", "in about 12 minutes", "in about 4 hours". */
export function formatRelative(seconds) {
	const s = Math.max(1, Math.ceil(seconds));
	if (s < 90) return `in about ${s} second${s === 1 ? '' : 's'}`;
	const m = Math.round(s / 60);
	if (m < 90) return `in about ${m} minute${m === 1 ? '' : 's'}`;
	const h = Math.round(s / 3600);
	return `in about ${h} hour${h === 1 ? '' : 's'}`;
}

/** Wall-clock time of `ms` in the viewer's zone (or the given one, for tests). */
export function formatClock(ms, { locale, timeZone } = {}) {
	return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ms));
}

const NOT_YOUR_LIMIT = 'This is not a limit on your account, and your prompt and settings are kept.';

const PROVIDER_COPY = {
	image: {
		title: 'Our image step is busy',
		lead: `Lots of people are making models from text right now, so the step that paints your reference image is pacing requests. ${NOT_YOUR_LIMIT}`,
	},
	engine: {
		title: 'The 3D engine is busy',
		lead: `The engine that builds your model is at capacity right now. ${NOT_YOUR_LIMIT}`,
	},
	free_engines: {
		title: 'High demand right now',
		lead: `The free 3D engines are all busy right now. ${NOT_YOUR_LIMIT}`,
	},
	unavailable: {
		title: 'Temporarily unavailable',
		lead: `The generator is catching up (an engine may still be starting). ${NOT_YOUR_LIMIT}`,
	},
	limiter: {
		title: 'Briefly paused on our side',
		lead: `Our usage check is briefly unavailable, so new generations are paused to be safe. ${NOT_YOUR_LIMIT}`,
	},
	line_full: {
		title: 'Forge is full right now',
		lead: `Too many generations are already waiting for the image step. ${NOT_YOUR_LIMIT}`,
	},
	world: {
		title: 'This world is busy',
		lead: 'This world is forging as much as it can right now. Your prompt and settings are kept.',
	},
};

/**
 * Title, lead and action ids for a classification.
 *
 * @param {ReturnType<typeof classifyThrottle>} c
 * @param {object} [ctx]
 * @param {boolean} [ctx.refused] an automatic retry was already refused
 * @param {boolean} [ctx.signedIn]
 * @param {boolean} [ctx.canUsePhoto] the page can switch to photo input
 * @param {boolean} [ctx.canChooseFreeEngine] the page can focus its engine picker
 * @param {string} [ctx.locale]
 * @param {string} [ctx.timeZone]
 * @param {number} [ctx.now]
 * @returns {{ title: string, lead: string, actions: string[] }}
 */
export function describeThrottle(c, ctx = {}) {
	const { refused = false, signedIn = true, canUsePhoto = false, canChooseFreeEngine = false, locale, timeZone } = ctx;
	const now = ctx.now ?? Date.now();
	const secondsLeft = Math.max(1, Math.ceil((c.resetAt - now) / 1000));
	const at = formatClock(c.resetAt, { locale, timeZone });

	if (c.kind === THROTTLE.PROVIDER_BUSY) {
		const copy = PROVIDER_COPY[c.source] || PROVIDER_COPY.engine;
		// These two answers carry live facts (the world's state, the line's depth).
		const quotesServer = c.source === 'world' || c.source === 'line_full';
		const lead = quotesServer && c.serverMessage ? c.serverMessage : copy.lead;
		const actions = [];
		// A photo goes straight to a 3D engine and skips the image step entirely.
		if ((c.source === 'image' || c.source === 'line_full') && canUsePhoto) actions.push('photo');
		return {
			title: copy.title,
			lead: refused ? `Still busy after the automatic retry. ${lead}` : lead,
			actions,
		};
	}

	if (c.kind === THROTTLE.USER_RATE_LIMIT) {
		if (c.source === 'world_player') {
			return {
				title: 'Wait a moment before forging again',
				lead: c.serverMessage || 'You just forged one in this world. Wait a moment before forging another.',
				actions: [],
			};
		}
		// The title already says the allowance is used; signed out, say why it
		// ran out sooner than expected.
		const who = signedIn ? 'Your allowance' : 'You are not signed in, so this allowance is shared with everyone on your network. It';
		return {
			title: 'You have used your generations for now',
			lead: `${who} resets at ${at}, ${formatRelative(secondsLeft)}. Nothing was charged, and your prompt and settings are kept.`,
			actions: signedIn ? [] : ['signin'],
		};
	}

	if (c.kind === THROTTLE.DAILY_CAP) {
		return {
			title: 'Today’s paid generations are used up',
			lead: `Paid engines reset at ${at} your time (midnight UTC), ${formatRelative(secondsLeft)}. The free engines stay open, so you can keep making models now.`,
			actions: canChooseFreeEngine ? ['free_engine'] : [],
		};
	}

	return {
		title: 'Too many requests right now',
		lead: c.serverMessage || 'The server asked us to slow down for a moment. Your prompt and settings are kept.',
		actions: [],
	};
}

/** The live line under the lead, for `remaining` seconds left. */
export function countdownText(c, remaining, { auto = false } = {}) {
	if (c.kind === THROTTLE.DAILY_CAP) {
		return remaining > 0 ? `Paid engines reset in ${formatCountdown(remaining)}.` : 'Paid engines have reset. You can try again now.';
	}
	if (remaining > 0) {
		if (auto) return `Retrying automatically in ${formatCountdown(remaining)}.`;
		if (c.kind === THROTTLE.USER_RATE_LIMIT) return `You can generate again in ${formatCountdown(remaining)}.`;
		return `You can try again in ${formatCountdown(remaining)}.`;
	}
	if (auto) return 'Retrying now.';
	if (c.kind === THROTTLE.USER_RATE_LIMIT) return 'Your allowance has reset. You can try again now.';
	return 'You can try again now.';
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
	photo: 'Use a photo instead',
	free_engine: 'Choose a free engine',
	signin: 'Sign in',
};

/**
 * The throttle state of a Forge error panel: copy, a live countdown driven by
 * the server's own number, and at most one automatic retry per user action.
 *
 * The page calls `show(classification, ctx)` when a request is refused,
 * `stop()` whenever it leaves the state (it must not reset the retry budget),
 * and `resetAutoRetry()` only on a user-initiated submit or Retry click. That is
 * what guarantees the automatic retry fires once and never loops: a second
 * refusal finds the budget spent and counts down to a manual retry instead.
 *
 * @param {object} opts
 * @param {object} opts.els { panel, title, message, retry, lanes, refineLocally }
 * @param {() => void} opts.onRetry re-run the last job (must not reset the budget)
 * @param {Record<string, () => void>} [opts.actions] handlers: photo, free_engine
 * @param {string} [opts.buttonClass] class list for the extra buttons
 * @param {string} [opts.signInUrl]
 * @param {() => number} [opts.now]
 */
export function createThrottlePanel({
	els,
	onRetry,
	actions = {},
	buttonClass = 'btn',
	signInUrl = '/login',
	now = () => Date.now(),
}) {
	let timer = null;
	let current = null;
	let deadline = 0;
	let total = 0;
	let autoPending = false;
	let autoUsed = 0;
	let nodes = null;
	let savedGlyph = null;
	let savedLanesLabel = null;

	const glyph = () => els.panel?.querySelector('.glyph');

	function remainingSeconds() {
		return Math.max(0, Math.ceil((deadline - now()) / 1000));
	}

	function ensureNodes() {
		if (nodes) return nodes;
		const wrap = document.createElement('div');
		wrap.className = 'forge-throttle';
		// The stage around this panel is a polite live region. The countdown opts
		// out so a screen reader is not read a new number every second; the
		// announcer below speaks once at the start and once at the end.
		wrap.setAttribute('aria-live', 'off');
		const line = document.createElement('p');
		line.className = 'forge-throttle__line';
		const meter = document.createElement('div');
		meter.className = 'forge-throttle__meter';
		meter.setAttribute('aria-hidden', 'true');
		const fill = document.createElement('span');
		meter.appendChild(fill);
		wrap.append(line, meter);
		const announcer = document.createElement('p');
		announcer.className = 'forge-throttle__sr';
		announcer.setAttribute('role', 'status');
		announcer.setAttribute('aria-live', 'polite');
		els.message.insertAdjacentElement('afterend', wrap);
		wrap.insertAdjacentElement('afterend', announcer);
		nodes = { wrap, line, meter, fill, announcer };
		return nodes;
	}

	function announce(text) {
		const { announcer } = ensureNodes();
		// Clear first so repeating the same sentence is still announced.
		announcer.textContent = '';
		setTimeout(() => {
			if (nodes) nodes.announcer.textContent = text;
		}, 50);
	}

	function renderTick() {
		if (!current || !nodes) return;
		const remaining = remainingSeconds();
		nodes.line.textContent = countdownText(current, remaining, { auto: autoPending });
		const done = total > 0 ? 1 - remaining / total : 1;
		nodes.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, done))})`;
		nodes.wrap.dataset.auto = String(autoPending);
	}

	function clearTimer() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function focusFirstAction(force = false) {
		const ax = document.activeElement;
		const idle = !ax || ax === document.body || !els.panel?.contains(ax);
		if (!force && !idle) return;
		const target =
			els.panel?.querySelector('.forge-throttle-cancel') ||
			(els.retry && !els.retry.disabled ? els.retry : null) ||
			els.lanes?.querySelector('button, a') ||
			els.title;
		if (target === els.title && els.title && !els.title.hasAttribute('tabindex')) els.title.setAttribute('tabindex', '-1');
		target?.focus?.({ preventScroll: true });
	}

	function renderActions(ids) {
		if (!els.lanes) return;
		els.lanes.innerHTML = '';
		savedLanesLabel ??= els.lanes.getAttribute('aria-label');
		els.lanes.setAttribute('aria-label', 'What you can do now');
		if (autoPending) {
			const cancel = document.createElement('button');
			cancel.type = 'button';
			cancel.className = `${buttonClass} forge-throttle-cancel`;
			cancel.textContent = 'Cancel automatic retry';
			cancel.addEventListener('click', cancelAutoRetry);
			els.lanes.appendChild(cancel);
		}
		for (const id of ids) {
			if (id === 'signin') {
				const a = document.createElement('a');
				a.className = buttonClass;
				a.href = signInUrl;
				a.textContent = ACTION_LABELS.signin;
				els.lanes.appendChild(a);
				continue;
			}
			const handler = actions[id];
			if (typeof handler !== 'function') continue;
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = buttonClass;
			btn.textContent = ACTION_LABELS[id];
			btn.addEventListener('click', () => {
				stop();
				handler();
			});
			els.lanes.appendChild(btn);
		}
		els.lanes.classList.toggle('is-hidden', !els.lanes.children.length);
	}

	function elapsed() {
		clearTimer();
		if (els.retry) els.retry.disabled = false;
		if (autoPending) {
			autoPending = false;
			autoUsed += 1;
			renderTick();
			announce('Retrying now.');
			onRetry();
			return;
		}
		renderTick();
		announce(countdownText(current, 0));
		// Retry just became the way forward; a disabled button could not hold focus.
		const ax = document.activeElement;
		if (!ax || ax === document.body || ax === els.title) els.retry?.focus({ preventScroll: true });
	}

	/**
	 * Enter the throttle state for a classification.
	 * @param {ReturnType<typeof classifyThrottle>} c
	 * @param {object} [ctx] see describeThrottle; plus canRefineLocally
	 */
	function show(c, ctx = {}) {
		clearTimer();
		current = c;
		const refused = autoUsed > 0 && c.kind === THROTTLE.PROVIDER_BUSY;
		autoPending = c.autoRetry && autoUsed < 1;
		const copy = describeThrottle(c, {
			...ctx,
			refused,
			canUsePhoto: typeof actions.photo === 'function',
			canChooseFreeEngine: typeof actions.free_engine === 'function',
			now: now(),
		});

		if (els.title) {
			// Pages that restore a translated heading read it from here.
			els.title.dataset.defaultText ??= els.title.textContent;
			els.title.textContent = copy.title;
		}
		els.message.classList.remove('upload-sign-in', 'upload-sign-in--panel');
		els.message.textContent = copy.lead;
		if (els.panel) els.panel.dataset.throttle = c.kind;
		const g = glyph();
		if (g) {
			savedGlyph ??= g.textContent;
			g.textContent = '◷';
		}
		if (els.refineLocally) els.refineLocally.classList.toggle('is-hidden', !ctx.canRefineLocally);

		deadline = now() + c.waitSeconds * 1000;
		total = c.waitSeconds;
		ensureNodes();
		renderActions(copy.actions);
		if (els.retry) els.retry.disabled = remainingSeconds() > 0;
		renderTick();
		announce(`${copy.title}. ${countdownText(c, remainingSeconds(), { auto: autoPending })}`);

		timer = setInterval(() => {
			if (remainingSeconds() <= 0) elapsed();
			else renderTick();
		}, 1000);
	}

	function cancelAutoRetry() {
		if (!autoPending) return;
		autoPending = false;
		// The user said no to this automatic retry; it does not come back on its own.
		autoUsed += 1;
		els.panel?.querySelector('.forge-throttle-cancel')?.remove();
		if (els.lanes && !els.lanes.children.length) els.lanes.classList.add('is-hidden');
		renderTick();
		announce('Automatic retry cancelled. Try again yourself when the countdown ends.');
		focusFirstAction(true);
	}

	function stop() {
		clearTimer();
		autoPending = false;
		current = null;
		if (nodes) {
			nodes.wrap.remove();
			nodes.announcer.remove();
			nodes = null;
		}
		if (els.panel) delete els.panel.dataset.throttle;
		const g = glyph();
		if (g && savedGlyph != null) g.textContent = savedGlyph;
		savedGlyph = null;
		// The group holds other actions (engine switches) once this state ends.
		if (els.lanes && savedLanesLabel != null) els.lanes.setAttribute('aria-label', savedLanesLabel);
		savedLanesLabel = null;
	}

	function resetAutoRetry() {
		autoUsed = 0;
	}

	return {
		show,
		stop,
		cancelAutoRetry,
		resetAutoRetry,
		focus: focusFirstAction,
		get active() {
			return current !== null;
		},
		get autoRetryPending() {
			return autoPending;
		},
	};
}
