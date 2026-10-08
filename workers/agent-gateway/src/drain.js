// The inbox drain: claims gateway_inbox rows with a lease, runs each through its
// platform adapter, and acknowledges, retries with backoff, or dead-letters it.
//
// Ordering and exclusivity come from the claim itself (api/_lib/gateway/store.js
// claimInbox): at most one open row per chat is ever handed out, so a chat's
// replies leave in the order its messages arrived, and concurrency here is
// concurrency across chats. While a row runs, its lease is renewed so a long
// agent turn is never reclaimed and answered twice.
//
// The loop knows nothing about any platform. It asks the adapter registry for
// the adapter named by the row's `platform`, and the adapter supplies
// normalize(payload) -> event, gateway(event) -> the send surface, and
// optionally its own handle(event, gw); the default handler is the shared
// gateway core (handleEvent). A new platform is a new adapter in
// src/adapters/index.js, never a change here.

import { handleEvent } from '../../../api/_lib/gateway/core.js';
import { previewText } from '../../../api/_lib/gateway/conversation.js';
import * as inboxStore from '../../../api/_lib/gateway/store.js';
import { classifyFailure, errorSummary } from './errors.js';
import { log as defaultLog } from './log.js';

// Methods whose success means the chat saw something. typing and ackAction are
// transient signals and do not count.
const DELIVERY_METHODS = ['sendText', 'sendChoice', 'sendMedia', 'sendVoice', 'editMessage'];
const EXPIRED_PREVIEW_LINE = 'Expired. Ask your agent again for a fresh quote.';
const APOLOGY = 'Something went wrong on our side while answering that. Please send it again in a minute.';
const PRUNE_EVERY_MS = 60 * 60 * 1000;

class TurnTimeout extends Error {
	constructor(ms) {
		super(`row still running after ${ms}ms`);
		this.code = 'turn_timeout';
	}
}

/**
 * Wrap an adapter's gateway so every successful delivery is counted. The
 * wrapper keeps the original's shape: a method the adapter does not implement
 * (sendVoice on a platform without audio) stays absent, because the core
 * checks for it with typeof.
 */
export function trackDeliveries(gw) {
	const counter = { delivered: 0 };
	const wrapped = { ...gw };
	for (const name of DELIVERY_METHODS) {
		if (typeof gw[name] !== 'function') continue;
		wrapped[name] = async (...args) => {
			const out = await gw[name](...args);
			counter.delivered += 1;
			return out;
		};
	}
	for (const name of Object.keys(gw)) {
		if (typeof gw[name] === 'function' && !DELIVERY_METHODS.includes(name)) wrapped[name] = gw[name].bind(gw);
	}
	return { gw: wrapped, counter };
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TurnTimeout(ms)), ms); });
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {Map<string, object>} opts.adapters      platform -> adapter (src/adapters/index.js)
 * @param {import('./config.js').GatewayConfig} opts.config
 * @param {object} [opts.store]                     the inbox store (defaults to api/_lib/gateway/store.js)
 * @param {(event:object, gw:object) => Promise<unknown>} [opts.defaultHandler]  defaults to the gateway core
 * @param {object} [opts.log]
 */
