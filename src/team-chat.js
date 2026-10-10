// /team-chat and /teams/:id/chat: the squad coordinator.
//
// /team-chat lists the squads the caller can talk to (their specialist teams,
// then any agent they own, which plays every role itself). /teams/:id/chat is
// the conversation: one sentence goes to POST /api/teams/:id/chat, which
// streams the plan, per-step status with evidence, approval items and the
// closing summary over SSE. An approval pauses the run; Approve or Deny posts
// the exact payload_hash that was shown and the run resumes on the same stream.
// Approvals mirrored to the inbox are followed over GET .../stream, so deciding
// them there resumes this page too.
//
// Every string from a token, an agent or the owner's own message is untrusted
// and only ever reaches the DOM through textContent (see h()).

import { consumeCsrfToken } from './api.js';
import { agentAvatarGlb } from './shared/agent-3d.js';
import { resolveDevR2Url } from './shared/dev-r2-proxy.js';

const ROOT = document.getElementById('tcRoot');
const CONTENT = document.getElementById('tcContent');
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const ROLES = ['researcher', 'entry', 'trader', 'launcher'];
const ROLE_TITLE = { researcher: 'Researcher', entry: 'Entry', trader: 'Trader', launcher: 'Launcher', coordinator: 'Coordinator', custom: 'Specialist' };
const STEP_STATUS = {
	queued: ['Queued', ''],
	running: ['Running', 'info'],
	needs_approval: ['Needs approval', 'warn'],
	executing: ['Executing', 'info'],
	done: ['Done', 'good'],
	failed: ['Failed', 'bad'],
	skipped: ['Skipped', ''],
	denied: ['Declined', 'bad'],
	expired: ['Expired', 'warn'],
};
const RUN_STATUS = {
	planning: ['Planning', 'info'],
	running: ['Running', 'info'],
	awaiting_approval: ['Waiting for you', 'warn'],
	done: ['Done', 'good'],
	failed: ['Failed', 'bad'],
	cancelled: ['Cancelled', ''],
};
const OPEN_RUN = new Set(['planning', 'running', 'awaiting_approval']);
const GATE_LABEL = { signs: 'Signs a transaction', exceeds_cap: 'Above the per-trade cap', launches: 'Launches a coin', transfers: 'Moves funds' };
const PREF_LABEL = { default_trade_sol: 'Default trade size', venues: 'Favorite venues', risk: 'Risk appetite' };
const SUGGESTIONS = [
	'Research $THREE and buy 0.05 SOL if market cap is under $5M',
	'Remember my default trade size is 0.1 SOL and keep risk low',
	'Check $THREE and tell me if it is safe to enter',
	'Launch a coin called Avatar Dance ($ADNC) about my agent dancing in 3D',
];
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const CHAT_PATH = new RegExp(`^/teams/(${UUID})/chat/?$`);
const RISK_ACK_CODE = 'risk_ack_required';

// ── small helpers ────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const short = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');
const roleOf = (role) => (ROLES.includes(role) ? role : 'custom');

/** Build an element. Children and `text` land as text nodes, never as HTML. */
function h(tag, props = {}, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props || {})) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of kids.flat(Infinity)) {
		if (c == null || c === false) continue;
		el.append(c instanceof Node ? c : String(c));
	}
	return el;
}

function chip(text, tone = '', title) {
	return h('span', { class: `tm-chip ${tone}`.trim(), title }, text);
}

/** Only same-site paths and https links are ever rendered as hrefs. */
function safeHref(u) {
	if (typeof u !== 'string') return null;
	if (/^\/(?!\/)/.test(u)) return u;
	return /^https:\/\/[^\s]+$/i.test(u) ? u : null;
}

function ago(iso) {
	if (!iso) return '';
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}

