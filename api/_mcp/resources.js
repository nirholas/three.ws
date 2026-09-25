// MCP resources for the hosted three.ws servers: live, read-only views of the
// caller's account under the three:// URI scheme.
//
// One registry serves /api/mcp, /api/mcp-agent, /api/mcp-3d and /api/mcp-bazaar.
// Each server exposes the subset listed in SERVER_RESOURCES and answers
// resources/list, resources/templates/list, resources/read, resources/subscribe
// and resources/unsubscribe through handleResourceMethod(). Every resource reads
// the same tables and helpers as the REST route named in its comment, so a
// resource can never disagree with the dashboard.
//
// Every resource is also reachable through the read_resource tool on the same
// server, for clients that render tools but not resources; the description of
// each resource names that equivalent.
//
// Subscriptions: resources/subscribe records the URI and a fingerprint of its
// current state in mcp_resource_subscriptions. The client's GET event stream
// (streamSubscriptions, wired through api/_mcp/auth.js handleSse) re-derives
// the fingerprint on a timer and emits notifications/resources/updated when it
// changes. A wallet's fingerprint is its latest transaction signature plus its
// guard settings, so a transfer in or out is what fires the notification.
//
// Heavy helpers (RPC, pricing, facilitator clients) are imported lazily inside
// the readers, so listing resources costs no more than the registry itself.

import { createHash, randomUUID } from 'node:crypto';

import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { hasScope } from '../_lib/auth.js';

export const RESOURCE_SERVERS = Object.freeze(['mcp', 'mcp-agent', 'mcp-3d', 'mcp-bazaar']);

const JSON_MIME = 'application/json';
const MARKDOWN_MIME = 'text/markdown';
const PAGE_SIZE = 100;
const MAX_LISTED_AGENTS = 25;
const MAX_SUBSCRIPTIONS = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// JSON-RPC error codes. -32002 is the MCP spec's "resource not found"; -32001
// is used for "authenticate or grant a scope first" so a client can tell a
// missing credential apart from a URI that names nothing.
const NOT_FOUND = -32002;
const AUTH_REQUIRED = -32001;

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

function origin() {
	return env.APP_ORIGIN || 'https://three.ws';
}

// ── Access rules ───────────────────────────────────────────────────────────────

// Each resource declares one of:
//   'public'  anyone, including anonymous and x402 principals
//   'user'    any signed-in principal (OAuth token or API key)
//   [scopes]  a signed-in principal holding at least one of the scopes
function canRead(access, auth) {
	if (access === 'public') return true;
	if (!auth?.userId) return false;
	if (access === 'user') return true;
	return access.some((s) => hasScope(auth.scope, s));
}

function assertAccess(def, auth, uri) {
	if (canRead(def.access, auth)) return;
	if (!auth?.userId) {
		throw rpcError(AUTH_REQUIRED, `${uri} is account data: sign in with three.ws OAuth or an API key to read it`, {
			uri,
			hint: 'Connect this server with OAuth, or send Authorization: Bearer sk_live_... from /dashboard/api-keys.',
		});
	}
	throw rpcError(AUTH_REQUIRED, `${uri} requires one of these scopes: ${def.access.join(', ')}`, {
		uri,
		required_scopes: def.access,
	});
}

function notFound(uri) {
	return rpcError(NOT_FOUND, `Resource not found: ${uri}`, { uri });
}

// Load an agent the caller owns. A missing agent and someone else's agent give
// the same answer so a URI cannot be used to probe which ids exist.
async function ownedAgent(ctx, agentId) {
	if (!UUID_RE.test(agentId)) throw notFound(ctx.uri);
	const [row] = await sql`
		SELECT id, user_id, name, description, persona_prompt, skills, meta, avatar_id,
		       is_published, created_at, updated_at
		  FROM agent_identities
		 WHERE id = ${agentId} AND deleted_at IS NULL
		 LIMIT 1
	`;
	if (!row || row.user_id !== ctx.auth.userId) throw notFound(ctx.uri);
	return row;
}

// Tables a later build adds (first-class runs and chat messages). Checked
// against the live schema so these resources switch to the richer source the
// moment its migration is applied, without a redeploy.
const tableCache = new Map();
async function tableExists(name) {
	const hit = tableCache.get(name);
	if (hit && hit.expires > Date.now()) return hit.value;
	const [row] = await sql`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present`;
	const value = Boolean(row?.present);
	tableCache.set(name, { value, expires: Date.now() + 5 * 60_000 });
	return value;
}

