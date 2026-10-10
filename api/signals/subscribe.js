/**
 * Signal subscriptions: the follower's control surface.
 *
 *   GET    /api/signals/subscribe                       list the caller's subscriptions
 *   POST   /api/signals/subscribe                       create / update a subscription
 *   POST   /api/signals/subscribe { id, status }        pause / resume / stop
 *   POST   /api/signals/subscribe { id, killed:true }   INSTANT kill (no further pay/trade)
 *   POST   /api/signals/subscribe { id, action:'sync' } deliver pending now (owner-triggered)
 *   DELETE /api/signals/subscribe?id=                   stop (soft, keeps delivery history)
 *
 * A subscriber agent's own custodial wallet pays the x402 USDC and signs the
 * mirror, so a subscription is owner-authenticated and scoped to an agent the
 * caller owns. `mode:'simulate'` mirrors WITHOUT paying or trading (trust-building);
 * `live` does both within the agent's spend policy. `killed` halts everything the
 * instant it is set: the kill is honoured before any payment or trade fires.
 */

import { cors, json, error, method, wrap, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { sql } from '../_lib/db.js';
import { deliverSubscription } from '../_lib/signal-engine.js';
import {
	SignalSubscriptionError, isLiveRunning, listSignalSubscriptions, loadSignalSubscription as loadSub,
	loadSubscribableFeed, existingSubscription, subscriptionKnobs, upsertSignalSubscription,
	setSignalSubscriptionStatus, setSignalSubscriptionKilled,
} from '../_lib/signal-subscription-control.js';
import { requireUser, loadOwnedAgent, normNetwork, parseRowId } from './_common.js';

// A live subscription pays x402 USDC and mirrors trades from the subscriber
// agent's custodial wallet. Turning one on (or delivering it now) needs the
// signed real-funds agreement; simulate mode, pause, stop and kill never do.
// The store itself (api/_lib/signal-subscription-control.js) is shared with the
// threews-agent MCP tool sniper_subscribe.

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const auth = await requireUser(req, res);
	if (!auth) return;
	const { userId } = auth;

	if (req.method === 'GET') {
		return json(res, 200, { subscriptions: await listSignalSubscriptions(userId) });
	}

	if (auth.viaSession && !(await requireCsrf(req, res, userId))) return;

	if (req.method === 'DELETE') {
		const id = parseRowId(new URL(req.url, 'http://x').searchParams.get('id'));
		if (!id) return error(res, 400, 'invalid_id', 'numeric subscription id required');
		const [row] = await sql`
			update signal_subscriptions set status = 'stopped', updated_at = now()
			where id = ${id} and owner_user_id = ${userId} returning id
		`;
		if (!row) return error(res, 404, 'not_found', 'subscription not found');
		return json(res, 200, { ok: true, id: Number(row.id), status: 'stopped' });
	}

	const body = await readJson(req).catch(() => null);
	if (!body) return error(res, 400, 'bad_request', 'JSON body required');

	// ── Mutations on an existing subscription (status / kill / sync) ────────────
	if (body.id && !body.feed_id) {
		const subId = parseRowId(body.id);
		if (!subId) return error(res, 400, 'invalid_id', 'numeric subscription id required');
		// Instant kill: the halt path, takes precedence.
		if (body.killed != null) {
			const killed = body.killed === true || body.killed === 'true';
			if (!killed) {
				const cur = await loadSub(subId, userId);
				if (cur?.mode === 'live' && !isLiveRunning(cur) && !(await requireRealFundsAgreement(req, res, { userId, network: normNetwork(cur.network), context: 'signal-subscribe' }))) return;
			}
			const row = await setSignalSubscriptionKilled({ userId, subId, killed });
			if (!row) return error(res, 404, 'not_found', 'subscription not found');
			return json(res, 200, { subscription: row });
		}
		if (body.action === 'sync') {
			const row = await loadSub(subId, userId);
			if (!row) return error(res, 404, 'not_found', 'subscription not found');
			if (row.mode === 'live' && !(await requireRealFundsAgreement(req, res, { userId, network: normNetwork(row.network), context: 'signal-subscribe' }))) return;
			const result = await deliverSubscription(row, { maxEvents: 10 });
			return json(res, 200, { ok: true, ...result });
		}
		if (body.status) {
			const status = ['active', 'paused', 'stopped'].includes(body.status) ? body.status : 'paused';
			if (status === 'active') {
				const cur = await loadSub(subId, userId);
				if (cur?.mode === 'live' && !isLiveRunning(cur) && !(await requireRealFundsAgreement(req, res, { userId, network: normNetwork(cur.network), context: 'signal-subscribe' }))) return;
			}
			// Resuming clears any kill; pausing/stopping leaves the kill flag untouched.
			const row = await setSignalSubscriptionStatus({ userId, subId, status });
			if (!row) return error(res, 404, 'not_found', 'subscription not found');
			return json(res, 200, { subscription: row });
		}
		return error(res, 400, 'no_op', 'nothing to update');
	}

	// ── Create / update a subscription ──────────────────────────────────────────
	if (!body.feed_id) return error(res, 400, 'invalid_feed', 'feed_id required');
	const feedId = parseRowId(body.feed_id);
	if (!feedId) return error(res, 400, 'invalid_feed', 'numeric feed_id required');
	const owned = await loadOwnedAgent(req, res, userId, body.agent_id);
	if (owned.error) return;

	let feed;
	try {
		feed = await loadSubscribableFeed(feedId, body.agent_id);
	} catch (err) {
		if (err instanceof SignalSubscriptionError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	const knobs = subscriptionKnobs(body);
	if (knobs.mode === 'live') {
		const cur = await existingSubscription(body.agent_id, feed.id);
		if (!isLiveRunning(cur) && !(await requireRealFundsAgreement(req, res, { userId, network: feed.network, context: 'signal-subscribe' }))) return;
	}

	const subscription = await upsertSignalSubscription({ userId, agentId: body.agent_id, feed, knobs });
	return json(res, 200, { subscription });
});