function timeLeft(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (!(ms > 0)) return null;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function errText(e) {
	if (!e) return '';
	if (typeof e === 'string') return e;
	return e.message || e.code || 'Something went wrong.';
}

async function csrfHeaders(method) {
	const headers = { accept: 'application/json' };
	if (method !== 'GET') {
		const token = await consumeCsrfToken().catch(() => null);
		if (token) headers['x-csrf-token'] = token;
	}
	return headers;
}

async function readError(r) {
	let j = null;
	try {
		j = await r.json();
	} catch {
		j = null;
	}
	return {
		ok: false,
		status: r.status,
		code: j?.error || 'error',
		message: j?.error_description || j?.message || `Request failed (${r.status}).`,
	};
}

async function api(url, { method = 'GET', body } = {}) {
	const opts = { method, credentials: 'include', headers: await csrfHeaders(method) };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	let r;
	try {
		r = await fetch(url, opts);
	} catch {
		return { ok: false, status: 0, code: 'network', message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	if (!r.ok) return readError(r);
	const j = await r.json().catch(() => null);
	return { ok: true, status: r.status, data: j?.data ?? null };
}

/**
 * POST and read the answer as Server-Sent Events. Validation failures arrive as
 * plain JSON errors before the stream opens; those come back as { ok: false }.
 */
async function streamPost(url, body, onEvent) {
	const headers = await csrfHeaders('POST');
	headers['content-type'] = 'application/json';
	headers.accept = 'text/event-stream';
	let r;
	try {
		r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
	} catch {
		return { ok: false, status: 0, code: 'network', message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	if (!r.ok) return readError(r);
	if (!(r.headers.get('content-type') || '').includes('text/event-stream') || !r.body) return readError(r);
	const reader = r.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let ended = false;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let cut;
			while ((cut = buf.indexOf('\n\n')) !== -1) {
				const frame = buf.slice(0, cut);
				buf = buf.slice(cut + 2);
				const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
				if (!data) continue;
				let ev;
				try {
					ev = JSON.parse(data);
				} catch {
					continue;
				}
				if (ev.kind === 'end') ended = true;
				onEvent(ev);
			}
		}
	} catch {
		return { ok: false, status: 0, code: 'stream_dropped', message: 'The connection dropped. The squad keeps working; this page is following the run again.', ended };
	}
	return { ok: true, ended };
}

async function currentUser() {
	try {
		const r = await fetch('/api/auth/me', { credentials: 'include' });
		if (!r.ok) return null;
		return (await r.json())?.user || null;
	} catch {
		return null;
	}
}

let toastTimer = 0;
function toast(msg) {
	const el = $('#tcToast');
	el.textContent = msg;
	el.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function announce(msg) {
	const el = $('#tcAnnounce');
	if (el) el.textContent = msg;
}

/** The page's <dialog>: resolves true on Confirm. Body is built from nodes. */
function confirmDialog({ title, body, ok = 'Confirm', tone = 'primary' }) {
	const dlg = $('#tcConfirm');
	$('#tcConfirmTitle').textContent = title;
	$('#tcConfirmBody').replaceChildren(...[].concat(body));
	const okBtn = $('#tcConfirmOk');
	okBtn.textContent = ok;
	okBtn.className = `tm-btn ${tone}`;
	return new Promise((resolve) => {
		dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
		dlg.returnValue = '';
		dlg.showModal();
	});
}

function setBusy(busy) {
	ROOT.setAttribute('aria-busy', busy ? 'true' : 'false');
}

// ── state ────────────────────────────────────────────────────────────────────

const state = {
	user: null,
	squadId: null,
	squad: null,
	prefs: [],
	runs: [],
	mode: 'paper',
	sending: false,
	turns: new Map(),
	tails: new Map(),
	figures: new Map(),
	observer: null,
	freshPref: null,
};

// ── boot ─────────────────────────────────────────────────────────────────────

async function boot() {
	const m = location.pathname.match(CHAT_PATH);
	state.user = await currentUser();
	if (!state.user) return paintSignedOut(m ? location.pathname : '/team-chat');
	if (m) return openChat(m[1]);
	return openPicker();
}

function paintSignedOut(next) {
	setBusy(false);
	document.title = 'Squad Chat · three.ws';
	CONTENT.replaceChildren(
		h('section', { class: 'tc-hero' },
			h('p', { class: 'tm-kicker', text: 'Squad chat' }),
			h('h1', { class: 'tm-title', text: 'Talk to your squad in plain language.' }),
			h('p', { class: 'tm-sub', text: 'One sentence becomes a plan of specialist steps. Research and entry checks run live, and anything that signs, sends or launches waits for your approval with the full details.' }),
			h('div', { class: 'tm-actions' },
				h('a', { class: 'tm-btn primary', href: `/login?next=${encodeURIComponent(next)}`, text: 'Sign in to start' }),
				h('a', { class: 'tm-btn', href: '/teams', text: 'What is a squad?' }),
			),
		),
	);
}

function paintError(title, message, { retry, back } = {}) {
	setBusy(false);
	CONTENT.replaceChildren(
		h('div', { class: 'tc-state', role: 'alert' },
			h('h1', { class: 'tc-state-title', text: title }),
			h('p', { class: 'tm-muted', text: message }),
			h('div', { class: 'tm-actions' },
				retry ? h('button', { class: 'tm-btn primary', type: 'button', onclick: retry, text: 'Try again' }) : null,
				back ? h('a', { class: 'tm-btn', href: back.href, text: back.text }) : null,
			),
		),
	);
}

// ── the squad picker (/team-chat) ────────────────────────────────────────────

async function openPicker() {
	document.title = 'Squad Chat · three.ws';
	const r = await api('/api/team-chat');
	if (!r.ok) {
		if (r.status === 401) return paintSignedOut('/team-chat');
		return paintError('Your squads did not load', r.message, { retry: () => location.reload() });
	}
	setBusy(false);
	const squads = r.data || [];
	const head = h('section', { class: 'tc-hero' },
		h('p', { class: 'tm-kicker', text: 'Squad chat' }),
		h('h1', { class: 'tm-title', text: 'Who do you want to talk to?' }),
		h('p', { class: 'tm-sub', text: 'Pick a specialist team or one of your agents. Tell it what you want in one sentence; it plans the steps, runs them, and stops for your approval before anything signs.' }),
	);
	if (!squads.length) {
		CONTENT.replaceChildren(head,
			h('div', { class: 'tc-state' },
				h('h2', { class: 'tc-state-title', text: 'No squads yet' }),
				h('p', { class: 'tm-muted', text: 'Assemble a specialist team (a Researcher, an Entry scout, a Trader and a Launcher under one spend policy), or create a single agent that plays every role.' }),
				h('div', { class: 'tm-actions' },
					h('a', { class: 'tm-btn primary', href: '/teams', text: 'Assemble a team' }),
					h('a', { class: 'tm-btn', href: '/create', text: 'Create an agent' }),
				),
			),
		);
		return;
	}
	const teams = squads.filter((s) => s.kind === 'team');
	const agents = squads.filter((s) => s.kind === 'agent');
	CONTENT.replaceChildren(head,
		teams.length ? pickerGroup('Specialist teams', 'Four roles, one spend policy', teams) : null,
		agents.length ? pickerGroup('Solo agents', 'One agent plays every role', agents) : null,
	);
}

function pickerGroup(title, hint, squads) {
	return h('section', { class: 'tm-section' },
		h('h2', { class: 'tm-h2' }, title, h('small', { text: hint })),
		h('ul', { class: 'tc-pick' }, squads.map(pickerCard)),
	);
}

function pickerCard(s) {
	const team = s.kind === 'team';
	const status = team ? s.status : 'active';
	const tone = status === 'active' ? 'good' : status === 'paused' ? 'warn' : status === 'failed' ? 'bad' : 'info';
	return h('li', {},
		h('a', { class: 'tc-pick-card', href: `/teams/${s.id}/chat` },
			h('span', { class: 'tc-pick-mark', 'aria-hidden': 'true', text: (s.name || '?').trim().charAt(0).toUpperCase() || '?' }),
			h('span', { class: 'tc-pick-body' },
				h('b', { text: s.name || 'Squad' }),
				h('span', { class: 'tc-pick-meta' },
					chip(team ? `${s.members} member${s.members === 1 ? '' : 's'}` : 'Solo agent'),
					team ? chip(label(status), tone) : null,
					team && s.network === 'devnet' ? chip('Devnet', 'info') : null,
					!team && s.wallet ? h('span', { class: 'tm-mono tm-faint', title: s.wallet, text: short(s.wallet) }) : null,
				),
			),
			h('span', { class: 'tc-pick-go', 'aria-hidden': 'true', text: 'Chat ›' }),
		),
	);
}

// ── the chat (/teams/:id/chat) ───────────────────────────────────────────────

async function openChat(id) {
	state.squadId = id;
	const r = await api(`/api/teams/${id}/chat`);
	if (!r.ok) {
		if (r.status === 401) return paintSignedOut(location.pathname);
		if (r.status === 404) return paintError('Squad not found', 'This squad does not exist, or it belongs to another account.', { back: { href: '/team-chat', text: 'Your squads' } });
		return paintError('The squad did not load', r.message, { retry: () => location.reload(), back: { href: '/team-chat', text: 'Your squads' } });
	}
	setBusy(false);
	state.squad = r.data.squad;
	state.prefs = r.data.prefs || [];
	state.runs = r.data.runs || [];
	paintChat();

	const wanted = new URLSearchParams(location.search).get('run');
	const open = state.runs.filter((x) => OPEN_RUN.has(x.status)).slice(0, 3).map((x) => x.id);
	const toLoad = [...new Set([wanted, ...open].filter((x) => x && new RegExp(`^${UUID}$`).test(x)))];
	for (const runId of toLoad.reverse()) await loadRun(runId, { scroll: runId === wanted });
}

function paintChat() {
	const s = state.squad;
	const team = s.kind === 'team';
	document.title = `${s.name} · Squad Chat · three.ws`;
	const modeSeg = h('div', { class: 'tm-seg tc-mode', role: 'group', 'aria-label': 'Mode' },
		h('button', { type: 'button', 'aria-pressed': 'true', dataset: { mode: 'paper' }, title: 'Simulated against live quotes. Never signs.', text: 'Paper' }),
		h('button', { type: 'button', 'aria-pressed': 'false', dataset: { mode: 'live' }, title: 'Approved trades sign from the Trader wallet.', text: 'Live' }),
	);
	modeSeg.addEventListener('click', onModeClick);

	const textarea = h('textarea', {
		class: 'tm-input tc-input', id: 'tcInput', rows: '2', maxlength: '2000', autocomplete: 'off',
		placeholder: 'Tell the squad what you want, e.g. research $THREE and buy 0.05 SOL if it looks safe',
		'aria-label': 'Message your squad',
	});
	const composer = h('form', { class: 'tc-composer', id: 'tcComposer', novalidate: true },
		textarea,
		h('div', { class: 'tc-composer-row' },
			h('span', { class: 'tc-mic', id: 'tcMic' }),
			h('span', { class: 'tc-hint', id: 'tcHint' }),
			h('button', { class: 'tm-btn primary sm', type: 'submit', id: 'tcSend', text: 'Send' }),
		),
	);

	CONTENT.replaceChildren(
		h('nav', { class: 'tc-crumbs', 'aria-label': 'Breadcrumb' },
			h('a', { class: 'tm-back', href: '/team-chat', text: '‹ Your squads' }),
			h('a', { class: 'tm-back', href: s.page_url, text: team ? 'Team page' : 'Agent page' }),
		),
		h('header', { class: 'tc-head' },
			h('div', { class: 'tc-head-main' },
				h('h1', { text: s.name }),
				h('div', { class: 'tc-head-meta' },
					chip(team ? 'Specialist team' : 'Solo agent'),
					s.network === 'devnet' ? chip('Devnet', 'info') : chip('Solana mainnet'),
					team ? chip(label(s.status), s.status === 'active' ? 'good' : s.status === 'paused' ? 'warn' : 'bad') : null,
					team && s.policy?.per_trade_sol != null ? chip(`Cap ${s.policy.per_trade_sol} SOL a trade`) : null,
				),
			),
			modeSeg,
		),
		h('div', { id: 'tcBanner' }),
		h('div', { class: 'tc-layout' },
			h('section', { class: 'tc-main', 'aria-label': 'Conversation' },
				h('ul', { class: 'tc-squad', id: 'tcSquad', 'aria-label': 'The squad' }),
				h('div', { class: 'tc-thread', id: 'tcThread' }),
				composer,
			),
			h('aside', { class: 'tc-side', 'aria-label': 'Squad memory and history' },
				h('section', { class: 'tm-panel tc-panel', 'aria-labelledby': 'tcMemH' },
					h('h2', { class: 'tm-h2', id: 'tcMemH' }, 'Remembered', h('small', { text: 'Kept in agent memory' })),
					h('div', { id: 'tcMemory' }),
				),
				h('section', { class: 'tm-panel tc-panel', 'aria-labelledby': 'tcRunsH' },
					h('h2', { class: 'tm-h2', id: 'tcRunsH', text: 'Recent runs' }),
					h('ol', { class: 'tc-runs', id: 'tcRuns' }),
				),
				h('section', { class: 'tm-panel tc-panel tc-howto', 'aria-labelledby': 'tcHowH' },
					h('h2', { class: 'tm-h2', id: 'tcHowH', text: 'What needs your yes' }),
					h('p', { class: 'tm-muted', text: 'Research and entry checks run on their own. Every trade, standing order, send or launch stops as an approval showing the action, amount, token, recipient and chain. Approving sends back the exact fingerprint you saw; if anything changed, nothing runs.' }),
				),
			),
		),
		h('p', { class: 'tc-sr', id: 'tcAnnounce', role: 'status', 'aria-live': 'polite' }),
	);

	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			composer.requestSubmit();
		}
	});
	textarea.addEventListener('input', autosize);
	composer.addEventListener('submit', onSend);
	document.addEventListener('keydown', (e) => {
		if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target;
		if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		e.preventDefault();
		textarea.focus();
	});

	paintBanner();
	paintHint();
	paintSquad();
	paintMemory();
	paintRuns();
	paintThreadEmpty();
	mountDictation(textarea);
	setInterval(tickCountdowns, 1000);
}

function autosize(e) {
	const t = e.currentTarget || e;
	t.style.height = 'auto';
	t.style.height = `${Math.min(220, t.scrollHeight + 2)}px`;
}

function canRun() {
	return state.squad.status === 'active';
}

function paintBanner() {
	const s = state.squad;
	const el = $('#tcBanner');
	el.replaceChildren();
	if (!canRun()) {
		el.append(h('div', { class: 'tm-note warn tc-banner' },
			h('span', {}, h('b', { text: s.status === 'paused' ? 'This team is paused.' : `This team is ${label(s.status).toLowerCase()}.` }),
				' ', s.status === 'paused' ? 'Resume it on the team page, then ask again. Past runs stay readable.' : 'Repair it on the team page before it can take a new plan.'),
			h('a', { class: 'tm-btn sm', href: s.page_url, text: 'Open team page' }),
		));
	}
	const composerOff = !canRun();
	$('#tcInput').disabled = composerOff;
	$('#tcSend').disabled = composerOff || state.sending;
}

function paintHint() {
	const live = state.mode === 'live';
	const hint = $('#tcHint');
	hint.textContent = live
		? 'Live: approved trades sign from the Trader wallet.'
		: 'Paper: simulated on live quotes, never signs.';
	hint.classList.toggle('live', live);
}

async function onModeClick(e) {
	const btn = e.target.closest('button[data-mode]');
	if (!btn || btn.dataset.mode === state.mode) return;
	if (btn.dataset.mode === 'live') {
		const net = state.squad.network === 'devnet' ? 'Solana devnet' : 'Solana mainnet';
		const ok = await confirmDialog({
			title: 'Switch to live mode?',
			body: [
				h('p', { text: `In live mode an approved trade signs from the squad's Trader wallet on ${net}, inside its spend policy.` }),
				h('p', { text: 'Nothing changes about the gate: every trade, order, send or launch still stops for your approval with the amount, token, recipient and chain, and only runs on your explicit yes.' }),
				state.squad.network === 'devnet' ? null : h('p', { text: 'Live mode on mainnet needs the signed real-funds agreements on your account.' }),
			],
			ok: 'Use live mode',
			tone: 'live',
		});
		if (!ok) return;
	}
	state.mode = btn.dataset.mode;
	for (const b of $$('.tc-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
	paintHint();
	announce(state.mode === 'live' ? 'Live mode on.' : 'Paper mode on.');
}

async function mountDictation(textarea) {
	try {
		const { mountPromptDictation } = await import('./voice/prompt-dictation.js');
		mountPromptDictation($('#tcMic'), textarea, { onError: toast });
	} catch {
		$('#tcMic')?.remove();
	}
}

// ── squad figures ────────────────────────────────────────────────────────────

/** One figure per role for a team; one figure that plays every role for a solo agent. */
function figureSlots() {
	const s = state.squad;
	if (s.kind !== 'team') {
		const m = s.members[0];
		return m ? [{ key: 'solo', roles: ROLES, member: m, title: 'Every role' }] : [];
	}
	const slots = [];
	for (const role of ROLES) {
		const m = s.members.find((x) => x.role === role);
		slots.push({ key: role, roles: [role], member: m || null, title: ROLE_TITLE[role] });
	}
	return slots;
}

function paintSquad() {
	const list = $('#tcSquad');
	state.figures.clear();
	list.classList.toggle('solo', state.squad.kind !== 'team');
	const items = figureSlots().map((slot) => {
		const m = slot.member;
		const role = slot.key === 'solo' ? 'trader' : slot.key;
		const stage = h('div', { class: 'tc-stage', dataset: m ? { glb: agentAvatarGlb({ model_url: m.model_url }), name: m.name || 'Agent' } : {} },
			m?.thumbnail_url
				? h('img', { class: 'tc-stage-img', src: resolveDevR2Url(m.thumbnail_url), alt: '', loading: 'lazy', decoding: 'async' })
				: h('span', { class: 'tc-stage-initial', 'aria-hidden': 'true', text: ((m?.name || slot.title || '?').trim()[0] || '?').toUpperCase() }),
		);
		const stateLabel = h('span', { class: 'tc-fig-state', text: m ? 'Idle' : 'Not assembled' });
		const li = h('li', { class: 'tc-fig', style: `--role:var(--role-${role})`, dataset: { state: 'idle', slot: slot.key } },
			stage,
			h('div', { class: 'tc-fig-body' },
				h('span', { class: 'tm-chip role', text: slot.title }),
				h('b', { class: 'tc-fig-name', text: m?.name || 'Missing' }),
				stateLabel,
			),
		);
		state.figures.set(slot.key, { li, stage, stateLabel, el: null, timer: 0, roles: slot.roles });
		return li;
	});
	list.replaceChildren(...items);
	mountFigures();
}

let elementReady = null;
function loadElement() {
	elementReady ??= import('./element.js').then(() => true, () => false);
	return elementReady;
}

function mountFigures() {
	state.observer?.disconnect();
	if (!('IntersectionObserver' in window)) return;
	state.observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			state.observer.unobserve(entry.target);
			mountFigure(entry.target);
		}
	}, { rootMargin: '120px' });
	for (const stage of $$('#tcSquad .tc-stage[data-glb]')) state.observer.observe(stage);
}

