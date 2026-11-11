// Sign in with Microsoft for everyone: work, school and personal accounts,
// through the multitenant Entra app on the `common` authority (authorization
// code + PKCE + nonce, api/_lib/entra-oidc.js). Dispatches on
// ?action=start|callback|confirm|status|unlink.
//
// Env: MS_ENTRA_SSO_CLIENT_ID, MS_ENTRA_SSO_CLIENT_SECRET (the same app the
// Microsoft Marketplace landing page uses). Its redirect URIs must include
// `${APP_ORIGIN}/api/auth/microsoft/callback`. Unset, /start sends a browser
// back to /login?error=microsoft_unavailable and api/config.js keeps the button
// hidden.
//
// Four intents share one round trip:
//
//   login         no session. A linked identity (including one a Marketplace
//                 purchase linked) signs straight in. Otherwise the same rule
//                 Google follows (api/_lib/identities.js decideIdentityLogin):
//                 a Microsoft-verified email that matches a verified account
//                 gets the confirm page; no match creates an account. An
//                 address Microsoft does not vouch for never reaches an existing
//                 account, and the new account is born with a placeholder email
//                 instead of the unproven one.
//   link          session. Links the Microsoft account to the signed-in user.
//   reauth        session. Fresh credential entry; grants the five-minute proof
//                 that unlinking honors.
//   tenant_claim  session, team owner. Fresh sign-in by a directory admin of the
//                 organisation (Global, Privileged Role, Application or Cloud
//                 Application Administrator); claims that Entra tenant for the
//                 team (api/_lib/team-enterprise.js).
//
// After a Microsoft login, a tenant some team claimed either adds the person to
// that team (join_mode auto), offers it (/teams/:id?join=1), or binds the row
// the team's SCIM client provisioned ahead of the first sign-in. Sessions
// created here carry the tenant id, so SCIM deprovisioning revokes them.
//
// A tampered or replayed state finds no matching flow cookie and lands on
// /login?error=microsoft_expired; nothing is exchanged.

import { sql } from '../../_lib/db.js';
import { getSessionUser, createSession, sessionCookie, verifyPassword } from '../../_lib/auth.js';
import { requireCsrf } from '../../_lib/csrf.js';
import {
	cors, method, wrap, error, json, redirect, readForm, readJson, rateLimited, wantsHtmlNavigation,
} from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { logAudit } from '../../_lib/audit.js';
import { seedDefaultAgent } from '../../_lib/seed-default-agent.js';
import { safeNext } from '../../../src/safe-next.js';
import { recordConversion } from '../../_lib/campaign-ledger.js';
import { randomToken, constantTimeEquals } from '../../_lib/crypto.js';
import { renderLinkConfirm } from '../../_lib/identity-confirm-page.js';
import {
	findUserByIdentity, touchIdentity, linkIdentity, decideIdentityLogin, listSignInMethods, reauthCookie, readReauth,
	unlinkIdentity, IdentityError, REAUTH_TTL_SEC, cookie, clearCookie, readCookie, signIdentityPayload, unsignIdentityPayload,
} from '../../_lib/identities.js';
import {
	entraConfigured, buildAuthorize, exchangeCode, verifyIdToken, directoryRoles, tenantAdminRole, EntraError,
} from '../../_lib/entra-oidc.js';
import { loadTeamFor } from '../../_lib/teams/runtime.js';
import { TeamError } from '../../_lib/teams/roles.js';
import { claimTenant, onMicrosoftSignIn, EnterpriseError, isUuid } from '../../_lib/team-enterprise.js';

const PROVIDER = 'microsoft';
export const FLOW_COOKIE = '__Host-msauth';
const LINK_COOKIE = '__Host-mslink';
const FLOW_TTL_SEC = 600;
const LINK_TTL_SEC = 300;
export const INTENTS = Object.freeze(['login', 'link', 'reauth', 'tenant_claim']);
const SETTINGS_URL = '/dashboard/settings#sign-in-methods';

