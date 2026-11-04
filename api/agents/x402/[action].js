// Consolidated x402 payment endpoints (invoke + manifest).

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse, isUuid } from '../../_lib/validate.js';
import { emit402, verifyPaid, consumeIntent, releaseIntent, manifestOnly } from '../../_lib/x402.js';
import { calculateFee } from '../../_lib/fee.js';
import { insertNotification } from '../../_lib/notify.js';
import { hasSkillAccess, consumeTrialUse, logSkillUsage } from '../../_lib/skill-access.js';
import { enforceOnchainLicense } from '../../_lib/skill-license-verify.js';
import { runOnce, argsDigest, normalizeIdempotencyKey, IDEMPOTENCY_KEY_MAX } from '../../_lib/idempotency.js';

const HANDLERS = { echo: async (args) => ({ ok: true, echoed: args }) };

// Run a skill either via a registered server handler or by delegating to the
// in-process skill-runtime. The skill name on the agent is treated as a
// "<skill>.<tool>" qualifier; a bare call defaults the tool to the skill name —
// the runtime surfaces a descriptive error if there's no matching export.
async function executeSkill(agent, body, caller, signerAddress) {
	if (HANDLERS[body.skill]) {
		return HANDLERS[body.skill](body.args, { agent, caller });
	}
	const { makeRuntime } = await import('../../_lib/skill-runtime.js');
	const runtime = makeRuntime({ agentId: agent.id, signerAddress });
	const tool = typeof body.args?._tool === 'string' ? body.args._tool : body.skill;
	return runtime.invoke(`${body.skill}.${tool}`, body.args);
}

// C1 — x402 bridge: prices come from the canonical agent_skill_prices table
// first (the marketplace's source of truth), with the legacy meta.skill_prices
// jsonb as a fallback for agents priced before the marketplace migration.
// Returns null when the skill has no canonical price — callers must respond
// with 409 no_payments rather than synthesize a price.
async function priceFor(agent, skill) {
	const [row] = await sql`
		SELECT amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agent.id} AND skill = ${skill} AND is_active = true
	`;
	if (row) return { amount: String(row.amount), currency: row.currency_mint, chain: row.chain };

	return metaPrice(agent, skill);
}

// Legacy pricing: agents priced via meta.skill_prices (or a meta default) before
// the agent_skill_prices marketplace migration. Both invoke and manifest fall
// back to this so pre-migration agents keep working.
function metaPrice(agent, skill) {
	const prices = agent.meta?.skill_prices || {};
	const fromMap = prices[skill];
	if (fromMap?.amount && fromMap?.currency) {
		return { amount: String(fromMap.amount), currency: fromMap.currency, chain: fromMap.chain ?? 'solana' };
	}
	const defaultPrice = agent.meta?.payments?.default_price;
	if (defaultPrice?.amount && defaultPrice?.currency) {
		return { amount: String(defaultPrice.amount), currency: defaultPrice.currency, chain: defaultPrice.chain ?? 'solana' };
	}
	return null;
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, kind: 'session' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope, kind: 'bearer' };
	return null;
}

// ── invoke ────────────────────────────────────────────────────────────────────

const invokeSchema = z.object({
	agent_id: z.string().min(1).max(80),
	skill: z.string().min(1).max(64),
	args: z.record(z.any()).default({}),
});

