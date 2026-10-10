// Sell a whole agent as a paid x402 API.
//
// An owner flips "Sell this agent as an API" on the agent wallet's Earn tab,
// sets a USD price per call and a short public description. The config lives on
// the agent (meta.api_service = { active, price_usd, description, updated_at })
// and POST /api/x402/agents/:id turns it into a stable pay-per-call endpoint:
// the buyer gets a 402, pays USDC on Solana straight to the agent's payout
// wallet, and the agent answers one turn. This module is the single source of
// truth for the rules every surface shares: what a valid config is, which
// agents may be sold, where the money goes, and how a sale is recorded.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';
import { env } from './env.js';
import { calculateFee, getFeeBps } from './fee.js';
import { normalizeLegacyPolicy } from './embed-policy.js';
import { insertNotification } from './notify.js';
import { ownWalletFor, resolvePayoutAddress } from './payout.js';
import { isValidSolanaAddress } from './validate.js';
import { MIN_SPONSOR_SETTLE_ATOMIC } from './x402/self-facilitator.js';
import { NETWORK_SOLANA_MAINNET } from './x402-spec.js';

// The revenue ledger's `skill` value for a whole-agent API sale.
export const AGENT_API_SKILL = 'agent-api';

// The facilitator refuses to co-sign a settle below MIN_SPONSOR_SETTLE_ATOMIC
// (it would burn more SOL in fees than it moves), so that is the floor price.
export const MIN_PRICE_ATOMICS = Math.max(1, MIN_SPONSOR_SETTLE_ATOMIC);
export const MIN_PRICE_USD = MIN_PRICE_ATOMICS / 1e6;
// A ceiling keeps a typo ("50" meant as cents) from pricing a chat turn at
// hundreds of dollars. Owners who need more can raise it here with a reason.
export const MAX_PRICE_USD = 50;
export const DESCRIPTION_MAX = 280;
export const DESCRIPTION_MIN = 10;

// Request limits for a paid call.
export const MESSAGE_MAX = 4000;
export const HISTORY_MAX_TURNS = 20;
export const BODY_MAX_BYTES = 32 * 1024;

export class AgentServiceError extends Error {
	constructor(status, code, message) {
		super(message);
		this.name = 'AgentServiceError';
		this.status = status;
		this.code = code;
	}
}

/** USD (number) to USDC atomics (string), rounded to the 6-decimal grid. */
export function usdToAtomics(usd) {
	return String(Math.round(Number(usd) * 1_000_000));
}

/** The stable public URL buyers call. */
export function agentServiceUrl(agentId) {
	return `${env.APP_ORIGIN}/api/x402/agents/${agentId}`;
}

/** The stored config, normalized. Absent or malformed config reads as inactive. */
export function readServiceConfig(agent) {
	const raw = agent?.meta?.api_service;
	if (!raw || typeof raw !== 'object') return { active: false, price_usd: null, description: '' };
	const price = Number(raw.price_usd);
	return {
		active: raw.active === true,
		price_usd: Number.isFinite(price) && price > 0 ? price : null,
		description: typeof raw.description === 'string' ? raw.description : '',
		updated_at: raw.updated_at || null,
	};
}

/**
 * Validate an owner's config write. Returns the normalized config to store, or
 * throws AgentServiceError(400) naming the first bad field.
 */
export function validateServiceConfig(input) {
	if (!input || typeof input !== 'object') {
		throw new AgentServiceError(400, 'validation_error', 'body must be an object');
	}
	const active = input.active === true;
	const price = Number(input.price_usd);
	if (!Number.isFinite(price)) {
		throw new AgentServiceError(400, 'invalid_price', 'price_usd must be a number');
	}
	const atomics = Number(usdToAtomics(price));
	if (atomics < MIN_PRICE_ATOMICS) {
		throw new AgentServiceError(
			400,
			'invalid_price',
			`price_usd must be at least $${MIN_PRICE_USD}, the smallest payment the facilitator settles`,
		);
	}
	if (price > MAX_PRICE_USD) {
		throw new AgentServiceError(400, 'invalid_price', `price_usd must be at most $${MAX_PRICE_USD}`);
	}
	const description = typeof input.description === 'string' ? input.description.trim().replace(/\s+/g, ' ') : '';
	if (description.length > DESCRIPTION_MAX) {
		throw new AgentServiceError(400, 'invalid_description', `description must be at most ${DESCRIPTION_MAX} characters`);
	}
	if (active && description.length < DESCRIPTION_MIN) {
		throw new AgentServiceError(
			400,
			'invalid_description',
			`write a public description of at least ${DESCRIPTION_MIN} characters so buyers know what they are paying for`,
		);
	}
	return { active, price_usd: atomics / 1e6, description };
}

