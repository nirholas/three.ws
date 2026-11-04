// Microsoft Marketplace SaaS offer: landing page API, buyer sign-in and the
// connection webhook. Dispatches on ?action= (routes in vercel.json):
//
//   POST /api/microsoft-marketplace/resolve        { token } from the landing page URL.
//        Resolves the purchase with Microsoft, stores the subscription, and pins
//        it to this browser in a signed cookie so the sign-in round trip can
//        only activate the purchase this browser actually landed with.
//   GET  /api/microsoft-marketplace/sso/start      Microsoft Entra sign-in (multitenant,
//        code + PKCE). With a pinned purchase it activates; without one it is a
//        plain "Sign in with Microsoft" for an already linked identity.
//   GET  /api/microsoft-marketplace/sso/callback   Verifies the Entra ID token, finds
//        or creates the three.ws account, checks the tenant matches the
//        subscription, links it, activates it with Microsoft and grants the plan.
//   GET  /api/microsoft-marketplace/subscriptions  The signed-in user's Microsoft subscriptions.
//   GET  /api/microsoft-marketplace/status         Whether this deployment can take purchases.
//   POST /api/microsoft-marketplace/webhook        Microsoft's connection webhook. Verifies the
//        Entra bearer token, applies each operation once (by operation id),
//        re-reads the subscription from Microsoft rather than trusting the
//        body, and acknowledges ChangePlan / ChangeQuantity / Reinstate.
//
// Every browser-facing failure lands on /microsoft/activate?error=<code>, which
// the page explains; the API never leaves raw JSON in the address bar.

import { sql } from '../_lib/db.js';
import { getSessionUser, createSession, sessionCookie } from '../_lib/auth.js';
import { cors, method, wrap, error, json, redirect, readJson, rateLimited, wantsHtmlNavigation } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { logAudit } from '../_lib/audit.js';
import { seedDefaultAgent } from '../_lib/seed-default-agent.js';
import { safeNext } from '../../src/safe-next.js';
import {
	findUserByIdentity, touchIdentity, linkIdentity, IdentityError,
	signIdentityPayload, unsignIdentityPayload, readCookie, cookie, clearCookie,
} from '../_lib/identities.js';
import {
	MarketplaceError, LANDING_PATH, ACK_ACTIONS,
	publisherConfig, ssoConfig, missingConfig,
	resolvePurchaseToken, getSubscription, activateSubscription, acknowledgeOperation,
	verifyWebhookToken, buildSsoAuthorize, exchangeSsoCode, verifySsoIdToken,
	identityMatchesSubscription, upsertSubscription, findSubscription, recomputeUserPlan,
	publicSubscription, planForMicrosoftPlan,
} from '../_lib/microsoft-marketplace.js';

const PROVIDER = 'microsoft';
const PURCHASE_COOKIE = '__Host-mspurchase';
const PURCHASE_TTL_SEC = 3600;
const FLOW_COOKIE = '__Host-msflow';
const FLOW_TTL_SEC = 600;

function landing(params) {
	const q = new URLSearchParams(params);
	return `${LANDING_PATH}?${q.toString()}`;
}

function loginError(code, next) {
	const q = new URLSearchParams({ error: code });
	if (next) q.set('next', next);
	return `/login?${q.toString()}`;
}

async function signIn(req, res, userId, { isNew = false, extraCookies = [] } = {}) {
	const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip: clientIp(req) });
	res.setHeader('set-cookie', [sessionCookie(token), clearCookie(FLOW_COOKIE), ...extraCookies]);
	logAudit({ userId, action: isNew ? 'register:microsoft' : 'login:microsoft', req });
	if (isNew) queueMicrotask(() => seedDefaultAgent(userId));
}

// ── status ──────────────────────────────────────────────────────────────────

async function handleStatus(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const missing = missingConfig();
	return json(res, 200, { ready: missing.length === 0, sso: Boolean(ssoConfig()), missing });
}

// ── resolve ─────────────────────────────────────────────────────────────────

