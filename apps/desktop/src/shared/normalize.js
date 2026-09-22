// Shape adapters between the platform's API responses and what the console
// renders. Pure, dependency-free, and shared by the main process and the
// renderer, so the tests exercise exactly the code that ships.
//
// Two API generations are live at once: the v1 Agents API (/api/v1/agents, runs
// and steps, `{ data, meta }` envelopes) and the routes it wraps (/api/agents,
// /api/agent-actions). Every adapter accepts both.

export function listFrom(body, ...keys) {
	if (Array.isArray(body)) return body;
	for (const k of ['data', ...keys, 'items', 'results']) {
		const v = body?.[k];
		if (Array.isArray(v)) return v;
		if (v && typeof v === 'object') {
			for (const inner of keys) if (Array.isArray(v[inner])) return v[inner];
		}
	}
	return [];
}

export function objectFrom(body, ...keys) {
	for (const k of ['data', ...keys]) {
		const v = body?.[k];
		if (v && typeof v === 'object' && !Array.isArray(v)) return v;
	}
	return body && typeof body === 'object' ? body : {};
}

const pick = (o, ...keys) => {
	for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k];
	return null;
};

export function normalizeAgent(a = {}) {
	return {
		id: String(pick(a, 'id', 'agent_id', 'agentId') || ''),
		name: String(pick(a, 'name', 'display_name') || 'Untitled agent'),
		description: pick(a, 'description', 'persona') || '',
		thumbnail: pick(a, 'avatar_thumbnail_url', 'thumbnail_url', 'thumbnailUrl', 'avatarUrl', 'image') || null,
		solanaAddress: pick(a, 'solana_address', 'solanaAddress', 'wallet_solana') || null,
		walletReady: Boolean(pick(a, 'wallet_ready', 'walletReady')),
		// `status` arrives with the v1 lifecycle (running | stopped); older rows
		// carry only publication state.
		status: pick(a, 'status') || (a.is_published === false ? 'draft' : null),
		isPublished: a.is_published !== false,
		updatedAt: pick(a, 'updated_at', 'updatedAt', 'created_at', 'createdAt'),
		homeUrl: pick(a, 'home_url', 'homeUrl') || null,
	};
}

export function normalizeAgents(body) {
	return listFrom(body, 'agents').map(normalizeAgent).filter((a) => a.id);
}

const RUN_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'budget_exhausted']);

export function normalizeRun(r = {}) {
	const status = String(pick(r, 'status') || 'queued');
	return {
		id: String(pick(r, 'id', 'run_id', 'runId') || ''),
		agentId: pick(r, 'agent_id', 'agentId'),
		goal: String(pick(r, 'goal', 'title') || ''),
		status,
		terminal: RUN_TERMINAL.has(status),
		steps: Number(pick(r, 'step_count', 'stepCount', 'steps_count') || 0),
		maxSteps: Number(pick(r, 'max_steps', 'maxSteps') || 0) || null,
		spentUsd: Number(pick(r, 'spent_usd', 'spentUsd') || 0) + Number(pick(r, 'spent_credits_usd', 'spentCreditsUsd') || 0),
		budgetUsd: Number(pick(r, 'budget_usd', 'budgetUsd') || 0) + Number(pick(r, 'budget_credits_usd', 'budgetCreditsUsd') || 0),
		result: pick(r, 'result') || null,
		error: pick(r, 'error') || null,
		createdAt: pick(r, 'created_at', 'createdAt'),
		finishedAt: pick(r, 'finished_at', 'finishedAt'),
	};
}

export function normalizeRuns(body) {
	return listFrom(body, 'runs').map(normalizeRun).filter((r) => r.id);
}

