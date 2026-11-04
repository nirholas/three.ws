// @ts-check
// Ops alerts. Errors should find the operator, not wait to be hunted:
// serverError()/wrap() report 5xx server faults here and api/client-errors.js
// reports browser errors, so production failures surface seconds after they
// happen.
//
// One durable sink and two push channels:
//   dashboard (PRIMARY, always on). Every alert is upserted into `ops_alerts`
//      keyed by its stable signature, so a recurring condition is ONE row with
//      a growing count, not a flood.
//   telegram (push). TELEGRAM_BOT_TOKEN + TELEGRAM_ALERTS_CHAT_ID, a PRIVATE
//      ops chat. Never the public holders' channel: alerts carry stack traces,
//      URLs and IPs.
//   email (push). OPS_ALERT_EMAILS (comma-separated) + RESEND_API_KEY, through
//      the platform's existing Resend account (api/_lib/email.js).
// Channel config is read from api/_lib/alert-channels.js.
//
// Routing by severity (severityOf, or opts.severity):
//   critical  pushed on every configured channel every time it fires. A leak
//             or a halted payer repeating is news, so dedup never holds it.
//   warn      Telegram once per signature per hour. Email does not send warns
//             one by one: they reach the inbox through the hourly digest
//             (sendWarnDigest, run by api/cron/ops-alerts-digest.js), which
//             reads them back from ops_alerts.
//   info      dashboard only.
// Each channel has its own hourly ceiling (GLOBAL_LIMIT_PER_HOUR) followed by
// one "throttled" notice, and its own dedup keys, so a Telegram storm never
// silences email and the reverse. Windows live in the shared cache (Redis when
// configured, else in-memory).
//
// Fire-and-forget like sentry.js: the DB write is one upsert, deliveries are
// not awaited, and every failure (cache, DB, transport, sync or async) is
// caught. An alerting pipeline must never delay or break the request it is
// reporting on.

import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache.js';
import { fetchUpstream } from './upstream-fetch.js';
import { alertChannels, emailAlertConfig, telegramConfig } from './alert-channels.js';

export { alertChannels } from './alert-channels.js';

const HOUR_MS = 3_600_000;
const DEDUP_MS = HOUR_MS;
const WINDOW_TTL_S = 60 * 60 + 60; // a little past the window so a slow clock never re-opens it early
export const GLOBAL_LIMIT_PER_HOUR = 20;

/**
 * Whether the Telegram PUSH channel is wired. Kept for /api/healthz's
 * `telegram_push` field; alertChannels() reports every channel.
 * @returns {boolean}
 */
export function alertsConfigured() {
	return telegramConfig() !== null;
}

