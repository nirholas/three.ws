// LobeHub iframe bridge for three.ws.
//
// Primary protocol: v1 spec envelope
//   { v: 1, source: 'agent-host'|'agent-3d', id, inReplyTo?, kind, op, payload }
// See prompts/final-integration/01-embed-bridges.md for the canonical contract.
//
// Backward-compat layer also accepts the legacy format:
//   { v: 1, ns: '3d-agent', type: 'host:xxx', id?, payload }

const EMBED_VERSION = '1.0.0';
const CAPABILITIES = ['speak', 'gesture', 'emote', 'look', 'setAgent', 'subscribe', 'ping'];

// Origins unconditionally trusted.
const KNOWN_ORIGINS = new Set(['https://chat.lobehub.com', 'https://lobechat.ai']);

function isDev(origin) {
	try {
		const h = new URL(origin).hostname;
		return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || h === '0.0.0.0';
	} catch {
		return false;
	}
}

const params = new URL(location.href).searchParams;
const agentId = params.get('agent') || '';
const srcParam = params.get('src') || '';

// ?host=<encoded-origin> restricts accepted parent to one origin.
let allowedOrigin = null;
const hostParam = params.get('host');
if (hostParam) {
	try {
		allowedOrigin = new URL(decodeURIComponent(hostParam)).origin;
	} catch {
		console.warn('[3d-agent] invalid ?host param');
	}
}

function isAllowedOrigin(origin) {
	if (!origin) return false;
	if (allowedOrigin) return origin === allowedOrigin;
	if (KNOWN_ORIGINS.has(origin)) return true;
	if (isDev(origin)) return true;
	// Permit unknown origins with a warning — public agents may embed anywhere.
	console.warn('[3d-agent] message from unlisted origin', origin);
	return true;
}

function newId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ── Outgoing ─────────────────────────────────────────────────────────────────

function post(op, payload, inReplyTo) {
	const msg = {
		v: 1,
		source: 'agent-3d',
		id: newId(),
		kind: inReplyTo ? 'response' : 'event',
		op,
		payload: payload ?? {},
	};
	if (inReplyTo) msg.inReplyTo = inReplyTo;
	const target = allowedOrigin ?? '*';
	try {
		window.parent.postMessage(msg, target);
	} catch (_) {}
}

// ── Element wiring ────────────────────────────────────────────────────────────

const el = document.getElementById('agent');
const statusEl = document.getElementById('status');

function setStatus(text) {
	if (statusEl) statusEl.textContent = text;
}

if (srcParam) {
	el.setAttribute('src', decodeURIComponent(srcParam));
} else if (agentId) {
	el.setAttribute('agent-id', agentId);
} else {
	setStatus('No agent specified — add ?agent=<id> or ?src=<glb-url> to the URL.');
}

el.addEventListener('agent:ready', (ev) => {
	const { manifest } = ev.detail || {};
	if (statusEl) statusEl.style.display = 'none';
	post('ready', {
		agentId,
		embedVersion: EMBED_VERSION,
		capabilities: CAPABILITIES,
		name: manifest?.meta?.name || manifest?.name || '',
	});
});

el.addEventListener('agent:error', (ev) => {
	const { phase, error: err } = ev.detail || {};
	setStatus(err?.message || 'Error loading agent');
	post('error', {
		code: err?.code || 'load_error',
		message: err?.message || 'Agent failed to load',
		phase: phase || 'boot',
	});
});

// ── ResizeObserver → resize event (debounced 100 ms) ─────────────────────────

if (typeof ResizeObserver !== 'undefined') {
	let resizeTimer;
	const ro = new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			post('resize', {
				width: el.offsetWidth,
				height: el.offsetHeight,
				contentHeight: el.scrollHeight,
			});
		}, 100);
	});
	ro.observe(el);
}

// ── Action dispatch ───────────────────────────────────────────────────────────

let subscribed = false;