async function mountFigure(stage) {
	if (!(await loadElement())) return;
	const el = document.createElement('agent-3d');
	el.setAttribute('body', resolveDevR2Url(stage.dataset.glb));
	el.setAttribute('mode', 'inline');
	el.setAttribute('responsive', '');
	el.setAttribute('background', 'transparent');
	el.setAttribute('name-plate', 'off');
	el.setAttribute('avatar-chat', 'off');
	el.setAttribute('kiosk', '');
	el.setAttribute('aria-label', `${stage.dataset.name} in 3D`);
	el.addEventListener('agent:ready', () => {
		el.classList.add('ready');
		$('.tc-stage-img, .tc-stage-initial', stage)?.classList.add('gone');
	}, { once: true });
	stage.append(el);
	for (const fig of state.figures.values()) if (fig.stage === stage) fig.el = el;
}

function figureFor(role) {
	if (state.figures.has('solo')) return state.figures.get('solo');
	return state.figures.get(role) || state.figures.get(role === 'coordinator' ? 'trader' : 'researcher') || [...state.figures.values()][0] || null;
}

const MOOD = { idle: [0, 0.3], working: [0.15, 0.75], alert: [-0.35, 0.9], speaking: [0.55, 0.55] };

/** Drive one squad figure: the card's ring and label, and the avatar itself. */
function setFigure(role, mood, text, { emote, speak, hold = 0 } = {}) {
	const fig = figureFor(role);
	if (!fig) return;
	clearTimeout(fig.timer);
	fig.li.dataset.state = mood;
	fig.stateLabel.textContent = text;
	const el = fig.el;
	if (el && !REDUCED) {
		const [v, a] = MOOD[mood] || MOOD.idle;
		el.setMood?.(v, a);
		if (emote) el.playEmote?.(emote, 0.8);
		if (speak) el.speak?.(speak);
	}
	if (hold > 0) fig.timer = setTimeout(() => setFigure(role, 'idle', 'Idle'), hold);
}