async function handleResolve(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	if (!publisherConfig()) return error(res, 501, 'not_configured', 'Microsoft Marketplace purchases are not enabled on this deployment yet');
	const body = await readJson(req);
	const token = typeof body?.token === 'string' ? body.token.trim() : '';
	if (!token) return error(res, 400, 'invalid_token', 'the purchase token is missing; open this page from the Microsoft Marketplace "Configure account" button');

	const resolved = await resolvePurchaseToken(token);
	// The resolve body carries a subscription snapshot, but the GET is the
	// authoritative copy (and includes term and status), so store that one.
	const sub = await getSubscription(resolved.id);
	const row = await upsertSubscription(sub);
	const user = await getSessionUser(req, res);
	const pinned = await signIdentityPayload({ s: row.id, e: Math.floor(Date.now() / 1000) + PURCHASE_TTL_SEC });
	res.setHeader('set-cookie', cookie(PURCHASE_COOKIE, pinned, PURCHASE_TTL_SEC));
	return json(res, 200, {
		subscription: publicSubscription(row),
		plan_known: Boolean(planForMicrosoftPlan(row.plan_id)),
		owned_by_you: Boolean(user && row.user_id === user.id),
		owned_by_other: Boolean(row.user_id && (!user || row.user_id !== user.id)),
		signed_in: user ? { display_name: user.display_name, email: user.email } : null,
		sso_ready: Boolean(ssoConfig()),
		sign_in_url: '/api/microsoft-marketplace/sso/start',
	});
}

// ── sso/start ───────────────────────────────────────────────────────────────

async function handleSsoStart(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const next = safeNext(url.searchParams.get('next'), '/dashboard');
	const pinned = await unsignIdentityPayload(readCookie(req, PURCHASE_COOKIE));
	const fail = (code) => (pinned || !wantsHtmlNavigation(req) ? redirect(res, landing({ error: code })) : redirect(res, loginError(`microsoft_${code}`, next)));
	if (!ssoConfig()) return fail('sso_unavailable');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return fail('rate_limited');

	let loginHint = null;
	if (pinned) {
		const row = await findSubscription(pinned.s);
		if (!row) return fail('purchase_expired');
		loginHint = row.beneficiary_email || row.purchaser_email || null;
	}
	const auth = await buildSsoAuthorize({ loginHint });
	const flow = await signIdentityPayload({
		s: auth.state, n: auth.nonce, v: auth.verifier,
		p: pinned ? pinned.s : null, x: next,
		e: Math.floor(Date.now() / 1000) + FLOW_TTL_SEC,
	});
	res.setHeader('set-cookie', cookie(FLOW_COOKIE, flow, FLOW_TTL_SEC));
	return redirect(res, auth.url);
}

// ── sso/callback ────────────────────────────────────────────────────────────

function entraDeniedCode(entraError) {
	if (entraError === 'access_denied' || entraError === 'interaction_required' || entraError === 'login_required') return 'sso_cancelled';
	if (entraError === 'consent_required') return 'admin_consent_required';
	return 'sso_failed';
}

async function handleSsoCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const flow = await unsignIdentityPayload(readCookie(req, FLOW_COOKIE));
	const state = url.searchParams.get('state');
	const purchaseId = flow?.p || null;
	const back = (code) => {
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		return redirect(res, purchaseId ? landing({ error: code }) : loginError(`microsoft_${code}`, flow?.x));
	};
	if (!flow || typeof state !== 'string' || flow.s !== state) return back('sso_expired');
	const entraError = url.searchParams.get('error');
	if (entraError) return back(entraDeniedCode(entraError));
	const code = url.searchParams.get('code');
	if (!code) return back('sso_failed');

	let claims;
	try {
		const idToken = await exchangeSsoCode({ code, verifier: flow.v });
		claims = await verifySsoIdToken(idToken, { nonce: flow.n });
	} catch (err) {
		if (err instanceof MarketplaceError) return back(err.code);
		throw err;
	}

	if (!purchaseId) return completeLogin(req, res, flow, claims, back);
	return completePurchase(req, res, flow, claims, back);
}

// Sign in with Microsoft without a purchase in hand: only an identity that a
// purchase already linked can sign in, so this never mints stray accounts.
async function completeLogin(req, res, flow, claims, back) {
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (!linked) return back('not_linked');
	if (linked.deleted_at) return back('account_deleted');
	await touchIdentity(linked.identity_id);
	await signIn(req, res, linked.id);
	return redirect(res, safeNext(flow.x, '/dashboard'));
}

