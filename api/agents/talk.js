// POST /api/agents/talk
//
// Open agent-conversation endpoint, the public counterpart to
// /api/agent-delegate.js. The original endpoint required session auth and
// was scoped to user-owned agents; this one is auth-optional and is
// callable from the paid `agent_delegate_action` MCP tool (which gates
// access via x402 USDC payment).
//
// Body:
//   { agentId: string, message: string, model?: string }
//
// Response:
//   { ok, agentId, agentName, response, model, durationMs, fetchedAt }
//
// Safety: agents with surfaces.mcp === false (their owner's embed policy)
// are refused — owners can opt their agent out of public MCP use.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { normalizeLegacyPolicy } from '../_lib/embed-policy.js';
import { isUuid } from '../_lib/validate.js';
import { runAgentTurn, AgentTurnError } from '../_lib/agent-turn.js';

const bodySchema = z.object({
	agentId: z.string().min(1).max(120),
	message: z.string().min(1).max(4000),
	model: z.string().min(1).max(100).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	if (parseInt(req.headers['x-delegate-depth'] || '0', 10) > 0) {
		return error(res, 400, 'recursion_denied', 'nested agent delegation is not allowed');
	}

	// Each call burns platform LLM credit, so require an authenticated principal.
	// The x402-paid public path lives in the MCP tool, not here.
	const session = await getSessionUser(req);
	const principal = session ?? (await authenticateBearer(extractBearer(req)));
	if (!principal) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? principal?.userId ?? null;

	const rl = await limits.agentDelegate(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'agent delegate rate limit');

	let raw;
	try {
		raw = await readJson(req);
	} catch {
		return error(res, 400, 'invalid_json', 'body must be JSON');
	}
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return error(
			res,
			400,
			'validation_error',
			parsed.error.issues[0]?.message ?? 'invalid body',
		);
	}
	const { agentId, message, model: requestedModel } = parsed.data;

	// agent_identities.id is a uuid column — a malformed id otherwise leaks
	// Postgres error 22P02 to the caller as a 500. Return a clean 404 instead.
	if (!isUuid(agentId)) return error(res, 404, 'agent_not_found', 'agent not found');

	const [agent] = await sql`
		SELECT id, name, description, embed_policy, meta, skills
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
			AND (is_published = true OR user_id = ${userId})
	`;
	if (!agent) return error(res, 404, 'agent_not_found', 'agent not found');

	const policy = normalizeLegacyPolicy(agent.embed_policy);
	if (policy?.surfaces?.mcp === false) {
		return error(res, 403, 'mcp_disabled', 'this agent has opted out of MCP delegation');
	}

	// The turn itself (persona, custom skills, patronage, premium-skill access,
	// the LLM failover chain) is shared with the paid agent API in
	// api/_lib/agent-turn.js so both surfaces answer as the same agent.
	const started = Date.now();
	let result;
	try {
		result = await runAgentTurn({
			agent,
			message,
			userId,
			callerWallet: session?.wallet_address || null,
			requestedModel,
			tool: 'agent.talk',
		});
	} catch (err) {
		if (err instanceof AgentTurnError && err.code === 'llm_unavailable') {
			return error(res, 503, 'llm_unavailable', 'agent delegation is not available right now');
		}
		if (err instanceof AgentTurnError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	return json(res, 200, {
		ok: true,
		agentId: agent.id,
		agentName: agent.name,
		response: result.text,
		model: result.model,
		usage: result.usage,
		durationMs: Date.now() - started,
		fetchedAt: new Date().toISOString(),
	});
});