function num(v) {
	if (v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function atomicToDecimal(amount, decimals) {
	const a = num(amount);
	const d = num(decimals) ?? 6;
	if (a === null) return null;
	return a / 10 ** d;
}

function agentLinks(id) {
	return {
		page: `${origin()}/agents/${id}`,
		resources: {
			agent: `three://agents/${id}`,
			wallet: `three://agents/${id}/wallet`,
			usage: `three://agents/${id}/usage`,
			chat: `three://agents/${id}/chat`,
			runs: `three://agents/${id}/runs`,
			orders: `three://agents/${id}/orders`,
			dca: `three://agents/${id}/dca`,
			intents: `three://agents/${id}/intents`,
		},
	};
}

async function avatarUrls(storageKey, thumbnailKey, visibility) {
	const { publicUrl, thumbnailUrl } = await import('../_lib/r2.js');
	const shareable = visibility == null || visibility === 'public' || visibility === 'unlisted';
	return {
		glb_url: shareable && storageKey ? publicUrl(storageKey) : null,
		thumbnail_url: thumbnailKey ? thumbnailUrl(thumbnailKey) : null,
	};
}

// ── Readers ───────────────────────────────────────────────────────────────────

// three://me  (api/usage/summary.js, api/api-keys.js)
async function readMe(ctx) {
	const { auth } = ctx;
	const scopes = String(auth.scope || '').split(/\s+/).filter(Boolean);
	const credential = { type: auth.source === 'apikey' ? 'api_key' : auth.source, scopes };
	if (auth.apiKeyId) {
		const [key] = await sql`
			SELECT name, prefix, expires_at, last_used_at, created_at
			  FROM api_keys WHERE id = ${auth.apiKeyId} LIMIT 1
		`;
		if (key) credential.api_key = key;
	}
	if (auth.clientId) credential.oauth_client_id = auth.clientId;

	const [quota] = await sql`
		SELECT u.plan, q.mcp_calls_per_day, q.max_avatars,
		       (SELECT count(*) FROM usage_events
		         WHERE user_id = ${auth.userId} AND kind = 'tool_call'
		           AND created_at > now() - interval '24 hours') AS mcp_calls_24h
		  FROM users u
		  LEFT JOIN plan_quotas q ON q.plan = u.plan
		 WHERE u.id = ${auth.userId}
	`;
	const perDay = num(quota?.mcp_calls_per_day);
	const used = num(quota?.mcp_calls_24h) ?? 0;
	const out = {
		user_id: auth.userId,
		credential,
		rate_limits: {
			mcp_calls_per_day: perDay,
			mcp_calls_last_24h: used,
			remaining_today: perDay === null ? null : Math.max(0, perDay - used),
		},
	};

	// The account profile (plan, credits, display name) is gated by the
	// `profile` scope everywhere else, so it is here too.
	if (hasScope(auth.scope, 'profile')) {
		const { getCreditAccount } = await import('../_lib/credits.js');
		const [[user], credits] = await Promise.all([
			sql`SELECT display_name, plan, created_at FROM users WHERE id = ${auth.userId}`,
			getCreditAccount(auth.userId),
		]);
		out.account = {
			display_name: user?.display_name || null,
			plan: user?.plan || null,
			member_since: user?.created_at || null,
			credits_usd: credits?.balanceUsd ?? 0,
		};
	} else {
		out.account = null;
		out.account_note = 'Grant the profile scope to include plan, credits and display name.';
	}
	return out;
}

// three://agents  (api/marketplace/[action].js handleMine)
async function listAgentRows(userId, limit) {
	return sql`
		SELECT ai.id, ai.name, ai.description, ai.is_published, ai.created_at,
		       ai.meta->>'solana_address' AS solana_address,
		       ai.meta->'brain'->>'provider' AS model,
		       ai.avatar_id, av.storage_key, av.thumbnail_key, av.visibility
		  FROM agent_identities ai
		  LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
		 WHERE ai.user_id = ${userId} AND ai.deleted_at IS NULL
		 ORDER BY ai.created_at DESC
		 LIMIT ${limit}
	`;
}

async function readAgents(ctx) {
	const rows = await listAgentRows(ctx.auth.userId, 100);
	const agents = await Promise.all(
		rows.map(async (r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			model: r.model || null,
			solana_address: r.solana_address || null,
			is_published: Boolean(r.is_published),
			created_at: r.created_at,
			avatar: r.avatar_id ? { id: r.avatar_id, ...(await avatarUrls(r.storage_key, r.thumbnail_key, r.visibility)) } : null,
			uri: `three://agents/${r.id}`,
			page: `${origin()}/agents/${r.id}`,
		})),
	);
	return { count: agents.length, agents };
}

// three://agents/{agentId}  (api/agents.js handleGetOne, owner view)
async function readAgent(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const { getSkillPrices } = await import('../_lib/skill-price-cache.js');
	const [avatar] = row.avatar_id
		? await sql`SELECT storage_key, thumbnail_key, visibility FROM avatars WHERE id = ${row.avatar_id} AND deleted_at IS NULL`
		: [null];
	const prices = await getSkillPrices(row.id);
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		persona: row.persona_prompt || null,
		model: row.meta?.brain?.provider || null,
		skills: row.skills || [],
		skill_prices: prices.map((p) => ({
			skill: p.skill,
			amount: atomicToDecimal(p.amount, p.mint_decimals),
			currency_mint: p.currency_mint,
			chain: p.chain,
			trial_uses: num(p.trial_uses),
			pricing_type: p.pricing_type || 'per_call',
		})),
		solana_address: row.meta?.solana_address || null,
		is_published: Boolean(row.is_published),
		avatar: avatar ? { id: row.avatar_id, ...(await avatarUrls(avatar.storage_key, avatar.thumbnail_key, avatar.visibility)) } : null,
		created_at: row.created_at,
		updated_at: row.updated_at,
		...agentLinks(row.id),
	};
}

// three://agents/{agentId}/wallet  (api/agents/solana-wallet.js handleLimits,
// api/agents/solana-guard.js, api/_lib/agent-trade-guards.js)
async function readWallet(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const address = row.meta?.solana_address || null;
	const guards = await import('../_lib/agent-trade-guards.js');
	const { resolveSpendPolicy } = await import('../_lib/agent-spend-policy.js');
	const limits = guards.getSpendLimits(row.meta || {});
	const out = {
		agent_id: row.id,
		chain: 'solana',
		network: 'mainnet',
		address,
		frozen: Boolean(limits.frozen),
		spend_limits: {
			daily_usd: limits.daily_usd,
			per_tx_usd: limits.per_tx_usd,
			per_counterparty_daily_usd: limits.per_counterparty_daily_usd,
			require_capabilities: limits.require_capabilities,
			updated_at: limits.updated_at,
		},
		withdraw_allowlist: limits.withdraw_allowlist || [],
		trade_limits: guards.getTradeLimits(row.meta || {}),
		spend_policy: resolveSpendPolicy(row.meta || {}),
	};
	if (!address) {
		return {
			...out,
			balances: null,
			note: 'This agent has no Solana wallet yet. Run the setup-wallet prompt to provision one.',
		};
	}
	const { getBalances, walletUsdTotal } = await import('../_lib/balances.js');
	const [balances, spentUsd, latest] = await Promise.all([
		getBalances({ chain: 'solana', address }),
		guards.getDailySpendUsd(row.id, 'mainnet'),
		latestSignature(address),
	]);
	return {
		...out,
		balances: {
			sol: balances.native?.amount ?? null,
			sol_usd: balances.native?.usd ?? null,
			tokens: (balances.tokens || []).map((t) => ({
				mint: t.mint,
				symbol: t.symbol || null,
				name: t.name || null,
				amount: t.amount,
				usd: t.usd ?? null,
			})),
			total_usd: walletUsdTotal(balances),
			stale: Boolean(balances.stale),
		},
		spent_today_usd: spentUsd,
		latest_signature: latest,
		explorer: `https://solscan.io/account/${address}`,
	};
}

async function latestSignature(address) {
	const [{ PublicKey }, { solanaConnection }] = await Promise.all([
		import('@solana/web3.js'),
		import('../_lib/agent-pumpfun.js'),
	]);
	const sigs = await solanaConnection('mainnet').getSignaturesForAddress(new PublicKey(address), { limit: 1 });
	return sigs[0]?.signature || null;
}

// The wallet notification keys on the newest signature (any transfer in or out
// produces one) plus the guard settings the resource reports. Cheap: one RPC
// call and one row read, no balance fetch.
async function walletFingerprint(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const address = row.meta?.solana_address || null;
	const { getSpendLimits, getTradeLimits } = await import('../_lib/agent-trade-guards.js');
	const guardState = JSON.stringify([getSpendLimits(row.meta || {}), getTradeLimits(row.meta || {})]);
	const sig = address ? await latestSignature(address) : 'none';
	return hash(`${address}|${sig}|${guardState}`);
}

async function onWalletChanged(ctx, { agentId }) {
	const [row] = await sql`SELECT meta->>'solana_address' AS address FROM agent_identities WHERE id = ${agentId}`;
	if (!row?.address) return;
	const { invalidateBalances } = await import('../_lib/balances.js');
	await invalidateBalances({ chain: 'solana', address: row.address });
}