// The account a purchase lands on: the identity's own account when it is
// already linked, else the account signed in on this browser, else a new
// passwordless account. An existing account found only by email is never
// taken over; its owner signs in first and comes back.
async function accountForPurchase(req, res, claims) {
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (linked) {
		if (linked.deleted_at) throw new MarketplaceError('account_deleted', 'that account was deleted', 403);
		await touchIdentity(linked.identity_id);
		return { userId: linked.id, isNew: false };
	}
	const session = await getSessionUser(req, res);
	if (session) {
		try {
			await linkIdentity({ userId: session.id, provider: PROVIDER, claims });
		} catch (err) {
			if (err instanceof IdentityError) throw new MarketplaceError(err.code, err.message, err.status);
			throw err;
		}
		return { userId: session.id, isNew: false };
	}
	if (!claims.email) throw new MarketplaceError('no_email', 'your Microsoft account has no email address three.ws can use', 400);
	const [existing] = await sql`select id from users where email = ${claims.email} limit 1`;
	if (existing) throw new MarketplaceError('existing_account', 'an account with this email already exists; sign in to it first', 409);
	const displayName = claims.display_name || claims.email.split('@')[0];
	const [created] = await sql`
		insert into users (email, display_name, email_verified)
		values (${claims.email}, ${displayName}, false)
		returning id
	`;
	await linkIdentity({ userId: created.id, provider: PROVIDER, claims });
	return { userId: created.id, isNew: true };
}

async function completePurchase(req, res, flow, claims, back) {
	const row = await findSubscription(flow.p);
	if (!row) return back('purchase_expired');
	if (!identityMatchesSubscription(claims, row)) return back('tenant_mismatch');

	let account;
	try {
		account = await accountForPurchase(req, res, claims);
	} catch (err) {
		if (err instanceof MarketplaceError) {
			if (err.code === 'existing_account') {
				res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
				return redirect(res, loginError('microsoft_existing_account', landing({ resume: '1' })));
			}
			return back(err.code);
		}
		throw err;
	}

	// Claim the subscription for this user. A row already linked to someone
	// else is never moved.
	const [claimed] = await sql`
		update microsoft_saas_subscriptions set user_id = ${account.userId}, updated_at = now()
		where id = ${row.id} and (user_id is null or user_id = ${account.userId})
		returning id
	`;
	if (!claimed) return back('already_linked');

	if (row.saas_status === 'PendingFulfillmentStart') {
		if (!planForMicrosoftPlan(row.plan_id)) return back('unknown_plan');
		try {
			await activateSubscription(row.id, { planId: row.plan_id, quantity: row.quantity });
		} catch (err) {
			if (err instanceof MarketplaceError) return back('activation_failed');
			throw err;
		}
	}
	const fresh = await upsertSubscription(await getSubscription(row.id));
	await sql`update microsoft_saas_subscriptions set activated_at = coalesce(activated_at, now()) where id = ${row.id} and saas_status = 'Subscribed'`;
	const plan = await recomputeUserPlan(account.userId);
	logAudit({ userId: account.userId, action: 'microsoft_marketplace:activate', resourceId: row.id, meta: { plan_id: fresh.plan_id, plan, status: fresh.saas_status }, req });
	await signIn(req, res, account.userId, { isNew: account.isNew, extraCookies: [clearCookie(PURCHASE_COOKIE)] });
	return redirect(res, landing({ subscription: row.id }));
}

// ── subscriptions ───────────────────────────────────────────────────────────

async function handleSubscriptions(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to see your Microsoft subscriptions');
	const rows = await sql`
		select * from microsoft_saas_subscriptions where user_id = ${user.id} order by created_at desc limit 50
	`;
	const [{ plan } = {}] = await sql`select plan from users where id = ${user.id} limit 1`;
	return json(res, 200, { plan: plan || 'free', subscriptions: rows.map(publicSubscription) });
}

// ── webhook ─────────────────────────────────────────────────────────────────