function loginUrl(code, next) {
	const q = new URLSearchParams({ error: code });
	if (next) q.set('next', next);
	return `/login?${q.toString()}`;
}

function settingsUrl(outcome) {
	return `/dashboard/settings?microsoft=${encodeURIComponent(outcome)}#sign-in-methods`;
}

function teamUrl(teamId, outcome) {
	return `/teams/${encodeURIComponent(teamId)}?tenant=${encodeURIComponent(outcome)}#enterprise`;
}

/** Where a failed or finished flow of each intent lands. */
function backUrl(flow, code) {
	const bare = code.replace(/^microsoft_/, '');
	if (!flow || flow.intent === 'login') return loginUrl(code, flow?.next);
	if (flow.intent === 'tenant_claim' && flow.teamId) return teamUrl(flow.teamId, bare);
	return settingsUrl(bare);
}

/** The signed flow cookie, read back only when `state` matches in constant time. */
export async function readFlow(req, state) {
	const payload = await unsignIdentityPayload(readCookie(req, FLOW_COOKIE));
	if (!payload || typeof state !== 'string' || typeof payload.s !== 'string' || !constantTimeEquals(payload.s, state)) return null;
	return {
		nonce: payload.n,
		verifier: payload.v,
		intent: payload.i,
		userId: payload.u || null,
		teamId: payload.t || null,
		next: payload.x || null,
	};
}

async function signIn(req, res, userId, { isNew = false, tenantId = null } = {}) {
	const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip: clientIp(req), entraTenantId: tenantId });
	res.setHeader('set-cookie', [sessionCookie(token), clearCookie(FLOW_COOKIE), clearCookie(LINK_COOKIE)]);
	logAudit({ userId, action: isNew ? 'register:microsoft' : 'login:microsoft', meta: tenantId ? { tenant_id: tenantId } : null, req });
	if (isNew) queueMicrotask(() => seedDefaultAgent(userId));
}

/**
 * Where a signed-in person goes next. A sign-in that started on a page with
 * its own destination (the MCP consent screen, a deep link) keeps it; a plain
 * /login lands on the team a claimed tenant just admitted or offered.
 */
async function landing(userId, claims, next) {
	const dest = safeNext(next, '/dashboard');
	let team = null;
	try {
		team = await onMicrosoftSignIn({ userId, claims });
	} catch (err) {
		// The team side is a courtesy on top of a sign-in that already happened;
		// a fault there must not strand the person on an error page.
		console.error('[auth/microsoft] tenant join step failed', err);
	}
	if (!team || dest !== '/dashboard') return dest;
	if (team.outcome === 'offer') return `/teams/${team.teamId}?join=1`;
	if (team.outcome === 'joined' || team.outcome === 'bound') return `/teams/${team.teamId}?joined=1`;
	return dest;
}

// ── start ─────────────────────────────────────────────────────────────────────

