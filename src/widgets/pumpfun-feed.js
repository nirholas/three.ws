/**
 * Pump.fun Live Feed Widget
 *
 * DOM overlay on top of the 3D viewer. Subscribes to /api/agents/pumpfun-feed
 * (SSE) and renders a stack of cards. When `autoNarrate` is on, the agent
 * narrates each event through the existing protocol bus — speak + emote
 * routed through the Empathy Layer (see src/CLAUDE.md "Empathy Layer").
 *
 * Config (validated in widget-types.js):
 *   - kind        'all' | 'claims' | 'graduations'
 *   - minTier     ''    | 'notable' | 'influencer' | 'mega'
 *   - autoNarrate boolean
 *   - maxCards    1..50
 */

const FEED_PATH = '/api/agents/pumpfun-feed';
const TIER_BADGE = { mega: '🔥🔥', influencer: '🔥', notable: '⭐' };

/**
 * @param {import('../viewer.js').Viewer} viewer
 * @param {object} config
 * @param {HTMLElement} container  parent element to attach the overlay to
 * @param {{ protocol?: any }} [ctx]
 */
export async function mountPumpfunFeed(viewer, config, container, ctx = {}) {
	const root = document.createElement('div');
	root.className = 'pumpfun-feed';
	root.style.cssText = [
		'position:absolute',
		'right:16px',
		'top:16px',
		'width:320px',
		'max-height:80%',
		'overflow-y:auto',
		'pointer-events:auto',
		'z-index:5',
		'font-family:ui-sans-serif,system-ui,-apple-system,sans-serif',
		'color:#fff',
	].join(';');
	(container || document.body).appendChild(root);

	const status = document.createElement('div');
	status.style.cssText = 'opacity:0.6;font-size:12px;padding:4px 8px';
	status.textContent = 'Connecting to pump.fun feed…';
	root.appendChild(status);

	const stack = document.createElement('div');
	root.appendChild(stack);

	const params = new URLSearchParams();
	params.set('kind', config.kind || 'all');
	if (config.minTier) params.set('minTier', config.minTier);

	const es = new EventSource(`${FEED_PATH}?${params.toString()}`, {
		withCredentials: true,
	});

	const maxCards = Math.max(1, Math.min(50, config.maxCards || 8));
	const protocol = ctx.protocol || (typeof window !== 'undefined' ? window.VIEWER?.agent_protocol : null);

	es.addEventListener('open', () => {
		status.textContent = 'Live · pump.fun';
	});

	es.addEventListener('claim', (msg) => {
		const ev = safeJson(msg.data);
		if (!ev) return;
		addCard(stack, renderClaim(ev), maxCards);
		if (config.autoNarrate) narrateClaim(protocol, ev);
	});

	es.addEventListener('graduation', (msg) => {
		const ev = safeJson(msg.data);
		if (!ev) return;
		addCard(stack, renderGraduation(ev), maxCards);
		if (config.autoNarrate) narrateGraduation(protocol, ev);
	});

	es.addEventListener('error', () => {
		if (es.readyState === EventSource.CLOSED) {
			status.textContent = 'Disconnected.';
		}
	});

	es.addEventListener('close', () => {
		status.textContent = 'Reconnecting…';
	});

	return {
		destroy() {
			try {
				es.close();
			} catch {}
			root.remove();
		},
	};
}

function addCard(stack, el, max) {
	stack.prepend(el);
	while (stack.children.length > max) stack.lastChild?.remove();
}

function renderClaim(ev) {
	const el = document.createElement('div');
	el.style.cssText = cardStyle(ev.fake_claim ? '#3a1418' : ev.first_time_claim ? '#0d2d1a' : '#161616');
	const tier = ev.tier ? `${TIER_BADGE[ev.tier] || ''} ${ev.tier}` : '';
	const sol = ev.amount_sol != null ? `${Number(ev.amount_sol).toFixed(3)} SOL` : '';
	el.innerHTML = `
		<div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.7">
			<span>${ev.first_time_claim ? '🚨 FIRST CLAIM' : 'Claim'}</span>
			<span>${tier}</span>
		</div>
		<div style="font-weight:600;margin-top:4px">${escapeHtml(ev.github_user ? '@' + ev.github_user : ev.claimer || '—')}</div>
		<div style="font-size:12px;opacity:0.85">${sol}${ev.token_symbol ? ' · $' + escapeHtml(ev.token_symbol) : ''}</div>
		${ev.ai_take ? `<div style="font-size:11px;opacity:0.75;margin-top:4px;font-style:italic">${escapeHtml(ev.ai_take)}</div>` : ''}
	`;
	return el;
}

function renderGraduation(ev) {
	const el = document.createElement('div');
	el.style.cssText = cardStyle('#1a1632');
	el.innerHTML = `
		<div style="font-size:11px;opacity:0.7">🎓 Graduation</div>
		<div style="font-weight:600;margin-top:4px">${escapeHtml(ev.name || ev.symbol || ev.mint)}</div>
		${ev.symbol ? `<div style="font-size:12px;opacity:0.85">$${escapeHtml(ev.symbol)}</div>` : ''}
	`;
	return el;
}

function cardStyle(bg) {
	return [
		`background:${bg}`,
		'border:1px solid rgba(255,255,255,0.08)',
		'border-radius:8px',
		'padding:10px 12px',
		'margin-bottom:6px',
		'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
	].join(';');
}

function narrateClaim(protocol, ev) {
	if (!protocol) return;
	if (ev.first_time_claim) {
		protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });
		protocol.emit({
			type: 'speak',
			payload: {
				text: `First-time claim: ${ev.github_user ? '@' + ev.github_user : 'unknown'}${ev.ai_take ? ' — ' + ev.ai_take : ''}`,
				sentiment: 0.7,
			},
		});
	} else if (ev.fake_claim) {
		protocol.emit({ type: 'emote', payload: { trigger: 'concern', weight: 0.7 } });
		protocol.emit({
			type: 'speak',
			payload: { text: `Fake claim from ${ev.github_user || ev.claimer}.`, sentiment: -0.5 },
		});
	} else if (ev.tier === 'mega' || ev.tier === 'influencer') {
		protocol.emit({ type: 'emote', payload: { trigger: 'curiosity', weight: 0.5 } });
	}
}

function narrateGraduation(protocol, ev) {
	if (!protocol) return;
	protocol.emit({ type: 'gesture', payload: { name: 'wave', duration: 1500 } });
	protocol.emit({
		type: 'speak',
		payload: { text: `Graduation: ${ev.symbol || ev.name || 'a token'} hit PumpAMM.`, sentiment: 0.6 },
	});
}

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
