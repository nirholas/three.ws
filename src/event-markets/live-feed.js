// Client for GET /api/event-markets/stream (see docs/event-markets.md, "Live feed").
//
// One EventSource per feed, reconnected by hand so the retry policy is ours:
//   - exponential backoff with jitter, resuming from the last seen event id
//     (`?lastEventId=`), so a dropped connection replays only what it missed;
//   - a watchdog that treats silence longer than ~2.2 heartbeats as a dead socket;
//   - duplicate suppression by `seq`, so a replay overlapping a live frame, or a
//     held frame arriving late, never double-applies;
//   - the connection is closed while the tab is hidden and reopened on return;
//   - after repeated failures it falls back to REST polling and reports it, and
//     says "offline" when the browser has no network.
//
// Status: connecting | live | reconnecting | polling | offline.

const HEARTBEAT_MS = 15000;
const WATCHDOG_FACTOR = 2.2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const FAILS_BEFORE_POLLING = 3;
const POLL_MS = 5000;
const SEEN_LIMIT = 2000;

const MARKET_EVENTS = ['snapshot', 'resync', 'open', 'odds', 'pick', 'move', 'lock', 'resolve'];

/**
 * @param {object} opts
 * @param {string|null} [opts.slug] one market, or null for the global feed
 * @param {(ev: {type: string, [k: string]: any}) => void} opts.onEvent
 * @param {(status: string) => void} [opts.onStatus]
 * @param {() => Promise<{markets: object[]}>} [opts.poll] REST fallback; returns the same market shape as a snapshot
 * @param {object} [opts.env] injectable browser surface for tests
 */
