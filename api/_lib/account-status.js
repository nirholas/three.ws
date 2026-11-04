// One-call account status and the canonical dashboard URLs.
//
// Shared by GET /api/v1/me/status and the get_account_status / get_dashboard_urls
// MCP tools so a model asking "what plan am I on, what are my limits, what is
// waiting for approval" gets one answer on every surface, and never has to guess
// a link.
//
// Every field is picked by name from the helper it comes from. Nothing is spread
// through, so a new column on a subscription or wallet row can never leak into a
// status response.

import { sql } from './db.js';
import { env } from './env.js';
import { getDevSubscription } from './dev-plans/subscription.js';
import { peekDevQuota } from './dev-plans/quota.js';
import { freeTierStatus } from './agents-v1/billing.js';
import { getUserWalletStatus } from './x402-user-payer.js';

/** Canonical signed-in pages, by the name a model asks for. Paths only. */
export const DASHBOARD_PATHS = Object.freeze({
	dashboard: '/dashboard',
	account: '/dashboard/account',
	billing: '/dashboard/billing',
	settings: '/dashboard/settings',
	developers: '/dashboard/developers',
	api_keys: '/dashboard/developers',
	agents: '/agents',
	wallet: '/wallet',
	runs: '/runs',
	approvals: '/approvals',
	connections: '/settings/connections',
	mcp_integrations: '/mcp-integrations',
	mcp_tools: '/settings/mcp-tools',
	memory: '/settings/memory',
	sandbox: '/settings/sandbox',
});

export const DASHBOARD_PAGE_NAMES = Object.freeze(Object.keys(DASHBOARD_PATHS));

/** Absolute URLs on this deployment's origin. Optionally restricted to one page. */
export function dashboardUrls(page = null) {
	const origin = env.APP_ORIGIN.replace(/\/+$/, '');
	const names = page ? [page] : DASHBOARD_PAGE_NAMES;
	return Object.fromEntries(names.map((n) => [n, `${origin}${DASHBOARD_PATHS[n]}`]));
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);

function walletSummary(w) {
	if (!w?.provisioned) return { provisioned: false, spend_enabled: Boolean(w?.spend_enabled) };
	return {
		provisioned: true,
		agent_id: w.agent_id ?? null,
		agent_name: w.agent_name ?? null,
		address: w.address,
		network: w.network,
		balances: { sol: w.balances?.sol ?? null, usdc: w.balances?.usdc ?? null },
		spend_enabled: Boolean(w.spend_enabled),
		caps: {
			max_per_call_usdc: w.caps?.max_per_call_usdc ?? null,
			max_per_hour_usdc: w.caps?.max_per_hour_usdc ?? null,
			max_per_day_usdc: w.caps?.max_per_day_usdc ?? null,
		},
	};
}

/**
 * @param {string} userId
 * @param {{ includeWallet?: boolean }} [opts] the wallet section carries an address
 *   and balances, so callers include it only when the token carries a wallet grant.
 */
export async function buildAccountStatus(userId, { includeWallet = false } = {}) {
	const [sub, free, counts, wallet] = await Promise.all([
		getDevSubscription(userId),
		freeTierStatus(userId),
		sql`
			select
				(select plan from users where id = ${userId}) as plan,
				(select count(*)::int from agent_identities where user_id = ${userId} and deleted_at is null) as agents,
				(select count(*)::int from approval_requests
				  where user_id = ${userId} and status = 'pending' and expires_at > now()) as pending_approvals
		`,
		includeWallet ? getUserWalletStatus(userId) : Promise.resolve(null),
	]);
	const quota = await peekDevQuota(sub);
	const row = counts[0] || {};
	const urls = dashboardUrls();

	return {
		userId,
		plan: {
			account: row.plan || 'free',
			api: {
				id: sub.plan.id,
				name: sub.plan.name,
				price_usd: sub.plan.priceUsd,
				period_start: iso(sub.periodStart),
				period_end: iso(sub.periodEnd),
				manage_url: urls.developers,
			},
		},
		limits: {
			api_calls_per_period: sub.plan.includedCalls,
			burst_per_minute: sub.plan.burstPerMinute,
			concurrent: sub.plan.concurrent,
			webhooks: sub.plan.webhooks,
			free_chat_per_day: free.limit,
		},
		remaining: {
			api_calls: quota.remaining,
			api_calls_used: quota.used,
			api_calls_reset_at: iso(quota.resetAt),
			free_chat_messages: free.remaining,
			free_chat_resets_at: free.resetsAt ?? null,
		},
		agents: { count: row.agents ?? 0, url: urls.agents },
		wallet: includeWallet ? walletSummary(wallet) : null,
		approvals: { pending: row.pending_approvals ?? 0, url: urls.approvals },
	};
}
