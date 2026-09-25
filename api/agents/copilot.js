// /api/agents/:id/copilot — the Conversational Trading Copilot.
//
// A tool-calling LLM that talks to the agent's owner (text or voice), answers
// with REAL live market + portfolio data, and PROPOSES trades the owner must
// confirm. The model never signs and never executes: read-only tools run
// server-side and feed grounded numbers back to the model; any state-changing
// intent (buy / sell / risk-limits) is returned to the client as a structured
// proposal. The client re-quotes it live and, only on the owner's confirmation,
// calls the existing guarded endpoints (POST /api/agents/:id/solana/trade,
// PUT /api/agents/:id/trade/limits) — which enforce the spend guards
// (api/_lib/agent-trade-guards.js), the rug/honeypot firewall
// (api/_lib/trade-firewall.js), and the custody audit (agent_custody_events).
// Conversation can never bypass a guard, the kill switch, or a spend cap.
//
//   POST /api/agents/:id/copilot   { messages:[{role,content}], network, model? }  → SSE
//        `model` overrides the agent's default model for this message
//        (api/_lib/agent-model.js). The copilot is a tool loop, so an override
//        without tool calling is refused; an agent default without tools
//        answers on the platform chain. A free open model draws on the owner's
//        daily free-tier allowance (api/_lib/free-tier.js).
//   GET  /api/agents/:id/copilot?after=<message id>&limit=<1-100>
//        → { messages:[{id,role,content,channel,createdAt}], latest_id }
//        the agent's cross-channel thread, oldest first, so the web panel can
//        show what the owner said to the agent from a paired chat (tagged
//        "via Telegram" and so on) and carry it into the next web turn.
//
// SSE events: `status` (phase), `tool` (a read-only tool ran), `proposal`
// (a confirm-before-execute trade/limits card), `chunk` (streamed narration
// tokens), `done` (final reply + proposals + citations), `error`.
//
// The tools, prompt and loop live in api/_lib/copilot-engine.js, shared with the
// Telegram and Discord gateways (api/_lib/gateway/). Each finished web turn is
// appended to the agent's cross-channel thread (api/_lib/agent-thread.js) with
// channel `web`, so a conversation started here continues in chat and back.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is the only coin three.ws
// promotes. The copilot trades whatever mint the owner names at runtime — generic
// coin-agnostic plumbing — and never names or recommends any other token.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, method, error, json, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { providerChain } from '../_lib/llm-tool-chain.js';
import { runCopilotTurn, netOf, COPILOT_MAX_MESSAGES } from '../_lib/copilot-engine.js';
import { appendThreadMessage, listThread } from '../_lib/agent-thread.js';
import { resolveMessageModel, modelChain, ModelChoiceError } from '../_lib/agent-model.js';
import { meterFreeModel, FreeTierExhaustedError, freeTierErrorBody, retryAfterSeconds } from '../_lib/free-tier.js';
import { recordEvent } from '../_lib/usage.js';
import { costMicroUsd } from '../_lib/llm-pricing.js';
export { providerChain };

// ── auth / ownership ──────────────────────────────────────────────────────────
async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