function signatureOf(text) {
	return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Classify an alert by its title. Callers encode urgency with a leading emoji
 * (🚨 for compromise/leak/CRITICAL, ⚠️/💸/⛽/💵 for degradations); map that to a
 * stable severity the dashboard can sort and colour by. Overridable via
 * opts.severity.
 * @param {string} title
 * @returns {'critical'|'warn'|'info'}
 */
export function severityOf(title) {
	const t = String(title || '');
	if (/🚨/.test(t) || /\b(CRITICAL|LEAK|COMPROMISED|halted)\b/i.test(t)) return 'critical';
	if (/ℹ️|\binfo\b/i.test(t)) return 'info';
	return 'warn';
}

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Upsert the alert into `ops_alerts`. Best-effort and fail-soft: a missing DB,
 * an absent table (pre-migration), or any query error is swallowed so the
 * caller's error path is never affected. Keyed by signature so repeats
 * increment a count and refresh last_seen instead of piling up rows; a repeat
 * also clears a prior acknowledgement (the condition is happening again).
 * @param {{ sig: string, title: string, detail: string, severity: string, environment: string }} a
 */
async function persistAlert({ sig, title, detail, severity, environment }) {
	try {
		const [{ sql }, { databaseConfigured }] = await Promise.all([import('./db.js'), import('./env.js')]);
		if (typeof databaseConfigured === 'function' && !databaseConfigured()) return;
		await sql`
			insert into ops_alerts (signature, title, detail, severity, environment, count, first_seen, last_seen)
			values (${sig}, ${title}, ${detail || null}, ${severity}, ${environment}, 1, now(), now())
			on conflict (signature) do update set
				title = excluded.title,
				detail = excluded.detail,
				severity = excluded.severity,
				environment = excluded.environment,
				count = ops_alerts.count + 1,
				last_seen = now(),
				acknowledged_at = null,
				acknowledged_by = null
		`;
	} catch {
		/* dashboard sink is best-effort, never throws into the caller */
	}
}

// ─── Transports ──────────────────────────────────────────────────────────────
// A transport takes one message and returns a promise that resolves once the
// provider accepted it and rejects otherwise. The alerter never awaits them;
// scripts/alerts-self-test.mjs does, to report real delivery.

/**
 * @typedef {{
 *   channel: 'telegram' | 'email',
 *   kind: 'alert' | 'throttle' | 'digest' | 'self-test',
 *   severity?: string,
 *   title?: string,
 *   detail?: string,
 *   environment?: string,
 *   subject: string,
 *   text: string,
 *   html?: string,
 * }} AlertMessage
 */

/**
 * Telegram transport for a chat. Uses fetchUpstream for the timeout, the
 * Retry-After-aware second attempt and the shared breaker.
 * @param {{ token: string, chatId: string }} cfg
 */
export function telegramTransport(cfg) {
	return async (/** @type {AlertMessage} */ msg) => {
		const res = await fetchUpstream(
			`https://api.telegram.org/bot${cfg.token}/sendMessage`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					chat_id: cfg.chatId,
					text: msg.text.slice(0, 4000), // Telegram's hard limit is 4096
					disable_web_page_preview: true,
				}),
				keepalive: true,
			},
			{ name: 'telegram:ops-alert', timeoutMs: 5_000, attempts: 2 },
		);
		if (res && res.ok === false) {
			const body = await res.text().catch(() => '');
			throw new Error(`telegram ${res.status}: ${body.slice(0, 200)}`);
		}
		return { ok: true };
	};
}

/**
 * Email transport through Resend. The Resend SDK reports API errors in the
 * resolved value rather than by throwing, so both shapes count as a failure.
 * @param {{ recipients: string[] }} cfg
 */
export function emailTransport(cfg) {
	return async (/** @type {AlertMessage} */ msg) => {
		const { sendEmail } = await import('./email.js');
		const res = await sendEmail({ to: cfg.recipients, subject: msg.subject, html: msg.html || `<pre>${escapeHtml(msg.text)}</pre>`, text: msg.text });
		if (res?.skipped) throw new Error(`email skipped: ${res.reason}`);
		if (res?.error) throw new Error(`resend: ${res.error.message || res.error.name || 'send failed'}`);
		return { ok: true, id: res?.data?.id };
	};
}

/** The transports wired by the current environment. Read per call so a config change applies without a restart. */
export function configuredTransports() {
	/** @type {{ telegram?: (m: AlertMessage) => Promise<unknown>, email?: (m: AlertMessage) => Promise<unknown> }} */
	const out = {};
	const tg = telegramConfig();
	if (tg) out.telegram = telegramTransport(tg);
	const em = emailAlertConfig();
	if (em) out.email = emailTransport(em);
	return out;
}

// ─── Message rendering ───────────────────────────────────────────────────────

const SEVERITY_LABEL = { critical: 'CRITICAL', warn: 'WARN', info: 'INFO' };
const DASHBOARD_HINT = 'Open rows: select * from ops_alerts where acknowledged_at is null order by last_seen desc;';

function renderAlert(channel, { title, detail, severity, environment }) {
	if (channel === 'telegram') {
		return { subject: title, text: `🔴 three.ws [${environment}] ${title}${detail ? `\n${detail}` : ''}` };
	}
	const subject = `[three.ws ${environment}] ${SEVERITY_LABEL[severity] || 'ALERT'}: ${title}`.slice(0, 200);
	const text = `${title}\n\nSeverity: ${severity}\nEnvironment: ${environment}\n\n${detail || '(no detail)'}\n\n${DASHBOARD_HINT}\n`;
	const html =
		`<h2 style="margin:0 0 8px">${escapeHtml(title)}</h2>` +
		`<p style="margin:0 0 12px">Severity: <b>${escapeHtml(severity)}</b> &middot; Environment: ${escapeHtml(environment)}</p>` +
		`<pre style="white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:6px">${escapeHtml(detail || '(no detail)')}</pre>` +
		`<p style="color:#555">${escapeHtml(DASHBOARD_HINT)}</p>`;
	return { subject, text, html };
}