// three://agents/{agentId}/usage  (api/usage/summary.js, api/credits/,
// api/agents/_id/_sub.js handleUsage)
async function readUsage(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const { getCreditAccount } = await import('../_lib/credits.js');
	const { inferenceUsage } = await import('../_lib/inference-billing.js');
	const [byModel, byTool, daily, credits, inference] = await Promise.all([
		sql`
			SELECT coalesce(model, 'unknown') AS model, count(*)::int AS calls,
			       coalesce(sum(coalesce(input_tokens, 0)), 0)::bigint AS input_tokens,
			       coalesce(sum(coalesce(output_tokens, 0)), 0)::bigint AS output_tokens,
			       coalesce(sum(coalesce(cost_micro_usd, 0)), 0)::bigint AS cost_micro_usd
			  FROM usage_events
			 WHERE agent_id = ${row.id} AND kind = 'llm'
			   AND created_at >= date_trunc('month', now())
			 GROUP BY 1 ORDER BY calls DESC LIMIT 25
		`,
		sql`
			SELECT coalesce(tool, 'unknown') AS tool, count(*)::int AS calls
			  FROM usage_events
			 WHERE agent_id = ${row.id} AND kind = 'tool_call'
			   AND created_at >= date_trunc('month', now())
			 GROUP BY 1 ORDER BY calls DESC LIMIT 25
		`,
		sql`
			SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS llm_calls
			  FROM usage_events
			 WHERE agent_id = ${row.id} AND kind = 'llm'
			   AND created_at >= now() - interval '30 days'
			 GROUP BY 1 ORDER BY 1
		`,
		getCreditAccount(ctx.auth.userId),
		inferenceUsage({ userId: ctx.auth.userId, agent: row }),
	]);
	const models = byModel.map((m) => ({
		model: m.model,
		calls: m.calls,
		input_tokens: Number(m.input_tokens),
		output_tokens: Number(m.output_tokens),
		cost_usd: Number(m.cost_micro_usd) / 1e6,
	}));
	return {
		agent_id: row.id,
		period: 'current_month',
		llm: {
			calls: models.reduce((s, m) => s + m.calls, 0),
			tokens: models.reduce((s, m) => s + m.input_tokens + m.output_tokens, 0),
			cost_usd: models.reduce((s, m) => s + m.cost_usd, 0),
			by_model: models,
		},
		mcp_tool_calls: {
			calls: byTool.reduce((s, t) => s + t.calls, 0),
			by_tool: byTool,
		},
		daily_llm_calls_30d: daily.map((d) => ({ day: d.day, calls: d.llm_calls })),
		account_credits: {
			balance_usd: credits?.balanceUsd ?? 0,
			lifetime_spent_usd: credits?.lifetimeSpentUsd ?? 0,
			note: 'Credits are held per account and shared by all of your agents.',
		},
		// Self-funded inference (api/_lib/inference-billing.js): burn rate, runway,
		// this agent's budget and spend, the last top-ups with their Solana
		// signatures, and the auto top-up rule. Same shape as GET /api/me/usage.
		inference: {
			burn_rate_usd_per_day: inference.burn_rate_usd_per_day,
			days_remaining: inference.days_remaining,
			month: inference.inference_month,
			budget: inference.agent?.budget ?? null,
			spend: inference.agent?.spend ?? null,
			exhausted: inference.agent?.exhausted ?? null,
			auto_fund: inference.auto_fund ?? null,
			topups: inference.topups,
			pricing: inference.pricing,
			base_url: 'https://three.ws/api/v1',
		},
	};
}

// three://agents/{agentId}/chat  (agent_messages once the agents REST build
// lands; until then the concierge Q&A turns api/agent-ask.js stores and the
// replies the embodied agent speaks, both of which are per-agent)
async function readChat(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	if (await tableExists('agent_messages')) {
		const rows = await sql`
			SELECT id, role, content, model, created_at
			  FROM agent_messages
			 WHERE agent_id = ${row.id}
			 ORDER BY created_at DESC, id DESC
			 LIMIT 50
		`;
		return {
			agent_id: row.id,
			source: 'agent_messages',
			messages: rows.reverse().map((m) => ({ role: m.role, content: m.content, model: m.model, at: m.created_at })),
		};
	}
	const [qa, spoken] = await Promise.all([
		sql`
			SELECT content, created_at FROM agent_memories
			 WHERE agent_id = ${row.id} AND tags @> ARRAY['qa']::text[]
			   AND (expires_at IS NULL OR expires_at > now())
			 ORDER BY created_at DESC LIMIT 25
		`,
		sql`
			SELECT payload, source_skill, created_at FROM agent_actions
			 WHERE agent_id = ${row.id} AND type = 'speak'
			 ORDER BY created_at DESC LIMIT 50
		`,
	]);
	const messages = [];
	for (const m of qa) {
		const match = /^Q: ([\s\S]*?)\n\nA: ([\s\S]*)$/.exec(m.content || '');
		if (match) {
			messages.push({ role: 'user', content: match[1], at: m.created_at, channel: 'ask' });
			messages.push({ role: 'assistant', content: match[2], at: m.created_at, channel: 'ask' });
		}
	}
	for (const s of spoken) {
		const text = s.payload?.text;
		if (text) messages.push({ role: 'assistant', content: text, at: s.created_at, channel: s.source_skill || 'speak' });
	}
	messages.sort((a, b) => new Date(a.at) - new Date(b.at));
	return { agent_id: row.id, source: 'agent_memories+agent_actions', messages: messages.slice(-50) };
}

// three://agents/{agentId}/runs  (agent_runs once the agents REST build lands;
// until then the agent's recorded actions, which is what api/agents/activity.js
// serves as its activity feed)
async function readRuns(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	if (await tableExists('agent_runs')) {
		const rows = await sql`
			SELECT id, goal, status, model, step_count, max_steps, spent_usd, spent_credits_usd,
			       budget_usd, budget_credits_usd, result, error, created_at, started_at, finished_at
			  FROM agent_runs
			 WHERE agent_id = ${row.id}
			 ORDER BY created_at DESC LIMIT 50
		`;
		return {
			agent_id: row.id,
			source: 'agent_runs',
			runs: rows.map((r) => ({ ...r, uri: `three://agents/${row.id}/runs/${r.id}` })),
		};
	}
	const { rowToEntry } = await import('../_lib/agent-activity.js');
	const rows = await sql`
		SELECT id, type, payload, source_skill, signature, created_at
		  FROM agent_actions
		 WHERE agent_id = ${row.id}
		 ORDER BY created_at DESC, id DESC LIMIT 50
	`;
	return {
		agent_id: row.id,
		source: 'agent_actions',
		runs: rows.map((r) => ({
			id: String(r.id),
			type: r.type,
			summary: rowToEntry(r).activity,
			skill: r.source_skill || null,
			signature: r.signature || null,
			at: r.created_at,
			uri: `three://agents/${row.id}/runs/${r.id}`,
		})),
	};
}