async function handleWebhook(req, res) {
	if (!method(req, res, ['POST'])) return;
	try {
		await verifyWebhookToken(req.headers.authorization);
	} catch (err) {
		if (err instanceof MarketplaceError) return error(res, err.status, err.code, err.message);
		throw err;
	}
	const body = await readJson(req);
	const operationId = typeof body?.id === 'string' ? body.id : null;
	const subscriptionId = typeof body?.subscriptionId === 'string' ? body.subscriptionId : null;
	const action = typeof body?.action === 'string' ? body.action : null;
	if (!operationId || !subscriptionId || !action) return error(res, 400, 'validation_error', 'id, subscriptionId and action are required');

	const [fresh] = await sql`
		insert into microsoft_saas_operations (id, subscription_id, action, plan_id, quantity, status, raw)
		values (${operationId}, ${subscriptionId}, ${action}, ${body.planId ?? null},
		        ${Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : null}, ${body.status ?? null},
		        ${JSON.stringify(body)}::jsonb)
		on conflict (id) do nothing
		returning id
	`;
	if (!fresh) {
		const [prior] = await sql`select outcome from microsoft_saas_operations where id = ${operationId} limit 1`;
		// A redelivery of an operation we already finished is answered without
		// re-applying it. One that failed mid-way is retried below.
		if (prior && prior.outcome !== 'received' && prior.outcome !== 'failed') return json(res, 200, { ok: true, duplicate: true });
	}

	try {
		const outcome = await applyOperation({ operationId, subscriptionId, action, body });
		await sql`update microsoft_saas_operations set outcome = ${outcome}, error = null, processed_at = now() where id = ${operationId}`;
		return json(res, 200, { ok: true, outcome });
	} catch (err) {
		await sql`update microsoft_saas_operations set outcome = 'failed', error = ${String(err?.message || err).slice(0, 500)}, processed_at = now() where id = ${operationId}`;
		// A non-2xx makes Microsoft redeliver, which is what a transient failure needs.
		if (err instanceof MarketplaceError) return error(res, 502, err.code, err.message);
		throw err;
	}
}

async function applyOperation({ operationId, subscriptionId, action, body }) {
	if (ACK_ACTIONS.includes(action) && body.status === 'InProgress') {
		// Microsoft waits for our verdict. Accept a plan or quantity we can
		// serve; refuse an unknown plan so the buyer is not billed for nothing.
		const targetPlan = action === 'ChangePlan' ? body.planId : null;
		const ok = targetPlan == null || Boolean(planForMicrosoftPlan(targetPlan));
		await acknowledgeOperation(subscriptionId, operationId, ok ? 'Success' : 'Failure');
		const row = await upsertSubscription(await getSubscription(subscriptionId));
		if (row.user_id) await recomputeUserPlan(row.user_id);
		return ok ? 'acknowledged_success' : 'acknowledged_failure';
	}
	// Renew, Suspend, Unsubscribe, and the Succeeded follow-ups: Microsoft has
	// already applied it. Re-read the authoritative state and mirror it.
	const row = await upsertSubscription(await getSubscription(subscriptionId));
	if (row.user_id) {
		const plan = await recomputeUserPlan(row.user_id);
		logAudit({ userId: row.user_id, action: `microsoft_marketplace:${action.toLowerCase()}`, resourceId: subscriptionId, meta: { status: row.saas_status, plan } });
	}
	return 'applied';
}

// ── dispatch ────────────────────────────────────────────────────────────────

const ACTIONS = {
	status: handleStatus,
	resolve: handleResolve,
	'sso-start': handleSsoStart,
	'sso-callback': handleSsoCallback,
	subscriptions: handleSubscriptions,
	webhook: handleWebhook,
};

export default wrap(async (req, res) => {
	const action = new URL(req.url, 'http://x').searchParams.get('action');
	const handler = ACTIONS[action];
	if (!handler) return error(res, 404, 'not_found', 'unknown Microsoft Marketplace action');
	try {
		return await handler(req, res);
	} catch (err) {
		if (err instanceof MarketplaceError) {
			if (wantsHtmlNavigation(req)) return redirect(res, landing({ error: err.code }));
			return error(res, err.status, err.code, err.message);
		}
		throw err;
	}
});