async function handleInvoke(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = parse(invokeSchema, await readJson(req));
	if (!isUuid(body.agent_id)) return error(res, 404, 'not_found', 'agent not found');
	const [agent] =
		await sql`select id, user_id, name, meta, skills from agent_identities where id = ${body.agent_id} and deleted_at is null limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Determine if the skill is callable: registered server handler OR a skill
	// declared on the agent's skills[] (delegated to skill-runtime). Hard-fail
	// only when the agent has no record of this skill at all.
	const handlerExists = !!HANDLERS[body.skill];
	const skillDeclared = Array.isArray(agent.skills) && agent.skills.includes(body.skill);
	if (!handlerExists && !skillDeclared) {
		return error(
			res,
			404,
			'unknown_skill',
			`skill "${body.skill}" is not registered on this agent`,
		);
	}

	const price = await priceFor(agent, body.skill);
	if (!price) {
		return error(res, 409, 'no_payments', `skill "${body.skill}" is not priced on this agent`);
	}

	// Access-control gate. For skills carrying a canonical agent_skill_prices
	// entry (access.paid), a buyer who already purchased the skill or holds a
	// subscription/trial covering it executes WITHOUT a fresh x402 charge —
	// double-billing someone who already paid would be theft. Legacy meta-priced
	// skills (no canonical price row) report paid:false and fall through to the
	// pay-per-call x402 path below unchanged.
	const access = await hasSkillAccess(auth.userId, agent.id, body.skill);
	if (access.paid && access.owned) {
		// Trustless gate: if this purchase minted an on-chain license that has
		// since been revoked on chain (e.g. a refund), entitlement is gone even
		// though the DB grant lingers — enforce the chain's verdict. Fail-open on
		// any infrastructure trouble so a paid user is never locked out by RPC.
		const lic = await enforceOnchainLicense({
			sql,
			userId: auth.userId,
			agentId: agent.id,
			skill: body.skill,
		});
		if (lic.blocked) {
			return error(res, 403, 'license_revoked', 'this skill license was revoked on-chain', {
				reason: lic.reason,
				license: lic.license ?? null,
			});
		}

		const startedAt = Date.now();
		const result = await executeSkill(agent, body, auth, null);
		if (access.trial) {
			await consumeTrialUse(auth.userId, agent.id, body.skill).catch(() => {});
		}
		logSkillUsage({
			userId: auth.userId,
			agentId: agent.id,
			skillName: body.skill,
			status: result?.ok === false ? 'failure' : 'success',
			executionTimeMs: Date.now() - startedAt,
		});
		return json(res, 200, {
			ok: true,
			access: access.via_subscription
				? 'subscription'
				: access.via_nft
					? 'nft'
					: access.trial
						? 'trial'
						: 'purchase',
			...(access.trial
				? { trial_remaining: Math.max(0, (access.trial_remaining ?? 1) - 1) }
				: {}),
			result,
		});
	}

	// NFT-gated but the caller doesn't hold the collection. Payment cannot unlock
	// it — access is the on-chain holding — so there is no x402 challenge to issue.
	// Return 402 with the required collection so the caller knows what to acquire.
	if (access.gate?.type === 'nft') {
		return error(
			res,
			402,
			'nft_gate_required',
			`You need to hold an NFT from collection ${access.gate.collection} to use this skill.`,
			{
				agent_id: agent.id,
				skill: body.skill,
				reason: access.reason || 'nft_required',
				gate: { type: 'nft', collection: access.gate.collection },
			},
		);
	}

	// Priced but unowned. A human session caller (cookie auth) cannot construct an
	// x402 payment, so a 402 pay-per-call challenge — meant for autonomous agents —
	// is a dead end for them. Send them to the marketplace with a 403 instead.
	if (access.paid && auth.kind === 'session') {
		return error(
			res,
			403,
			'skill_access_denied',
			'You do not have access to this skill. Please purchase it from the marketplace.',
			{
				agent_id: agent.id,
				skill: body.skill,
				reason: access.reason || 'not_purchased',
				price: { amount: price.amount, currency: price.currency, chain: price.chain ?? 'solana' },
			},
		);
	}

	// The pay-per-call path runs at most once per (caller, key). The intent is
	// consumed before the skill runs, so without this a buyer whose response was
	// lost (timeout, dropped mobile connection) retried, found the intent
	// `consumed`, failed verifyPaid and was told to pay again for work already
	// delivered. The key is the buyer's `Idempotency-Key` header when sent (it
	// wins, so an SDK can pick its own) and the intent id otherwise; the store is
	// scoped to the authenticated caller, so only the account that paid can
	// collect the result. Only a delivered call is stored: a failure releases the
	// intent and leaves the key free, so the retry actually retries.
	let headerKey;
	try {
		headerKey = normalizeIdempotencyKey(req.headers['idempotency-key']);
	} catch {
		return error(res, 400, 'invalid_idempotency_key',
			`Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX} characters.`);
	}
	const intentHeader = (req.headers['x-payment-intent'] || '').toString().trim();
	const replayKey = headerKey ? `key:${headerKey}` : intentHeader ? `intent:${intentHeader}` : null;

	const attempt = () => paidCall(req, { agent, body, auth, price });
	const outcome = replayKey
		? await runOnce({
			caller: `x402-invoke:${auth.userId}`,
			key: replayKey,
			fingerprint: argsDigest({ agent_id: agent.id, skill: body.skill, args: body.args }),
			run: attempt,
			shouldStore: (o) => o.kind === 'delivered',
			toStored: (o) => o.body,
		})
		: { state: 'fresh', value: await attempt() };

	if (outcome.state === 'replayed') {
		res.setHeader('idempotent-replayed', 'true');
		return json(res, 200, { ...outcome.stored, replayed: true });
	}
	if (outcome.state === 'conflict') {
		return error(res, 409, 'idempotency_conflict',
			'This payment intent or Idempotency-Key was already used for a different request.');
	}
	if (outcome.state === 'in_progress') {
		res.setHeader('retry-after', '2');
		return error(res, 409, 'idempotency_in_progress',
			'The first call with this payment is still running. Retry shortly to collect its result.',
			{ retry: true });
	}

	const result = outcome.value;
	if (result.kind === 'challenge') {
		return emit402(res, {
			agent,
			skill: body.skill,
			amount: price.amount,
			currency: price.currency,
			chain: price.chain ?? 'solana',
		});
	}
	if (result.kind === 'refused') {
		return error(res, result.status, result.code, result.message, result.extra);
	}
	return json(res, 200, { ...result.body, replayed: false });
}

// Verify the payment, apply the $THREE holder gate, consume the intent, run the
// skill and credit revenue. Returns an outcome rather than writing the response
// so handleInvoke can store a delivered call for replay:
//   { kind: 'challenge' }                          not paid: answer the 402
//   { kind: 'refused', status, code, message, extra }  paid, but not runnable now
//   { kind: 'delivered', body }                    the skill ran; body is the 200
// A throw from the skill releases the intent and propagates (a 500, nothing stored).
async function paidCall(req, { agent, body, auth, price }) {
	const paid = await verifyPaid(req, {
		agentId: agent.id,
		skill: body.skill,
		payerUserId: auth.userId,
		expectedAmount: price.amount,
		expectedCurrency: price.currency,
	});
	if (!paid) return { kind: 'challenge' };

	// $THREE holder gate: agents can require callers to hold a minimum $THREE
	// balance. Checked after payment to use the verified payerAddress; the intent
	// is NOT consumed on gate failure so the caller can acquire $THREE and retry.
	const gate = agent.meta?.three_gate;
	if (gate?.enabled && paid.payerAddress) {
		const minBalance = parseInt(gate.min_balance ?? 1, 10) || 1;
		let gateResult;
		try {
			const { checkThreeBalance } = await import('../../_lib/three-gate.js');
			gateResult = await checkThreeBalance(paid.payerAddress, minBalance);
		} catch {
			gateResult = { unavailable: true };
		}
		if (gateResult.unavailable) {
			return {
				kind: 'refused',
				status: 503,
				code: 'three_gate_unavailable',
				message: 'The $THREE balance check is temporarily unavailable. Your payment is not consumed; retry shortly.',
				extra: { retry: true },
			};
		}
		if (!gateResult.eligible) {
			return {
				kind: 'refused',
				status: 402,
				code: 'insufficient_three_balance',
				message: 'This agent requires a minimum $THREE balance. Acquire $THREE to use this skill.',
				extra: {
					required: minBalance,
					held: gateResult.balance,
					buy_url: 'https://pump.fun/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
				},
			};
		}
	}

	// Consume the intent BEFORE executing the skill: the atomic paid→consumed
	// transition is the single-use lock. Two concurrent requests used to both
	// pass verifyPaid (both see status='paid') and BOTH execute, delivering
	// the paid work twice for one on-chain payment; only the transition
	// winner proceeds now. If the handler then throws, the intent flips back
	// to 'paid' so the buyer's payment still covers a retry instead of being
	// burned on a failed call.
	const claimed = await consumeIntent(paid.intentId);
	if (!claimed) {
		return {
			kind: 'refused',
			status: 409,
			code: 'payment_in_flight',
			message: 'This payment intent was already used or is being processed. Retry shortly.',
		};
	}

	let result;
	try {
		result = await executeSkill(agent, body, auth, paid.payerAddress || null);
	} catch (err) {
		// Handler failed after we won the transition: restore the intent so the
		// buyer is not charged for a call that never delivered.
		await releaseIntent(paid.intentId).catch(() => {});
		throw err;
	}

	// Revenue is credited here, for the request that won the transition AND
	// delivered. The unique index on agent_revenue_events(intent_id) is the
	// hard backstop against double-crediting.
	const gross = parseInt(paid.amount, 10);
	const { fee, net } = calculateFee(gross);
	// settled_to_wallet: the intent paid the owner's payout wallet directly, so
	// this is income already held, never a treasury-withdrawable balance.
	await sql`
		insert into agent_revenue_events
			(agent_id, intent_id, skill, gross_amount, fee_amount, net_amount, currency_mint, chain, payer_address, settled_to_wallet)
		values
			(${agent.id}, ${paid.intentId}, ${body.skill}, ${gross}, ${fee}, ${net}, ${paid.currency}, ${price.chain ?? 'solana'}, ${paid.payerAddress}, true)
		on conflict (intent_id) do nothing
	`;
	insertNotification(agent.user_id, 'payment_received', {
		agent_id: agent.id,
		agent_name: agent.name,
		skill: body.skill,
		net_amount: net,
		currency_mint: paid.currency,
	});
	return {
		kind: 'delivered',
		body: {
			ok: true,
			intent_id: paid.intentId,
			amount: paid.amount,
			currency: paid.currency,
			result,
		},
	};
}

// ── manifest ──────────────────────────────────────────────────────────────────

async function handleManifest(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://x');
	const agent_id = url.searchParams.get('agent_id');
	const skill = url.searchParams.get('skill');
	if (!agent_id || !skill)
		return error(res, 400, 'validation_error', 'agent_id and skill required');
	if (!isUuid(agent_id)) return error(res, 404, 'not_found', 'agent not found');

	const [agent] =
		await sql`select id, name, meta from agent_identities where id = ${agent_id} and deleted_at is null limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Canonical pricing lives in agent_skill_prices. Fetch the row regardless of
	// is_active so we can distinguish "deactivated" (skill_not_available) from
	// "never priced" (skill_not_priced).
	const [priceRow] = await sql`
		SELECT amount, currency_mint, chain, is_active
		FROM agent_skill_prices
		WHERE agent_id = ${agent.id} AND skill = ${skill}
	`;

	let price;
	if (priceRow) {
		if (!priceRow.is_active) {
			return error(res, 404, 'skill_not_available', 'this skill is not currently available');
		}
		price = { amount: String(priceRow.amount), currency: priceRow.currency_mint, chain: priceRow.chain };
	} else {
		// Legacy meta-priced agents predate the marketplace table. The invoke path
		// still honors them, so the manifest must surface them too.
		price = metaPrice(agent, skill);
		if (!price) {
			return error(res, 404, 'skill_not_priced', 'this skill is not priced');
		}
	}

	// The recipient is resolved inside manifestOnly by resolveSkillRecipient,
	// the same rule the invoke path's 402 uses: payout wallet, then the agent's
	// own wallet, then the meta.payments receiver.
	return manifestOnly(res, {
		agent,
		skill,
		amount: price.amount,
		currency: price.currency,
		chain: price.chain,
	});
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = { invoke: handleInvoke, manifest: handleManifest };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown x402 action: ${action}`);
	return fn(req, res);
});