export function createDrainer({ adapters, config, store = inboxStore, defaultHandler = handleEvent, log = defaultLog }) {
	const platforms = [...adapters.keys()];
	const inflight = new Map();
	const stats = {
		startedAt: new Date().toISOString(),
		lastLoopAt: 0,
		lastClaimOkAt: 0,
		lastClaimError: null,
		claimed: 0,
		completed: 0,
		ignored: 0,
		retried: 0,
		deadLettered: 0,
		notificationsSent: 0,
		notificationsSkipped: 0,
		previewsExpired: 0,
	};
	let stopping = false;
	let wakeUp = null;
	let loopDone = null;
	let sweepTimer = null;
	let lastPruneAt = 0;

	function wake() {
		const fn = wakeUp;
		wakeUp = null;
		if (fn) fn();
	}

	function sleep(ms) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => { wakeUp = null; resolve(); }, ms);
			wakeUp = () => { clearTimeout(timer); resolve(); };
		});
	}

	async function deliverNotification(row, adapter) {
		const p = row.payload || {};
		if (p.expiresAt && Date.parse(p.expiresAt) <= Date.now()) {
			stats.notificationsSkipped += 1;
			log.info('notification expired before delivery', { id: row.id, platform: row.platform });
			return;
		}
		if (p.linkId) {
			const link = await store.getLinkById(p.linkId);
			if (!link || link.revoked_at || link.notify === false) {
				stats.notificationsSkipped += 1;
				log.info('notification skipped: chat unlinked or muted', { id: row.id, platform: row.platform });
				return;
			}
		}
		if (!p.chatId || !p.text) {
			stats.notificationsSkipped += 1;
			log.warn('notification row has no chat or text', { id: row.id });
			return;
		}
		const { gw, counter } = trackDeliveries(adapter.gateway(null));
		row.counter = counter;
		await gw.sendText(String(p.chatId), String(p.text));
		stats.notificationsSent += 1;
	}

	async function runEvent(row, adapter) {
		const event = adapter.normalize(row.payload);
		if (!event) {
			stats.ignored += 1;
			log.info('row ignored: nothing to handle', { id: row.id, platform: row.platform });
			return;
		}
		const { gw, counter } = trackDeliveries(adapter.gateway(event));
		row.counter = counter;
		row.event = event;
		row.gw = gw;
		const handler = typeof adapter.handle === 'function' ? adapter.handle.bind(adapter) : defaultHandler;
		log.info('handling event', {
			id: row.id, platform: row.platform, attempt: row.attempts,
			kind: event.action ? 'action' : event.command ? 'command' : event.voice ? 'voice' : event.photo ? 'photo' : 'text',
			command: event.command || null,
		});
		await handler(event, gw);
		if (typeof adapter.finish === 'function') await adapter.finish(event, gw, counter);
	}

	async function apologize(row) {
		if (!row.event || !row.gw) return;
		try {
			await row.gw.sendText(String(row.event.chatId), APOLOGY);
		} catch (e) {
			log.warn('apology not delivered', { id: row.id, ...errorSummary(e) });
		}
	}

	async function processRow(row) {
		const adapter = adapters.get(row.platform);
		const started = Date.now();
		const renewEvery = Math.max(5000, Math.floor((config.leaseSeconds * 1000) / 3));
		const renew = setInterval(() => {
			store.renewInboxLease(row.id, config.leaseSeconds)
				.then((held) => { if (!held) log.warn('lease lost while processing', { id: row.id }); })
				.catch((e) => log.warn('lease renewal failed', { id: row.id, ...errorSummary(e) }));
		}, renewEvery);
		try {
			if (!adapter) throw Object.assign(new Error(`no adapter for platform ${row.platform}`), { deadLetter: true });
			const work = row.payload?.kind === 'notify' ? deliverNotification(row, adapter) : runEvent(row, adapter);
			await withTimeout(work, config.turnTimeoutMs);
			await store.completeInbox(row.id);
			stats.completed += 1;
			log.info('row done', { id: row.id, platform: row.platform, ms: Date.now() - started, delivered: row.counter?.delivered ?? 0 });
		} catch (err) {
			const delivered = row.counter?.delivered ?? 0;
			const verdict = err?.deadLetter || err instanceof TurnTimeout
				? { deadLetter: true, retryAfterMs: 0, reason: err instanceof TurnTimeout ? 'timeout' : 'no_adapter' }
				: classifyFailure(err, { attempts: row.attempts, maxAttempts: config.maxAttempts, delivered, baseMs: config.backoffBaseMs, maxMs: config.backoffMaxMs });
			const summary = errorSummary(err);
			try {
				await store.failInbox(row.id, `${verdict.reason}: ${summary.error}`, {
					attempts: row.attempts,
					maxAttempts: config.maxAttempts,
					retryAfterSeconds: verdict.retryAfterMs / 1000,
					deadLetter: verdict.deadLetter,
				});
			} catch (e) {
				log.error('could not record row failure; its lease will expire and it will be retried', { id: row.id, ...errorSummary(e) });
			}
			if (verdict.deadLetter) {
				stats.deadLettered += 1;
				log.error('row dead-lettered', { id: row.id, platform: row.platform, attempt: row.attempts, reason: verdict.reason, delivered, ...summary });
				// The owner sent something and is waiting. Say so rather than leave
				// them in silence, unless the platform itself refuses this chat,
				// they already got part of an answer, or a timed-out turn may still
				// answer on its own.
				if (!['permanent', 'partially_delivered', 'timeout'].includes(verdict.reason)) await apologize(row);
			} else {
				stats.retried += 1;
				log.warn('row will be retried', { id: row.id, platform: row.platform, attempt: row.attempts, retryInMs: verdict.retryAfterMs, ...summary });
			}
		} finally {
			clearInterval(renew);
		}
	}

	async function claim(limit) {
		try {
			const rows = await store.claimInbox({ limit, leaseSeconds: config.leaseSeconds, platforms, chatKeys: config.chatKeys });
			stats.lastClaimOkAt = Date.now();
			stats.lastClaimError = null;
			return rows;
		} catch (e) {
			stats.lastClaimError = errorSummary(e).error;
			log.error('inbox claim failed', errorSummary(e));
			return null;
		}
	}

	/** Claim and start as many rows as there are free slots. Returns how many started. */
	async function tick() {
		stats.lastLoopAt = Date.now();
		const free = config.concurrency - inflight.size;
		if (free <= 0 || stopping) return 0;
		const rows = await claim(free);
		if (!rows) return -1;
		for (const row of rows) {
			stats.claimed += 1;
			const p = processRow(row).finally(() => {
				inflight.delete(row.id);
				wake();
			});
			inflight.set(row.id, p);
		}
		return rows.length;
	}

	async function loop() {
		let failures = 0;
		while (!stopping) {
			const started = await tick();
			if (started < 0) {
				failures += 1;
				await sleep(Math.min(30_000, config.pollMs * 2 ** Math.min(failures, 5)));
				continue;
			}
			failures = 0;
			// A full claim may have more waiting behind it; otherwise wait for
			// the poll interval or for a running row to finish (which may free
			// its chat's next message).
			if (started > 0 && inflight.size < config.concurrency) continue;
			await sleep(config.pollMs);
		}
	}

	/** Expire overdue trade previews and strip their buttons; prune old rows hourly. */
	async function sweep() {
		try {
			const due = await store.expireDuePreviews({ limit: 50 });
			for (const p of due) {
				stats.previewsExpired += 1;
				const adapter = adapters.get(p.platform);
				if (!adapter || !p.message_ref) continue;
				const gw = adapter.gateway(null);
				if (gw.canEdit === false || typeof gw.editMessage !== 'function') continue;
				await gw.editMessage(p.message_ref, `${previewText(p.proposal || {})}\n\n${EXPIRED_PREVIEW_LINE}`, { choices: [] })
					.catch((e) => log.warn('expired preview not edited', { previewId: p.id, ...errorSummary(e) }));
			}
			if (due.length) log.info('previews expired', { count: due.length });
		} catch (e) {
			log.warn('preview sweep failed', errorSummary(e));
		}
		if (Date.now() - lastPruneAt >= PRUNE_EVERY_MS) {
			lastPruneAt = Date.now();
			await store.pruneInbox({ keepDays: config.pruneKeepDays })
				.catch((e) => log.warn('inbox prune failed', errorSummary(e)));
		}
	}

	return {
		stats,
		inflight,
		tick,
		sweep,
		processRow,
		start() {
			stopping = false;
			loopDone = loop();
			sweepTimer = setInterval(() => { sweep(); }, config.sweepMs);
			sweepTimer.unref?.();
			return loopDone;
		},
		/** Stop claiming, then wait up to `graceMs` for rows already running. */
		async stop(graceMs = config.shutdownGraceMs) {
			stopping = true;
			clearInterval(sweepTimer);
			wake();
			await loopDone;
			if (!inflight.size) return { abandoned: 0 };
			let timer;
			const grace = new Promise((resolve) => { timer = setTimeout(resolve, graceMs); });
			await Promise.race([Promise.allSettled([...inflight.values()]), grace]);
			clearTimeout(timer);
			// Anything still running keeps its lease until it expires; the next
			// worker reclaims it then.
			return { abandoned: inflight.size };
		},
		health() {
			const now = Date.now();
			const stallMs = Math.max(60_000, config.pollMs * 20);
			const looping = stopping || (stats.lastLoopAt > 0 && now - stats.lastLoopAt < stallMs) || inflight.size >= config.concurrency;
			return {
				ok: looping,
				stopping,
				platforms,
				inflight: inflight.size,
				concurrency: config.concurrency,
				lastClaimOkAgoMs: stats.lastClaimOkAt ? now - stats.lastClaimOkAt : null,
				...stats,
			};
		},
	};
}