function reactToStep(step) {
	const role = step.role || 'coordinator';
	const title = step.title || ROLE_TITLE[role];
	switch (step.status) {
		case 'running':
		case 'executing':
			setFigure(role, 'working', step.status === 'executing' ? 'Executing' : 'Working');
			break;
		case 'needs_approval':
			setFigure(role, 'alert', 'Needs your approval');
			announce(`${ROLE_TITLE[role] || 'A specialist'} needs your approval: ${step.approval?.summary || title}.`);
			break;
		case 'done': {
			const executed = step.result?.verdict === 'executed' || step.result?.verdict === 'order_placed';
			setFigure(role, 'speaking', 'Reporting', { emote: executed ? 'cheer' : null, speak: step.result?.summary || title, hold: 3200 });
			break;
		}
		case 'failed':
			setFigure(role, 'alert', 'Hit a problem', { hold: 4200 });
			break;
		default:
			setFigure(role, 'idle', 'Idle');
	}
}

// ── memory + history panels ──────────────────────────────────────────────────

function prefValue(entry) {
	const v = entry.value;
	if (entry.key === 'default_trade_sol') return `${v} SOL`;
	if (Array.isArray(v)) return v.map(label).join(', ');
	return label(v);
}

function paintMemory() {
	const box = $('#tcMemory');
	if (!box) return;
	if (!state.prefs.length) {
		box.replaceChildren(h('p', { class: 'tc-empty' },
			'Nothing remembered yet. Say ',
			h('q', { text: 'remember my default trade size is 0.1 SOL and keep risk low' }),
			' and the squad will use it in every plan.'));
		return;
	}
	box.replaceChildren(h('ul', { class: 'tc-mem' }, state.prefs.map((p) => h('li', { class: state.freshPref === p.key ? 'fresh' : '' },
		h('span', { class: 'tc-mem-k', text: PREF_LABEL[p.key] || label(p.key) }),
		h('b', { class: 'tc-mem-v', text: prefValue(p) }),
		h('span', { class: 'tc-mem-t tm-faint', text: ago(p.updated_at) }),
		h('button', { class: 'tc-link', type: 'button', 'aria-label': `Forget ${PREF_LABEL[p.key] || p.key}`, onclick: (e) => forgetPref(p.key, e.currentTarget), text: 'Forget' }),
	))));
	state.freshPref = null;
}