async function readRun(ctx, { agentId, runId }) {
	const row = await ownedAgent(ctx, agentId);
	if (UUID_RE.test(runId) && (await tableExists('agent_runs'))) {
		const [run] = await sql`SELECT * FROM agent_runs WHERE id = ${runId} AND agent_id = ${row.id}`;
		if (!run) throw notFound(ctx.uri);
		const steps = await sql`
			SELECT seq, kind, provider, model, tool_name, input, output, input_tokens, output_tokens,
			       cost_micro_usd, latency_ms, created_at
			  FROM agent_run_steps WHERE run_id = ${run.id} ORDER BY seq ASC LIMIT 200
		`;
		const { checkpoint: _c, lease_owner: _o, lease_until: _u, ...visible } = run;
		return { ...visible, steps };
	}
	if (!/^\d{1,18}$/.test(runId)) throw notFound(ctx.uri);
	const [action] = await sql`
		SELECT id, type, payload, source_skill, signature, signer_address, created_at
		  FROM agent_actions WHERE id = ${runId} AND agent_id = ${row.id}
	`;
	if (!action) throw notFound(ctx.uri);
	return {
		id: String(action.id),
		agent_id: row.id,
		type: action.type,
		skill: action.source_skill || null,
		payload: action.payload,
		signature: action.signature || null,
		signer_address: action.signer_address || null,
		at: action.created_at,
		explorer: action.signature ? `https://solscan.io/tx/${action.signature}` : null,
	};
}

// three://agents/{agentId}/orders  (api/agents/orders.js, api/_lib/orders.js)
async function readOrders(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const { listOrders } = await import('../_lib/orders.js');
	const orders = await listOrders(row.id, { statuses: ['active', 'partial', 'firing'], limit: 100 });
	return { agent_id: row.id, status: 'open', count: orders.length, orders };
}

// three://agents/{agentId}/dca  (api/dca-strategies.js GET)
async function readDca(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const strategies = await sql`
		SELECT s.id, s.chain_id, s.token_in, s.token_out, s.token_out_symbol,
		       s.amount_per_execution, s.period_seconds, s.slippage_bps, s.status,
		       s.next_execution_at, s.last_execution_at, s.created_at, s.cancelled_at,
		       s.paused_at, s.consecutive_failures, s.last_error,
		       (SELECT json_build_object('tx_hash', e.tx_hash, 'amount_in', e.amount_in,
		                                 'amount_out', e.amount_out, 'status', e.status,
		                                 'executed_at', e.executed_at)
		          FROM dca_executions e WHERE e.strategy_id = s.id
		         ORDER BY e.executed_at DESC LIMIT 1) AS last_execution,
		       (SELECT count(*)::int FROM dca_executions e
		         WHERE e.strategy_id = s.id AND e.status = 'success') AS executions_total
		  FROM dca_strategies s
		 WHERE s.agent_id = ${row.id}
		 ORDER BY s.created_at DESC
	`;
	return { agent_id: row.id, count: strategies.length, strategies };
}

// three://agents/{agentId}/intents  (api/agents/wallet-intents.js)
async function readIntents(ctx, { agentId }) {
	const row = await ownedAgent(ctx, agentId);
	const { listIntents } = await import('../_lib/wallet-intents.js');
	const intents = await listIntents(row.id);
	return { agent_id: row.id, count: intents.length, intents };
}

// three://marketplace  (api/marketplace/, api/marketplace/trial-status.js,
// api/agents/economy.js view=offers)
async function readMarketplace(ctx) {
	const { listOffersWithStats } = await import('../_lib/agent-economy.js');
	const [skills, offers] = await Promise.all([
		sql`
			SELECT asp.agent_id, ai.name AS agent_name, asp.skill, asp.amount, asp.currency_mint,
			       asp.chain, asp.mint_decimals, asp.trial_uses, asp.pricing_type,
			       asp.time_pass_hours, asp.time_pass_amount
			  FROM agent_skill_prices asp
			  JOIN agent_identities ai ON ai.id = asp.agent_id AND ai.deleted_at IS NULL AND ai.is_published = true
			 WHERE asp.is_active = true
			 ORDER BY asp.updated_at DESC
			 LIMIT 100
		`,
		listOffersWithStats({ limit: 50 }),
	]);
	const out = {
		skills: skills.map((s) => ({
			agent_id: s.agent_id,
			agent_name: s.agent_name,
			skill: s.skill,
			price: atomicToDecimal(s.amount, s.mint_decimals),
			currency_mint: s.currency_mint,
			chain: s.chain,
			pricing_type: s.pricing_type || 'per_call',
			free_trial_uses: num(s.trial_uses) || 0,
			time_pass: s.time_pass_hours
				? { hours: num(s.time_pass_hours), price: atomicToDecimal(s.time_pass_amount, s.mint_decimals) }
				: null,
			page: `${origin()}/agents/${s.agent_id}?skill=${encodeURIComponent(s.skill)}`,
		})),
		agent_services: offers.map((o) => ({
			slug: o.slug,
			name: o.name,
			description: o.description,
			price_usdc: o.price_usdc,
			network: o.network,
			provider: o.provider,
			stats: o.stats,
		})),
		marketplace: `${origin()}/marketplace`,
	};
	if (ctx.auth?.userId) {
		const { buyerView } = await import('../marketplace/trial-status.js');
		const trials = await buyerView(ctx.auth.userId);
		out.your_trials = trials.trials.map((t) => ({
			agent_id: t.agentId,
			agent_name: t.agentName,
			skill: t.skill,
			remaining: t.trialRemaining,
			granted: t.trialUses,
			state: t.state,
		}));
	}
	return out;
}

// three://models  (api/_lib/chat-models.js, api/_lib/llm-pricing.js,
// api/brain/chat.js getAvailableProviders)
async function readModels() {
	const [{ getAvailableProviders, ANON_BRAIN_PROVIDERS }, { MODEL_CATALOG }, { modelPrice, isFreeLane }] =
		await Promise.all([
			import('../brain/chat.js'),
			import('../_lib/chat-models.js'),
			import('../_lib/llm-pricing.js'),
		]);
	const agentModels = getAvailableProviders().map((p) => {
		const free = ANON_BRAIN_PROVIDERS.has(p.key);
		return {
			id: p.key,
			label: p.label,
			network: p.network,
			tier: p.tier,
			max_output_tokens: p.maxOutput,
			available: p.available,
			free,
			// A key like ibm-granite names no priced model itself; the model it
			// routes to does.
			price_usd_per_mtok: free ? [0, 0] : modelPrice(p.key) || modelPrice(p.openrouterModel),
			description: p.description || null,
		};
	});
	const chatModels = Object.entries(MODEL_CATALOG).map(([id, m]) => {
		const free = isFreeLane(m.provider, id);
		return {
			id,
			provider: m.provider,
			tools: Boolean(m.tools),
			free,
			price_usd_per_mtok: free ? [0, 0] : modelPrice(id),
		};
	});
	return {
		agent_models: agentModels,
		chat_models: chatModels,
		note: 'agent_models ids are what an agent brain accepts (create_agent model argument). Prices are USD per million tokens, [input, output]; free models are [0, 0], and null means the model is not metered by list price.',
	};
}