async function handleStart(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const intent = url.searchParams.get('intent') || 'login';
	const next = safeNext(url.searchParams.get('next'), '/dashboard');
	const teamId = url.searchParams.get('team');
	if (!INTENTS.includes(intent)) return error(res, 400, 'validation_error', `intent must be one of ${INTENTS.join(', ')}`);
	if (intent === 'tenant_claim' && !isUuid(teamId)) return error(res, 400, 'validation_error', 'team must be a team id');
	const flowFor = { intent, next, teamId: intent === 'tenant_claim' ? teamId : null };

	if (!entraConfigured()) {
		if (wantsHtmlNavigation(req)) return redirect(res, backUrl(flowFor, 'microsoft_unavailable'));
		return error(res, 501, 'not_configured', 'Microsoft sign-in is not configured');
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) {
		if (wantsHtmlNavigation(req)) return redirect(res, backUrl(flowFor, 'rate_limited'));
		return rateLimited(res, rl);
	}

	let userId = null;
	let loginHint = null;
	let prompt = 'select_account';
	let maxAge = null;
	if (intent !== 'login') {
		const user = await getSessionUser(req, res);
		if (!user) {
			const back = intent === 'tenant_claim' ? `/teams/${teamId}#enterprise` : SETTINGS_URL;
			return redirect(res, `/login?next=${encodeURIComponent(back)}`);
		}
		const rlLink = await limits.identityLink(user.id);
		if (!rlLink.success) return redirect(res, backUrl(flowFor, 'rate_limited'));
		userId = user.id;
		if (intent === 'reauth') {
			const [linked] = await sql`select email from user_identities where user_id = ${userId} and provider = ${PROVIDER} limit 1`;
			if (!linked) return redirect(res, settingsUrl('not_linked'));
			loginHint = linked.email;
		}
		if (intent === 'tenant_claim') {
			try {
				await loadTeamFor(teamId, userId, { write: true });
			} catch (err) {
				if (err instanceof TeamError) return redirect(res, '/teams?error=not_found');
				throw err;
			}
		}
		if (intent === 'reauth' || intent === 'tenant_claim') {
			// Fresh credential entry; the callback also checks the token's age.
			prompt = 'login';
			maxAge = 0;
		}
	}

	const auth = await buildAuthorize({ prompt, maxAge, loginHint });
	const flow = await signIdentityPayload({
		s: auth.state,
		n: auth.nonce,
		v: auth.verifier,
		i: intent,
		u: userId,
		t: flowFor.teamId,
		x: next,
		e: Math.floor(Date.now() / 1000) + FLOW_TTL_SEC,
	});
	res.setHeader('set-cookie', cookie(FLOW_COOKIE, flow, FLOW_TTL_SEC));
	return redirect(res, auth.url);
}

// ── callback ──────────────────────────────────────────────────────────────────

/** Microsoft's error answer, mapped onto codes the pages explain. */
export function deniedCode(err, description = '') {
	if (err === 'access_denied' && /AADSTS65004|declined/i.test(description)) return 'microsoft_cancelled';
	if (/AADSTS65001|AADSTS90094|consent/i.test(description)) return 'microsoft_admin_consent_required';
	if (err === 'access_denied' || err === 'interaction_required' || err === 'login_required') return 'microsoft_cancelled';
	return 'microsoft_failed';
}

async function handleCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const flow = await readFlow(req, url.searchParams.get('state'));
	const back = (code) => {
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		return redirect(res, backUrl(flow, code));
	};
	if (!flow) return back('microsoft_expired');
	if (url.searchParams.get('error')) return back(deniedCode(url.searchParams.get('error'), url.searchParams.get('error_description') || ''));
	const code = url.searchParams.get('code');
	if (!code) return back('microsoft_failed');
	if (!entraConfigured()) return back('microsoft_unavailable');

	let claims;
	let accessToken;
	try {
		const tokens = await exchangeCode({ code, verifier: flow.verifier });
		accessToken = tokens.accessToken;
		claims = await verifyIdToken(tokens.idToken, {
			nonce: flow.nonce,
			maxAuthAgeSec: flow.intent === 'reauth' || flow.intent === 'tenant_claim' ? REAUTH_TTL_SEC : null,
		});
	} catch (err) {
		if (err instanceof EntraError) return back(`microsoft_${err.code}`);
		throw err;
	}

	if (flow.intent === 'link') return completeLink(req, res, flow, claims);
	if (flow.intent === 'reauth') return completeReauth(req, res, flow, claims);
	if (flow.intent === 'tenant_claim') return completeTenantClaim(req, res, flow, claims, accessToken);
	return completeLogin(req, res, flow, claims);
}

