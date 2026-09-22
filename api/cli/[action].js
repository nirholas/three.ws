// The `three-ws` CLI's server half (packages/three-ws-cli).
//
//   POST /api/cli/link      start a device link: { client_name, hostname, scope }
//                           -> { device_code, user_code, verification_uri, ... }
//   GET  /api/cli/link      ?code=XXXX-XXXX, signed in: what the link is asking for
//   POST /api/cli/approve   signed in + CSRF: { code, decision, scope } allow or deny
//   POST /api/cli/token     { device_code }: poll; hands over the minted key once
//   GET  /api/cli/whoami    Bearer: the account, credential, plan and agent wallet
//
// The link is the RFC 8628 device authorization grant, issuing a three.ws API
// key instead of an OAuth token. It exists for the two places a loopback OAuth
// redirect cannot reach: a terminal over SSH or in a container, and an API key
// that the stdio `@three-ws/*-mcp` packages read from their env block. Error
// codes on the poll are RFC 8628 §3.5's, so any device-flow client reads them.
//
// Approval is a person in a browser. `approve` refuses every bearer principal,
// API keys and OAuth tokens included: a credential must never be able to widen
// itself into a new credential without a human pressing the button.

import { randomInt } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { env } from '../_lib/env.js';
import { API_KEY_SCOPES, mintApiKey, normalizeKeyScopes } from '../_lib/api-keys.js';
import { getUserWalletStatus } from '../_lib/x402-user-payer.js';
import { logAudit } from '../_lib/audit.js';

const LINK_TTL_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 3;
// RFC 8628 §6.1: consonants only, no vowels (so no words) and no characters
// that read alike (0/O, 1/I/L). 19^8 is ~1.7e10 codes, and a code only lives
// ten minutes behind a signed-in session, so guessing one is not a strategy.
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
const DEFAULT_SCOPE = 'profile avatars:read avatars:write memory:read memory:write agents:read wallet:read';

const SCOPE_LABELS = {
	'avatars:read': 'Read your avatars',
	'avatars:write': 'Create and update avatars',
	'avatars:delete': 'Delete your avatars',
	profile: 'See your name, email and plan',
	'memory:read': 'Recall your agents’ memories',
	'memory:write': 'Store and forget your agents’ memories',
	'agents:read': 'Read your agents and their identities',
	'agents:write': 'Create, update and register agents',
	'herald:announce': 'Post announcements through the Herald',
	'wallet:read': 'See your agent wallet balance and spending caps',
	'wallet:write': 'Spend USDC from your agent wallet, within your caps',
	'services:write': 'Publish paid services that earn USDC to your agent wallet',
	inference: 'Call models on your credits through the OpenAI-compatible endpoint',
};
// Scopes that let the key move money. The authorize page marks them so the
// person sees the difference before they approve, not after.
const FINANCIAL_SCOPES = new Set(['wallet:write', 'services:write']);

