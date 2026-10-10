// /api/pump/launch-intents: funded pump.fun launch intents.
//
// The flow, in the order a client walks it:
//
//   POST   /api/pump/launch-intents                 create an intent → quote + preflight token
//   GET    /api/pump/launch-intents                 list your intents (?agent=, ?limit=)
//   GET    /api/pump/launch-intents/:id             status with stages (quote, paid, submitted, confirmed, indexed)
//   POST   /api/pump/launch-intents/:id/dry-run     simulate the create against the lane, no signature
//   POST   /api/pump/launch-intents/:id/pay         prove the funding transfer (signature + preflight token); replays
//   POST   /api/pump/launch-intents/:id/confirm     ask for the owner's yes; the approval executor signs the launch
//
// Who may call what is the whole point of this file. Creating, listing, polling
// and dry-running take a session OR a bearer token, so a CLI or an agent can
// create the intent and watch it. `pay` and `confirm` are the two steps that
// end in a signature (the funding transfer from the user's wallet, and the
// create transaction the agent wallet signs once the owner approves), and they
// take ONLY a same-site session with a CSRF token. A bearer token on either is
// answered 403 `session_required`, no matter its scope: no API key can fund or
// confirm a launch.

import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { getRequestUser, getSessionUser, isSameSiteOrigin } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	FundedLaunchError,
	createFundedLaunchIntent,
	listFundedLaunchIntents,
	getFundedLaunchIntent,
	recordFundingProof,
	requestLaunchConfirmation,
	dryRunFundedLaunch,
} from '../_lib/pump-funded-launch.js';

const SIGNING_ACTIONS = new Set(['pay', 'confirm']);
const ACTIONS = new Set(['pay', 'confirm', 'dry-run']);

function sendFundedLaunchError(res, err) {
	if (err instanceof FundedLaunchError) return error(res, err.status, err.code, err.message, err.extra || {});
	throw err;
}

/**
 * The caller for a step that ends in a signature: a signed-in browser on this
 * site, with a valid CSRF token. Bearer tokens are refused here on purpose.
 */
async function requireSigningSession(req, res) {
	const session = await getSessionUser(req, res);
	if (!session) {
		const viaBearer = await getRequestUser(req, res);
		if (viaBearer?.source === 'bearer') {
			error(res, 403, 'session_required', 'funding and confirming a launch happen in the browser; an API key can create the intent and poll it, but cannot sign it', {
				page: `/launch/intents/${encodeURIComponent(String(req.query?.id || ''))}`,
			});
			return null;
		}
		error(res, 401, 'unauthorized', 'sign in required');
		return null;
	}
	if (!isSameSiteOrigin(req)) {
		error(res, 403, 'forbidden', 'cross-site request blocked');
		return null;
	}
	if (!(await requireCsrf(req, res, session.id))) return null;
	return session;
}

async function requireCaller(req, res) {
	const user = await getRequestUser(req, res);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in or pass a bearer token');
		return null;
	}
	return user;
}

export default wrap(async (req, res) => {
	cors(req, res, { methods: 'GET,POST,OPTIONS' });
	if (req.method === 'OPTIONS') return res.end();
	if (!method(req, res, ['GET', 'POST'])) return;

	const id = req.query?.id ? String(req.query.id) : null;
	const action = req.query?.action ? String(req.query.action) : null;
	if (action && !ACTIONS.has(action)) return error(res, 404, 'not_found', `no action "${action}"; use pay, confirm or dry-run`);
	if (action && !id) return error(res, 400, 'validation_error', 'an intent id is required');

	try {
		if (action && SIGNING_ACTIONS.has(action)) {
			if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST required');
			const session = await requireSigningSession(req, res);
			if (!session) return;
			const rl = await limits.authIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const body = (await readJson(req)) || {};
			if (action === 'pay') {
				const { intent, result, replayed } = await recordFundingProof({
					userId: session.id,
					intentId: id,
					signature: body.signature,
					preflightToken: body.preflight_token ?? body.preflightToken,
				});
				return json(res, replayed ? 200 : 201, { ok: true, replayed, payment: result, intent });
			}
			const { intent, approval, created } = await requestLaunchConfirmation({ userId: session.id, intentId: id });
			return json(res, created ? 201 : 200, { ok: true, created, approval, intent });
		}

		const user = await requireCaller(req, res);
		if (!user) return;

		if (action === 'dry-run') {
			if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST required');
			const rl = await limits.authIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const { intent, dry_run } = await dryRunFundedLaunch({ userId: user.id, intentId: id });
			return json(res, 200, { ok: true, dry_run, intent });
		}

		if (id) {
			if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET required');
			const rl = await limits.authedReadIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const intent = await getFundedLaunchIntent(user.id, id, { withBalance: req.query?.balance !== '0' });
			return json(res, 200, { ok: true, intent }, { 'cache-control': 'private, no-store' });
		}

		if (req.method === 'GET') {
			const rl = await limits.authedReadIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30));
			const intents = await listFundedLaunchIntents(user.id, { agentId: req.query?.agent || null, limit });
			return json(res, 200, { ok: true, intents, count: intents.length }, { 'cache-control': 'private, no-store' });
		}

		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const body = (await readJson(req)) || {};
		const agentId = body.agent_id ?? body.agentId ?? body.agent;
		if (!agentId) return error(res, 400, 'validation_error', 'agent_id is required: the agent whose wallet funds and signs the launch');
		const { intent, preflight_token } = await createFundedLaunchIntent({ userId: user.id, agentId: String(agentId), input: body });
		return json(res, 201, {
			ok: true,
			intent,
			preflight_token,
			next: {
				fund: `Send ${describeTotals(intent)} to ${intent.funding?.address} before ${intent.quote?.expires_at}, then POST ${intent.links.api}/pay from the signed-in browser with the signature and this preflight_token.`,
				page: intent.links.page,
				status: intent.links.api,
				signing: 'The funding transfer and the final confirmation are signed in the browser or the approval inbox only. This token does not let an API key sign anything.',
			},
		});
	} catch (err) {
		return sendFundedLaunchError(res, err);
	}
});

function describeTotals(intent) {
	const totals = intent?.quote?.totals || {};
	const parts = Object.entries(totals).map(([asset, t]) => `${t.amount} ${asset}`);
	return parts.length ? parts.join(' + ') : 'the quoted total';
}
