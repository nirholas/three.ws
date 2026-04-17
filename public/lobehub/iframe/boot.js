// LobeHub iframe postMessage bridge for 3D Agent.
// Envelope: { v: 1, ns: '3d-agent', type, id?, payload }
// See public/lobehub/README.md for full contract.

const NS = '3d-agent';
const V = 1;
const EMBED_VERSION = '0.1.0';

// Origins trusted unconditionally (no ?host= needed).
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

// ?host=<encoded-origin> narrows the allowed parent to a single origin.
let allowedOrigin = null;
const hostParam = params.get('host');
if (hostParam) {
	try {
		allowedOrigin = new URL(decodeURIComponent(hostParam)).origin;
	} catch {
		console.warn('[3d-agent:bridge] invalid ?host param');
	}
}

function isAllowedOrigin(origin) {
	if (!origin) return false;
	if (allowedOrigin) return origin === allowedOrigin;
	if (KNOWN_ORIGINS.has(origin)) return true;
	if (isDev(origin)) return true;
	// Permit unlisted origins but log — public agents may embed anywhere.
	console.warn('[3d-agent:bridge] message from unlisted origin', origin);
	return true;
}

function postToHost(type, payload, replyId) {
	const msg = { v: V, ns: NS, type, payload: payload ?? {} };
	if (replyId !== undefined) msg.id = replyId;
	const target = allowedOrigin || '*';
	try {
		window.parent.postMessage(msg, target);
	} catch {}
}

// ── Element wiring ────────────────────────────────────────────────────────────

const el = document.getElementById('agent');
const statusEl = document.getElementById('status');

function setStatus(text) {
	if (statusEl) statusEl.textContent = text;
}

if (agentId) {
	el.setAttribute('agent-id', agentId);
} else {
	setStatus('No agent specified — add ?agent=<id> to the URL.');
}

el.addEventListener('agent:ready', (ev) => {
	const { manifest } = ev.detail || {};
	if (statusEl) statusEl.style.display = 'none';
	postToHost('embed:ready', {
		agentId,
		name: manifest?.meta?.name || manifest?.name || '',
		avatarUrl: manifest?.body?.url || '',
	});
});

el.addEventListener('agent:error', (ev) => {
	const { phase, error: err } = ev.detail || {};
	setStatus(err?.message || 'Error loading agent');
	postToHost('embed:error', {
		code: err?.code || 'load_error',
		message: err?.message || 'Agent failed to load',
		phase: phase || 'boot',
	});
});

// ── ResizeObserver → embed:resize (debounced 100ms) ──────────────────────────

if (typeof ResizeObserver !== 'undefined') {
	let resizeTimer;
	const ro = new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			postToHost('embed:resize', {
				width: el.offsetWidth,
				height: el.offsetHeight,
				contentHeight: el.scrollHeight,
			});
		}, 100);
	});
	ro.observe(el);
}

// ── Action dispatch ───────────────────────────────────────────────────────────

async function dispatchAction(action) {
	if (!action || !action.type) return;
	try {
		switch (action.type) {
			case 'speak':
				await el.say?.(action.payload?.text || '', {
					sentiment: action.payload?.sentiment,
				});
				break;
			case 'gesture':
				if (action.payload?.name === 'wave') {
					await el.wave?.();
				} else {
					await el.play?.(action.payload?.name, { duration: action.payload?.duration });
				}
				break;
			case 'emote':
				// TODO(lobehub-spec): <agent-3d> has no direct emote() public method.
				// Dispatching as a CustomEvent; element.js may not consume it without
				// a corresponding listener. Confirm with src/element.js maintainer.
				el.dispatchEvent(new CustomEvent('agent:action', { detail: action }));
				break;
			default:
				el.dispatchEvent(new CustomEvent('agent:action', { detail: action }));
		}
		// Mirror action up to host so it can log what the avatar did.
		postToHost('embed:action', {
			action: { ...action, timestamp: Date.now(), agentId },
		});
	} catch (err) {
		console.warn('[3d-agent:bridge] action dispatch failed', err);
	}
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme({ mode, accent } = {}) {
	if (mode === 'dark') document.body.style.background = '#0b0d10';
	else if (mode === 'light') document.body.style.background = '#f5f5f5';
	else if (mode === 'transparent') document.body.style.background = 'transparent';
	if (accent) document.documentElement.style.setProperty('--agent-accent', accent);
}

// ── postMessage handler ───────────────────────────────────────────────────────

function onMessage(ev) {
	const { origin, data } = ev;
	if (!data || typeof data !== 'object') return;

	// Acceptance-test handshake: { type: 'handshake' } → { type: 'ready' }
	if (data.type === 'handshake') {
		try {
			window.parent.postMessage({ type: 'ready', agentId }, ev.origin || '*');
		} catch {}
		return;
	}

	// Legacy compat: { __agent, type: 'action', action } — deprecated, one version support.
	if (data.__agent !== undefined) {
		if (data.__agent === agentId && data.type === 'action' && data.action) {
			console.warn('[3d-agent:bridge] legacy message format — migrate to v1 envelope');
			dispatchAction(data.action);
		}
		return;
	}

	if (!isAllowedOrigin(origin)) return;

	// v1 envelope validation
	if (data.v !== V || data.ns !== NS || !data.type) return;
	const { type, id, payload = {} } = data;
	console.log('[3d-agent:bridge] recv', type, payload);

	switch (type) {
		case 'host:hello':
			postToHost(
				'embed:hello',
				{
					embedVersion: EMBED_VERSION,
					agentId,
					capabilities: [
						'speak',
						'gesture',
						'emote',
						'theme',
						'resize',
						'pause',
						'resume',
						'set-agent',
					],
				},
				id,
			);
			break;

		case 'host:ping':
			postToHost('embed:pong', {}, id);
			break;

		case 'host:action':
			if (payload.action) dispatchAction(payload.action);
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
			if (payload.agentId && payload.agentId !== agentId) {
				const url = new URL(location.href);
				url.searchParams.set('agent', payload.agentId);
				location.replace(url.toString());
			}
			break;
	}
}

window.addEventListener('message', onMessage);

// Fire initial hello so host knows the iframe is alive.
postToHost('embed:hello', {
	embedVersion: EMBED_VERSION,
	agentId,
	capabilities: ['speak', 'gesture', 'emote', 'theme', 'resize', 'pause', 'resume', 'set-agent'],
});
