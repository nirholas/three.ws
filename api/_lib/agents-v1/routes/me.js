// v1 account routes: usage, credit budget, credit transactions, linked
// integrations and link codes.
//
//   GET    /me/usage                     plan limits, usage counts, LLM spend this month
//   GET    /me/budget                    credit balance, lifetime totals, free allowance
//   GET    /me/transactions              credit ledger, newest first, paged
//   GET    /me/integrations              linked accounts (X, GitHub, ...) and their state
//   PUT    /me/integrations/:provider    state of one integration, or the sign-in URL to link it
//   DELETE /me/integrations/:provider    unlink an integration
//   POST   /me/link-code                 mint an eight-letter pairing code (ten minutes)
//   POST   /me/link-code/redeem          a device claims a code and gets its claim secret
//
// Every route reads the same tables and helpers the dashboard uses, so the
// numbers match what the person sees on /dashboard.

import { apiError, page, strParam } from '../http.js';
import { sql } from '../../db.js';
import { hasScope } from '../../auth.js';
import { limits } from '../../rate-limit.js';
import { getCreditAccount, listLedger } from '../../credits.js';
import { usageSummary } from '../../usage-summary.js';
import { freeTierStatus } from '../billing.js';
import { isUuid } from '../../validate.js';
import {
	LinkCodeError,
	DEVICE_KINDS,
	LINK_CODE_TTL_SEC,
	LINKABLE_SCOPES,
	mintLinkCode,
	claimLinkCode,
	describeClaim,
} from '../../account-link/link-codes.js';

/** Providers a person can link today, and the OAuth entry point that links each. */
const PROVIDERS = Object.freeze({
	x: { label: 'X', connectUrl: '/api/auth/x/connect' },
	github: { label: 'GitHub', connectUrl: '/api/auth/github/connect' },
});

function provider(v) {
	const id = String(v || '').toLowerCase();
	if (!PROVIDERS[id]) {
		throw apiError(404, 'not_found', `Unknown integration "${id}". Available: ${Object.keys(PROVIDERS).join(', ')}.`, {
			providers: Object.keys(PROVIDERS),
		});
	}
	return id;
}

function shapeConnection(id, row) {
	return {
		provider: id,
		label: PROVIDERS[id].label,
		connected: Boolean(row),
		username: row?.username ?? null,
		connectedAt: row?.connected_at ?? null,
		connectUrl: row ? null : PROVIDERS[id].connectUrl,
	};
}

async function connections(userId) {
	const rows = await sql`
		select provider, username, connected_at
		from social_connections
		where user_id = ${userId} and disconnected_at is null and provider = any(${Object.keys(PROVIDERS)}::text[])
	`;
	return Object.keys(PROVIDERS).map((id) => shapeConnection(id, rows.find((r) => r.provider === id)));
}

function linkError(err) {
	if (err instanceof LinkCodeError) return apiError(err.status || 400, err.code, err.message, err.extra || null);
	return err;
}