export function createLiveFeed({ slug = null, onEvent, onStatus = () => {}, poll, env = {} }) {
	const ES = env.EventSource ?? globalThis.EventSource;
	const doc = env.document ?? globalThis.document;
	const win = env.window ?? globalThis.window;
	// Wrapped, not passed bare: browsers throw "Illegal invocation" when the native
	// timer functions are called as methods of this plain object.
	const timers = env.timers ?? {
		setTimeout: (...a) => setTimeout(...a),
		clearTimeout: (...a) => clearTimeout(...a),
		setInterval: (...a) => setInterval(...a),
		clearInterval: (...a) => clearInterval(...a),
	};
	const random = env.random ?? Math.random;
	const online = () => (env.online ? env.online() : globalThis.navigator?.onLine !== false);

	let es = null;
	let stopped = true;
	let status = '';
	let lastEventId = null;
	let fails = 0;
	let retryTimer = null;
	let watchdog = null;
	let pollTimer = null;
	let serverRetryMs = 0;
	const seen = new Set();
	const oddsSeq = new Map();

	const setStatus = (s) => {
		if (s === status) return;
		status = s;
		onStatus(s);
	};

	const url = () => {
		const qs = new URLSearchParams();
		if (slug) qs.set('slug', slug);
		if (lastEventId != null) qs.set('lastEventId', String(lastEventId));
		const q = qs.toString();
		return `/api/event-markets/stream${q ? `?${q}` : ''}`;
	};

	function fresh(type, data) {
		const seq = Number(data?.seq);
		if (!Number.isFinite(seq)) return true;
		if (type === 'odds') {
			const key = data.slug;
			if (seq <= (oddsSeq.get(key) ?? 0)) return false;
			oddsSeq.set(key, seq);
			return true;
		}
		if (type === 'snapshot' || type === 'resync') return true;
		if (seen.has(seq)) return false;
		seen.add(seq);
		if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
		return true;
	}

	function armWatchdog() {
		timers.clearTimeout(watchdog);
		watchdog = timers.setTimeout(() => fail('silent'), HEARTBEAT_MS * WATCHDOG_FACTOR);
	}

	function handle(type, e) {
		armWatchdog();
		if (e.lastEventId) lastEventId = e.lastEventId;
		let data = {};
		try { data = JSON.parse(e.data); } catch { return; }
		if (type === 'snapshot' || type === 'resync') {
			fails = 0;
			stopPolling();
			setStatus('live');
		}
		if (!fresh(type, data)) return;
		onEvent({ type, ...data });
	}

	function open() {
		if (stopped || es) return;
		if (!online()) { setStatus('offline'); return; }
		setStatus(fails ? 'reconnecting' : 'connecting');
		es = new ES(url());
		es.onopen = () => { armWatchdog(); };
		for (const t of MARKET_EVENTS) es.addEventListener(t, (e) => handle(t, e));
		es.addEventListener('ping', () => { armWatchdog(); if (status !== 'live') { fails = 0; stopPolling(); setStatus('live'); } });
		es.addEventListener('resume', (e) => { fails = 0; stopPolling(); setStatus('live'); handle('resume', e); });
		es.addEventListener('close', () => { teardown(); schedule(0); });
		es.onerror = () => fail('error');
	}

	function teardown() {
		timers.clearTimeout(watchdog);
		if (es) { es.onerror = null; es.close(); es = null; }
	}

	function schedule(delay) {
		timers.clearTimeout(retryTimer);
		retryTimer = timers.setTimeout(open, delay);
	}

	function fail() {
		teardown();
		if (stopped) return;
		fails++;
		if (!online()) { setStatus('offline'); return; }
		if (fails >= FAILS_BEFORE_POLLING && poll) startPolling();
		else setStatus('reconnecting');
		const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(fails - 1, 5));
		schedule(Math.max(serverRetryMs, backoff * (0.7 + random() * 0.6)));
	}

	async function pollOnce() {
		try {
			const data = await poll();
			if (stopped || !pollTimer) return;
			setStatus('polling');
			onEvent({ type: 'snapshot', polled: true, ...data });
		} catch {
			if (!stopped && pollTimer) setStatus(online() ? 'polling' : 'offline');
		}
	}

	function startPolling() {
		if (pollTimer) return;
		setStatus('polling');
		pollTimer = timers.setInterval(pollOnce, POLL_MS);
		pollOnce();
	}

	function stopPolling() {
		if (pollTimer) { timers.clearInterval(pollTimer); pollTimer = null; }
	}

	const onVisibility = () => {
		if (stopped) return;
		if (doc.hidden) { teardown(); timers.clearTimeout(retryTimer); stopPolling(); }
		else { fails = 0; open(); }
	};
	const onOnline = () => { if (!stopped) { fails = 0; timers.clearTimeout(retryTimer); open(); } };
	const onOffline = () => { if (!stopped) { teardown(); timers.clearTimeout(retryTimer); stopPolling(); setStatus('offline'); } };

	return {
		start() {
			if (!stopped) return;
			stopped = false;
			if (!ES) { if (poll) startPolling(); else setStatus('offline'); return; }
			doc?.addEventListener('visibilitychange', onVisibility);
			win?.addEventListener('online', onOnline);
			win?.addEventListener('offline', onOffline);
			if (doc?.hidden) return;
			open();
		},
		stop() {
			stopped = true;
			teardown();
			timers.clearTimeout(retryTimer);
			stopPolling();
			doc?.removeEventListener('visibilitychange', onVisibility);
			win?.removeEventListener('online', onOnline);
			win?.removeEventListener('offline', onOffline);
		},
		get status() { return status; },
	};
}

/** Apply an odds snapshot for one market onto a REST-shaped market view, in place. */
export function applyOdds(market, odds) {
	if (!market || !odds) return false;
	const byId = new Map(odds.outcomes.map((o) => [o.id, o]));
	for (const o of market.outcomes) {
		const next = byId.get(o.id);
		if (!next) continue;
		o.percent = next.percent;
		o.picks = next.picks;
		if (next.share != null) o.share = next.share;
	}
	market.pick_count = odds.pick_count ?? market.pick_count;
	return true;
}