// three://wallets  (every agent wallet the caller owns, api/_lib/balances.js)
async function readWallets(ctx) {
	const rows = await sql`
		SELECT id, name, meta->>'solana_address' AS address,
		       coalesce((meta->'spend_limits'->>'frozen')::boolean, false) AS frozen
		  FROM agent_identities
		 WHERE user_id = ${ctx.auth.userId} AND deleted_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT ${MAX_LISTED_AGENTS}
	`;
	const { getBalances, walletUsdTotal } = await import('../_lib/balances.js');
	const wallets = await Promise.all(
		rows.map(async (r) => {
			if (!r.address) return { agent_id: r.id, agent_name: r.name, address: null, balances: null };
			try {
				const b = await getBalances({ chain: 'solana', address: r.address });
				return {
					agent_id: r.id,
					agent_name: r.name,
					address: r.address,
					frozen: r.frozen,
					sol: b.native?.amount ?? null,
					tokens: (b.tokens || []).length,
					total_usd: walletUsdTotal(b),
					stale: Boolean(b.stale),
					uri: `three://agents/${r.id}/wallet`,
				};
			} catch (err) {
				return {
					agent_id: r.id,
					agent_name: r.name,
					address: r.address,
					frozen: r.frozen,
					error: `balance unavailable: ${err.message}`,
					uri: `three://agents/${r.id}/wallet`,
				};
			}
		}),
	);
	return {
		chain: 'solana',
		count: wallets.length,
		total_usd: wallets.reduce((s, w) => s + (w.total_usd || 0), 0),
		wallets,
	};
}

// three://launches  (api/pump/[action].js my-coins over pump_agent_mints)
async function readLaunches(ctx) {
	const rows = await sql`
		SELECT pam.mint, pam.name, pam.symbol, pam.network, pam.created_at, pam.quote_mint,
		       ai.id AS agent_id, ai.name AS agent_name
		  FROM pump_agent_mints pam
		  LEFT JOIN agent_identities ai ON ai.id = pam.agent_id AND ai.deleted_at IS NULL
		 WHERE pam.user_id = ${ctx.auth.userId}
		 ORDER BY pam.created_at DESC
		 LIMIT 200
	`;
	return {
		count: rows.length,
		launches: rows.map((r) => ({
			mint: r.mint,
			name: r.name,
			symbol: r.symbol,
			network: r.network,
			quote_mint: r.quote_mint || null,
			agent_id: r.agent_id,
			agent_name: r.agent_name,
			created_at: r.created_at,
			page: `${origin()}/launches`,
		})),
	};
}

// three://x402/services  (api/_mcpbazaar/tools.js browse_services)
async function readX402Services() {
	const [{ Bazaar }, { slim }] = await Promise.all([
		import('../_lib/x402/bazaar-client.js'),
		import('../_mcpbazaar/tools.js'),
	]);
	const { items, sources, errors } = await new Bazaar({}).listCached({ type: 'http', limit: 200, maxItems: 200 });
	return {
		count: items.length,
		facilitators: sources,
		errors: errors?.length ? errors : undefined,
		services: items.map(slim),
	};
}

// three://assets/{id} on /api/mcp-3d  (api/_lib/avatars.js getAvatar)
async function readAsset(ctx, { id }) {
	if (!UUID_RE.test(id)) throw notFound(ctx.uri);
	const { getAvatar, resolveAvatarUrl } = await import('../_lib/avatars.js');
	const avatar = await getAvatar({ id, requesterId: ctx.auth?.userId || null });
	if (!avatar) throw notFound(ctx.uri);
	const url = await resolveAvatarUrl(avatar);
	return {
		id: avatar.id,
		name: avatar.name,
		slug: avatar.slug,
		description: avatar.description,
		visibility: avatar.visibility,
		model_category: avatar.model_category,
		size_bytes: avatar.size_bytes,
		content_type: avatar.content_type,
		tags: avatar.tags,
		glb_url: url?.url || null,
		glb_url_expires_in: url?.cdn ? null : url?.expires_in ?? null,
		thumbnail_url: avatar.thumbnail_url,
		is_owner: Boolean(ctx.auth?.userId && avatar.owner_id === ctx.auth.userId),
		created_at: avatar.created_at,
		page: `${origin()}/avatars/${avatar.id}`,
	};
}

// ── Registry ──────────────────────────────────────────────────────────────────

const AGENT_SCOPES = ['agents:read', 'agents:write'];
const WALLET_SCOPES = ['wallet:read', 'wallet:write', 'agents:read', 'agents:write'];

