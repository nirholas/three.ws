// Fan-out hub for the live odds stream.
//
// One poller per process reads the shared event log (events.js) and fans each new
// row out to every connected listener, so database load is one cheap query per
// tick no matter how many browsers are watching. Cloud Run runs several instances
// and a pick can land on any of them, which is why the log (not process memory)
// is the source of truth: every instance sees every event, and a row id is a
// global ordering that Last-Event-ID can resume from.
//
// Coalescing: within a tick, odds updates collapse to the latest per market and a
// burst of picks collapses to one `pick` carrying a `batched` count. Across
// ticks, a market's odds are sent at most once per coalesce window: the first
// change goes out at once, later ones are held and flushed when the window ends.
// A held frame is sent without an SSE id so the browser's Last-Event-ID never
// moves backwards; every frame carries `seq` (its log row id) for de-duplication.
// Moves, locks, resolves and opens are never merged or delayed.

import { feedConfig } from './feed-config.js';

const RAW_KINDS = new Set(['pick', 'open', 'lock', 'resolve']);
const PASS_THROUGH = new Set(['open', 'move', 'lock', 'resolve']);
const MAX_BACKLOG_BYTES = 256 * 1024;
const PRUNE_EVERY_MS = 3_600_000;

/**
 * Collapse a batch of ascending log rows into the frames worth sending, in id
 * order. A merged event keeps the id of the newest row it absorbed so a resume
 * never replays what was already folded in.
 */
export function coalesce(rows) {
	const lastOdds = new Map();
	const lastPick = new Map();
	const pickCount = new Map();
	for (const r of rows) {
		if (r.kind === 'odds') lastOdds.set(r.slug, r);
		else if (r.kind === 'pick') {
			lastPick.set(r.slug, r);
			pickCount.set(r.slug, (pickCount.get(r.slug) || 0) + 1);
		}
	}
	const out = [];
	for (const r of rows) {
		if (PASS_THROUGH.has(r.kind)) out.push(r);
		else if (r.kind === 'odds' && lastOdds.get(r.slug) === r) out.push(r);
		else if (r.kind === 'pick' && lastPick.get(r.slug) === r) {
			const n = pickCount.get(r.slug);
			out.push(n > 1 ? { ...r, batched: n } : r);
		}
	}
	return out;
}

/** SSE wire frame. `seq` is the log row id; `withId: false` leaves Last-Event-ID alone. */
export function frame(ev, { withId = true } = {}) {
	const { id, kind, ...data } = ev;
	return `${withId ? `id: ${id}\n` : ''}event: ${kind}\ndata: ${JSON.stringify({ seq: id, ...data })}\n\n`;
}

/**
 * @param {object} opts
 * @param {{ eventsSince(afterId:number, limit:number):Promise<object[]>,
 *           latestId():Promise<number>, oldestId():Promise<number>,
 *           snapshot(slug:string|null):Promise<object>,
 *           process?():Promise<unknown>, prune?():Promise<void> }} opts.source
 * @param {typeof feedConfig.stream} [opts.config]
 * @param {() => number} [opts.now]
 */