function renderThrottle(channel, environment) {
	const text = `⚠️ three.ws [${environment}] alerts throttled on ${channel}: over ${GLOBAL_LIMIT_PER_HOUR}/h. Further alerts this hour are in the ops_alerts table only.`;
	return { subject: `[three.ws ${environment}] ${channel} alerts throttled`, text };
}

// ─── The alerter ─────────────────────────────────────────────────────────────

/**
 * Build an alerter. Production uses the default instance behind sendOpsAlert;
 * tests inject recording transports, an in-memory cache and a clock.
 * @param {{
 *   transports?: Record<string, (m: AlertMessage) => unknown> | (() => Record<string, (m: AlertMessage) => unknown>),
 *   cache?: { get: (k: string) => Promise<any>, set: (k: string, v: any, ttlS?: number) => Promise<void> },
 *   persist?: (row: { sig: string, title: string, detail: string, severity: string, environment: string }) => Promise<void>,
 *   now?: () => number,
 *   environment?: string | (() => string),
 * }} [deps]
 */
export function createOpsAlerter(deps = {}) {
	const transportsOf = typeof deps.transports === 'function' ? deps.transports : () => deps.transports || {};
	const cache = deps.cache || { get: cacheGet, set: cacheSet };
	const persist = deps.persist || persistAlert;
	const now = deps.now || Date.now;
	const envOf = typeof deps.environment === 'function' ? deps.environment : () => deps.environment || process.env.VERCEL_ENV || 'development';

	async function cacheRead(key) {
		try {
			return await cache.get(key);
		} catch {
			return null; // fail open: a dead cache means more pushes, never a lost alert
		}
	}
	async function cacheWrite(key, value) {
		try {
			await cache.set(key, value, WINDOW_TTL_S);
		} catch {
			/* see cacheRead */
		}
	}

	function deliver(channel, fn, msg) {
		Promise.resolve()
			.then(() => fn(msg))
			.catch((err) => {
				console.warn(`[alerts] ${channel} delivery failed: ${err?.message || err}`);
			});
	}

	/**
	 * Claim one slot of this channel's hourly ceiling. Returns 'ok' when the
	 * alert may go, 'notice' when the ceiling was just reached (send the
	 * throttle notice instead) and 'over' after that.
	 */
	async function claimHourlySlot(channel, t) {
		const key = `alert:global:${channel}:${Math.floor(t / HOUR_MS)}`;
		const sent = Number((await cacheRead(key)) || 0);
		await cacheWrite(key, sent + 1);
		if (sent < GLOBAL_LIMIT_PER_HOUR) return 'ok';
		return sent === GLOBAL_LIMIT_PER_HOUR ? 'notice' : 'over';
	}

	/**
	 * @param {string} title
	 * @param {string} [detail]
	 * @param {{ signature?: string, severity?: 'critical'|'warn'|'info' }} [opts]
	 */
	async function send(title, detail = '', opts = {}) {
		const environment = envOf();
		const sig = signatureOf(opts.signature || `${title}\n${detail}`);
		const severity = opts.severity || severityOf(title);
		/** @type {string[]} */
		const pushed = [];
		/** @type {Record<string, string>} */
		const suppressed = {};
		/** @type {Record<string, string>} */
		const held = {};

		try {
			await persist({ sig, title, detail, severity, environment });
		} catch {
			/* an injected persist that throws is treated like a DB outage */
		}
		if (severity === 'info') return { severity, signature: sig, pushed, suppressed, held };

		let transports;
		try {
			transports = transportsOf() || {};
		} catch {
			transports = {};
		}
		const t = now();
		for (const [channel, fn] of Object.entries(transports)) {
			if (typeof fn !== 'function') continue;
			if (severity === 'warn' && channel === 'email') {
				held.email = 'digest';
				continue;
			}
			if (severity !== 'critical') {
				const dedupKey = `alert:dedup:${channel}:${sig}`;
				const until = Number((await cacheRead(dedupKey)) || 0);
				if (until > t) {
					suppressed[channel] = 'dedup';
					continue;
				}
				await cacheWrite(dedupKey, t + DEDUP_MS);
			}
			const slot = await claimHourlySlot(channel, t);
			if (slot !== 'ok') {
				suppressed[channel] = 'hourly_limit';
				if (slot === 'notice') deliver(channel, fn, { channel, kind: 'throttle', environment, ...renderThrottle(channel, environment) });
				continue;
			}
			deliver(channel, fn, { channel, kind: 'alert', severity, title, detail, environment, ...renderAlert(channel, { title, detail, severity, environment }) });
			pushed.push(channel);
		}
		return { severity, signature: sig, pushed, suppressed, held };
	}

	return { send };
}

