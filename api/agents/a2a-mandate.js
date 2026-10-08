// POST /api/agents/a2a-mandate — issue an Intent Mandate.
//
// A user authorizes one of their agents to spend autonomously on their behalf,
// up to a total budget and per-call cap, over specified networks, optionally
// restricted to a set of peer endpoints. The server binds the authenticated
// userId into the mandate and signs it; the agent later presents the returned
// JWS to /api/agents/a2a-call to pay peers without a human in the loop.
//
// This is the human-consent step of AP2: the mandate is the verifiable record
// that the user authorized this class of spend before any autonomous payment.

import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, rateLimited, readJson, respondError, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { DEFAULT_NETWORK, issueIntentMandate, MandateError, MAX_TTL_SECONDS, SUPPORTED_NETWORKS } from '../_lib/a2a/mandate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	// A mandate lets an agent pay peers with no human in the loop, so issuing
	// one is a spend: a bearer needs wallet:write, exactly as paying does.
	assertBearerMaySpend(bearer, req);
	const userId = session?.id ?? bearer?.userId;

	const rl = await limits.mcpAgent(userId || 'anon');
	if (!rl.success) return rateLimited(res, rl, 'mandate issuance rate limit exceeded');

	const body = await readJson(req);
	const {
		subjectAgentId,
		maxAtomics,
		perCallAtomics,
		currency = 'USDC',
		networks = [DEFAULT_NETWORK],
		resources = [],
		purpose = '',
		ttlSec = 24 * 60 * 60,
	} = body || {};

	try {
		const { jws, mandate } = await issueIntentMandate({
			ownerUserId: userId,
			subjectAgentId,
			maxAtomics,
			perCallAtomics,
			currency,
			networks,
			resources,
			purpose,
			ttlSec,
		});
		return json(res, 201, {
			ok: true,
			mandate: jws,
			details: mandate,
			supported_networks: SUPPORTED_NETWORKS,
			max_ttl_seconds: MAX_TTL_SECONDS,
		});
	} catch (err) {
		if (err instanceof MandateError) return respondError(res, err.status, err.code, err);
		throw err;
	}
});
