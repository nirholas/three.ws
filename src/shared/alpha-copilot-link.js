// alpha-copilot-link — the Alpha Co-pilot entry point on an agent's profile.
//
// Mounts a compact panel cross-linking an agent to the Alpha Co-pilot, where it
// reads a real live launch in character and speaks its verdict aloud. When the
// live feed has a candidate, it deep-links straight to a read of that launch so
// the profile becomes a one-tap path into the magic moment. Pure enhancement:
// any fetch failure degrades to the plain link, and it never blocks the profile.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function mountAlphaPanel({ agentId, agentName = 'this agent', isOwner = false, listed = true, container, position = 'append' } = {}) {
	if (!agentId || !container) return null;
	// Alpha reads of an agent that is not listed on the marketplace are
	// owner-only: for a visitor the candidates call and the co-pilot deep link
	// would both 404, so there is nothing to offer.
	if (listed === false && !isOwner) return null;
	const el = document.createElement('div');
	el.className = 'alpha-link-panel';
	if (position === 'prepend') container.prepend(el);
	else container.append(el);
	injectStyle();

	// Try to surface one live launch to deep-link a read; degrade to the plain link.
	let top = null;
	try {
		const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/alpha/candidates?network=mainnet`, { credentials: 'include' });
		if (r.ok) { const j = await r.json().catch(() => ({})); top = (j.items || [])[0] || null; }
	} catch { /* plain link below */ }

	const base = `/alpha-copilot?agent=${encodeURIComponent(agentId)}`;
	const deep = top?.mint ? `${base}&mint=${encodeURIComponent(top.mint)}` : base;
	const label = top?.symbol ? `$${esc(top.symbol)}` : (top ? 'a live launch' : null);

	el.innerHTML = `
		<div class="alp-head">
			<span class="alp-kicker">Alpha Co-pilot</span>
			<span class="alp-badge">In-character</span>
		</div>
		<p class="alp-copy">${esc(agentName)} reads a real launch in character — citing live liquidity, holders & smart-money — and speaks its verdict aloud.${isOwner ? ' Act on the call within your spend limits.' : ''}</p>
		<div class="alp-actions">
			<a class="alp-btn primary" href="${deep}">${label ? `Hear its read on ${label}` : 'Open Alpha Co-pilot'}</a>
			${label ? `<a class="alp-btn ghost" href="${base}">Browse launches</a>` : ''}
		</div>`;

	return { el, destroy() { try { el.remove(); } catch { /* idempotent */ } } };
}

let _styled = false;
function injectStyle() {
	if (_styled) return;
	_styled = true;
	const css = `
	.alpha-link-panel{border:1px solid rgba(139,92,246,.28);background:rgba(139,92,246,.06);border-radius:14px;padding:14px 16px;margin:14px 0;font-family:inherit}
	.alpha-link-panel .alp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
	.alpha-link-panel .alp-kicker{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c4b5fd}
	.alpha-link-panel .alp-badge{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#c4b5fd;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:999px;padding:2px 8px}
	.alpha-link-panel .alp-copy{margin:0 0 10px;font-size:14px;opacity:.9;line-height:1.45}
	.alpha-link-panel .alp-actions{display:flex;gap:8px;flex-wrap:wrap}
	.alpha-link-panel .alp-btn{display:inline-block;padding:8px 16px;border-radius:9px;border:1px solid rgba(139,92,246,.3);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:background .15s,transform .1s}
	.alpha-link-panel .alp-btn:hover{background:rgba(139,92,246,.18)}
	.alpha-link-panel .alp-btn:active{transform:scale(.97)}
	.alpha-link-panel .alp-btn.primary{background:linear-gradient(90deg,#a78bfa,#8b5cf6);border:0;color:#fff}
	.alpha-link-panel .alp-btn.ghost{opacity:.85}
	.alpha-link-panel .alp-btn:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}`;
	const tag = document.createElement('style');
	tag.textContent = css;
	document.head.appendChild(tag);
}
