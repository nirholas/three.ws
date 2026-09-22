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
//   POST /api/agents/:id/copilot   { messages:[{role,content}], network }  → SSE
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
import { cors, method, error, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { providerChain } from '../_lib/llm-tool-chain.js';
import { runCopilotTurn, netOf, COPILOT_MAX_MESSAGES } from '../_lib/copilot-engine.js';
import { appendThreadMessage } from '../_lib/agent-thread.js';
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
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to talk to this copilot');

	const rl = await limits.tradePerUser(auth.userId).catch(() => ({ success: true }));
	if (rl && rl.success === false) return rateLimited(res, rl);

	const [row] = await sql`SELECT id, user_id, name, persona_prompt, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'only the owner can use this copilot');

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

	const chain = providerChain();
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

	try {
		const turn = await runCopilotTurn({
			agent: row,
			history,
			network,
			chain,
			isActive: () => active,
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