// `tools` maps a server to a dedicated tool on that server returning the same
// data; read_resource covers every resource on every server regardless.
export const RESOURCES = [
	{
		key: 'me',
		uri: 'three://me',
		name: 'me',
		title: 'Your account',
		description: 'The signed-in account: credential type and scopes, daily MCP call quota and usage, plan and credit balance (profile scope).',
		access: 'user',
		read: readMe,
	},
	{
		key: 'agents',
		uri: 'three://agents',
		name: 'agents',
		title: 'Your agents',
		description: 'Every agent you own: name, model, Solana wallet address, avatar and page URL, newest first.',
		access: AGENT_SCOPES,
		read: readAgents,
	},
	{
		key: 'agent',
		uriTemplate: 'three://agents/{agentId}',
		name: 'agent',
		title: 'Agent',
		description: 'One agent you own: persona, model, skills and their prices, wallet address, avatar, and links to its wallet, usage, chat, runs, orders, DCA and intents resources.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readAgent,
	},
	{
		key: 'wallet',
		uriTemplate: 'three://agents/{agentId}/wallet',
		name: 'agent-wallet',
		title: 'Agent wallet',
		description: 'An agent\'s Solana wallet: address, SOL and token balances with USD values, spend limits, withdraw allowlist, trade limits, freeze state and spend today. Subscribe to be notified after any transfer.',
		access: WALLET_SCOPES,
		perAgent: true,
		read: readWallet,
		fingerprint: walletFingerprint,
		onChanged: onWalletChanged,
		tools: { 'mcp-agent': 'wallet_status' },
	},
	{
		key: 'usage',
		uriTemplate: 'three://agents/{agentId}/usage',
		name: 'agent-usage',
		title: 'Agent usage',
		description: 'This month\'s LLM calls, tokens and cost per model, MCP tool calls per tool, a 30-day daily series, your account credit balance, and self-funded inference: burn rate, days of credits left, this agent\'s inference budget, and the last wallet top-ups with their signatures.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readUsage,
	},
	{
		key: 'chat',
		uriTemplate: 'three://agents/{agentId}/chat',
		name: 'agent-chat',
		title: 'Agent chat history',
		description: 'The 50 most recent chat messages with an agent, oldest first.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readChat,
	},
	{
		key: 'runs',
		uriTemplate: 'three://agents/{agentId}/runs',
		name: 'agent-runs',
		title: 'Agent runs',
		description: 'An agent\'s 50 most recent autonomous runs (or, before runs are enabled on the account, its recorded actions: skills, replies, trades, launches), each with a URI for its detail.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readRuns,
	},
	{
		key: 'run',
		uriTemplate: 'three://agents/{agentId}/runs/{runId}',
		name: 'agent-run',
		title: 'Agent run',
		description: 'One run with every step (model call, tool call, result, cost), or one recorded action with its full payload and transaction signature.',
		access: AGENT_SCOPES,
		read: readRun,
	},
	{
		key: 'orders',
		uriTemplate: 'three://agents/{agentId}/orders',
		name: 'agent-orders',
		title: 'Agent open orders',
		description: 'An agent\'s open programmable orders (limit, stop, take-profit, trailing) with trigger prices, sizes and fill progress.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readOrders,
	},
	{
		key: 'dca',
		uriTemplate: 'three://agents/{agentId}/dca',
		name: 'agent-dca',
		title: 'Agent DCA strategies',
		description: 'An agent\'s dollar-cost-averaging strategies: pair, amount per execution, period, status, next run, and the latest execution.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readDca,
	},
	{
		key: 'intents',
		uriTemplate: 'three://agents/{agentId}/intents',
		name: 'agent-intents',
		title: 'Agent wallet intents',
		description: 'An agent\'s standing wallet intents (if this happens, do that): trigger, action, limits, fire count and last result.',
		access: AGENT_SCOPES,
		perAgent: true,
		read: readIntents,
	},
	{
		key: 'marketplace',
		uri: 'three://marketplace',
		name: 'marketplace',
		title: 'Skill marketplace',
		description: 'Paid agent skills with prices and free-trial allowances, agent-to-agent services with completion stats, and (signed in) the trials you hold.',
		access: 'public',
		read: readMarketplace,
	},
	{
		key: 'models',
		uri: 'three://models',
		name: 'models',
		title: 'Model catalog',
		description: 'Every model an agent brain can run, with availability, free-tier status and USD price per million input and output tokens.',
		access: 'public',
		read: readModels,
	},
	{
		key: 'wallets',
		uri: 'three://wallets',
		name: 'wallets',
		title: 'All agent wallets',
		description: 'A summary across every agent wallet you own: address, SOL, token count, USD value and freeze state, with a total.',
		access: WALLET_SCOPES,
		read: readWallets,
		tools: { 'mcp-agent': 'wallet_status' },
	},
	{
		key: 'launches',
		uri: 'three://launches',
		name: 'launches',
		title: 'Your token launches',
		description: 'Every token your agents launched through three.ws: mint, name, symbol, network and the launching agent.',
		access: AGENT_SCOPES,
		read: readLaunches,
	},
	{
		key: 'x402-services',
		uri: 'three://x402/services',
		name: 'x402-services',
		title: 'x402 service catalog',
		description: 'Paid agent services across the live x402 facilitator network: resource URL, price, payment networks and facilitator.',
		access: 'public',
		read: readX402Services,
		tools: { 'mcp-bazaar': 'browse_services', 'mcp-agent': 'find_services' },
	},
	{
		key: 'asset',
		uriTemplate: 'three://assets/{id}',
		name: 'asset',
		title: '3D asset',
		description: 'A 3D asset (avatar or generated model): name, visibility, size, GLB download URL and thumbnail. Public and unlisted assets are readable by anyone; private ones only by their owner.',
		access: 'public',
		read: readAsset,
	},
];

const BY_KEY = new Map(RESOURCES.map((r) => [r.key, r]));

// Which resources each hosted server exposes.
const SERVER_RESOURCES = {
	mcp: ['me', 'agents', 'agent', 'wallet', 'usage', 'chat', 'runs', 'run', 'orders', 'dca', 'intents', 'marketplace', 'models', 'wallets', 'launches', 'x402-services'],
	'mcp-agent': ['me', 'agents', 'agent', 'wallet', 'usage', 'runs', 'run', 'orders', 'dca', 'intents', 'wallets', 'launches', 'marketplace', 'x402-services'],
	'mcp-3d': ['me', 'agents', 'agent', 'asset', 'models'],
	'mcp-bazaar': ['me', 'x402-services', 'marketplace'],
};

/** The resource definitions a server exposes. */
export function resourcesFor(server) {
	const keys = SERVER_RESOURCES[server];
	if (!keys) throw new Error(`unknown MCP resource server: ${server}`);
	return keys.map((k) => BY_KEY.get(k));
}

/** Description with the tool equivalent on this server appended. */
export function describeFor(def, server) {
	const example = def.uri || def.uriTemplate;
	const dedicated = def.tools?.[server];
	const also = dedicated ? ` The ${dedicated} tool returns a summary of the same data.` : '';
	return `${def.description} Tool equivalent on this server: read_resource with uri "${example}".${also}`;
}

// ── URI matching ──────────────────────────────────────────────────────────────

function splitUri(raw) {
	if (typeof raw !== 'string' || !raw.startsWith('three://')) return null;
	const q = raw.indexOf('?');
	const path = q === -1 ? raw : raw.slice(0, q);
	const query = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
	return { path: path.replace(/\/+$/, ''), query };
}

function matchTemplate(template, path) {
	const t = template.slice('three://'.length).split('/');
	const p = path.slice('three://'.length).split('/');
	if (t.length !== p.length) return null;
	const params = {};
	for (let i = 0; i < t.length; i++) {
		const m = /^\{(\w+)\}$/.exec(t[i]);
		if (m) {
			if (!p[i]) return null;
			params[m[1]] = decodeURIComponent(p[i]);
		} else if (t[i] !== p[i]) {
			return null;
		}
	}
	return params;
}

/** Resolve a three:// URI to { def, params, format } on a server, or null. */
export function matchResource(server, rawUri) {
	const parts = splitUri(rawUri);
	if (!parts) return null;
	for (const def of resourcesFor(server)) {
		const params = matchTemplate(def.uri || def.uriTemplate, parts.path);
		if (params) {
			const format = parts.query.get('format');
			return { def, params, path: parts.path, format: format === 'markdown' || format === 'md' ? 'markdown' : 'json' };
		}
	}
	return null;
}