export const ROUTES = [
	{
		method: 'GET',
		path: '/me/usage',
		name: 'v1.me.usage',
		auth: 'required',
		scope: 'profile',
		summary: 'Plan limits, usage counts and LLM spend for the current month.',
		handler: async ({ principal }) => {
			const out = await usageSummary(principal.userId);
			if (!out) throw apiError(500, 'internal_error', 'The plan quota record for this account is missing. Quote the requestId to support.');
			return out;
		},
	},
	{
		method: 'GET',
		path: '/me/budget',
		name: 'v1.me.budget',
		auth: 'required',
		scope: 'profile',
		summary: 'Prepaid credit balance, lifetime totals and the free daily allowance.',
		handler: async ({ principal }) => {
			const [acct, free] = await Promise.all([getCreditAccount(principal.userId), freeTierStatus(principal.userId)]);
			return {
				balanceUsd: acct.balanceUsd,
				lifetimeDepositedUsd: acct.lifetimeDepositedUsd,
				lifetimeSpentUsd: acct.lifetimeSpentUsd,
				updatedAt: acct.updatedAt,
				freeTier: free,
			};
		},
	},
	{
		method: 'GET',
		path: '/me/transactions',
		name: 'v1.me.transactions',
		auth: 'required',
		scope: 'profile',
		summary: 'The credit ledger (deposits, spends, refunds), newest first.',
		params: { limit: '1-100, default 25', cursor: 'meta.nextCursor from the previous page' },
		handler: async ({ principal, query }) => {
			const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
			const cursor = query.cursor ? strParam(query.cursor, { name: 'cursor', max: 64 }) : null;
			if (cursor && !isUuid(cursor)) {
				throw apiError(400, 'invalid_cursor', 'cursor must be a value returned in meta.nextCursor.', { parameter: 'cursor' });
			}
			const out = await listLedger({ userId: principal.userId, limit, before: cursor });
			return page(out.items, { hasMore: Boolean(out.next_cursor), nextCursor: out.next_cursor ?? null });
		},
	},
	{
		method: 'GET',
		path: '/me/integrations',
		name: 'v1.me.integrations.list',
		auth: 'required',
		scope: 'profile',
		summary: 'Linked accounts and whether each is connected.',
		handler: async ({ principal }) => ({ integrations: await connections(principal.userId) }),
	},
	{
		method: 'PUT',
		path: '/me/integrations/:provider',
		name: 'v1.me.integrations.put',
		auth: 'required',
		scope: 'profile',
		summary: 'One integration. When it is not linked yet the response carries the sign-in URL that links it.',
		handler: async ({ params, principal }) => {
			const id = provider(params.provider);
			const all = await connections(principal.userId);
			return all.find((c) => c.provider === id);
		},
	},
	{
		method: 'DELETE',
		path: '/me/integrations/:provider',
		name: 'v1.me.integrations.delete',
		auth: 'required',
		scope: 'profile',
		summary: 'Unlink an integration. For X this also revokes the memory-seeding grants it authorized.',
		handler: async ({ params, principal }) => {
			const id = provider(params.provider);
			const rows = await sql`
				update social_connections
				set disconnected_at = now(), updated_at = now()
				where user_id = ${principal.userId} and provider = ${id} and disconnected_at is null
				returning id
			`;
			let purged = null;
			if (id === 'x' && rows.length) {
				const { revokeAllSeedConsentsForUser } = await import('../../x-seed-consent.js');
				purged = await revokeAllSeedConsentsForUser(principal.userId, 'x_disconnected');
			}
			return { provider: id, disconnected: rows.length > 0, revokedSeedGrants: purged };
		},
	},
	{
		method: 'POST',
		path: '/me/link-code',
		name: 'v1.me.linkCode.create',
		auth: 'required',
		scope: 'profile',
		summary: 'Mint an eight-letter code that pairs a device to this account. A signed-in session still has to confirm the claim.',
		handler: async ({ principal, body, req }) => {
			const deviceKind = strParam(body.deviceKind ?? body.device_kind, { name: 'deviceKind', max: 20, required: true });
			if (!DEVICE_KINDS.includes(deviceKind)) {
				throw apiError(400, 'invalid_parameter', `deviceKind must be one of ${DEVICE_KINDS.join(', ')}.`, { parameter: 'deviceKind' });
			}
			const scopes = strParam(body.scopes, { name: 'scopes', max: 400 });
			// A key can only hand out scopes it holds itself.
			if (scopes && principal.source !== 'session') {
				const missing = scopes.split(/\s+/).filter((s) => s && !hasScope(principal.scope, s));
				if (missing.length) {
					throw apiError(403, 'insufficient_scope', `This key cannot grant: ${missing.join(', ')}.`, { missing });
				}
			}
			try {
				const code = await mintLinkCode({
					userId: principal.userId,
					deviceKind,
					label: strParam(body.label, { name: 'label', max: 80 }),
					requestedScope: scopes,
					req,
				});
				return { ...code, expiresInSeconds: LINK_CODE_TTL_SEC, linkableScopes: LINKABLE_SCOPES };
			} catch (err) {
				throw linkError(err);
			}
		},
	},
	{
		method: 'POST',
		path: '/me/link-code/redeem',
		name: 'v1.me.linkCode.redeem',
		auth: 'public',
		summary: 'A device claims a code and gets a claim secret to poll with. The code is the only credential.',
		handler: async ({ body, req, ip }) => {
			const rl = await limits.linkCodeClaimIp(ip);
			if (!rl.success) throw apiError(429, 'rate_limited', 'Too many link attempts. Slow down and retry.');
			const expectKind = DEVICE_KINDS.includes(body.deviceKind) ? body.deviceKind : null;
			try {
				const claim = describeClaim(body.device || {}, { ip, userAgent: req.headers['user-agent'] || null });
				const claimed = await claimLinkCode({ code: body.code, claim, expectKind, forbidKinds: ['telegram'] });
				return { ...claimed, pollPath: '/api/auth/link-codes/poll', pollEveryMs: 2000 };
			} catch (err) {
				throw linkError(err);
			}
		},
	},
];