export function createHub({ source, config = feedConfig.stream, now = Date.now }) {
	const listeners = new Set();
	const perIp = new Map();
	const lastOddsAt = new Map();
	const heldOdds = new Map();
	let cursor = 0;
	let timer = null;
	let ticking = false;
	let lastPrune = 0;
	const stats = { ticks: 0, rows: 0, frames: 0, bytes: 0, dropped: 0 };

	function deliver(l, str) {
		if (!l.ready) {
			l.pending.push(str);
			return;
		}
		if ((l.backlog?.() ?? 0) > MAX_BACKLOG_BYTES) {
			// A client that cannot keep up is cut loose; it reconnects with
			// Last-Event-ID and is replayed what it missed.
			stats.dropped++;
			detach(l);
			l.end();
			return;
		}
		l.write(str);
		stats.frames++;
		stats.bytes += str.length;
	}

	function broadcast(ev, opts) {
		const str = frame(ev, opts);
		for (const l of listeners) {
			if (ev.id <= l.joinCursor) continue;
			if (l.slug && l.slug !== ev.slug) continue;
			deliver(l, str);
		}
	}

	function emitOdds(ev, t) {
		if (t - (lastOddsAt.get(ev.slug) || 0) >= config.coalesceMs) {
			lastOddsAt.set(ev.slug, t);
			heldOdds.delete(ev.slug);
			broadcast(ev);
		} else {
			heldOdds.set(ev.slug, ev);
		}
	}

	function flushHeld(t) {
		for (const [slug, ev] of heldOdds) {
			if (t - (lastOddsAt.get(slug) || 0) < config.coalesceMs) continue;
			heldOdds.delete(slug);
			lastOddsAt.set(slug, t);
			broadcast(ev, { withId: false });
		}
	}

	async function tick() {
		if (ticking || listeners.size === 0) return;
		ticking = true;
		try {
			let rows = await source.eventsSince(cursor, config.replayLimit);
			if (rows.length) {
				cursor = rows[rows.length - 1].id;
				// Raw rows (a pick, a lock) need their odds snapshot or move derived.
				// Do it now and read the result back in the same tick, so a pick shows
				// up for other viewers in about one poll interval.
				if (source.process && rows.some((r) => RAW_KINDS.has(r.kind))) {
					try {
						await source.process();
						const derived = await source.eventsSince(cursor, config.replayLimit);
						if (derived.length) {
							cursor = derived[derived.length - 1].id;
							rows = rows.concat(derived);
						}
					} catch (err) {
						console.error('[event-markets] feed processing failed:', err?.message || err);
					}
				}
				stats.rows += rows.length;
				const t = now();
				for (const ev of coalesce(rows)) {
					if (ev.kind === 'odds') emitOdds(ev, t);
					else broadcast(ev);
				}
			}
			flushHeld(now());
			stats.ticks++;
			if (source.prune && now() - lastPrune > PRUNE_EVERY_MS) {
				lastPrune = now();
				source.prune().catch(() => {});
			}
		} catch (err) {
			console.error('[event-markets] stream poll failed:', err?.message || err);
		} finally {
			ticking = false;
		}
	}

	function detach(l) {
		if (!listeners.delete(l)) return;
		const n = (perIp.get(l.ip) || 1) - 1;
		if (n <= 0) perIp.delete(l.ip);
		else perIp.set(l.ip, n);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = null;
			heldOdds.clear();
		}
	}

	return {
		stats,
		get size() {
			return listeners.size;
		},

		/** Whether another connection from `ip` is allowed. */
		admit(ip) {
			if (listeners.size >= config.maxConnectionsPerProcess) return { ok: false, reason: 'server_busy' };
			if ((perIp.get(ip) || 0) >= config.maxConnectionsPerIp) return { ok: false, reason: 'too_many_connections' };
			return { ok: true };
		},

		/**
		 * Attach a listener and bring it current. Without a Last-Event-ID it gets a
		 * `snapshot` of present odds; with one it is replayed what it missed, or sent
		 * a `resync` snapshot when the gap is larger than the log can answer.
		 * Resolves to a detach function.
		 */
		async attach({ write, end, backlog, slug = null, ip, lastEventId = null }) {
			if (listeners.size === 0) cursor = await source.latestId();
			const l = { write, end, backlog, slug, ip, ready: false, pending: [], joinCursor: cursor };
			listeners.add(l);
			perIp.set(ip, (perIp.get(ip) || 0) + 1);
			if (!timer) {
				timer = setInterval(tick, config.pollIntervalMs);
				timer.unref?.();
			}
			try {
				let replay = null;
				if (Number.isFinite(lastEventId) && lastEventId >= 0 && lastEventId <= l.joinCursor) {
					const oldest = await source.oldestId();
					if (!(oldest > 0 && lastEventId + 1 < oldest)) {
						const rows = await source.eventsSince(lastEventId, config.replayLimit);
						const complete = rows.length < config.replayLimit || rows[rows.length - 1].id >= l.joinCursor;
						if (complete) {
							replay = coalesce(rows.filter((r) => r.id <= l.joinCursor && (!slug || r.slug === slug)));
						}
					}
				}
				if (replay) {
					write(`event: resume\ndata: ${JSON.stringify({ from: lastEventId, to: l.joinCursor, replayed: replay.length })}\n\n`);
					for (const ev of replay) write(frame(ev));
				} else {
					const snap = await source.snapshot(slug);
					write(`id: ${l.joinCursor}\nevent: ${lastEventId != null ? 'resync' : 'snapshot'}\ndata: ${JSON.stringify({ seq: l.joinCursor, ...snap })}\n\n`);
				}
				l.ready = true;
				for (const s of l.pending) write(s);
				l.pending.length = 0;
			} catch (err) {
				detach(l);
				throw err;
			}
			return () => detach(l);
		},

		/** Run one poll now (tests and the bench drive time themselves). */
		tick,

		heartbeat() {
			const str = `event: ping\ndata: ${JSON.stringify({ t: now() })}\n\n`;
			for (const l of listeners) if (l.ready) l.write(str);
		},

		shutdown() {
			if (timer) clearInterval(timer);
			timer = null;
			for (const l of [...listeners]) {
				detach(l);
				l.end();
			}
		},
	};
}
