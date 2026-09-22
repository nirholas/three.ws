// Everything the console reads and does, as typed calls over the session.
// Electron-free, so it is tested against a recorded fetch.
//
// Feature detection, not version pinning: the v1 Agents API (runs with step
// timelines, server-side chat history) is probed once per session. Where the
// server has it, the console uses it; where it does not yet, the same views
// run on the routes v1 wraps: /api/agents, the streaming /api/chat, and the
// signed action log at /api/agent-actions.

import {
	normalizeAgents, normalizeAgent, normalizeRuns, normalizeRun, normalizeSteps,
	normalizeActivity, describeNotification, listFrom, objectFrom,
} from '../shared/normalize.js';
import { readSse } from './sse.js';
import { errorFromBody } from './session.js';

const enc = encodeURIComponent;

export function createConsoleApi({ session }) {
	let v1 = null;

	async function hasV1() {
		if (v1 !== null) return v1;
		try {
			const res = await session.authorizedFetch('/api/v1/agents?limit=1');
			const type = res.headers.get('content-type') || '';
			v1 = res.ok && type.includes('application/json');
			await res.body?.cancel?.();
		} catch (err) {
			if (err.code === 'signed_out') throw err;
			v1 = false;
		}
		return v1;
	}

	function resetCapabilities() {
		v1 = null;
	}

	async function capabilities() {
		return { v1: await hasV1() };
	}

	// ── Agents ──────────────────────────────────────────────────────────────
	async function listAgents() {
		const body = (await hasV1())
			? await session.request('/api/v1/agents?limit=100')
			: await session.request('/api/agents');
		return normalizeAgents(body);
	}

	async function setAgentStatus(agentId, running) {
		if (!(await hasV1())) throw new Error('Starting and stopping agents needs the v1 Agents API on this server.');
		const body = await session.request(`/api/v1/agents/${enc(agentId)}/${running ? 'start' : 'stop'}`, { method: 'POST' });
		return normalizeAgent(objectFrom(body, 'agent'));
	}

	// ── Chat ────────────────────────────────────────────────────────────────
	async function chatHistory(agentId) {
		if (!(await hasV1())) return { serverHistory: false, messages: [] };
		const body = await session.request(`/api/v1/agents/${enc(agentId)}/messages?limit=50`);
		const messages = listFrom(body, 'messages').map((m) => ({
			role: m.role === 'user' ? 'user' : 'assistant',
			content: String(m.content ?? m.text ?? ''),
			channel: m.channel || null,
			at: m.created_at || m.createdAt || null,
			toolCalls: Array.isArray(m.tool_calls || m.toolCalls) ? (m.tool_calls || m.toolCalls).map((t) => String(t.name || t.tool || t)) : [],
		})).filter((m) => m.content);
		// Oldest first for rendering.
		messages.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
		return { serverHistory: true, messages };
	}

	// Streams one exchange. `emit` receives { type: 'chunk' | 'tool' | 'action' |
	// 'done' | 'error', ... }. Resolves with the final reply text.
	async function sendChat({ agentId, message, history = [], signal }, emit) {
		if (await hasV1()) {
			emit({ type: 'tool', status: 'thinking', label: 'Thinking' });
			const body = await session.request(`/api/v1/agents/${enc(agentId)}/messages`, {
				method: 'POST',
				body: { message, channel: 'desktop' },
				signal,
			});
			const d = objectFrom(body, 'message');
			const tools = d.tool_calls || d.toolCalls || [];
			for (const t of tools) emit({ type: 'tool', status: 'done', label: String(t.name || t.tool || t) });
			const signatures = d.signatures || d.transaction_signatures || [];
			const reply = String(d.content ?? d.reply ?? '');
			emit({ type: 'chunk', text: reply });
			emit({ type: 'done', reply, signatures, usage: d.usage || null, cost: d.cost ?? d.cost_credits ?? null });
			return reply;
		}

		const res = await session.authorizedFetch('/api/chat', {
			method: 'POST',
			signal,
			headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
			body: JSON.stringify({
				message,
				agentId,
				history: history.slice(-20).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 4000) })),
			}),
		});
		const type = res.headers.get('content-type') || '';
		if (!type.includes('text/event-stream')) {
			let parsed = null;
			try {
				parsed = await res.json();
			} catch {
				parsed = null;
			}
			if (!res.ok) throw errorFromBody(res.status, parsed, `Chat failed with ${res.status}`);
			const reply = String(parsed?.reply ?? '');
			emit({ type: 'chunk', text: reply });
			emit({ type: 'done', reply, actions: parsed?.actions || [] });
			return reply;
		}
		let reply = '';
		let failed = null;
		await readSse(res, ({ json }) => {
			if (!json) return;
			if (json.type === 'chunk') {
				reply += json.text || '';
				emit({ type: 'chunk', text: json.text || '' });
			} else if (json.type === 'home_tool') {
				emit({ type: 'tool', status: json.status || 'running', label: String(json.tool || 'tool').replace(/_/g, ' '), detail: json.data?.summary || null });
			} else if (json.type === 'error') {
				failed = json;
			} else if (json.type === 'done') {
				if (json.reply && !reply) {
					reply = json.reply;
					emit({ type: 'chunk', text: json.reply });
				}
				for (const a of json.actions || []) emit({ type: 'action', action: a });
				emit({ type: 'done', reply: json.reply || reply, model: json.model || null, governance: json.governance || null });
			}
		}, { signal });
		if (failed) {
			const err = new Error(failed.message || 'The agent could not answer.');
			err.code = failed.code || 'chat_error';
			throw err;
		}
		return reply;
	}

	// ── Runs ────────────────────────────────────────────────────────────────
	async function listRuns(agentId) {
		if (!(await hasV1())) {
			const body = await session.request(`/api/agent-actions?agent_id=${enc(agentId)}&limit=50`);
			return { mode: 'activity', activity: normalizeActivity(body) };
		}
		const body = await session.request(`/api/v1/agents/${enc(agentId)}/runs?limit=50`);
		return { mode: 'runs', runs: normalizeRuns(body) };
	}

	async function runDetail(runId) {
		const [run, steps] = await Promise.all([
			session.request(`/api/v1/runs/${enc(runId)}`),
			session.request(`/api/v1/runs/${enc(runId)}/steps`),
		]);
		return { run: normalizeRun(objectFrom(run, 'run')), steps: normalizeSteps(steps) };
	}

	async function createRun(agentId, { goal, maxSteps, budgetUsd }) {
		const text = String(goal || '').trim();
		if (!text) throw new Error('Describe the goal for this run.');
		const body = await session.request(`/api/v1/agents/${enc(agentId)}/runs`, {
			method: 'POST',
			body: {
				goal: text,
				...(Number(maxSteps) > 0 ? { max_steps: Math.min(60, Math.round(Number(maxSteps))) } : {}),
				...(Number(budgetUsd) > 0 ? { budget_usd: Number(budgetUsd) } : {}),
			},
		});
		return normalizeRun(objectFrom(body, 'run'));
	}

	async function cancelRun(runId) {
		const body = await session.request(`/api/v1/runs/${enc(runId)}/cancel`, { method: 'POST' });
		return normalizeRun(objectFrom(body, 'run'));
	}

	async function streamRun(runId, emit, signal) {
		const res = await session.authorizedFetch(`/api/v1/runs/${enc(runId)}/events`, { headers: { accept: 'text/event-stream' }, signal });
		if (!res.ok) {
			let parsed = null;
			try {
				parsed = await res.json();
			} catch {
				parsed = null;
			}
			throw errorFromBody(res.status, parsed, `Run stream failed with ${res.status}`);
		}
		await readSse(res, ({ event, json }) => {
			if (!json) return;
			if (json.step || event === 'step') emit({ type: 'step', step: normalizeSteps([json.step || json])[0] });
			if (json.run || event === 'status' || event === 'done') emit({ type: 'run', run: normalizeRun(json.run || json) });
		}, { signal });
	}

	// ── Wallet ──────────────────────────────────────────────────────────────
	async function wallet(agentId) {
		const [summary, holdings, proposals] = await Promise.allSettled([
			session.request(`/api/agents/${enc(agentId)}/solana`),
			session.request(`/api/agents/${enc(agentId)}/solana/holdings`),
			session.request(`/api/autopilot/proposals?agentId=${enc(agentId)}&status=pending`),
		]);
		if (summary.status === 'rejected') throw summary.reason;
		const s = objectFrom(summary.value);
		const h = holdings.status === 'fulfilled' ? objectFrom(holdings.value) : {};
		return {
			address: s.address || null,
			network: s.network || 'mainnet',
			sol: s.sol ?? null,
			balanceError: s.balance_error || null,
			signable: s.signable !== false,
			signableReason: s.signable_reason || null,
			tokens: Array.isArray(h.tokens) ? h.tokens.map((t) => ({
				mint: t.mint,
				amount: t.ui_amount,
				stable: Boolean(t.is_usdc),
			})) : [],
			holdingsError: holdings.status === 'rejected' ? holdings.reason.message : null,
			proposals: proposals.status === 'fulfilled'
				? (proposals.value?.proposals || []).map((p) => ({
					id: p.id,
					kind: p.kind,
					title: p.title,
					rationale: p.rationale,
					financial: p.kind === 'wallet_transfer',
					confidence: p.confidence,
					createdAt: p.createdAt,
				}))
				: [],
			proposalsError: proposals.status === 'rejected' ? proposals.reason.message : null,
		};
	}

	async function dismissProposal(agentId, proposalId) {
		await session.request('/api/autopilot/proposals', { method: 'POST', body: { agentId, action: 'dismiss', proposalId } });
		return { ok: true };
	}

	// ── Notifications ───────────────────────────────────────────────────────
	async function notifications({ before } = {}) {
		const qs = new URLSearchParams({ limit: '30' });
		if (before) qs.set('before', before);
		const body = await session.request(`/api/notifications?${qs}`);
		return {
			items: (body?.notifications || []).map(describeNotification),
			unread: Number(body?.unread_count || 0),
			hasMore: Boolean(body?.has_more),
		};
	}

	async function markRead(id) {
		return session.request(`/api/notifications/${enc(id)}/read`, { method: 'POST' });
	}

	async function markAllRead() {
		return session.request('/api/notifications/read-all', { method: 'POST' });
	}

	return {
		capabilities, resetCapabilities,
		listAgents, setAgentStatus,
		chatHistory, sendChat,
		listRuns, runDetail, createRun, cancelRun, streamRun,
		wallet, dismissProposal,
		notifications, markRead, markAllRead,
	};
}
