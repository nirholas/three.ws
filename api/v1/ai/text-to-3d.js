// POST /api/v1/ai/text-to-3d: the flagship FREE text→3D endpoint of the
// three.ws AI package.
//
// three.ws runs the only text→mesh lane in the x402 / agent-payments ecosystem.
// Its draft tier is genuinely free: a prompt goes to the NVIDIA NIM TRELLIS lane
// (backend `nvidia`, path `image`, draft tier) via the SAME submit pipeline that
// backs the `forge_free` MCP tool and /forge. It costs nothing and needs no
// wallet, but it does need a three.ws account: a free API key sent as
// `Authorization: Bearer <key>` (make one at /dashboard/api-keys) or a signed-in
// session. Every model is owned by the account that made it, so an anonymous
// call gets 401 sign_in_required with where to sign in and where to make a key.
//
// Semantics mirror the draft lane exactly (zero duplicated generation logic):
//   • The NIM often finishes inside the submit window → { status:'done', glb_url,
//     viewer_url }.
//   • Otherwise the job is queued → { status:'pending', job:<token>, poll_url }
//     and the caller polls the EXISTING endpoint GET /api/forge?job=<token>.
//
// Free with a per-account daily quota (10/day: the GPU quota is real). Above the
// quota we do NOT paywall silently: 429 with X-RateLimit-Reset AND a pointer to
// the paid /api/x402/forge tiers, which have no daily cap. The free lane is the
// funnel; the paid forge is the upsell.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { json } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { backendIsConfigured } from '../../_lib/forge-tiers.js';
import { startForge, originFromReq } from '../../_mcp-studio/forge-client.js';
import { forwardCreatorAuth, SIGN_IN_REQUIRED, SIGN_IN_URL, API_KEYS_URL } from '../../_lib/creator-account.js';
import { shapeResult, quotaBody, resetSeconds, DAILY_QUOTA, PROMPT_MIN, PROMPT_MAX } from './_text-to-3d-lane.js';

export { shapeResult } from './_text-to-3d-lane.js';

// The NVIDIA NIM lane can't serve without its key. Throw the platform's canonical
// missing-env error so the gateway's `wrap` renders the standard 503
// not_configured envelope and names the exact var to the operator (logs + ops
// alert) — which secrets are unset is operator information, never leaked to the
// client (see api/_lib/http.js `wrap`).
function throwNotConfigured() {
	throw new Error('Missing required env var: NVIDIA_API_KEY');
}

// Map a startForge lane failure to an honest boundary error. The buyer/user is
// never left with a silent failure — every code has a designed status + message.
function failFromLane(err, res) {
	const code = err?.code;
	if (code === SIGN_IN_REQUIRED) {
		signInRequired(res, err.message);
		return true;
	}
	if (code === 'not_configured') {
		// The nvidia backend's not_configured is precisely a missing NVIDIA env —
		// route it through the same canonical 503 not_configured path.
		throwNotConfigured();
	}
	if (code === 'busy') {
		fail(429, 'rate_limited', err.message || 'The free text→3D lane is momentarily busy — try again shortly.');
	}
	if (code === 'timeout') {
		fail(504, 'lane_timeout', err.message || 'The text→3D lane took too long to accept the job — try again.');
	}
	fail(502, 'lane_error', err?.message || 'The text→3D lane failed to accept the job.');
}

// The gateway envelope ({ error, error_description }) carrying the same
// sign-in pointers every creation surface returns, so a script can say exactly
// what to set and a browser can link to sign-in.
function signInRequired(res, message) {
	const text = message || 'Sign in to make a 3D model. A three.ws account is free.';
	res.setHeader('www-authenticate', 'Bearer realm="three.ws", error="invalid_token"');
	json(res, 401, {
		error: SIGN_IN_REQUIRED,
		error_description: text,
		message: text,
		sign_in_url: SIGN_IN_URL,
		api_keys_url: API_KEYS_URL,
	});
}

export default defineEndpoint({
	name: 'v1.ai.text_to_3d',
	method: 'POST',
	auth: 'optional',
	handler: async ({ req, res, body, principal }) => {
		// An account is required to make a model. Checked before validation so an
		// anonymous caller learns the one thing it must fix first.
		if (!principal?.userId) return signInRequired(res);

		const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
		if (prompt.length < PROMPT_MIN) {
			fail(400, 'validation_error', `"prompt" must be a non-empty string of at least ${PROMPT_MIN} characters`);
		}
		if (prompt.length > PROMPT_MAX) {
			fail(400, 'validation_error', `"prompt" must be ${PROMPT_MAX} characters or fewer`);
		}

		// The free draft lane pins the NVIDIA NIM TRELLIS backend. If its key isn't
		// present the lane can't serve — surface the platform's clean 503
		// not_configured (the missing var is named to the operator, not the client).
		if (!backendIsConfigured('nvidia')) {
			throwNotConfigured();
		}

		// Per-account daily GPU quota. Above it: 429 with reset + paid upsell, never a
		// silent paywall. Consumed before submit so a burst can't outrun the meter.
		const rl = await limits.aiTextTo3d(`user:${principal.userId}`);
		if (!rl.success) {
			const resetSec = resetSeconds(rl, Date.now());
			res.setHeader('X-RateLimit-Limit', String(rl.limit ?? DAILY_QUOTA));
			res.setHeader('X-RateLimit-Remaining', '0');
			res.setHeader('X-RateLimit-Reset', String(resetSec));
			res.setHeader('Retry-After', String(resetSec));
			return json(res, 429, quotaBody(rl, resetSec));
		}

		const base = originFromReq(req);
		let job;
		try {
			job = await startForge(base, {
				prompt,
				backend: 'nvidia',
				path: 'image',
				tier: 'draft',
				// The model is made by, owned by and rate-limited as this caller.
				auth: forwardCreatorAuth(req),
			});
		} catch (err) {
			if (failFromLane(err, res)) return;
		}

		return shapeResult(job, base);
	},
});