// ── Markdown rendering ────────────────────────────────────────────────────────

function cell(v, empty = '') {
	if (v === null || v === undefined) return empty;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
	return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);
}

function isScalar(v) {
	return v === null || v === undefined || v instanceof Date || typeof v !== 'object';
}

function renderValue(key, value, depth) {
	const heading = '#'.repeat(Math.min(depth + 2, 6));
	if (Array.isArray(value)) {
		if (!value.length) return `${heading} ${key}\n\nNone.\n`;
		if (value.every(isScalar)) return `${heading} ${key}\n\n${value.map((v) => `- ${cell(v)}`).join('\n')}\n`;
		const cols = [...new Set(value.flatMap((r) => Object.keys(r || {}).filter((k) => isScalar(r[k]))))].slice(0, 8);
		const rows = value.slice(0, 100).map((r) => `| ${cols.map((c) => cell(r?.[c])).join(' | ')} |`);
		const more = value.length > 100 ? `\n\n${value.length - 100} more not shown.` : '';
		return `${heading} ${key}\n\n| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n${rows.join('\n')}${more}\n`;
	}
	return `${heading} ${key}\n\n${renderObject(value, depth + 1)}`;
}

function renderObject(obj, depth) {
	const scalars = [];
	const blocks = [];
	for (const [k, v] of Object.entries(obj || {})) {
		if (v === undefined) continue;
		if (isScalar(v)) scalars.push(`- **${k}**: ${cell(v, 'not set')}`);
		else blocks.push(renderValue(k, v, depth));
	}
	return [scalars.join('\n'), ...blocks].filter(Boolean).join('\n\n') + '\n';
}

export function toMarkdown(title, uri, data) {
	return `# ${title}\n\n\`${uri}\`\n\n${renderObject(data, 0)}`;
}

// ── Method handlers ───────────────────────────────────────────────────────────

function hash(s) {
	return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

async function fingerprintFor(match, ctx) {
	if (match.def.fingerprint) return match.def.fingerprint(ctx, match.params);
	const data = await match.def.read(ctx, match.params);
	return hash(JSON.stringify(data));
}

function listEntry(server, def, uri, extra = {}) {
	return {
		uri,
		name: extra.name || def.name,
		title: extra.title || def.title,
		description: describeFor(def, server),
		mimeType: JSON_MIME,
	};
}

async function listResources(server, auth, cursor) {
	const defs = resourcesFor(server).filter((d) => canRead(d.access, auth));
	const entries = defs.filter((d) => d.uri).map((d) => listEntry(server, d, d.uri));
	const perAgent = defs.filter((d) => d.perAgent);
	if (auth?.userId && perAgent.length) {
		const agents = await listAgentRows(auth.userId, MAX_LISTED_AGENTS);
		for (const a of agents) {
			for (const d of perAgent) {
				const uri = d.uriTemplate.replace('{agentId}', a.id);
				entries.push(listEntry(server, d, uri, { name: `${d.name}:${a.id}`, title: `${a.name}: ${d.title}` }));
			}
		}
	}
	const offset = cursor ? Number.parseInt(Buffer.from(String(cursor), 'base64url').toString(), 10) || 0 : 0;
	const page = entries.slice(offset, offset + PAGE_SIZE);
	const next = offset + PAGE_SIZE < entries.length ? Buffer.from(String(offset + PAGE_SIZE)).toString('base64url') : undefined;
	return next ? { resources: page, nextCursor: next } : { resources: page };
}

function listTemplates(server) {
	return {
		resourceTemplates: resourcesFor(server)
			.filter((d) => d.uriTemplate)
			.map((d) => ({
				uriTemplate: d.uriTemplate,
				name: d.name,
				title: d.title,
				description: describeFor(d, server),
				mimeType: JSON_MIME,
			})),
	};
}

function wantsMarkdown(match, params) {
	if (match.format === 'markdown') return true;
	const accept = params?.accept || params?._meta?.accept || params?.mimeType;
	return typeof accept === 'string' && accept.includes(MARKDOWN_MIME);
}

/**
 * Read one resource and return its data object. Shared by resources/read and
 * the read_resource tool so both paths enforce the same access rules.
 */
export async function readResourceData(server, uri, auth, req) {
	const match = matchResource(server, uri);
	if (!match) throw notFound(uri);
	assertAccess(match.def, auth, uri);
	const ctx = { auth, req, uri: match.path, server };
	const data = await match.def.read(ctx, match.params);
	return { match, data };
}

/**
 * The read_resource tool: the same data as resources/read for clients that
 * only render tools. With no uri it returns the resource index for the caller.
 */
export async function readResourceToolResult(server, args, auth, req) {
	if (!args?.uri) {
		const [{ resources }, { resourceTemplates }] = await Promise.all([
			listResources(server, auth),
			Promise.resolve(listTemplates(server)),
		]);
		const index = {
			resources: resources.map((r) => ({ uri: r.uri, title: r.title })),
			templates: resourceTemplates.map((t) => ({ uriTemplate: t.uriTemplate, title: t.title })),
		};
		return { content: [{ type: 'text', text: JSON.stringify(index, null, 2) }], structuredContent: index };
	}
	let match;
	let data;
	try {
		({ match, data } = await readResourceData(server, args.uri, auth, req));
	} catch (err) {
		// A tool reports a designed error in its result rather than as a
		// protocol error, so the model can read the hint and recover.
		if (err.code === NOT_FOUND || err.code === AUTH_REQUIRED) {
			return {
				content: [{ type: 'text', text: `Error: ${err.message}${err.data?.hint ? `. ${err.data.hint}` : ''}` }],
				isError: true,
			};
		}
		throw err;
	}
	const text =
		args.format === 'markdown' || match.format === 'markdown'
			? toMarkdown(match.def.title, match.path, data)
			: JSON.stringify(data, null, 2);
	return { content: [{ type: 'text', text }], structuredContent: data };
}

async function readResource(server, params, auth, req) {
	const uri = params?.uri;
	const { match, data } = await readResourceData(server, uri, auth, req);
	if (wantsMarkdown(match, params)) {
		return { contents: [{ uri, mimeType: MARKDOWN_MIME, text: toMarkdown(match.def.title, match.path, data) }] };
	}
	return { contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(data, null, 2) }] };
}

/**
 * The key a subscription is stored under: the client's Mcp-Session-Id when it
 * sends one, otherwise the credential itself, so a POST subscribe and the GET
 * stream from the same client meet at the same key.
 */
export function subscriberKey(auth, req) {
	const session = req?.headers?.['mcp-session-id'];
	if (typeof session === 'string' && session.length > 0 && session.length <= 200) return `session:${session}`;
	const cred = auth.apiKeyId ? `key:${auth.apiKeyId}` : auth.clientId ? `client:${auth.clientId}` : auth.source || 'token';
	return `user:${auth.userId}:${cred}`;
}

