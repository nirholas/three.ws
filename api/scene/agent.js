// POST /api/scene/agent
//
// One reasoning round for the Scene Studio "Agent" tab (src/scene-studio/agent-tab.js).
// The browser owns the scene and every tool execution: this endpoint only picks a
// model off the free-first tool-calling chain (api/_lib/llm-tool-chain.js), sends
// it the running transcript plus the caller's own tool definitions, and returns
// the assistant's text and/or requested tool_calls verbatim.
//
// Same shape as api/concierge.js on purpose: free, public, anonymous, CORS `*`,
// its own IP + global rate buckets (limits.sceneAgentIp / sceneAgentGlobal) so a
// busy studio session can never starve signed-in chat or the embeddable widget.
// Unlike concierge this DOES take tools, reusing the client-tool-round building
// blocks (api/_lib/client-tool-round.js) that already validate an OpenAI-shaped
// tool list and a bounded message transcript for the metered /api/v1 lane, the
// same validation, just answered as plain JSON instead of billed SSE, since the
// studio executes tools locally and only needs the next round's result.
import { z } from 'zod';
import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { providerChain } from '../_lib/llm-tool-chain.js';
import { clientToolRound, sanitizeClientMessages, normalizeClientTools, ClientToolError } from '../_lib/client-tool-round.js';
import { recordEvent } from '../_lib/usage.js';
import { captureException } from '../_lib/sentry.js';

export const maxDuration = 60;

const MAX_TOKENS = 1024;

const bodySchema = z.object({
	messages: z.array(z.record(z.any())).min(1).max(200),
	tools: z.array(z.record(z.any())).min(1).max(32),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const body = parse(bodySchema, await readJson(req));
	const ip = clientIp(req);
	const rl = await limits.sceneAgentIp(ip);
	if (!rl.success) return rateLimited(res, rl, 'too many agent turns from this connection, try again shortly');
	const gl = await limits.sceneAgentGlobal();
	if (!gl.success) return rateLimited(res, gl, 'the scene agent is at capacity, try again in a moment');

	let messages;
	let tools;
	try {
		messages = sanitizeClientMessages(body.messages);
		tools = normalizeClientTools(body.tools);
	} catch (err) {
		if (err instanceof ClientToolError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	const started = Date.now();
	const chain = providerChain();
	if (!chain.length) return error(res, 503, 'llm_unavailable', 'No scene agent model is configured right now.');

	let out;
	try {
		out = await clientToolRound({ messages, tools, maxTokens: MAX_TOKENS, temperature: 0.2, chain });
	} catch (err) {
		captureException(err, { route: 'scene/agent', stage: 'round' });
		return error(res, err?.status === 503 ? 503 : 502, err?.code || 'upstream_error', 'The scene agent could not reach a model this turn. Try again.');
	}

	recordEvent({
		userId: null,
		kind: 'chat',
		tool: 'scene-agent',
		latencyMs: Date.now() - started,
		meta: {
			provider: out.provider,
			model: out.model,
			anonymous: true,
			tool_calls: out.toolCalls.length,
			history_turns: messages.length,
		},
	});

	return json(res, 200, {
		content: out.content || null,
		tool_calls: out.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args || '{}' })),
		provider: out.provider,
		model: out.model,
	});
});