// ── handler ─────────────────────────────────────────────────────────────────────
export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to talk to this copilot');

	const rl = await limits.tradePerUser(auth.userId).catch(() => ({ success: true }));
	if (rl && rl.success === false) return rateLimited(res, rl);

	const [row] = await sql`SELECT id, user_id, name, persona_prompt, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'only the owner can use this copilot');

	if (req.method === 'GET') return sendThread(req, res, { agentId: row.id, userId: auth.userId });

	const body = await readJson(req).catch(() => null);
	const network = netOf(body?.network);
	const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
	const history = rawMessages
		.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
		.slice(-COPILOT_MAX_MESSAGES)
		.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
	if (!history.length || history[history.length - 1].role !== 'user') {
		return error(res, 422, 'no_message', 'send at least one user message');
	}

	let choice;
	try {
		choice = copilotModel(body?.model, row.meta);
	} catch (e) {
		if (e instanceof ModelChoiceError) return error(res, e.status, e.code, e.message);
		throw e;
	}
	try {
		await meterFreeModel(choice.model, { userId: auth.userId });
	} catch (e) {
		if (!(e instanceof FreeTierExhaustedError)) throw e;
		res.setHeader('Retry-After', String(retryAfterSeconds(e.resetAt)));
		return error(res, 429, 'free_tier_exhausted', e.message, freeTierErrorBody(e));
	}

	const { chain } = modelChain(choice.model);
	if (!chain.length) return error(res, 503, 'llm_unavailable', 'No LLM provider configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or NVIDIA_API_KEY (or GOOGLE_CLOUD_PROJECT for the Vertex credits anchor).');

	// SSE open.
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();
	let active = true;
	req.on('close', () => { active = false; });
	const send = (event, data) => { if (active) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
	// Keepalive: a tool-loop round can sit silent for tens of seconds waiting on a
	// slow provider (or a mid-round failover to the next one). Emit an SSE comment
	// every 15s so the client's stall watchdog can stay tight and only fire on a
	// genuinely dead connection, never on a model that's just thinking.
	const heartbeat = setInterval(() => { if (active) res.write(': ping\n\n'); }, 15_000);
	send('model', { model: choice.model, source: choice.source });

	try {
		const turn = await runCopilotTurn({
			agent: row,
			history,
			network,
			chain,
			isActive: () => active,
			onRound: (served) => {
				send('model', { model: choice.model, source: choice.source, served: served.catalogModel || served.model, lane: served.provider });
				meterRound({ userId: auth.userId, agentId: id, served });
			},
			// tool_start is for surfaces that paint a live status line (the chat
			// gateways); the web UI already paints each finished read as a card.
			emit: (event, data) => { if (event !== 'tool_start') send(event, data); },
		});
		send('done', { reply: turn.reply, proposals: turn.proposals, citations: turn.citations });
		await persistWebTurn({ agentId: id, userId: auth.userId, userText: history[history.length - 1].content, turn });
	} catch (e) {
		send('error', { code: e?.code || 'copilot_error', message: e?.message || 'The copilot hit an error. Try again.' });
	} finally {
		clearInterval(heartbeat);
		if (active) res.end();
	}
}

// The thread since `after` (a message id), oldest first. Without `after` it is
// the most recent page, which is what a panel opening for the first time shows.
async function sendThread(req, res, { agentId, userId }) {
	const q = new URL(req.url, 'http://x').searchParams;
	const after = /^\d{1,18}$/.test(q.get('after') || '') ? Number(q.get('after')) : null;
	const limit = Math.max(1, Math.min(100, Number(q.get('limit')) || 30));
	const { messages } = await listThread({ agentId, userId, limit });
	const rows = messages.filter((m) => after == null || m.id > after).reverse();
	const latestId = messages.length ? messages[0].id : after;
	return json(res, 200, {
		messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, channel: m.channel, signatures: m.signatures, createdAt: m.createdAt })),
		latest_id: latestId ?? null,
	}, { 'cache-control': 'no-store' });
}

/**
 * The model one copilot message runs on. An explicit override must call tools
 * (the copilot is a tool loop); an agent default without tools is skipped for
 * the platform chain rather than blocking the owner's chat. Exported for tests.
 * @param {unknown} requested body.model
 * @param {object|null} meta agent meta
 */
export function copilotModel(requested, meta) {
	const override = typeof requested === 'string' && requested.trim() ? requested.trim().slice(0, 80) : null;
	try {
		return resolveMessageModel({ requested: override, agentMeta: meta, purpose: 'run' });
	} catch (e) {
		if (!override && e instanceof ModelChoiceError && e.code === 'model_lacks_tools') {
			return { model: null, source: 'platform', tools: true };
		}
		throw e;
	}
}

// Every model round is recorded against the owner, priced at the lane that
// served it (free lanes cost 0), the same ledger /brain and the runs write.
function meterRound({ userId, agentId, served }) {
	if (!served.usage) return;
	recordEvent({
		userId,
		agentId,
		kind: 'llm',
		tool: 'agent.copilot',
		provider: served.provider,
		model: served.model,
		inputTokens: served.usage.input,
		outputTokens: served.usage.output,
		costMicroUsd: costMicroUsd({
			provider: served.provider,
			model: served.model,
			input: served.usage.input,
			output: served.usage.output,
			reportedCostUsd: served.usage.reportedCostUsd,
		}),
	});
}

// Append the finished web turn to the agent's cross-channel thread, so Telegram
// and Discord continue the same conversation. Best-effort: the owner already has
// the reply, and a thread write must never turn a good answer into an error.
async function persistWebTurn({ agentId, userId, userText, turn }) {
	if (!turn.reply) return;
	try {
		await appendThreadMessage({ agentId, userId, role: 'user', content: userText, channel: 'web' });
		await appendThreadMessage({ agentId, userId, role: 'assistant', content: turn.reply, channel: 'web', toolCalls: turn.toolCalls });
	} catch (e) {
		console.warn('[copilot] thread append failed', e?.message);
	}
}