/**
 * Why an agent can or cannot be sold. `reasons` are owner-facing sentences the
 * Earn tab shows verbatim; `ok` is true only when there are none.
 *   - The agent must be public: a private agent has no public endpoint.
 *   - Its embed policy must leave it a brain: brain.mode "none" means the owner
 *     turned answering off everywhere, so a paid call could never be served.
 *   - It must have a Solana payout address, because the buyer's USDC settles
 *     straight to it and Solana is the rail every buyer can pay on.
 */
export function sellability(agent, { solanaPayTo }) {
	const reasons = [];
	if (!agent || agent.deleted_at) reasons.push('This agent no longer exists.');
	if (agent && agent.is_public !== true) {
		reasons.push('The agent is private. Make it public so buyers can reach it.');
	}
	const policy = normalizeLegacyPolicy(agent?.embed_policy);
	if (policy?.brain?.mode === 'none') {
		reasons.push("The agent's embed policy turns its brain off (brain mode \"none\"), so it cannot answer calls.");
	}
	if (!solanaPayTo || !isValidSolanaAddress(solanaPayTo)) {
		reasons.push('The agent has no Solana payout address. Provision its Solana wallet or add a Solana payout wallet first.');
	}
	return { ok: reasons.length === 0, reasons };
}

/** Where a sale settles: the Solana payout (required) and a Base payout when one exists. */
export async function resolveServicePayTo(agentId) {
	const [solana, base] = await Promise.all([
		resolvePayoutAddress(agentId, 'solana'),
		resolvePayoutAddress(agentId, 'base'),
	]);
	return { solana: solana || null, base: base || null };
}

/** Load one agent with everything the paid route and the owner route need. */
export async function loadServiceAgent(agentId) {
	const [row] = await sql`
		SELECT ai.id, ai.user_id, ai.name, ai.description, ai.meta, ai.skills, ai.embed_policy,
		       ai.is_public, ai.deleted_at, ai.avatar_url, ai.profile_image_url, ai.updated_at
		FROM agent_identities ai
		WHERE ai.id = ${agentId} AND ai.deleted_at IS NULL
		LIMIT 1
	`;
	return row || null;
}