async function dispatchAction(op, payload, replyId) {
	try {
		switch (op) {
			case 'speak':
				el.speak?.(payload.text || '', { sentiment: payload.sentiment ?? 0 });
				break;
			case 'gesture':
				if (payload.name === 'wave') {
					await el.wave?.();
				} else {
					await el.play?.(payload.name, { duration: payload.duration });
				}
				break;
			case 'emote':
				// <agent-3d> has no public emote() method; dispatch as a CustomEvent
				// for the runtime's empathy-layer listener (src/agent-avatar.js).
				el.dispatchEvent(
					new CustomEvent('agent:action', { detail: { type: 'emote', payload } }),
				);
				break;
			case 'look':
				el.dispatchEvent(
					new CustomEvent('agent:action', { detail: { type: 'look', payload } }),
				);
				break;
			case 'setAgent':
				if (payload.agentId && payload.agentId !== agentId) {
					const url = new URL(location.href);
					url.searchParams.set('agent', payload.agentId);
					location.replace(url.toString());
				}
				break;
		}
		if (replyId) post('pong', { ok: true }, replyId);
		if (subscribed) {
			post('action', { op, payload, timestamp: Date.now(), agentId });
		}
	} catch (err) {
		console.warn('[3d-agent] action dispatch failed', err);
		if (replyId) post('error', { code: 'dispatch_error', message: String(err) }, replyId);
	}
}

// ── postMessage handler ───────────────────────────────────────────────────────

function onMessage(ev) {
	const { origin, data } = ev;
	if (!data || typeof data !== 'object') return;

	// Dev-harness handshake shortcut.
	if (data.type === 'handshake') {
		try {
			window.parent.postMessage({ type: 'ready', agentId }, ev.origin || '*');
		} catch (_) {}
		return;
	}

	if (!isAllowedOrigin(origin)) return;

	// ── v1 spec envelope ──────────────────────────────────────────────────────
	if (data.v === 1 && data.source === 'agent-host' && data.kind && data.op) {
		const { id, kind, op, payload = {} } = data;
		if (kind !== 'request') return;

		switch (op) {
			case 'ping':
				post('pong', { agentId }, id);
				break;
			case 'subscribe':
				subscribed = true;
				post('pong', { ok: true }, id);
				break;
			case 'speak':
			case 'gesture':
			case 'emote':
			case 'look':
			case 'setAgent':
				dispatchAction(op, payload, id);
				break;
			default:
				post('error', { code: 'unknown_op', op }, id);
		}
		return;
	}

	// ── Legacy envelope: { v:1, ns:'3d-agent', type:'host:xxx', ... } ─────────
	if (data.v === 1 && data.ns === '3d-agent' && typeof data.type === 'string') {
		const { type, id, payload = {} } = data;
		switch (type) {
			case 'host:hello':
				post(
					'ready',
					{ agentId, embedVersion: EMBED_VERSION, capabilities: CAPABILITIES },
					id,
				);
				break;
			case 'host:ping':
				post('pong', {}, id);
				break;
			case 'host:action':
				if (payload.action) {
					const a = payload.action;
					dispatchAction(a.type, a.payload || {}, null);
				}
				break;
			case 'host:pause':
				el.pause?.();
				break;
			case 'host:resume':
				el.resume?.();
				break;
			case 'host:theme':
				applyTheme(payload);
				break;
			case 'host:set-agent':
				dispatchAction('setAgent', payload, null);
				break;
		}
	}
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme({ mode, accent } = {}) {
	if (mode === 'dark') document.body.style.background = '#0b0d10';
	else if (mode === 'light') document.body.style.background = '#f5f5f5';
	else if (mode === 'transparent') document.body.style.background = 'transparent';
	if (accent) document.documentElement.style.setProperty('--agent-accent', accent);
}

window.addEventListener('message', onMessage);

// Fire initial ready event so the host knows the iframe is alive.
// The host should respond with a ping to complete the handshake.
post('ready', {
	agentId,
	embedVersion: EMBED_VERSION,
	capabilities: CAPABILITIES,
});