async function completeLogin(req, res, flow, claims) {
	// Microsoft's email claim is unverified unless xms_edov says otherwise, so
	// an unvouched address may still open a NEW account (with a placeholder
	// email) but never reaches an existing one.
	const decision = await decideIdentityLogin({ provider: PROVIDER, claims, allowUnverifiedSignup: true });
	if (decision.kind === 'signin') {
		await touchIdentity(decision.identityId);
		await signIn(req, res, decision.userId, { tenantId: claims.tenant_id });
		return redirect(res, await landing(decision.userId, claims, flow.next));
	}
	if (decision.kind === 'error') {
		if (decision.code === 'account_deleted') return redirect(res, loginUrl('account_deleted'));
		return redirect(res, loginUrl(`microsoft_${decision.code}`, flow.next));
	}
	if (decision.kind === 'confirm') {
		const pending = await signIdentityPayload({
			c: claims,
			u: decision.userId,
			x: flow.next,
			e: Math.floor(Date.now() / 1000) + LINK_TTL_SEC,
		});
		res.setHeader('set-cookie', [cookie(LINK_COOKIE, pending, LINK_TTL_SEC), clearCookie(FLOW_COOKIE)]);
		return renderLinkConfirm(res, { providerLabel: 'Microsoft', action: '/api/auth/microsoft/confirm', claims, next: flow.next });
	}
	const userId = await createMicrosoftUser(claims, decision);
	queueMicrotask(() => recordConversion(req, 'signup', userId));
	await linkIdentity({ userId, provider: PROVIDER, claims });
	await signIn(req, res, userId, { isNew: true, tenantId: claims.tenant_id });
	return redirect(res, await landing(userId, claims, flow.next));
}

/**
 * A new passwordless account. With a Microsoft-verified address the row is
 * born email_verified, like Google's. Without one it gets a non-deliverable
 * placeholder (the @wallet.local convention X and wallet sign-in use), so an
 * address nobody proved is never written to users.email.
 */
export async function createMicrosoftUser(claims, decision) {
	const displayName = claims.display_name || (claims.email ? claims.email.split('@')[0] : 'Microsoft user');
	if (decision.emailVerified) {
		const [row] = await sql`
			insert into users (email, display_name, email_verified)
			values (${decision.email}, ${displayName}, true)
			on conflict (email) do update set email_verified = true
			returning id, deleted_at
		`;
		if (row.deleted_at) throw new IdentityError('account_deleted', 'this account has been deleted', 403);
		return row.id;
	}
	let placeholder = `ms-${claims.tenant_id}-${claims.object_id}@wallet.local`;
	const [taken] = await sql`select 1 from users where email = ${placeholder} limit 1`;
	if (taken) placeholder = `ms-${claims.tenant_id}-${claims.object_id}.${randomToken(8).toLowerCase()}@wallet.local`;
	const [row] = await sql`
		insert into users (email, display_name) values (${placeholder}, ${displayName})
		returning id
	`;
	return row.id;
}

async function completeLink(req, res, flow, claims) {
	const user = await getSessionUser(req, res);
	if (!user || user.id !== flow.userId) return redirect(res, settingsUrl('session_changed'));
	try {
		const result = await linkIdentity({ userId: user.id, provider: PROVIDER, claims });
		logAudit({ userId: user.id, action: 'identity:link', meta: { provider: PROVIDER, relinked: result.relinked }, req });
	} catch (err) {
		if (err instanceof IdentityError) return redirect(res, settingsUrl(err.code));
		throw err;
	}
	res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
	return redirect(res, settingsUrl('linked'));
}

async function completeReauth(req, res, flow, claims) {
	const user = await getSessionUser(req, res);
	if (!user || user.id !== flow.userId) return redirect(res, settingsUrl('session_changed'));
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (!linked || linked.id !== user.id) return redirect(res, settingsUrl('wrong_account'));
	res.setHeader('set-cookie', [await reauthCookie(user.id, PROVIDER), clearCookie(FLOW_COOKIE)]);
	return redirect(res, settingsUrl('reauthenticated'));
}

