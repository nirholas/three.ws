// POST /api/v1/agents/signup: an autonomous agent onboards itself.
//
// The agent signs a short text message with an Ed25519 key (a Solana wallet key
// works) and posts it here. No email, no browser. The response carries the new
// agent, its custodial wallets and an API key, shown exactly once, plus a claim
// code a human uses to take ownership.
//
// Signed message (UTF-8, newline separated, no trailing newline):
//   three.ws agent signup v1
//   public_key: <base58 public key>
//   name: <requested agent name>
//   timestamp: <unix seconds>
//   nonce: <16-64 chars of A-Z a-z 0-9 _ ->
//
// Body: { public_key, name, timestamp, nonce, signature }  (keys and signature base58)
//
// Guarantees: the timestamp must be within 300s of server time (clock_skew
// otherwise, with server_time in the error); a nonce is accepted once per key,
// across all instances (replayed_nonce); limits are 5/h per IP and 10/h per key.
// The agent starts in paper mode with strict caps until a human claims it.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { limits } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import {
	verifySignupPayload,
	consumeSignupNonce,
	createSelfSignedAgent,
	SKEW_WINDOW_SECONDS,
} from '../../_lib/agent-signup.js';

export default defineEndpoint({
	name: 'v1.agents.signup',
	method: 'POST',
	auth: 'public',
	handler: async ({ body, ip }) => {
		const ipLimit = await limits.agentSignupIp(ip);
		if (!ipLimit.success) fail(429, 'rate_limited', 'too many signups from this address: try again later');

		// Cheap structural + signature checks first, so unsigned junk never reaches
		// the database or the per-key limiter.
		const signed = verifySignupPayload(body);

		const keyLimit = await limits.agentSignupKey(signed.publicKey);
		if (!keyLimit.success) fail(429, 'rate_limited', 'too many attempts for this public key: try again later');

		if (!(await consumeSignupNonce(signed.publicKey, signed.nonce))) {
			fail(409, 'replayed_nonce', 'this nonce was already used for this public key: sign a fresh message with a new nonce');
		}

		const { agent, key, apiKeySecret, claimCode, claimExpiresAt } = await createSelfSignedAgent({
			publicKey: signed.publicKey,
			name: signed.name,
			ip,
		});

		return {
			agent: {
				id: agent.id,
				name: agent.name,
				url: `${env.APP_ORIGIN}/agents/${agent.id}`,
				wallets: {
					solana: agent.meta?.solana_address ?? null,
					evm: agent.wallet_address ?? null,
				},
			},
			credentials: {
				api_key: apiKeySecret,
				api_key_prefix: key.prefix,
				scope: key.scope,
				shown_once: true,
			},
			mode: 'paper',
			caps: {
				spend_limits: agent.meta.spend_limits,
				trade_limits: agent.meta.trade_limits,
				live_perps: false,
			},
			claim: {
				code: claimCode,
				expires_at: claimExpiresAt,
				endpoint: `${env.APP_ORIGIN}/api/v1/agents/claim`,
				note: 'The human signs in and POSTs { code } to the claim endpoint. Until it is claimed the agent runs in paper mode.',
			},
			signature_window_seconds: SKEW_WINDOW_SECONDS,
		};
	},
});