const defaultAlerter = createOpsAlerter({ transports: configuredTransports });

/**
 * Send an ops alert. Always recorded to the dashboard (`ops_alerts`); pushed to
 * Telegram and email per the severity routing above. Safe to call on every
 * error path: fail-soft, never throws, resolves to undefined.
 * @param {string} title    one-line summary, e.g. "5xx in /api/chat"
 * @param {string} [detail] body lines (message, ref, page, stack head)
 * @param {{ signature?: string, severity?: 'critical'|'warn'|'info' }} [opts]
 *        signature overrides the dedup/identity key when the title/detail carry
 *        per-event noise (ids, refs) that would otherwise defeat coalescing;
 *        severity overrides the title-derived classification.
 */
export async function sendOpsAlert(title, detail = '', opts = {}) {
	try {
		await defaultAlerter.send(title, detail, opts);
	} catch {
		/* never throws into the caller */
	}
}

// ─── Hourly warn digest (email) ──────────────────────────────────────────────

function plural(n, word) {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function iso(v) {
	const d = v instanceof Date ? v : new Date(v);
	return Number.isFinite(d.getTime()) ? d.toISOString() : String(v ?? '');
}

function age(fromMs, nowMs) {
	const mins = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function firstLine(s) {
	return String(s || '').split('\n').find((l) => l.trim()) || '';
}

/**
 * Build the hourly email digest from warn rows. Pure.
 * @param {{ signature: string, title: string, detail?: string|null, count: number|string, first_seen: string|Date, last_seen: string|Date }[]} rows
 * @param {{ oldest: { title: string, severity: string, first_seen: string|Date } | null, environment: string, now: number }} ctx
 * @returns {null | { subject: string, text: string, html: string, groups: { title: string, count: number, signatures: number, last_seen: string, sample: string }[], occurrences: number }}
 */
export function buildWarnDigest(rows, { oldest, environment, now }) {
	if (!rows || rows.length === 0) return null;
	/** @type {Map<string, { title: string, count: number, signatures: number, lastMs: number, sample: string }>} */
	const byTitle = new Map();
	for (const r of rows) {
		const lastMs = new Date(r.last_seen).getTime();
		const g = byTitle.get(r.title) || { title: r.title, count: 0, signatures: 0, lastMs: -Infinity, sample: '' };
		g.count += Number(r.count) || 0;
		g.signatures += 1;
		if (lastMs > g.lastMs) {
			g.lastMs = lastMs;
			g.sample = firstLine(r.detail);
		}
		byTitle.set(r.title, g);
	}
	const groups = [...byTitle.values()]
		.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
		.map((g) => ({ title: g.title, count: g.count, signatures: g.signatures, last_seen: iso(g.lastMs), sample: g.sample }));
	const occurrences = groups.reduce((n, g) => n + g.count, 0);

	const subject = `three.ws ops digest [${environment}]: ${plural(groups.length, 'warn alert')}, ${plural(occurrences, 'occurrence')}`;
	const oldestLine = oldest
		? `Oldest unresolved: ${oldest.title} (${oldest.severity}), open since ${iso(oldest.first_seen)} (${age(new Date(oldest.first_seen).getTime(), now)})`
		: 'Oldest unresolved: none';
	const blocks = groups.map(
		(g) =>
			`${g.title}\n  ${plural(g.count, 'occurrence')} across ${plural(g.signatures, 'signature')}, last ${g.last_seen}` +
			(g.sample ? `\n  latest: ${g.sample}` : ''),
	);
	const text = [
		`Warn alerts recorded in the hour to ${iso(now)}.`,
		oldestLine,
		'',
		...blocks.flatMap((b) => [b, '']),
		'Critical alerts are emailed as they fire; this digest only collects warns.',
		DASHBOARD_HINT,
		'',
	].join('\n');
	const html =
		`<p>Warn alerts recorded in the hour to ${escapeHtml(iso(now))}.</p>` +
		`<p><b>${escapeHtml(oldestLine)}</b></p>` +
		`<table cellpadding="6" style="border-collapse:collapse">` +
		`<tr><th align="left">Alert</th><th align="right">Count</th><th align="right">Signatures</th><th align="left">Last seen</th></tr>` +
		groups
			.map(
				(g) =>
					`<tr style="border-top:1px solid #ddd"><td>${escapeHtml(g.title)}${g.sample ? `<br><small style="color:#555">${escapeHtml(g.sample)}</small>` : ''}</td>` +
					`<td align="right">${g.count}</td><td align="right">${g.signatures}</td><td>${escapeHtml(g.last_seen)}</td></tr>`,
			)
			.join('') +
		`</table>` +
		`<p style="color:#555">Critical alerts are emailed as they fire; this digest only collects warns.<br>${escapeHtml(DASHBOARD_HINT)}</p>`;
	return { subject, text, html, groups, occurrences };
}

/** Read the last hour's unacknowledged warn rows and the oldest open non-info row. */
async function loadDigestRows(nowMs) {
	const [{ sql }, { databaseConfigured }] = await Promise.all([import('./db.js'), import('./env.js')]);
	if (typeof databaseConfigured === 'function' && !databaseConfigured()) return { rows: [], oldest: null };
	const since = new Date(nowMs - HOUR_MS).toISOString();
	const rows = await sql`
		select signature, title, detail, count, first_seen, last_seen
		from ops_alerts
		where severity = 'warn' and acknowledged_at is null and last_seen >= ${since}
		order by last_seen desc
		limit 500
	`;
	const [oldest] = await sql`
		select title, severity, first_seen
		from ops_alerts
		where acknowledged_at is null and severity <> 'info'
		order by first_seen asc
		limit 1
	`;
	return { rows, oldest: oldest || null };
}

/**
 * Email the hourly warn digest, at most once per clock hour. A failed send does
 * not consume the hour, so the next cron tick retries.
 * @param {{
 *   transport?: ((m: AlertMessage) => Promise<unknown>) | null,
 *   load?: (nowMs: number) => Promise<{ rows: any[], oldest: any }>,
 *   cache?: { get: (k: string) => Promise<any>, set: (k: string, v: any, ttlS?: number) => Promise<void> },
 *   now?: () => number,
 *   environment?: string,
 * }} [deps]
 */
export async function sendWarnDigest(deps = {}) {
	const transport = 'transport' in deps ? deps.transport : configuredTransports().email || null;
	const load = deps.load || loadDigestRows;
	const cache = deps.cache || { get: cacheGet, set: cacheSet };
	const t = (deps.now || Date.now)();
	const environment = deps.environment || process.env.VERCEL_ENV || 'development';
	if (!transport) return { sent: false, reason: 'email_unconfigured' };

	const key = `alert:digest:email:${Math.floor(t / HOUR_MS)}`;
	if (await cache.get(key)) return { sent: false, reason: 'already_sent' };

	const { rows, oldest } = await load(t);
	const digest = buildWarnDigest(rows, { oldest, environment, now: t });
	if (!digest) return { sent: false, reason: 'no_warn_alerts' };
	try {
		await transport({ channel: 'email', kind: 'digest', environment, subject: digest.subject, text: digest.text, html: digest.html });
	} catch (err) {
		console.warn(`[alerts] digest email failed: ${err?.message || err}`);
		return { sent: false, reason: 'send_failed', error: String(err?.message || err) };
	}
	await cache.set(key, 1, WINDOW_TTL_S);
	return { sent: true, alerts: digest.groups.length, occurrences: digest.occurrences };
}