/** Persist a validated config onto the agent (merged into meta, other keys untouched). */
export async function saveServiceConfig(agentId, config) {
	const stored = { ...config, updated_at: new Date().toISOString() };
	const [row] = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{api_service}', ${JSON.stringify(stored)}::jsonb, true),
		    updated_at = now()
		WHERE id = ${agentId} AND deleted_at IS NULL
		RETURNING meta
	`;
	return row ? readServiceConfig({ meta: row.meta }) : null;
}

/**
 * Every agent currently sold as an API, for discovery (/.well-known/x402.json,
 * GET /api/x402/agents, the /x402 catalog). Applies the same sellability rules
 * as the live route, so nothing is listed that would refuse a paid call.
 */
export async function listActiveAgentServices({ limit = 200 } = {}) {
	const capped = Math.max(1, Math.min(500, Number(limit) || 200));
	const rows = await sql`
		SELECT ai.id, ai.user_id, ai.name, ai.description, ai.meta, ai.skills, ai.embed_policy,
		       ai.is_public, ai.deleted_at, ai.avatar_url, ai.profile_image_url, ai.updated_at,
		       ai.wallet_address,
		       ai.meta->>'solana_address' AS solana_address,
		       (SELECT pw.address FROM agent_payout_wallets pw
		         WHERE pw.agent_id = ai.id AND pw.chain = 'solana'
		           AND pw.approved_at IS NOT NULL AND pw.effective_at <= now()
		         ORDER BY pw.is_default DESC, pw.created_at DESC LIMIT 1) AS payout_solana
		FROM agent_identities ai
		WHERE ai.deleted_at IS NULL
		  AND ai.is_public = true
		  AND ai.meta->'api_service'->>'active' = 'true'
		ORDER BY ai.updated_at DESC
		LIMIT ${capped}
	`;
	const out = [];
	for (const row of rows) {
		const solanaPayTo = row.payout_solana || ownWalletFor('solana', row);
		const cfg = readServiceConfig(row);
		if (!cfg.active || !cfg.price_usd) continue;
		if (!sellability(row, { solanaPayTo }).ok) continue;
		out.push({
			agent_id: row.id,
			name: row.name,
			description: cfg.description || row.description || '',
			image: row.profile_image_url || row.avatar_url || null,
			price_usd: cfg.price_usd,
			price_atomics: usdToAtomics(cfg.price_usd),
			network: NETWORK_SOLANA_MAINNET,
			network_label: 'solana-mainnet',
			asset: env.X402_ASSET_MINT_SOLANA || null,
			pay_to: solanaPayTo,
			url: agentServiceUrl(row.id),
			path: `/api/x402/agents/${row.id}`,
			method: 'POST',
			profile_url: `${env.APP_ORIGIN}/agents/${row.id}`,
		});
	}
	return out;
}

const CAIP_TO_CHAIN = { [NETWORK_SOLANA_MAINNET]: 'solana' };

/**
 * Record one settled sale on the revenue ledger, net of the platform fee
 * (PLATFORM_FEE_BPS via fee.js). Idempotent on the settlement transaction: the
 * unique index on intent_id means a retried hook never double-counts.
 * settled_to_wallet = true because the buyer paid the agent's wallet directly;
 * the row is income, never a treasury withdrawal liability.
 */
export async function recordAgentApiSale({ agent, payer, network, txHash, amountAtomics, asset }) {
	const gross = Number(amountAtomics);
	if (!Number.isFinite(gross) || gross <= 0) return null;
	const { fee, net } = calculateFee(gross);
	const intentId = txHash ? `x402:${txHash}` : `x402:${network || 'unknown'}:${randomUUID()}`;
	const chain = CAIP_TO_CHAIN[network] || (String(network || '').startsWith('eip155:') ? 'base' : 'solana');
	const rows = await sql`
		INSERT INTO agent_revenue_events
			(agent_id, intent_id, skill, gross_amount, fee_amount, net_amount,
			 currency_mint, chain, payer_address, owner_user_id, settled_to_wallet)
		VALUES
			(${agent.id}, ${intentId}, ${AGENT_API_SKILL}, ${gross}, ${fee}, ${net},
			 ${asset || env.X402_ASSET_MINT_SOLANA}, ${chain}, ${payer || null}, ${agent.user_id}, true)
		ON CONFLICT (intent_id) WHERE intent_id IS NOT NULL DO NOTHING
		RETURNING id
	`;
	if (rows.length && agent.user_id) {
		insertNotification(agent.user_id, 'payment_received', {
			agent_id: agent.id,
			agent_name: agent.name,
			skill: AGENT_API_SKILL,
			net_amount: net,
			currency_mint: asset || env.X402_ASSET_MINT_SOLANA,
			tx: txHash || null,
		});
	}
	return rows[0]?.id ?? null;
}

/** Owner-facing earnings for the service, straight from agent_revenue_events. */
export async function agentApiEarnings(agentId, { recent = 10 } = {}) {
	const [totals] = await sql`
		SELECT COUNT(*)::int AS calls,
		       COALESCE(SUM(gross_amount), 0)::text AS gross,
		       COALESCE(SUM(fee_amount), 0)::text AS fee,
		       COALESCE(SUM(net_amount), 0)::text AS net,
		       COALESCE(SUM(net_amount) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::text AS net_week,
		       MAX(created_at) AS last_at
		FROM agent_revenue_events
		WHERE agent_id = ${agentId} AND skill = ${AGENT_API_SKILL}
	`;
	const rows = await sql`
		SELECT intent_id, gross_amount, net_amount, payer_address, created_at
		FROM agent_revenue_events
		WHERE agent_id = ${agentId} AND skill = ${AGENT_API_SKILL}
		ORDER BY created_at DESC
		LIMIT ${Math.max(1, Math.min(50, recent))}
	`;
	const usd = (v) => Number(v || 0) / 1e6;
	return {
		calls: totals?.calls ?? 0,
		gross_usd: usd(totals?.gross),
		fee_usd: usd(totals?.fee),
		net_usd: usd(totals?.net),
		net_week_usd: usd(totals?.net_week),
		last_at: totals?.last_at ?? null,
		fee_bps: getFeeBps(),
		recent: rows.map((r) => ({
			tx: String(r.intent_id || '').startsWith('x402:') ? String(r.intent_id).slice(5) : null,
			gross_usd: usd(r.gross_amount),
			net_usd: usd(r.net_amount),
			payer: r.payer_address || null,
			created_at: r.created_at,
		})),
	};
}

/**
 * Parse and bound a paid call's body: { message, history? }. Throws
 * AgentServiceError(400|413) before any payment is verified, so a malformed
 * call is never charged and never reaches the facilitator.
 */
export function parseCallBody(raw) {
	if (raw.length > BODY_MAX_BYTES) {
		throw new AgentServiceError(413, 'payload_too_large', `body must be at most ${BODY_MAX_BYTES} bytes`);
	}
	let body;
	try {
		body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
	} catch {
		throw new AgentServiceError(400, 'invalid_json', 'body must be JSON: { "message": "...", "history": [] }');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new AgentServiceError(400, 'validation_error', 'body must be a JSON object with a "message" string');
	}
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	if (!message) throw new AgentServiceError(400, 'validation_error', '"message" is required');
	if (message.length > MESSAGE_MAX) {
		throw new AgentServiceError(400, 'validation_error', `"message" must be at most ${MESSAGE_MAX} characters`);
	}
	const history = body.history == null ? [] : body.history;
	if (!Array.isArray(history)) throw new AgentServiceError(400, 'validation_error', '"history" must be an array');
	if (history.length > HISTORY_MAX_TURNS) {
		throw new AgentServiceError(400, 'validation_error', `"history" holds at most ${HISTORY_MAX_TURNS} turns`);
	}
	const turns = history.map((h, i) => {
		const role = h?.role;
		const content = typeof h?.content === 'string' ? h.content : '';
		if (role !== 'user' && role !== 'assistant') {
			throw new AgentServiceError(400, 'validation_error', `history[${i}].role must be "user" or "assistant"`);
		}
		if (!content || content.length > MESSAGE_MAX) {
			throw new AgentServiceError(400, 'validation_error', `history[${i}].content must be 1 to ${MESSAGE_MAX} characters`);
		}
		return { role, content };
	});
	return { message, history: turns };
}

// Wire contract for a paid call, shared by the live 402 (bazaar extension) and
// every discovery listing so the two can never describe different inputs.
export const CALL_INPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['message'],
	additionalProperties: false,
	properties: {
		message: {
			type: 'string',
			minLength: 1,
			maxLength: MESSAGE_MAX,
			description: 'What you want the agent to answer.',
		},
		history: {
			type: 'array',
			maxItems: HISTORY_MAX_TURNS,
			description: 'Earlier turns of this conversation, oldest first. Optional.',
			items: {
				type: 'object',
				required: ['role', 'content'],
				additionalProperties: false,
				properties: {
					role: { type: 'string', enum: ['user', 'assistant'] },
					content: { type: 'string', minLength: 1, maxLength: MESSAGE_MAX },
				},
			},
		},
	},
};

export const CALL_OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['reply', 'model'],
	properties: {
		reply: { type: 'string', description: "The agent's answer." },
		model: { type: 'string', description: 'The model that produced the reply.' },
		usage: {
			type: ['object', 'null'],
			description: 'Token usage reported by the model provider, when it reports one.',
		},
		agent_id: { type: 'string' },
	},
};

export const CALL_INPUT_EXAMPLE = { message: 'What can you help me with?', history: [] };
export const CALL_OUTPUT_EXAMPLE = {
	reply: 'I can answer questions about my projects, explain how I work, and point you to the right tools.',
	model: 'claude-haiku-4-5-20251001',
	usage: { input_tokens: 412, output_tokens: 38 },
	agent_id: '00000000-0000-4000-8000-000000000000',
};

/** A printable-ASCII service name (the x402 bazaar rejects anything else). */
export function serviceNameFor(agent) {
	const ascii = String(agent?.name || '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
	return `three.ws agent: ${ascii || 'unnamed'}`.slice(0, 64);
}