async function forgetPref(key, btn) {
	btn.disabled = true;
	const r = await api(`/api/teams/${state.squadId}/chat/prefs/${encodeURIComponent(key)}`, { method: 'DELETE' });
	if (!r.ok) {
		btn.disabled = false;
		toast(r.message);
		return;
	}
	state.prefs = r.data || [];
	paintMemory();
	toast(`Forgot ${(PREF_LABEL[key] || key).toLowerCase()}.`);
}

function paintRuns() {
	const list = $('#tcRuns');
	if (!list) return;
	if (!state.runs.length) {
		list.replaceChildren(h('li', { class: 'tc-empty', text: 'No runs yet. Your first message starts one.' }));
		return;
	}
	list.replaceChildren(...state.runs.map((r) => {
		const [txt, tone] = RUN_STATUS[r.status] || [label(r.status), ''];
		const active = state.turns.has(r.id);
		return h('li', {},
			h('button', { class: `tc-run${active ? ' on' : ''}`, type: 'button', onclick: () => loadRun(r.id, { scroll: true }) },
				h('span', { class: 'tc-run-text', text: r.utterance }),
				h('span', { class: 'tc-run-meta' },
					chip(txt, tone),
					r.mode === 'live' ? chip('Live', 'bad') : null,
					h('span', { class: 'tm-faint', text: ago(r.created_at) }),
				),
			),
		);
	}));
}

async function refreshRuns() {
	const r = await api(`/api/teams/${state.squadId}/chat`);
	if (!r.ok) return;
	state.runs = r.data.runs || [];
	state.prefs = r.data.prefs || state.prefs;
	paintRuns();
	paintMemory();
}

// ── the thread ───────────────────────────────────────────────────────────────

function paintThreadEmpty() {
	const thread = $('#tcThread');
	if (state.turns.size) return;
	thread.replaceChildren(h('div', { class: 'tc-intro' },
		h('h2', { class: 'tc-intro-title', text: `What should ${state.squad.name} do?` }),
		h('p', { class: 'tm-muted', text: 'One sentence is enough. The coordinator turns it into steps for each specialist, runs what is safe on its own, and brings you anything that signs.' }),
		h('div', { class: 'tc-suggest', role: 'list' }, SUGGESTIONS.map((s) => h('button', {
			class: 'tc-suggestion', type: 'button', role: 'listitem', text: s,
			onclick: () => {
				const t = $('#tcInput');
				t.value = s;
				autosize(t);
				t.focus();
			},
		}))),
		h('p', { class: 'tc-keys tm-faint' }, h('kbd', { text: '/' }), ' focuses the message box. ', h('kbd', { text: 'Enter' }), ' sends, ', h('kbd', { text: 'Shift' }), '+', h('kbd', { text: 'Enter' }), ' adds a line.'),
	));
}