export function generateUserCode() {
	let out = '';
	for (let i = 0; i < 8; i++) out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
	return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// Accepts what a person actually types: lower case, spaces, a missing dash.
export function normalizeUserCode(input) {
	const letters = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
	if (letters.length !== 8) return null;
	for (const c of letters) if (!USER_CODE_ALPHABET.includes(c)) return null;
	return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

function cleanLabel(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : null;
}

function describeScopes(scope) {
	return String(scope || '').split(/\s+/).filter(Boolean).map((s) => ({
		scope: s,
		label: SCOPE_LABELS[s] || s,
		financial: FINANCIAL_SCOPES.has(s),
	}));
}

function publicLink(row) {
	return {
		user_code: row.user_code,
		client_name: row.client_name,
		hostname: row.hostname,
		status: row.status,
		requested_scopes: describeScopes(row.requested_scope),
		created_at: row.created_at,
		expires_at: row.expires_at,
		expired: new Date(row.expires_at) < new Date(),
	};
}

// ── link: start (POST, unauthenticated) and inspect (GET, signed in) ─────────

async function handleLink(req, res) {
	if (req.method === 'GET') return inspectLink(req, res);
	const rl = await limits.cliLinkIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'too many sign-in links from this network, wait a few minutes');

	const body = (await readJson(req, 4_000).catch(() => null)) || {};
	const { scopes, invalid } = normalizeKeyScopes(body.scope || DEFAULT_SCOPE);
	if (invalid.length) return error(res, 400, 'invalid_scope', `unknown scopes: ${invalid.join(', ')}`);
	if (!scopes.length) return error(res, 400, 'invalid_scope', 'scope must name at least one permission');

	const deviceCode = randomToken(32);
	const deviceHash = await sha256(deviceCode);
	const clientName = cleanLabel(body.client_name, 80) || 'three-ws CLI';
	const hostname = cleanLabel(body.hostname, 120);

	// A user-code collision is astronomically unlikely but the column is unique,
	// so retry on the constraint instead of surfacing a 500 for it.
	let userCode = null;
	for (let attempt = 0; attempt < 5 && !userCode; attempt++) {
		const candidate = generateUserCode();
		const rows = await sql`
			insert into cli_link_requests (device_code_hash, user_code, client_name, hostname, requested_scope, created_ip, expires_at)
			values (${deviceHash}, ${candidate}, ${clientName}, ${hostname}, ${scopes.join(' ')}, ${clientIp(req)}, now() + ${`${LINK_TTL_SECONDS} seconds`}::interval)
			on conflict (user_code) do nothing
			returning user_code
		`;
		if (rows[0]) userCode = rows[0].user_code;
	}
	if (!userCode) return error(res, 503, 'unavailable', 'could not allocate a sign-in code, try again');

	const verificationUri = `${env.APP_ORIGIN}/cli/authorize`;
	return json(res, 201, {
		device_code: deviceCode,
		user_code: userCode,
		verification_uri: verificationUri,
		verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
		expires_in: LINK_TTL_SECONDS,
		interval: POLL_INTERVAL_SECONDS,
		scope: scopes.join(' '),
	}, { 'cache-control': 'no-store' });
}

async function inspectLink(req, res) {
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to approve a CLI sign-in');
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const code = normalizeUserCode(new URL(req.url, 'http://x').searchParams.get('code'));
	if (!code) return error(res, 400, 'invalid_code', 'that is not a three-ws sign-in code; codes look like BCDF-GHJK');
	const [row] = await sql`select * from cli_link_requests where user_code = ${code} limit 1`;
	if (!row) return error(res, 404, 'unknown_code', 'no sign-in is waiting for that code');
	if (row.user_id && row.user_id !== user.id) return error(res, 404, 'unknown_code', 'no sign-in is waiting for that code');
	return json(res, 200, {
		link: publicLink(row),
		account: { email: user.email, display_name: user.display_name || null },
		available_scopes: describeScopes(API_KEY_SCOPES.join(' ')),
	}, { 'cache-control': 'no-store' });
}

// ── approve (POST, browser session only) ─────────────────────────────────────

async function handleApprove(req, res) {
	if (!method(req, res, ['POST'])) return;
	if (extractBearer(req)) return error(res, 403, 'forbidden', 'a CLI sign-in is approved by a person in a browser, not by a token');
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to approve a CLI sign-in');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, user.id))) return;

	const body = (await readJson(req, 4_000).catch(() => null)) || {};
	const code = normalizeUserCode(body.code);
	if (!code) return error(res, 400, 'invalid_code', 'that is not a three-ws sign-in code');
	const decision = body.decision === 'allow' ? 'allow' : body.decision === 'deny' ? 'deny' : null;
	if (!decision) return error(res, 400, 'invalid_request', 'decision must be allow or deny');

	const [row] = await sql`select * from cli_link_requests where user_code = ${code} limit 1`;
	if (!row) return error(res, 404, 'unknown_code', 'no sign-in is waiting for that code');
	if (row.status !== 'pending') return error(res, 409, 'already_decided', `this sign-in was already ${row.status === 'denied' ? 'denied' : 'approved'}`);
	if (new Date(row.expires_at) < new Date()) return error(res, 410, 'expired_token', 'this sign-in code expired; run the command again for a new one');

	if (decision === 'deny') {
		await sql`update cli_link_requests set status = 'denied', user_id = ${user.id}, decided_at = now() where id = ${row.id} and status = 'pending'`;
		logAudit({ userId: user.id, action: 'cli_link_deny', resourceId: row.id, meta: { client: row.client_name, hostname: row.hostname }, req });
		return json(res, 200, { status: 'denied' });
	}

	// The approver may narrow the request, never widen it.
	const requested = new Set(row.requested_scope.split(/\s+/).filter(Boolean));
	const { scopes: chosen } = normalizeKeyScopes(body.scope ?? row.requested_scope);
	const granted = chosen.filter((s) => requested.has(s));
	if (!granted.length) return error(res, 400, 'invalid_scope', 'keep at least one permission, or deny the sign-in instead');

	const updated = await sql`
		update cli_link_requests
		set status = 'approved', user_id = ${user.id}, granted_scope = ${granted.join(' ')}, decided_at = now()
		where id = ${row.id} and status = 'pending' and expires_at > now()
		returning id
	`;
	if (!updated[0]) return error(res, 409, 'already_decided', 'this sign-in changed while you were looking at it; run the command again');
	logAudit({ userId: user.id, action: 'cli_link_approve', resourceId: row.id, meta: { client: row.client_name, hostname: row.hostname, scope: granted.join(' ') }, req });
	return json(res, 200, { status: 'approved', scope: granted.join(' ') });
}

// ── token (POST, the CLI polling with its device code) ───────────────────────

async function handleToken(req, res) {
	if (!method(req, res, ['POST'])) return;
	const body = (await readJson(req, 4_000).catch(() => null)) || {};
	const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
	if (!deviceCode) return error(res, 400, 'invalid_request', 'device_code required');
	const deviceHash = await sha256(deviceCode);
	const rl = await limits.cliPoll(deviceHash);
	if (!rl.success) return error(res, 400, 'slow_down', `poll at most every ${POLL_INTERVAL_SECONDS} seconds`);

	const [row] = await sql`select * from cli_link_requests where device_code_hash = ${deviceHash} limit 1`;
	if (!row) return error(res, 400, 'invalid_grant', 'unknown device code');
	if (row.status === 'consumed') return error(res, 400, 'invalid_grant', 'this sign-in already delivered its key');
	if (row.status === 'denied') return error(res, 400, 'access_denied', 'the sign-in was denied in the browser');
	if (new Date(row.expires_at) < new Date()) return error(res, 400, 'expired_token', 'the sign-in code expired before it was approved');

	if (row.status === 'pending') {
		const tooSoon = row.last_polled_at && Date.now() - new Date(row.last_polled_at).getTime() < (POLL_INTERVAL_SECONDS - 1) * 1000;
		await sql`update cli_link_requests set last_polled_at = now() where id = ${row.id}`;
		if (tooSoon) return error(res, 400, 'slow_down', `poll at most every ${POLL_INTERVAL_SECONDS} seconds`);
		return error(res, 400, 'authorization_pending', 'waiting for approval in the browser');
	}

	// Approved: claim the row first so two concurrent polls can never mint twice.
	const claimed = await sql`
		update cli_link_requests set status = 'consumed', consumed_at = now()
		where id = ${row.id} and status = 'approved'
		returning id, user_id, granted_scope, hostname, client_name
	`;
	if (!claimed[0]) return error(res, 400, 'invalid_grant', 'this sign-in already delivered its key');
	const link = claimed[0];
	const name = `${link.client_name}${link.hostname ? ` on ${link.hostname}` : ''}`.slice(0, 80);
	const { row: key, secret } = await mintApiKey({
		userId: link.user_id,
		name,
		scopes: link.granted_scope.split(/\s+/).filter(Boolean),
		req,
		via: 'cli_link',
	});
	await sql`update cli_link_requests set api_key_id = ${key.id} where id = ${link.id}`;
	const [account] = await sql`select email from users where id = ${link.user_id} limit 1`;
	return json(res, 200, {
		access_token: secret,
		token_type: 'Bearer',
		scope: key.scope,
		key: { id: key.id, name: key.name, prefix: key.prefix, created_at: key.created_at },
		account: { email: account?.email || null },
	}, { 'cache-control': 'no-store' });
}

// ── whoami (GET, bearer) ─────────────────────────────────────────────────────

async function handleWhoami(req, res) {
	if (!method(req, res, ['GET'])) return;
	const token = extractBearer(req);
	if (!token) return error(res, 401, 'unauthorized', 'send an API key or access token as a Bearer credential; run `npx three-ws login`');
	const auth = await authenticateBearer(token, { audience: env.MCP_RESOURCE });
	if (!auth) return error(res, 401, 'invalid_token', 'this credential is revoked, expired or unknown; run `npx three-ws login`');
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const scope = auth.scope || '';
	const canProfile = hasScope(scope, 'profile');
	const canWallet = hasScope(scope, 'wallet:read') || hasScope(scope, 'wallet:write');

	const [[user], keyRows, walletStatus] = await Promise.all([
		sql`
			select u.id, u.email, u.display_name, u.username, u.plan, q.mcp_calls_per_day,
				(select count(*) from usage_events e where e.user_id = u.id and e.kind = 'tool_call' and e.created_at > now() - interval '24 hours') as mcp_calls_24h
			from users u left join plan_quotas q on q.plan = u.plan
			where u.id = ${auth.userId} and u.deleted_at is null limit 1
		`,
		auth.apiKeyId
			? sql`select name, prefix, expires_at, last_used_at, created_at from api_keys where id = ${auth.apiKeyId} limit 1`
			: Promise.resolve([]),
		canWallet ? getUserWalletStatus(auth.userId) : Promise.resolve(null),
	]);
	if (!user) return error(res, 401, 'invalid_token', 'the account behind this credential no longer exists');

	return json(res, 200, {
		user: canProfile
			? { id: user.id, email: user.email, display_name: user.display_name || null, username: user.username || null }
			: { id: user.id },
		plan: canProfile
			? { plan: user.plan, mcp_calls_per_day: user.mcp_calls_per_day == null ? null : Number(user.mcp_calls_per_day), mcp_calls_24h: Number(user.mcp_calls_24h || 0) }
			: null,
		credential: {
			source: auth.source,
			scope,
			client_id: auth.clientId || null,
			api_key: keyRows[0] || null,
		},
		wallet: canWallet ? walletStatus : null,
		missing: [!canProfile && 'profile', !canWallet && 'wallet:read'].filter(Boolean),
	}, { 'cache-control': 'no-store' });
}

const DISPATCH = {
	link: handleLink,
	approve: handleApprove,
	token: handleToken,
	whoami: handleWhoami,
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown cli action: ${action}`);
	if (action === 'link' && !method(req, res, ['GET', 'POST'])) return;
	return fn(req, res);
});
