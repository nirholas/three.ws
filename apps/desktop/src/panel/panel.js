// Menu bar panel renderer. Draws the snapshot the main process pushes and sends
// typed actions back. It holds no data of its own beyond what is on screen.
// The 3D body is the published walk embed driven over its postMessage contract
// (the same one the desktop companion uses), so the panel owns no 3D code.

import { formatSol, shortAddress, ago, agentPower } from './model.js';

if (new URLSearchParams(location.search).has('vibrancy')) document.documentElement.dataset.vibrancy = '';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
	const node = Object.assign(document.createElement(tag), props);
	for (const k of kids) node.append(k);
	return node;
};

const els = {
	panel: $('panel'), signin: $('signin'), picker: $('picker'), pill: $('power-label'), power: $('power'),
	body: $('body'), face: $('face'), sol: $('sol'), unit: $('sol-unit'), addr: $('addr'), balance: $('balance'),
	companion: $('companion'), companionCard: $('companion-card'), approval: $('approval'), tiles: $('tiles'),
	ask: $('ask'), askInput: $('ask-input'), askSend: $('ask-send'), reply: $('reply'), sync: $('sync'),
};

let state = null;
let embedFor = null;
let embedReady = false;
let embedOrigin = null;
let lastGesture = null;
let activeAsk = null;
let busyPower = false;

// ── 3D body ─────────────────────────────────────────────────────────────────

function toEmbed(type, payload = {}) {
	if (!embedReady || !embedOrigin) return;
	els.body.contentWindow?.postMessage({ channel: 'three-walk', v: 1, type, ...payload }, embedOrigin);
}

function mountEmbed(apiBase, agentId) {
	const key = `${apiBase}|${agentId || ''}`;
	if (embedFor === key) return;
	embedFor = key;
	embedReady = false;
	lastGesture = null;
	embedOrigin = new URL(apiBase).origin;
	const params = new URLSearchParams({ bg: 'transparent', ground: 'false', controls: 'none', badge: 'false', orbit: 'false', click: 'false', env: 'studio' });
	if (agentId) params.set('agent', agentId);
	els.body.src = `${apiBase}/walk-embed?${params}`;
}

els.body.addEventListener('load', () => {
	if (embedOrigin) els.body.contentWindow?.postMessage({ channel: 'three-walk', v: 1, type: 'walk:ping' }, embedOrigin);
});

window.addEventListener('message', (event) => {
	if (!embedOrigin || event.origin !== embedOrigin || event.source !== els.body.contentWindow) return;
	if (event.data?.type === 'walk:ready') {
		embedReady = true;
		applyGesture();
	}
});

function applyGesture() {
	const gesture = state?.face?.gesture;
	if (!gesture || gesture === lastGesture) return;
	lastGesture = gesture;
	toEmbed('walk:gesture', { gesture });
}

// ── Render ──────────────────────────────────────────────────────────────────

function tile(key, value, { tone = '', onClick = null, disabled = false, title = '' } = {}) {
	const b = el('button', { type: 'button', className: 'tile', disabled, title }, el('span', { className: 'k', textContent: key }), el('span', { className: 'v', textContent: value }));
	if (tone) b.dataset.tone = tone;
	if (onClick) b.addEventListener('click', onClick);
	return b;
}

function renderPicker(s) {
	els.picker.replaceChildren(...s.agents.map((a) => el('option', { value: a.id, textContent: a.name, selected: a.id === s.selected?.id })));
	els.picker.disabled = s.agents.length < 2;
	els.picker.title = s.agents.length < 2 ? 'Create more agents on three.ws to switch between them' : '';
}

function renderHeader(s) {
	const power = agentPower(s.selected);
	els.pill.textContent = s.selected ? power.label : s.syncedAt || s.syncError ? 'No agents' : 'Loading';
	els.pill.dataset.tone = power.on ? 'ok' : 'muted';
	els.power.hidden = !s.selected || !power.known;
	els.power.setAttribute('aria-pressed', String(power.on));
	els.power.setAttribute('aria-label', power.on ? `Stop ${s.selected?.name}` : `Start ${s.selected?.name}`);
	els.power.disabled = busyPower;
}

function renderBalance(s) {
	const w = s.wallet;
	els.sol.className = 'num';
	if (!s.selected) {
		els.sol.textContent = s.syncedAt ? 'No agent' : '';
		els.unit.hidden = true;
		els.addr.hidden = true;
		return;
	}
	els.unit.hidden = false;
	if (!w) {
		els.sol.className = 'num sk';
		els.sol.textContent = '0.000';
		els.sol.style.color = 'transparent';
		els.addr.hidden = true;
		return;
	}
	els.sol.style.color = '';
	const sol = formatSol(w.sol);
	els.sol.textContent = sol ?? '--';
	els.unit.textContent = sol == null ? '' : 'SOL';
	const address = w.address || s.selected.solanaAddress;
	els.addr.hidden = !address;
	if (address) {
		els.addr.textContent = w.error ? `${shortAddress(address)} · balance unavailable` : shortAddress(address);
		els.addr.dataset.address = address;
	}
}

function renderApproval(s) {
	const first = s.pending[0];
	els.approval.hidden = !first;
	if (!first) return;
	const more = s.pending.length - 1;
	els.approval.replaceChildren(
		el('div', { className: 'row' },
			el('div', {}, el('b', { textContent: `${first.agentName} needs your approval${more ? ` (+${more} more)` : ''}` }), el('p', { textContent: first.text || `Hash ${first.hash}` })),
			Object.assign(el('button', { type: 'button', className: 'btn', textContent: 'Review' }), { onclick: () => window.panel.review(first.id).catch(showError) }),
		),
	);
}