function newTurn({ runId = null, utterance = '', mode = state.mode, createdAt = new Date().toISOString() } = {}) {
	const turn = {
		key: runId || `local-${Date.now()}`,
		runId,
		utterance,
		mode,
		network: state.squad.network,
		status: 'planning',
		steps: new Map(),
		notes: [],
		clarify: null,
		planner: null,
		saved: [],
		summary: null,
		error: null,
		createdAt,
		seen: new Set(),
		lastEventId: 0,
		busyStep: null,
		el: h('article', { class: 'tc-turn', 'aria-label': 'Squad run' }),
		frame: 0,
	};
	const thread = $('#tcThread');
	if (!state.turns.size) thread.replaceChildren();
	const later = [...state.turns.values()].filter((t) => t.createdAt > createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
	if (later) thread.insertBefore(turn.el, later.el);
	else thread.append(turn.el);
	state.turns.set(turn.key, turn);
	return turn;
}

function bindRunId(turn, runId) {
	if (!runId || turn.runId === runId) return;
	state.turns.delete(turn.key);
	turn.runId = runId;
	turn.key = runId;
	state.turns.set(runId, turn);
	const url = new URL(location.href);
	url.searchParams.set('run', runId);
	history.replaceState(null, '', url);
}

/** Fold one event into a turn. `live` is false while replaying history. */
function applyEvent(turn, ev, { live = true } = {}) {
	if (ev.id) {
		if (turn.seen.has(ev.id)) return;
		turn.seen.add(ev.id);
		turn.lastEventId = Math.max(turn.lastEventId, Number(ev.id) || 0);
	}
	const p = ev.payload || {};
	switch (ev.kind) {
		case 'run':
			bindRunId(turn, p.run_id);
			if (p.status) turn.status = p.status;
			if (p.mode) turn.mode = p.mode;
			if (p.network) turn.network = p.network;
			if (p.utterance) turn.utterance = p.utterance;
			break;
		case 'memory':
			if (Array.isArray(p.entries)) {
				state.prefs = p.entries;
				if (p.saved) {
					turn.saved.push(p.saved);
					if (live) state.freshPref = p.saved;
				}
				paintMemory();
			}
			break;
		case 'plan':
			turn.steps = new Map((p.steps || []).map((s) => [s.id, s]));
			turn.notes = [...(p.notes || [])];
			turn.clarify = p.clarify || null;
			turn.planner = p.planner || null;
			if (live && (p.steps || []).length) setFigure('coordinator', 'speaking', 'Planning', { speak: `${p.steps.length} steps`, hold: 2200 });
			break;
		case 'step':
			if (p.step?.id) {
				turn.steps.set(p.step.id, { ...turn.steps.get(p.step.id), ...p.step });
				if (live) reactToStep(p.step);
			}
			break;
		case 'approval': {
			const step = turn.steps.get(p.step_id);
			if (step) {
				step.approval = p.approval;
				step.status = 'needs_approval';
				if (live) reactToStep(step);
			}
			break;
		}
		case 'note':
			if (p.text) turn.notes.push(p.text);
			break;
		case 'summary':
			turn.summary = p;
			if (p.status) turn.status = p.status;
			if (live && p.headline) setFigure('coordinator', 'speaking', 'Summing up', { speak: p.headline, hold: 3000 });
			break;
		case 'error':
			turn.error = p;
			break;
		case 'end':
			bindRunId(turn, p.run_id);
			if (p.status) turn.status = p.status;
			if (p.step?.id) turn.steps.set(p.step.id, { ...turn.steps.get(p.step.id), ...p.step });
			break;
		default:
			return;
	}
	scheduleRender(turn);
}

function scheduleRender(turn) {
	if (turn.frame) return;
	turn.frame = requestAnimationFrame(() => {
		turn.frame = 0;
		renderTurn(turn);
	});
}

function renderTurn(turn) {
	const [statusText, statusTone] = RUN_STATUS[turn.status] || [label(turn.status), ''];
	const steps = [...turn.steps.values()].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
	const planning = turn.status === 'planning' && !steps.length && !turn.clarify && !turn.error;
	const savedLabels = turn.saved.map((k) => {
		const entry = state.prefs.find((p) => p.key === k);
		return entry ? `${PREF_LABEL[k] || label(k)}: ${prefValue(entry)}` : PREF_LABEL[k] || label(k);
	});

	turn.el.replaceChildren(
		h('div', { class: 'tc-msg user' },
			h('p', { class: 'tc-bubble', text: turn.utterance }),
			h('span', { class: 'tc-msg-meta' },
				turn.mode === 'live' ? chip('Live', 'bad') : chip('Paper'),
				h('time', { datetime: turn.createdAt, text: ago(turn.createdAt) }),
			),
		),
		h('div', { class: 'tc-msg coord' },
			h('div', { class: 'tc-coord-head' },
				h('b', { text: 'Coordinator' }),
				chip(statusText, statusTone),
				turn.planner ? h('span', { class: 'tm-faint tc-planner', text: turn.planner === 'model' ? 'Planned by the model, checked against your words' : 'Planned from your words' }) : null,
				turn.runId ? h('a', { class: 'tc-link tc-permalink', href: `?run=${turn.runId}`, title: 'Link to this run', text: 'Link' }) : null,
			),
			planning ? h('div', { class: 'tc-planning', role: 'status' },
				h('span', { class: 'tc-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
				'Reading your message and planning the steps',
			) : null,
			turn.clarify ? h('div', { class: 'tm-note warn' }, h('b', { text: 'One thing first. ' }), turn.clarify) : null,
			turn.notes.length ? h('ul', { class: 'tc-notes' }, turn.notes.map((n) => h('li', { text: n }))) : null,
			savedLabels.length ? h('p', { class: 'tc-saved' }, h('b', { text: 'Remembered: ' }), savedLabels.join(' · ')) : null,
			steps.length ? h('ol', { class: 'tc-plan', 'aria-label': 'Plan' }, steps.map((s) => stepView(turn, s))) : null,
			turn.summary && !turn.summary.clarify ? summaryView(turn.summary) : null,
			turn.error ? h('div', { class: 'tm-note bad', role: 'alert' }, h('b', { text: 'The run stopped. ' }), errText(turn.error)) : null,
		),
	);
}

function stepView(turn, s) {
	const [txt, tone] = STEP_STATUS[s.status] || [label(s.status), ''];
	const role = roleOf(s.role);
	const body = s.result?.summary || s.evidence?.summary || null;
	const errorText = s.status === 'failed' || s.status === 'skipped' ? errText(s.error) : '';
	const deps = (s.depends_on || []).length ? `After ${s.depends_on.join(', ')}` : null;
	return h('li', { class: `tc-step st-${s.status}`, style: `--role:var(--role-${role})`, dataset: { step: s.id } },
		h('span', { class: 'tc-step-dot', 'aria-hidden': 'true' }),
		h('div', { class: 'tc-step-main' },
			h('div', { class: 'tc-step-head' },
				h('span', { class: 'tm-chip role', text: s.role_title || ROLE_TITLE[s.role] || label(s.role) }),
				h('b', { class: 'tc-step-title', text: s.title }),
				h('span', { class: `tm-chip ${tone} tc-step-status` }, s.status === 'running' || s.status === 'executing' ? h('i', { class: 'tc-spin', 'aria-hidden': 'true' }) : null, txt),
			),
			deps ? h('span', { class: 'tc-step-deps tm-faint', text: `${s.key} · ${deps}` }) : null,
			body ? h('p', { class: 'tc-step-body', text: body }) : null,
			errorText ? h('p', { class: `tc-step-body ${s.status === 'failed' ? 'bad' : 'tm-faint'}`, text: errorText }) : null,
			evidenceView(s),
			s.result?.receipt ? receiptView(s.result.receipt, s.kind) : handoffLink(s),
			s.approval && s.status === 'needs_approval' ? approvalView(turn, s) : null,
			s.approval && s.status !== 'needs_approval' && s.status !== 'done' && s.approval.summary
				? h('p', { class: 'tc-step-body tm-faint', text: `Approval: ${s.approval.summary}` })
				: null,
		),
	);
}

/** Flatten an evidence object to readable rows: one level of nesting, capped. */
function evidenceRows(ev) {
	const rows = [];
	const push = (k, v) => {
		if (rows.length >= 14 || v == null || v === '') return;
		if (typeof v === 'number') rows.push([k, Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 6 })]);
		else if (typeof v === 'boolean') rows.push([k, v ? 'Yes' : 'No']);
		else if (typeof v === 'string') rows.push([k, v.length > 160 ? `${v.slice(0, 159)}…` : v]);
		else if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) rows.push([k, v.slice(0, 8).join(', ')]);
	};
	for (const [k, v] of Object.entries(ev || {})) {
		if (k === 'summary') continue;
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			for (const [k2, v2] of Object.entries(v)) push(`${label(k)} · ${label(k2).toLowerCase()}`, v2);
		} else push(label(k), v);
	}
	return rows;
}