async function subscribe(server, params, auth, req) {
	const uri = params?.uri;
	if (!auth?.userId) {
		throw rpcError(AUTH_REQUIRED, 'Subscriptions need a signed-in client: connect with OAuth or an API key', { uri });
	}
	const match = matchResource(server, uri);
	if (!match) throw notFound(uri);
	assertAccess(match.def, auth, uri);
	const ctx = { auth, req, uri: match.path, server };
	const fingerprint = await fingerprintFor(match, ctx);
	const key = subscriberKey(auth, req);
	const [{ n }] = await sql`
		SELECT count(*)::int AS n FROM mcp_resource_subscriptions
		 WHERE server = ${server} AND subscriber_key = ${key} AND uri <> ${match.path}
	`;
	if (n >= MAX_SUBSCRIPTIONS) {
		throw rpcError(-32602, `Subscription limit reached (${MAX_SUBSCRIPTIONS} per client). Unsubscribe from one first.`);
	}
	await sql`
		INSERT INTO mcp_resource_subscriptions (server, subscriber_key, user_id, uri, fingerprint, checked_at)
		VALUES (${server}, ${key}, ${auth.userId}, ${match.path}, ${fingerprint}, now())
		ON CONFLICT (server, subscriber_key, uri)
		DO UPDATE SET fingerprint = EXCLUDED.fingerprint, checked_at = now(), created_at = now()
	`;
	return {};
}

async function unsubscribe(server, params, auth, req) {
	if (!auth?.userId) return {};
	const parts = splitUri(params?.uri);
	if (!parts) throw notFound(params?.uri);
	await sql`
		DELETE FROM mcp_resource_subscriptions
		 WHERE server = ${server} AND subscriber_key = ${subscriberKey(auth, req)} AND uri = ${parts.path}
	`;
	return {};
}

/** Drop every subscription a client holds (DELETE of its MCP session). */
export async function dropSubscriptions(server, auth, req) {
	if (!auth?.userId) return;
	await sql`
		DELETE FROM mcp_resource_subscriptions
		 WHERE server = ${server} AND subscriber_key = ${subscriberKey(auth, req)}
	`;
}

/**
 * Serve a resources/* method, or return undefined when `method` is not one.
 * Callers wrap the result in their JSON-RPC envelope.
 */
export async function handleResourceMethod(server, method, params, auth, req) {
	try {
		return await routeResourceMethod(server, method, params, auth, req);
	} catch (err) {
		// Designed JSON-RPC errors (numeric codes) go to the client as-is. Anything
		// else (a driver or RPC failure) is logged in full and answered with a
		// generic internal error, so SQL states and hostnames never leak.
		if (typeof err.code === 'number') throw err;
		const ref = randomUUID().slice(0, 8);
		console.error(`[mcp-resources] ${server} ${method} failed (ref ${ref})`, params?.uri, err);
		throw rpcError(-32603, `Could not read ${params?.uri || 'resources'} right now. Retry shortly (ref ${ref}).`, {
			uri: params?.uri,
			ref,
		});
	}
}

async function routeResourceMethod(server, method, params, auth, req) {
	switch (method) {
		case 'resources/list':
			return listResources(server, auth, params?.cursor);
		case 'resources/templates/list':
			return listTemplates(server);
		case 'resources/read':
			return readResource(server, params, auth, req);
		case 'resources/subscribe':
			return subscribe(server, params, auth, req);
		case 'resources/unsubscribe':
			return unsubscribe(server, params, auth, req);
		default:
			return undefined;
	}
}

export const RESOURCE_CAPABILITIES = Object.freeze({ subscribe: true, listChanged: false });

// ── Subscription stream ───────────────────────────────────────────────────────

const POLL_MS = 10_000;
const HEARTBEAT_MS = 15_000;
// Close before Cloud Run's request deadline; the client reconnects the GET
// stream and its subscriptions are still in the table.
const MAX_STREAM_MS = 840_000;

/**
 * Check every subscription a client holds once. Emits one notification per
 * resource whose fingerprint moved, and drops subscriptions whose resource is
 * gone or no longer readable. Exported for the stream and for tests.
 */
export async function pollSubscriptions(server, auth, req, notify) {
	const key = subscriberKey(auth, req);
	const subs = await sql`
		SELECT id, uri, fingerprint FROM mcp_resource_subscriptions
		 WHERE server = ${server} AND subscriber_key = ${key}
		 ORDER BY id ASC LIMIT ${MAX_SUBSCRIPTIONS}
	`;
	for (const sub of subs) {
		const match = matchResource(server, sub.uri);
		const ctx = { auth, req, uri: sub.uri, server };
		let fingerprint;
		try {
			if (!match) throw notFound(sub.uri);
			assertAccess(match.def, auth, sub.uri);
			fingerprint = await fingerprintFor(match, ctx);
		} catch (err) {
			if (err.code === NOT_FOUND || err.code === AUTH_REQUIRED) {
				await sql`DELETE FROM mcp_resource_subscriptions WHERE id = ${sub.id}`;
			}
			continue;
		}
		if (fingerprint === sub.fingerprint) {
			await sql`UPDATE mcp_resource_subscriptions SET checked_at = now() WHERE id = ${sub.id}`;
			continue;
		}
		await sql`
			UPDATE mcp_resource_subscriptions
			   SET fingerprint = ${fingerprint}, checked_at = now(), notified_at = now()
			 WHERE id = ${sub.id}
		`;
		if (match.def.onChanged) await match.def.onChanged(ctx, match.params).catch(() => {});
		notify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: sub.uri } });
	}
	return subs.length;
}

/**
 * The server-to-client half of Streamable HTTP for an authenticated GET: an
 * SSE stream that carries notifications/resources/updated for the caller's
 * subscriptions. Polls every POLL_MS, heartbeats so proxies keep it open.
 */
export async function streamSubscriptions(server, req, res, auth) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();
	let open = true;
	req.on('close', () => {
		open = false;
	});
	const send = (message) => {
		if (!open || res.writableEnded) return;
		try {
			res.write(`id: ${randomUUID()}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
		} catch {
			open = false;
		}
	};
	const deadline = Date.now() + MAX_STREAM_MS;
	let lastBeat = Date.now();
	res.write('retry: 5000\n\n');
	while (open && Date.now() < deadline) {
		try {
			await pollSubscriptions(server, auth, req, send);
		} catch (err) {
			console.warn('[mcp-resources] subscription poll failed', server, err?.message);
		}
		const until = Date.now() + POLL_MS;
		while (open && Date.now() < until) {
			if (Date.now() - lastBeat >= HEARTBEAT_MS) {
				try {
					res.write(': keepalive\n\n');
				} catch {
					open = false;
				}
				lastBeat = Date.now();
			}
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!res.writableEnded) res.end();
}
