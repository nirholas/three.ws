// @ts-check
// GET/POST /api/x/webhook: the Account Activity API webhook (x-grok 41).
//
// GET answers the Challenge-Response Check (CRC) X sends when the webhook is
// registered and periodically afterward to re-verify it is still live: X
// sends ?crc_token=... and expects { response_token: "sha256=" + base64(
// HMAC-SHA256(crc_token, consumer_secret)) } back. This has no gate: X must
// get a valid CRC response before it will ever deliver a POST, and the CRC
// reveals nothing an attacker could use (it only proves we hold the same
// consumer secret X already gave us).
//
// POST delivers real-time events once a subscription exists. Every delivery
// is signed over the raw body with the app's OAuth 1.0a consumer secret
// (X_API_SECRET, the same credential api/_lib/x-mentions.js's oauth1Transport
// already uses to read mentions): header x-twitter-webhooks-signature,
// "sha256=" + base64(HMAC-SHA256(rawBody, consumer_secret)). Gated behind
// X_WEBHOOK_ENABLED since the Account Activity API needs Enterprise or
// Pay-Per-Use access (order 926's owner message); until that is on, POST
// acks 200 without reading the body, which is also the correct response to
// X's own delivery retries while registration is incomplete.
//
// This order scopes event handling to the company account only: X's own
// tier gate caps Pay-Per-Use at 3 subscriptions, and reverse-resolving an
// arbitrary for_user_id to one of our agents' connected X accounts has no
// lookup on this branch (resolveXConnection needs the agentId already known,
// not just the X user id). An event for any other for_user_id is acknowledged
// and dropped; extending to agent accounts needs that reverse lookup first.
//
// Recording is the one step this handler takes: parseMentionIntent (pure)
// then recordMention, the exact same dedupe-safe insert the polling cron
// uses (x-mention-store.js, tweet_id primary key), so whichever path sees a
// tweet first wins and the other is a silent no-op. An intent of 'ignore'
// (not addressed to us, our own post, a retweet) is immediately marked
// 'skip', mirroring the cron's own early exit in api/_lib/x-mention-poll.js
// (main-branch only as of this order). Every other intent is left with
// decision = null, exactly as x-mention-store.js's recordMention already
// documents ("decision is null until decided"): deciding and replying is the
// cron's job, which keeps running as backfill regardless of this webhook.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cors, error, json, method, readBody, wrap } from '../_lib/http.js';
import { companyMentionsConfigured, companyUserId, COMPANY_HANDLE_DEFAULT } from '../_lib/x-mentions.js';
import { normalizeActivityEvent } from '../_lib/x-webhook-events.js';
import { parseMentionIntent } from '../_lib/x-mention-intents.js';
import { recordMention, updateDecision } from '../_lib/x-mention-store.js';

const BODY_LIMIT = 2_000_000;

function enabled(env = process.env) {
	return env.X_WEBHOOK_ENABLED === '1';
}

function sign(value, secret) {
	return createHmac('sha256', secret).update(value).digest('base64');
}

/** Constant-time string compare: hash both sides first so unequal lengths never short-circuit the comparison. */
function safeEqualStrings(a, b) {
	const ha = createHash('sha256').update(String(a)).digest();
	const hb = createHash('sha256').update(String(b)).digest();
	return timingSafeEqual(ha, hb);
}

function companyAccount(env) {
	const handle = env.X_COMPANY_HANDLE || COMPANY_HANDLE_DEFAULT;
	return { kind: 'company', ref: handle, userId: companyUserId(env), handle };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const secret = process.env.X_API_SECRET;

	if (req.method === 'GET') {
		const crcToken = req.query?.crc_token;
		if (typeof crcToken !== 'string' || !crcToken) return error(res, 400, 'bad_request', 'crc_token required');
		if (!secret) return error(res, 503, 'not_configured', 'X_API_SECRET not set');
		return json(res, 200, { response_token: `sha256=${sign(crcToken, secret)}` });
	}

	// POST. Ack quietly rather than 404/401 while disabled or unconfigured: a
	// 4xx on every retry is how X eventually suspends a webhook as unhealthy,
	// and "we chose not to read this yet" is not the same failure as "this URL
	// is broken".
	if (!enabled() || !secret || !companyMentionsConfigured(process.env)) {
		return json(res, 200, { ok: true, disabled: true });
	}

	const sigHeader = req.headers['x-twitter-webhooks-signature'];
	if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
		return error(res, 401, 'unauthorized', 'missing signature');
	}
	const raw = await readBody(req, BODY_LIMIT).catch((e) => {
		throw Object.assign(new Error(e?.message || 'invalid body'), { status: e?.status || 400 });
	});
	const expected = `sha256=${sign(raw, secret)}`;
	if (!safeEqualStrings(sigHeader, expected)) {
		return error(res, 401, 'unauthorized', 'bad signature');
	}

	let payload;
	try {
		payload = JSON.parse(raw.toString('utf8'));
	} catch {
		return error(res, 400, 'bad_request', 'invalid JSON');
	}

	const account = companyAccount(process.env);
	const forUserId = payload?.for_user_id ? String(payload.for_user_id) : null;
	const events = Array.isArray(payload?.tweet_create_events) ? payload.tweet_create_events : [];

	let inserted = 0;
	let skipped = 0;
	if (forUserId && account.userId && forUserId === String(account.userId)) {
		for (const tweet of events) {
			const mention = normalizeActivityEvent(tweet, account);
			if (!mention) continue;
			const parsed = parseMentionIntent(mention, account);
			const { inserted: wasInserted } = await recordMention({ mention, parsed, dryRun: true });
			if (!wasInserted) continue;
			inserted += 1;
			if (parsed.intent === 'ignore') {
				await updateDecision(mention.id, { decision: 'skip', reason: parsed.reason });
				skipped += 1;
			}
		}
	}

	return json(res, 200, { ok: true, received: events.length, inserted, skipped });
});