function evidenceView(s) {
	const rows = evidenceRows(s.evidence);
	if (!rows.length) return null;
	return h('details', { class: 'tc-evidence' },
		h('summary', { text: `Evidence (${rows.length})` }),
		h('dl', {}, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
	);
}

function handoffLink(s) {
	const href = safeHref(s.evidence?.handoff_url);
	if (!href || s.status !== 'done') return null;
	return h('p', { class: 'tc-receipt' }, h('a', { class: 'tm-btn sm', href, text: 'Open in the agent wallet' }));
}

function receiptView(r, kind) {
	const explorer = safeHref(r.explorer);
	const orders = safeHref(r.orders_url);
	const handoff = safeHref(r.handoff_url);
	const facts = [];
	if (r.sol_spent != null) facts.push(`Spent ${r.sol_spent} SOL`);
	if (r.tokens_received != null) facts.push(`Got ${Number(r.tokens_received).toLocaleString()} tokens`);
	if (r.tokens_sold != null) facts.push(`Sold ${Number(r.tokens_sold).toLocaleString()} tokens`);
	if (r.sol_received != null) facts.push(`Got ${r.sol_received} SOL`);
	if (r.expected_out != null && r.simulated) facts.push(`Expected out ${Number(r.expected_out).toLocaleString()}`);
	if (r.venue) facts.push(`via ${r.venue}`);
	if (r.order_id) facts.push(`Order ${short(r.order_id)} · ${label(r.status)}`);
	return h('div', { class: 'tc-receipt' },
		h('b', { text: 'Receipt' }),
		r.simulated ? chip('Paper', '', 'Simulated against the live quote. Nothing was signed.') : r.signature ? chip('Signed', 'good') : null,
		facts.length ? h('span', { text: facts.join(' · ') }) : null,
		r.simulation_error ? h('span', { class: 'bad', text: `Simulation error: ${typeof r.simulation_error === 'string' ? r.simulation_error : JSON.stringify(r.simulation_error)}` }) : null,
		explorer ? h('a', { class: 'tc-link', href: explorer, target: '_blank', rel: 'noopener noreferrer', text: `View transaction ${short(r.signature)}` }) : null,
		orders ? h('a', { class: 'tc-link', href: orders, text: 'View standing order' }) : null,
		handoff ? h('a', { class: 'tm-btn sm primary', href: handoff, text: kind === 'launch' ? 'Open the launchpad to sign' : 'Open the wallet to sign' }) : null,
	);
}

function approvalView(turn, s) {
	const a = s.approval;
	const busy = turn.busyStep?.id === s.id ? turn.busyStep.decision : null;
	const live = a.payload?.mode === 'live';
	const handoff = a.action === 'launch' || a.action === 'transfer';
	const left = a.expires_at ? timeLeft(a.expires_at) : null;
	const expired = Boolean(a.expires_at) && !left;
	const inbox = safeHref(a.inbox_url);
	return h('section', { class: `tc-approval${live ? ' live' : ''}`, 'aria-label': 'Approval needed' },
		h('div', { class: 'tc-approval-head' },
			h('b', { text: 'Your approval is needed' }),
			a.expires_at ? h('span', { class: 'tc-countdown', dataset: { expires: a.expires_at }, text: expired ? 'Expired' : `Expires in ${left}` }) : null,
		),
		a.summary ? h('p', { class: 'tc-approval-sum', text: a.summary }) : null,
		(a.gate_reasons || []).length ? h('div', { class: 'tc-gates' }, a.gate_reasons.map((g) => chip(GATE_LABEL[g] || label(g), g === 'exceeds_cap' ? 'warn' : 'bad'))) : null,
		(a.table || []).length ? h('table', { class: 'tc-table' },
			h('tbody', {}, a.table.map((row) => h('tr', {},
				h('th', { scope: 'row', text: row.label }),
				h('td', { title: row.full || null }, row.value, row.full && row.full !== row.value ? h('span', { class: 'tc-full tm-mono', text: row.full }) : null),
			))),
		) : null,
		(a.risk_notes || []).length ? h('ul', { class: 'tc-risk' }, a.risk_notes.map((n) => h('li', { text: n }))) : null,
		a.mirrored && inbox ? h('p', { class: 'tm-faint tc-inbox' }, 'Also waiting in your ', h('a', { class: 'tc-link', href: inbox, text: 'approvals inbox' }), '. Deciding there resumes this run too.') : null,
		h('div', { class: 'tm-actions tc-approval-actions' },
			h('button', {
				class: `tm-btn ${live ? 'live' : 'primary'}`, type: 'button', disabled: Boolean(busy) || expired,
				onclick: () => decide(turn, s, 'approve'),
				text: busy === 'approve' ? 'Approving…' : handoff ? (a.action === 'launch' ? 'Approve, then sign on the launchpad' : 'Approve, then sign in the wallet') : live ? 'Approve and sign' : 'Approve',
			}),
			h('button', { class: 'tm-btn danger', type: 'button', disabled: Boolean(busy), onclick: () => decide(turn, s, 'deny'), text: busy === 'deny' ? 'Declining…' : 'Deny' }),
		),
		h('p', { class: 'tc-fine tm-faint', text: handoff
			? 'Approving hands this to the page where you sign it yourself. Nothing signs from this chat.'
			: live
				? 'Approving signs exactly what is shown, from the Trader wallet, inside the spend policy.'
				: 'Paper mode: approving simulates this against the live quote. Nothing signs.' }),
	);
}

function tickCountdowns() {
	for (const el of $$('.tc-countdown[data-expires]')) {
		const left = timeLeft(el.dataset.expires);
		el.textContent = left ? `Expires in ${left}` : 'Expired';
		el.classList.toggle('soon', Boolean(left) && new Date(el.dataset.expires).getTime() - Date.now() < 60_000);
		if (!left) el.closest('.tc-approval')?.querySelector('.tc-approval-actions .tm-btn:not(.danger)')?.setAttribute('disabled', '');
	}
}

// ── actions ──────────────────────────────────────────────────────────────────

async function onSend(e) {
	e.preventDefault();
	const input = $('#tcInput');
	const message = input.value.trim();
	if (!message || state.sending || !canRun()) {
		if (!message) input.focus();
		return;
	}
	state.sending = true;
	$('#tcSend').disabled = true;
	$('#tcSend').textContent = 'Sending…';
	input.value = '';
	autosize(input);

	const turn = newTurn({ utterance: message, mode: state.mode });
	renderTurn(turn);
	turn.el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
	setFigure('coordinator', 'working', 'Planning');

	const out = await streamPost(`/api/teams/${state.squadId}/chat`, { message, mode: state.mode }, (ev) => applyEvent(turn, ev));
	state.sending = false;
	$('#tcSend').textContent = 'Send';
	paintBanner();

	if (!out.ok && !turn.runId) {
		turn.status = 'failed';
		turn.error = { message: out.message };
		renderTurn(turn);
		if (out.code === RISK_ACK_CODE) showAgreementNote(turn);
		if (out.status === 401) turn.el.append(h('p', {}, h('a', { class: 'tm-btn sm primary', href: `/login?next=${encodeURIComponent(location.pathname)}`, text: 'Sign in again' })));
		if (!out.status || out.status >= 500 || out.status === 429) input.value = message;
		setFigure('coordinator', 'alert', 'Could not start', { hold: 3500 });
		return;
	}
	if (!out.ended && turn.runId) follow(turn);
	else if (turn.runId && needsFollow(turn)) follow(turn);
	refreshRuns();
}

function showAgreementNote(turn) {
	turn.el.append(h('div', { class: 'tm-note warn' },
		h('b', { text: 'Live mode needs your signed real-funds agreements. ' }),
		'Sign them once, then send again. Paper mode works without them. ',
		h('a', { class: 'tc-link', href: `/legal/agreements?next=${encodeURIComponent(location.pathname)}`, text: 'Sign the agreements' }),
	));
}

/** A run waiting on an inbox-mirrored approval keeps moving after this page's stream ends. */
function needsFollow(turn) {
	if (!OPEN_RUN.has(turn.status)) return false;
	return [...turn.steps.values()].some((s) => s.status === 'needs_approval' ? s.approval?.mirrored : !['done', 'failed', 'skipped', 'denied', 'expired'].includes(s.status));
}

async function decide(turn, step, decision) {
	const a = step.approval;
	if (decision === 'approve' && a.payload?.mode === 'live') {
		const ok = await confirmDialog({
			title: 'Sign this from the Trader wallet?',
			body: [
				h('table', {}, h('tbody', {}, (a.table || []).map((row) => h('tr', {}, h('th', { text: row.label }), h('td', { text: row.full || row.value }))))),
				h('p', { text: 'This signs a real transaction. It cannot be undone once it lands.' }),
			],
			ok: 'Yes, sign it',
			tone: 'live',
		});
		if (!ok) return;
	}
	turn.busyStep = { id: step.id, decision };
	renderTurn(turn);
	setFigure(step.role, decision === 'approve' ? 'working' : 'idle', decision === 'approve' ? 'Executing' : 'Declined');
	let failed = null;
	const out = await streamPost(`/api/teams/${state.squadId}/chat/approve`, {
		step_id: step.id,
		decision,
		payload_hash: decision === 'approve' ? a.payload_hash : undefined,
	}, (ev) => {
		if (ev.kind === 'error') failed = ev.payload;
		else applyEvent(turn, ev);
	});
	turn.busyStep = null;
	if (!out.ok || failed) {
		const err = failed || out;
		if (err.code === RISK_ACK_CODE) showAgreementNote(turn);
		toast(err.message || 'That did not go through.');
		if (err.code === 'payload_mismatch' || err.code === 'expired' || err.code === 'not_pending' || err.code === 'already_decided') await loadRun(turn.runId, { force: true });
		else renderTurn(turn);
		setFigure(step.role, 'alert', 'Needs your approval');
		return;
	}
	toast(decision === 'approve' ? 'Approved. The squad picked the run back up.' : 'Declined. Nothing was signed.');
	renderTurn(turn);
	if (needsFollow(turn)) follow(turn);
	refreshRuns();
}

/** Load a past or open run, replay its events, and follow it if it is still moving. */
async function loadRun(runId, { scroll = false, force = false } = {}) {
	if (!runId) return;
	let turn = state.turns.get(runId);
	if (turn && !force) {
		if (scroll) turn.el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
		return;
	}
	const r = await api(`/api/teams/${state.squadId}/chat/runs/${runId}`);
	if (!r.ok) {
		if (scroll) toast(r.status === 404 ? 'That run is not part of this squad.' : r.message);
		return;
	}
	const { run, steps, events } = r.data;
	if (turn) {
		turn.steps = new Map();
		turn.notes = [];
		turn.saved = [];
		turn.seen = new Set();
		turn.summary = null;
		turn.error = null;
	} else {
		turn = newTurn({ runId: run.id, utterance: run.utterance, mode: run.mode, createdAt: run.created_at });
	}
	turn.status = run.status;
	turn.mode = run.mode;
	turn.network = run.network;
	for (const ev of events) applyEvent(turn, ev, { live: false });
	// The step rows are the source of truth; events only narrate how they got there.
	turn.steps = new Map(steps.map((s) => [s.id, s]));
	turn.status = run.status;
	if (run.summary && !turn.summary) turn.summary = { status: run.status, ...run.summary };
	if (!turn.clarify && run.plan?.clarify) turn.clarify = run.plan.clarify;
	if (!turn.planner && run.plan?.planner) turn.planner = run.plan.planner;
	renderTurn(turn);
	paintRuns();
	if (scroll) turn.el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
	if (OPEN_RUN.has(run.status)) follow(turn);
}

/** Tail a run's event log over EventSource (resumes with Last-Event-ID on reconnect). */
function follow(turn) {
	if (!turn.runId || state.tails.has(turn.runId) || typeof EventSource === 'undefined') return;
	const url = `/api/teams/${state.squadId}/chat/stream?run=${turn.runId}&after=${turn.lastEventId}`;
	const es = new EventSource(url, { withCredentials: true });
	state.tails.set(turn.runId, es);
	es.onmessage = (msg) => {
		let ev;
		try {
			ev = JSON.parse(msg.data);
		} catch {
			return;
		}
		if (ev.kind === 'end') {
			applyEvent(turn, ev);
			es.close();
			state.tails.delete(turn.runId);
			refreshRuns();
			return;
		}
		applyEvent(turn, ev);
	};
	es.onerror = () => {
		if (es.readyState === EventSource.CLOSED) state.tails.delete(turn.runId);
	};
}

function summaryView(sum) {
	const lines = sum.lines || [];
	return h('section', { class: 'tc-summary', 'aria-label': 'Summary' },
		h('b', { class: 'tc-summary-head', text: sum.headline || 'Summary' }),
		lines.length ? h('ul', {}, lines.map((l) => {
			const [txt, tone] = STEP_STATUS[l.status] || [label(l.status), ''];
			const explorer = safeHref(l.receipt?.explorer);
			return h('li', { style: `--role:var(--role-${roleOf(l.role)})` },
				h('span', { class: 'tm-chip role', text: l.role_title || ROLE_TITLE[l.role] || label(l.role) }),
				chip(txt, tone),
				h('span', { class: 'tc-summary-text', text: l.text }),
				explorer ? h('a', { class: 'tc-link', href: explorer, target: '_blank', rel: 'noopener noreferrer', text: 'Transaction' }) : null,
				l.receipt?.simulated ? h('span', { class: 'tm-faint', text: '(paper)' }) : null,
			);
		})) : null,
	);
}

boot().catch((e) => {
	console.error('[team-chat] boot failed', e);
	paintError('Squad chat did not load', 'Something broke while opening this page. Reload to try again.', { retry: () => location.reload() });
});