function renderTiles(s) {
	const local = s.local.summary;
	const tiles = [];
	tiles.push(tile('Local agents', local.total ? (local.allPaused ? 'Paused' : `${local.total - local.paused} running`) : 'None', {
		tone: local.total && !local.allPaused ? 'ok' : '',
		disabled: !local.total,
		title: local.total ? (local.action === 'resume' ? 'Resume all local agents' : 'Pause all local agents') : 'Create a local agent in the console',
		onClick: () => window.panel.toggleLocal().catch(showError),
	}));
	tiles.push(tile('Approvals', s.pending.length ? `${s.pending.length} waiting` : 'All clear', {
		tone: s.pending.length ? 'warn' : '',
		onClick: () => (s.pending.length ? window.panel.review(s.pending[0].id) : window.panel.open('wallet')).catch(showError),
	}));
	tiles.push(tile('Alerts', s.unread ? `${s.unread} unread` : 'None', { tone: s.unread ? 'warn' : '', onClick: () => window.panel.open('notifications').catch(showError) }));
	els.tiles.replaceChildren(...tiles);
}

function renderFooter(s) {
	els.sync.dataset.busy = String(Boolean(s.syncing));
	els.sync.dataset.error = String(Boolean(s.syncError));
	els.sync.textContent = s.syncing ? 'Syncing...' : s.syncError ? `Offline: ${s.syncError}` : s.syncedAt ? `Synced ${ago(s.syncedAt)}` : '';
	els.sync.title = s.syncError ? 'Click refresh by reopening the panel' : '';
}

function render(next) {
	state = next;
	els.panel.hidden = !next.signedIn;
	els.signin.hidden = next.signedIn;
	els.panel.setAttribute('aria-busy', String(next.syncing && !next.syncedAt));
	if (!next.signedIn) return;
	mountEmbed(next.apiBase, next.selected?.id);
	renderPicker(next);
	renderHeader(next);
	els.face.textContent = next.face.label;
	els.face.dataset.tone = next.face.tone;
	renderBalance(next);
	els.companion.checked = next.companion.enabled;
	renderApproval(next);
	renderTiles(next);
	els.askInput.placeholder = next.selected ? `Ask ${next.selected.name}` : 'Ask your agent';
	els.askInput.disabled = !next.selected;
	els.askSend.disabled = !next.selected || Boolean(activeAsk);
	renderFooter(next);
	applyGesture();
}

// ── Actions ─────────────────────────────────────────────────────────────────

function showReply(text, kind = '', who = '') {
	els.reply.hidden = !text;
	els.reply.dataset.state = kind;
	els.reply.replaceChildren(...(who ? [el('span', { className: 'who', textContent: who })] : []), document.createTextNode(text));
	els.reply.scrollTop = els.reply.scrollHeight;
}

function showError(err) {
	showReply(err?.message || 'Something went wrong', 'error');
}

els.picker.addEventListener('change', () => window.panel.select(els.picker.value).catch(showError));

els.power.addEventListener('click', async () => {
	const s = state?.selected;
	if (!s || busyPower) return;
	busyPower = true;
	els.power.disabled = true;
	try {
		await window.panel.setAgentRunning(s.id, !agentPower(s).on);
	} catch (err) {
		showError(err);
	} finally {
		busyPower = false;
		if (state) renderHeader(state);
	}
});

els.companion.addEventListener('change', () => window.panel.setCompanion(els.companion.checked).catch((err) => {
	els.companion.checked = !els.companion.checked;
	showError(err);
}));

els.addr.addEventListener('click', async () => {
	const address = els.addr.dataset.address;
	if (!address) return;
	try {
		await navigator.clipboard.writeText(address);
		const prev = els.addr.textContent;
		els.addr.textContent = 'Copied';
		setTimeout(() => {
			els.addr.textContent = prev;
		}, 1200);
	} catch {
		showReply(address, '', 'Wallet address');
	}
});

els.ask.addEventListener('submit', async (e) => {
	e.preventDefault();
	const message = els.askInput.value.trim();
	if (!message || activeAsk) return;
	els.askSend.disabled = true;
	showReply('Thinking...', '', state?.selected?.name || '');
	try {
		const { requestId } = await window.panel.ask(message);
		activeAsk = { requestId, text: '' };
		els.askInput.value = '';
	} catch (err) {
		els.askSend.disabled = false;
		showError(err);
	}
});

window.panel.onChat((evt) => {
	if (!activeAsk || evt.requestId !== activeAsk.requestId) return;
	const who = state?.selected?.name || '';
	if (evt.type === 'chunk') {
		activeAsk.text += evt.text;
		showReply(activeAsk.text, '', who);
	} else if (evt.type === 'done' && evt.reply) {
		activeAsk.text = evt.reply;
		showReply(evt.reply, '', who);
	} else if (evt.type === 'error') {
		showReply(evt.message || 'The agent could not answer. Try again.', 'error');
	} else if (evt.type === 'end') {
		activeAsk = null;
		if (state) els.askSend.disabled = !state.selected;
	}
});

$('open-console').addEventListener('click', () => window.panel.open().catch(showError));
$('signin-btn').addEventListener('click', () => window.panel.open().catch(showError));

window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.panel.hide();
});

setInterval(() => {
	if (state?.signedIn) renderFooter(state);
}, 15_000);

window.panel.onState(render);
window.panel.onShow((s) => {
	render(s);
	if (!els.askInput.disabled) els.askInput.focus();
});
window.panel.state().then(render).catch(showError);