async function completeTenantClaim(req, res, flow, claims, accessToken) {
	const user = await getSessionUser(req, res);
	const back = (code) => {
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		return redirect(res, teamUrl(flow.teamId, code));
	};
	if (!user || user.id !== flow.userId) return back('session_changed');
	try {
		await loadTeamFor(flow.teamId, user.id, { write: true });
	} catch (err) {
		if (err instanceof TeamError) return back('not_owner');
		throw err;
	}
	if (claims.personal) return back('personal_account');
	const role = tenantAdminRole(directoryRoles(claims, accessToken));
	if (!role) return back('not_admin');
	try {
		await claimTenant({
			teamId: flow.teamId,
			userId: user.id,
			tenantId: claims.tenant_id,
			tenantName: claims.username?.includes('@') ? claims.username.split('@')[1] : null,
			verifiedBy: claims.username || claims.email,
			verifiedRole: role,
			req,
		});
	} catch (err) {
		if (err instanceof EnterpriseError) return back(err.code);
		throw err;
	}
	return back('claimed');
}

// ── confirm (link Microsoft to an existing account by verified email) ────────

async function handleConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const form = await readForm(req);
	const pending = await unsignIdentityPayload(readCookie(req, LINK_COOKIE));
	if (!pending?.c?.subject || !pending.u) {
		res.setHeader('set-cookie', clearCookie(LINK_COOKIE));
		return redirect(res, loginUrl('microsoft_expired'));
	}
	const next = safeNext(pending.x, '/dashboard');
	if (form.decision !== 'link') {
		res.setHeader('set-cookie', clearCookie(LINK_COOKIE));
		return redirect(res, loginUrl('microsoft_not_linked', next));
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return redirect(res, loginUrl('rate_limited', next));
	const [user] = await sql`select id, deleted_at, email_verified from users where id = ${pending.u} limit 1`;
	if (!user || user.deleted_at) return redirect(res, loginUrl('account_deleted'));
	if (!user.email_verified) return redirect(res, loginUrl('microsoft_unverified_account', next));
	try {
		await linkIdentity({ userId: user.id, provider: PROVIDER, claims: pending.c });
	} catch (err) {
		if (err instanceof IdentityError) return redirect(res, loginUrl(`microsoft_${err.code}`, next));
		throw err;
	}
	logAudit({ userId: user.id, action: 'identity:link', meta: { provider: PROVIDER, via: 'login_confirm' }, req });
	await signIn(req, res, user.id, { tenantId: pending.c.tenant_id });
	return redirect(res, await landing(user.id, pending.c, next));
}

// ── status / unlink (settings card) ───────────────────────────────────────────

async function handleStatus(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to see your sign-in methods');
	const methods = await listSignInMethods(user.id);
	const microsoft = methods.identities.find((i) => i.provider === PROVIDER) || null;
	return json(res, 200, {
		configured: entraConfigured(),
		microsoft,
		password: methods.password,
		count: methods.count,
		reauthenticated: (await readReauth(req, user.id)) === PROVIDER,
	});
}

async function handleUnlink(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in first');
	if (!(await requireCsrf(req, res, user.id))) return;
	const body = await readJson(req);
	let proven = (await readReauth(req, user.id)) === PROVIDER;
	if (!proven && typeof body?.password === 'string' && body.password) {
		const [row] = await sql`select password_hash from users where id = ${user.id} limit 1`;
		proven = Boolean(row?.password_hash) && (await verifyPassword(body.password, row.password_hash));
	}
	if (!proven) return error(res, 401, 'reauth_required', 'confirm your password, or sign in with Microsoft again, before unlinking');
	try {
		const result = await unlinkIdentity({ userId: user.id, provider: PROVIDER });
		logAudit({ userId: user.id, action: 'identity:unlink', meta: { provider: PROVIDER }, req });
		return json(res, 200, result);
	} catch (err) {
		if (err instanceof IdentityError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	start: handleStart,
	callback: handleCallback,
	confirm: handleConfirm,
	status: handleStatus,
	unlink: handleUnlink,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown microsoft auth action: ${action}`);
	return fn(req, res);
});
