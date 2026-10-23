// POST /api/auth/agent-signup: an autonomous agent signs itself up for three.ws.
//
// Two calls, same path, no email and no browser:
//
//   1. { "public_key": "<base58 ed25519>" }
//        -> 200 { challenge: { nonce, message, issued_at, expires_at, ... } }
//   2. { "public_key", "nonce", "signature": "<base58 ed25519 signature of message>", "name"? }
//        -> 201 { account, agent, wallets, credentials, plan, upgrade, claim }
//
// The message is built by the server and rebuilt from the stored challenge on
// step 2, so the agent signs exactly what it was shown. A challenge is bound to
// the key it was issued to, lasts five minutes and works once. The account starts
// on the Free developer plan in paper mode; moving up is a 402 on
// POST /api/billing/agent-upgrade. Limits: 30 challenges and 5 signups per hour
// per IP, 10 per hour per key, and AGENT_SIGNUP_DAILY_CAP new accounts per day.

import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { fail } from '../_lib/gateway.js';
import { createSelfSignedAgent } from '../_lib/agent-signup.js';
import { listDevPlans, DEV_PLAN_PERIOD_DAYS } from '../_lib/dev-plans/config.js';
import {
	assertPublicKey,
	assertUnderDailyCap,
	issueChallenge,
	linkSignupWallet,
	redeemChallenge,
	walletOwner,
} from '../_lib/agent-onboarding.js';

function validName(value, publicKey) {
	if (value == null || value === '') return `agent-${publicKey.slice(0, 6)}`;
	const name = typeof value === 'string' ? value.trim() : '';
	if (name.length < 1 || name.length > 100) fail(400, 'validation_error', 'name must be 1-100 characters');
	if (/[\r\n]/.test(name)) fail(400, 'validation_error', 'name must be a single line');
	return name;
}

export function upgradeBlock() {
	return {
		endpoint: `${env.APP_ORIGIN}/api/billing/agent-upgrade?plan=<plan>`,
		method: 'POST',
		auth: 'Authorization: Bearer <api_key>',
		payment: 'x402: the first call answers 402 with the price; pay it in USDC on Solana and repeat the call with the payment header',
		period_days: DEV_PLAN_PERIOD_DAYS,
		plans: listDevPlans()
			.filter((p) => p.purchasable && !p.contactSales)
			.map((p) => ({ id: p.id, price_usd: p.priceUsd, included_calls: p.includedCalls })),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const body = (await readJson(req)) || {};
	const publicKey = assertPublicKey(body.public_key);

	// Step 1: issue a challenge.
	if (body.signature == null && body.nonce == null) {
		const ipLimit = await limits.agentChallengeIp(ip);
		if (!ipLimit.success) return rateLimited(res, ipLimit, 'too many challenge requests from this address');
		const keyLimit = await limits.agentChallengeKey(publicKey);
		if (!keyLimit.success) return rateLimited(res, keyLimit, 'too many challenge requests for this public key');
		const challenge = await issueChallenge({ publicKey, ip });
		return json(res, 200, { challenge, next: 'Sign challenge.message with the ed25519 key for public_key, then POST { public_key, nonce, signature } here.' });
	}

	// Step 2: redeem it.
	const ipLimit = await limits.agentSignupIp(ip);
	if (!ipLimit.success) return rateLimited(res, ipLimit, 'too many signups from this address: try again later');
	const keyLimit = await limits.agentSignupKey(publicKey);
	if (!keyLimit.success) return rateLimited(res, keyLimit, 'too many attempts for this public key: try again later');
	const name = validName(body.name, publicKey);

	await assertUnderDailyCap();
	await redeemChallenge({ publicKey, nonce: body.nonce, signature: body.signature });

	if (await walletOwner(publicKey)) {
		return error(res, 409, 'wallet_has_account', 'this wallet already belongs to an account: sign in with Sign-In with Solana at /api/auth/siws instead');
	}

	const { agent, user, key, apiKeySecret, claimCode, claimExpiresAt } = await createSelfSignedAgent({ publicKey, name, ip });
	await linkSignupWallet({ userId: user.id, publicKey });

	return json(res, 201, {
		account: { id: user.id, plan: 'free', created_via: 'agent_signup' },
		agent: { id: agent.id, name: agent.name, url: `${env.APP_ORIGIN}/agents/${agent.id}` },
		wallets: { identity: publicKey, agent_solana: agent.meta?.solana_address ?? null, agent_evm: agent.wallet_address ?? null },
		credentials: { api_key: apiKeySecret, api_key_prefix: key.prefix, scope: key.scope, shown_once: true },
		mode: 'paper',
		caps: { spend_limits: agent.meta.spend_limits, trade_limits: agent.meta.trade_limits, live_perps: false },
		upgrade: upgradeBlock(),
		claim: {
			code: claimCode,
			expires_at: claimExpiresAt,
			endpoint: `${env.APP_ORIGIN}/api/v1/agents/claim`,
			note: 'A human signs in and POSTs { code } to the claim endpoint to take ownership. Until then the agent runs in paper mode.',
		},
	});
});