function brief(value, max = 280) {
	if (value == null) return '';
	const s = typeof value === 'string' ? value : JSON.stringify(value);
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizeStep(s = {}) {
	const kind = String(pick(s, 'kind', 'type', 'step_type') || 'step');
	const tool = pick(s, 'tool', 'tool_name', 'toolName', 'name');
	return {
		id: String(pick(s, 'id', 'step_id') ?? ''),
		index: Number(pick(s, 'idx', 'index', 'seq', 'step') ?? 0),
		kind,
		tool: tool ? String(tool) : null,
		title: tool ? String(tool) : kind.replace(/_/g, ' '),
		input: brief(pick(s, 'input', 'args', 'arguments', 'prompt')),
		output: brief(pick(s, 'output', 'result', 'content', 'text')),
		error: pick(s, 'error') ? brief(s.error) : null,
		costUsd: Number(pick(s, 'cost_usd', 'costUsd', 'cost') || 0),
		signature: pick(s, 'signature', 'tx_signature') || null,
		at: pick(s, 'created_at', 'createdAt', 'ts', 'timestamp'),
	};
}

export function normalizeSteps(body) {
	return listFrom(body, 'steps').map(normalizeStep);
}

// /api/agent-actions rows: the signed action log every agent writes.
export function normalizeActivity(body) {
	return listFrom(body, 'actions').map((a) => {
		const payload = a.payload || {};
		return {
			id: String(a.id),
			kind: String(a.type || 'action'),
			title: String(a.type || 'action').replace(/[._]/g, ' '),
			detail: brief(payload.summary || payload.message || payload.text || payload.title || (Object.keys(payload).length ? payload : ''), 200),
			skill: a.source_skill || null,
			signature: a.signature || null,
			at: a.created_at || null,
		};
	});
}

const NOTIFICATION_TEXT = {
	payment_received: (p) => `Payment received${p.amount_usd ? `: $${Number(p.amount_usd).toFixed(2)}` : ''}${p.agent_name ? ` by ${p.agent_name}` : ''}`,
	'payment-earned': (p) => `Payment received${p.actor ? ` from ${p.actor}` : ''}`,
	withdrawal_completed: () => 'Your withdrawal was sent',
	withdrawal_failed: (p) => `A withdrawal failed${p.reason ? `: ${p.reason}` : ''}`,
	forge_complete: (p) => (p.prompt ? `Your 3D model "${String(p.prompt).slice(0, 60)}" is ready` : 'Your 3D model finished generating'),
	forge_failed: (p) => (p.prompt ? `Your generation "${String(p.prompt).slice(0, 60)}" failed` : 'A 3D generation failed'),
	companion_delivery: (p) => p.line || p.title || 'Something needs you',
	agent_review: (p) => (p.actor ? `${p.actor} reviewed your agent` : 'Your agent received a new review'),
	dm_received: (p) => (p.actor ? `New message from ${p.actor}` : 'You have a new message'),
	follow: (p) => (p.actor ? `${p.actor} started following you` : 'Someone started following you'),
	quest_complete: (p) => (p.mission ? `You finished "${p.mission}"` : 'You finished a quest'),
};

export function describeNotification(n = {}) {
	const p = n.payload || {};
	const type = String(n.type || 'notice');
	const text = NOTIFICATION_TEXT[type]?.(p) || p.title || p.message || p.line || type.replace(/[_-]/g, ' ');
	const title = p.agent_name || p.sender || p.actor || 'three.ws';
	let link = p.link || (p.tx_signature ? `https://solscan.io/tx/${encodeURIComponent(p.tx_signature)}` : null) || (p.agent_id ? `/agents/${encodeURIComponent(p.agent_id)}` : null);
	// Only same-site paths or https URLs: a hostile payload must not steer the
	// app into a script URL or a protocol-relative redirect.
	if (link && !(/^\/(?!\/)/.test(link) || /^https:\/\//i.test(link))) link = null;
	return {
		id: String(n.id || ''),
		type,
		title: String(title),
		text: String(text),
		link,
		read: Boolean(n.read_at),
		at: n.created_at || null,
	};
}

// "3m ago" style, with an absolute fallback past a week.
export function relativeTime(value, now = Date.now()) {
	if (!value) return '';
	const t = typeof value === 'number' ? value : Date.parse(value);
	if (!Number.isFinite(t)) return '';
	const s = Math.round((now - t) / 1000);
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d}d ago`;
	return new Date(t).toISOString().slice(0, 10);
}

export function shortAddress(addr, head = 4, tail = 4) {
	const s = String(addr || '');
	return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function formatUsd(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
	return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatAmount(n, max = 6) {
	const v = Number(n);
	if (!Number.isFinite(v)) return String(n ?? '');
	return v.toLocaleString('en-US', { maximumFractionDigits: max });
}
