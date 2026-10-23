// Agent-to-Agent hire — the shared, embodied "one agent pays another for real
// work" experience (prompts/agent-wallets/15). Reusable across every surface that
// shows an agent service offer: the live economy page, an agent profile, the
// marketplace.
//
// Everything here is real. The hire runs through POST /api/agents/a2a-hire, which:
//   • owner-gates the hiring agent (you can only spend YOUR agent's wallet),
//   • reserves the spend against that agent's server-side spend policy + kill
//     switch BEFORE any money moves,
//   • settles USDC to the provider over the real x402 rails (settle only after the
//     provider's work succeeds — payment-fails-but-work-fails can never charge),
//   • writes a real on-chain invocation receipt (agent-invocation program),
//   • records both sides in the custody ledger so the provider's income shows up
//     in the Galaxy Money-Cam as a real flow.
//
// This module owns the UI for picking a hiring agent, running the hire, showing
// the real receipt with explorer links, the honest failure states, the rating,
// and the embodied hand-off animation that plays on a real completed hire.

import { apiFetch } from '../api.js';
import { shortAddress as shortAddr } from './address.js';

// ── tiny helpers ────────────────────────────────────────────────────────────

export function escHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtUsd(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '$0.00';
	if (v === 0) return 'Free';
	if (v < 0.01) return `$${v.toFixed(4)}`;
	if (v < 1) return `$${v.toFixed(3)}`;
	return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { shortAddr };

function initials(name) {
	const parts = String(name || 'Agent').trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return 'A';
	return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// A stable color from an id so each agent's avatar fallback is consistent.
function hueFor(id) {
	let h = 0;
	const s = String(id || '');
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
	return h;
}

function avatarHtml(agent, size = 56) {
	const url = agent?.avatar_thumbnail_url || agent?.avatar_url || null;
	const id = agent?.id || agent?.name || '';
	const style = `width:${size}px;height:${size}px`;
	if (url) {
		return `<span class="tahx-av" style="${style}"><img src="${escHtml(url)}" alt="" loading="lazy" /></span>`;
	}
	const hue = hueFor(id);
	return `<span class="tahx-av tahx-av-fallback" style="${style};--h:${hue}">${escHtml(initials(agent?.name))}</span>`;
}

// ── data ────────────────────────────────────────────────────────────────────

let _myAgentsCache = null;

// The signed-in user's own agents — the only wallets they can spend from. Returns
// null when logged out (401 is a legitimate answer here). Never throws.
export async function fetchMyAgents({ force = false } = {}) {
	if (_myAgentsCache && !force) return _myAgentsCache;
	try {
		const r = await apiFetch('/api/agents', { allowAnonymous: true });
		if (r.status === 401) return null;
		if (!r.ok) return [];
		const j = await r.json().catch(() => null);
		const rows = j?.agents || j?.data?.agents || [];
		const agents = rows
			.map((a) => ({
				id: a.id,
				name: a.name || 'Untitled agent',
				avatar_thumbnail_url: a.avatar_thumbnail_url || a.thumbnail_url || null,
				solana_address: a.solana_address || a.meta?.solana_address || a.wallet?.solana || null,
			}))
			.filter((a) => a.id);
		_myAgentsCache = agents;
		return agents;
	} catch {
		return [];
	}
}

export async function fetchOffer(slug) {
	try {
		const r = await apiFetch(`/api/agents/economy?view=offer&slug=${encodeURIComponent(slug)}`, { allowAnonymous: true });
		if (!r.ok) return null;
		const j = await r.json().catch(() => null);
		return j?.data?.offer || null;
	} catch {
		return null;
	}
}

// Run the real hire. Returns { ok:true, hire, result } or
// { ok:false, code, message, detail } — never throws.
export async function runHire({ hirerAgentId, serviceSlug, input = null, maxUsd, idempotencyKey }) {
	const body = { hirerAgentId, serviceSlug };
	if (input != null) body.input = input;
	if (typeof maxUsd === 'number' && Number.isFinite(maxUsd)) body.maxUsd = maxUsd;
	if (idempotencyKey) body.idempotencyKey = idempotencyKey;
	let r;
	try {
		r = await apiFetch('/api/agents/a2a-hire', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			allowAnonymous: true,
		});
	} catch {
		return { ok: false, code: 'network', message: 'Network error — the hire did not start. No funds moved.' };
	}
	const j = await r.json().catch(() => null);
	if (r.ok && j?.ok) return { ok: true, hire: j.hire, result: j.result ?? null };
	return {
		ok: false,
		status: r.status,
		code: j?.error || 'hire_failed',
		message: j?.error_description || j?.message || `The hire failed (${r.status}).`,
		detail: j?.detail || j || null,
	};
}

export async function submitRating(hireId, rating) {
	try {
		const r = await apiFetch('/api/agents/economy', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'rate', hireId, rating }),
			allowAnonymous: true,
		});
		const j = await r.json().catch(() => null);
		if (r.ok && j?.ok) return { ok: true, rating: j.rating };
		return { ok: false, message: j?.error_description || 'Could not save your rating.' };
	} catch {
		return { ok: false, message: 'Could not save your rating.' };
	}
}

// ── embodied hand-off animation ─────────────────────────────────────────────

// Render two agents facing each other and animate a value hand-off between them:
// the hiring agent slides a USDC coin across to the provider, the provider
// receives it and nods. Driven entirely by the real hire (real names, real
// amount). Resolves when the animation settles. Respects reduced-motion.
export function renderHandoffStage(hirer, provider, amountUsdc) {
	return `
		<div class="tahx-stage" data-state="idle">
			<div class="tahx-actor tahx-actor-from">
				${avatarHtml(hirer, 64)}
				<span class="tahx-actor-name">${escHtml(hirer?.name || 'Hiring agent')}</span>
				<span class="tahx-actor-role">pays</span>
			</div>
			<div class="tahx-wire" aria-hidden="true">
				<span class="tahx-coin">$</span>
				<span class="tahx-amount">${escHtml(fmtUsd(amountUsdc))}</span>
			</div>
			<div class="tahx-actor tahx-actor-to">
				${avatarHtml(provider, 64)}
				<span class="tahx-actor-name">${escHtml(provider?.name || 'Provider')}</span>
				<span class="tahx-actor-role">delivers</span>
			</div>
		</div>`;
}

export function playHandoff(stageEl) {
	if (!stageEl) return Promise.resolve();
	const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	return new Promise((resolve) => {
		// Two frames so the initial 'idle' layout paints before we animate.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				stageEl.dataset.state = 'paying';
				const done = () => {
					stageEl.dataset.state = 'settled';
					resolve();
				};
				if (reduce) {
					done();
					return;
				}
				const coin = stageEl.querySelector('.tahx-coin');
				if (coin) {
					coin.addEventListener('animationend', done, { once: true });
					// Safety net if animationend never fires (e.g. display:none mid-anim).
					setTimeout(done, 1600);
				} else {
					setTimeout(done, 1200);
				}
			});
		});
	});
}

// ── the hire panel (modal) ──────────────────────────────────────────────────

let _stylesInjected = false;
function ensureStyles() {
	if (_stylesInjected) return;
	_stylesInjected = true;
	const css = `
.tahx-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,5,12,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .18s ease}
.tahx-backdrop.tahx-in{opacity:1}
.tahx-modal{width:min(540px,100%);max-height:calc(100dvh - 40px);overflow:auto;background:var(--surface-1,#0c0c12);border:1px solid var(--wallet-stroke,rgba(139,92,246,.32));border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.6);transform:translateY(8px) scale(.99);transition:transform .2s var(--ease-standard,cubic-bezier(.2,.8,.2,1));color:var(--text,#eaeafb)}
.tahx-backdrop.tahx-in .tahx-modal{transform:translateY(0) scale(1)}
.tahx-head{display:flex;align-items:flex-start;gap:12px;padding:18px 18px 0}
.tahx-head h3{margin:0;font-size:17px;letter-spacing:-.01em;flex:1}
.tahx-head p{margin:4px 0 0;font-size:12.5px;color:var(--text-muted,#8a8aa3)}
.tahx-x{appearance:none;background:transparent;border:1px solid var(--border,#23232e);color:var(--text-muted,#8a8aa3);width:30px;height:30px;border-radius:9px;font-size:16px;line-height:1;cursor:pointer;flex:none}
.tahx-x:hover{color:var(--text,#eaeafb);border-color:#3a3a47}
.tahx-x:focus-visible{outline:2px solid var(--accent,#c4b5fd);outline-offset:2px}
.tahx-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:14px}
.tahx-offer{display:flex;align-items:center;gap:12px;border:1px solid var(--border,#1c1c26);border-radius:14px;padding:12px;background:var(--surface-2,#13131b)}
.tahx-offer-meta{min-width:0;flex:1}
.tahx-offer-name{font-weight:600;font-size:14.5px}
.tahx-offer-prov{font-size:12px;color:var(--text-muted,#8a8aa3)}
.tahx-offer-price{font-family:var(--font-mono,ui-monospace,monospace);font-weight:700;color:#6ee7a8;white-space:nowrap}
.tahx-field{display:flex;flex-direction:column;gap:6px}
.tahx-label{font-size:12px;color:var(--text-muted,#8a8aa3);font-weight:600;letter-spacing:.01em}
.tahx-select,.tahx-input{font:inherit;font-size:14px;background:var(--surface-2,#13131b);color:var(--text,#eaeafb);border:1px solid var(--border-strong,#2a2a36);border-radius:11px;padding:10px 12px;width:100%}
.tahx-select:focus-visible,.tahx-input:focus-visible{outline:2px solid var(--accent,#c4b5fd);outline-offset:1px;border-color:transparent}
.tahx-row{display:flex;gap:10px;align-items:center}
.tahx-hint{font-size:11.5px;color:var(--text-faint,#6a6a82)}
.tahx-actions{display:flex;gap:10px;margin-top:2px}
.tahx-btn{appearance:none;font:inherit;font-weight:600;font-size:14px;border-radius:12px;padding:11px 16px;cursor:pointer;border:1px solid transparent;transition:transform .1s ease,background .15s ease,border-color .15s ease}
.tahx-btn:active{transform:translateY(1px)}
.tahx-btn:focus-visible{outline:2px solid var(--accent,#c4b5fd);outline-offset:2px}
.tahx-btn[disabled]{opacity:.5;cursor:not-allowed}
.tahx-btn-primary{flex:1;background:linear-gradient(135deg,#a78bfa,#7c5cff);color:#0b0b14}
.tahx-btn-primary:hover:not([disabled]){background:linear-gradient(135deg,#b6a0ff,#8c6dff)}
.tahx-btn-ghost{background:transparent;border-color:var(--border-strong,#2a2a36);color:var(--text,#eaeafb)}
.tahx-btn-ghost:hover{border-color:#3a3a47}
.tahx-note{font-size:12px;line-height:1.5;color:var(--text-muted,#8a8aa3);border-left:2px solid var(--wallet-stroke,rgba(139,92,246,.4));padding-left:10px}
.tahx-alert{border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5}
.tahx-alert-err{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.32);color:#fca5a5}
.tahx-alert-warn{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.3);color:#fcd34d}
.tahx-alert-ok{background:rgba(110,231,168,.07);border:1px solid rgba(110,231,168,.3);color:#86efac}
.tahx-alert a{color:inherit;text-decoration:underline}
/* receipt */
.tahx-receipt{display:flex;flex-direction:column;gap:10px}
.tahx-receipt-rows{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border,#1c1c26);border-radius:12px;padding:12px}
.tahx-rr{display:flex;justify-content:space-between;gap:12px;font-size:13px;align-items:baseline}
.tahx-rr-k{color:var(--text-muted,#8a8aa3)}
.tahx-rr-v{font-family:var(--font-mono,ui-monospace,monospace);text-align:right;word-break:break-word}
.tahx-rr-v a{color:#a78bfa;text-decoration:none}
.tahx-rr-v a:hover{text-decoration:underline}
.tahx-result{font-size:13px;line-height:1.5;background:var(--surface-2,#13131b);border:1px solid var(--border,#1c1c26);border-radius:12px;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto}
/* rating */
.tahx-rate{display:flex;align-items:center;gap:8px}
.tahx-star{appearance:none;background:transparent;border:0;cursor:pointer;font-size:24px;line-height:1;color:#3a3a47;padding:0 1px;transition:color .12s ease,transform .1s ease}
.tahx-star:hover,.tahx-star.tahx-on{color:#ffd166}
.tahx-star:hover{transform:scale(1.12)}
.tahx-star:focus-visible{outline:2px solid var(--accent,#c4b5fd);outline-offset:2px;border-radius:4px}
.tahx-spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;display:inline-block;animation:tahx-spin .7s linear infinite;vertical-align:-2px;margin-right:7px}
@keyframes tahx-spin{to{transform:rotate(360deg)}}
/* embodied stage */
.tahx-stage{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px;padding:16px 6px;border:1px solid var(--border,#1c1c26);border-radius:14px;background:radial-gradient(120% 140% at 50% 0%,rgba(124,92,255,.10),transparent 60%),var(--surface-2,#11111a)}
.tahx-actor{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;transition:transform .3s ease}
.tahx-actor-name{font-size:12.5px;font-weight:600;max-width:13ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tahx-actor-role{font-size:10.5px;color:var(--text-faint,#6a6a82);text-transform:uppercase;letter-spacing:.08em}
.tahx-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#1c1c2a,#0c0c14);border:2px solid rgba(124,92,255,.35);box-shadow:0 0 0 0 rgba(124,92,255,.4)}
.tahx-av img{width:100%;height:100%;object-fit:cover}
.tahx-av-fallback{font-weight:700;color:#fff;background:hsl(var(--h,265) 45% 30%)}
.tahx-wire{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:80px;height:34px;justify-content:center}
.tahx-wire::before{content:"";position:absolute;top:16px;left:6px;right:6px;height:2px;background:linear-gradient(90deg,transparent,rgba(124,92,255,.5),transparent)}
.tahx-amount{font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px;color:#a78bfa;z-index:1;background:var(--surface-2,#11111a);padding:0 6px}
.tahx-coin{position:absolute;top:4px;left:4px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#0b0b14;background:linear-gradient(135deg,#fff0a8,#ffd166);box-shadow:0 2px 10px rgba(255,209,102,.5);opacity:0;z-index:2}
.tahx-stage[data-state="paying"] .tahx-coin{animation:tahx-fly 1.2s var(--ease-standard,cubic-bezier(.4,0,.2,1)) forwards}
.tahx-stage[data-state="paying"] .tahx-actor-from{transform:translateX(-3px)}
.tahx-stage[data-state="settled"] .tahx-actor-to{animation:tahx-nod .5s ease}
.tahx-stage[data-state="settled"] .tahx-actor-to .tahx-av{border-color:#6ee7a8;box-shadow:0 0 0 5px rgba(110,231,168,.18)}
@keyframes tahx-fly{0%{opacity:0;left:4px;transform:translateY(0) scale(.6)}15%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1}100%{opacity:0;left:calc(100% - 30px);transform:translateY(-2px) scale(.9)}}
@keyframes tahx-nod{0%,100%{transform:translateY(0)}40%{transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.tahx-stage[data-state="paying"] .tahx-coin{animation:none;opacity:1;left:calc(50% - 13px)}}
@media (max-width:520px){.tahx-modal{width:100%}}
`;
	const tag = document.createElement('style');
	tag.id = 'tahx-styles';
	tag.textContent = css;
	document.head.appendChild(tag);
}

const escAttr = escHtml;

// Map a server error code to a designed, actionable message + optional CTA.
function explainError(res) {
	const code = res.code || 'hire_failed';
	const base = res.message || 'The hire could not complete.';
	switch (code) {
		case 'spend_disabled':
			return { kind: 'warn', html: 'Autonomous agent spending is not enabled on this server yet. Offers are real and browsable; live hiring turns on once the operator enables agent payments.' };
		case 'no_wallet':
		case 'no_solana_wallet':
			return { kind: 'warn', html: 'This agent has no Solana wallet provisioned to pay from. Open the agent and set up its wallet, then hire again.' };
		case 'over_cap': {
			const price = res.detail?.price_usd != null ? fmtUsd(res.detail.price_usd) : '';
			return { kind: 'warn', html: `This service costs ${escHtml(price)}, above the per-call limit you set. Raise the limit to proceed.` };
		}
		case 'frozen':
		case 'kill_switch':
			return { kind: 'err', html: 'This agent is frozen by its kill switch — all autonomous spending is halted. Unfreeze it in the wallet to hire.' };
		case 'daily_cap':
		case 'per_tx_cap':
		case 'spend_blocked':
			return { kind: 'err', html: `${escHtml(base)} This is your own spend policy protecting the wallet — adjust the limit in the agent's wallet if intended.` };
		case 'offer_unavailable':
		case 'offer_not_found':
			return { kind: 'err', html: 'This provider is no longer available. Pick another service.' };
		case 'self_hire':
			return { kind: 'err', html: 'An agent can\'t hire its own service. Choose a different hiring agent.' };
		case 'hire_in_progress':
			return { kind: 'warn', html: 'A hire with this request is already in progress — no double charge. Give it a moment.' };
		case 'unauthorized':
			return { kind: 'err', html: 'Sign in to hire an agent.' };
		default:
			return { kind: 'err', html: escHtml(base) };
	}
}

function explorerRow(label, sig, url) {
	if (!sig) return '';
	return `<div class="tahx-rr"><span class="tahx-rr-k">${escHtml(label)}</span><span class="tahx-rr-v">${
		url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${escHtml(shortAddr(sig))} ↗</a>` : escHtml(shortAddr(sig))
	}</span></div>`;
}

/**
 * Open the hire modal for a given offer.
 * @param {object} offer  shape from /api/agents/economy (slug, name, price_usdc, provider{…})
 * @param {object} opts   { onComplete(hire), defaultHirerId }
 */
export async function openHirePanel(offer, opts = {}) {
	ensureStyles();
	if (document.querySelector('.tahx-backdrop')) return; // one at a time

	const backdrop = document.createElement('div');
	backdrop.className = 'tahx-backdrop';
	backdrop.setAttribute('role', 'dialog');
	backdrop.setAttribute('aria-modal', 'true');
	backdrop.setAttribute('aria-label', `Hire ${offer?.name || 'an agent'}`);

	const priceUsd = offer?.price_usdc != null ? Number(offer.price_usdc) : (Number(offer?.price_atomics || 0) / 1e6);
	const providerName = offer?.provider?.name || 'Provider agent';

	backdrop.innerHTML = `
		<div class="tahx-modal">
			<div class="tahx-head">
				<div style="flex:1">
					<h3>Hire ${escHtml(offer?.name || 'this service')}</h3>
					<p>One of your agents pays ${escHtml(providerName)} over the real x402 rails — bounded by its spend policy.</p>
				</div>
				<button class="tahx-x" type="button" aria-label="Close">✕</button>
			</div>
			<div class="tahx-body">
				<div class="tahx-offer">
					${avatarHtml(offer?.provider, 44)}
					<div class="tahx-offer-meta">
						<div class="tahx-offer-name">${escHtml(offer?.name || 'Service')}</div>
						<div class="tahx-offer-prov">by ${escHtml(providerName)} · ${escHtml((offer?.network || 'solana').toUpperCase())}</div>
					</div>
					<div class="tahx-offer-price">${escHtml(fmtUsd(priceUsd))}</div>
				</div>
				<div class="tahx-form-area"></div>
			</div>
		</div>`;

	const modal = backdrop.querySelector('.tahx-modal');
	const formArea = backdrop.querySelector('.tahx-form-area');

	const close = () => {
		backdrop.classList.remove('tahx-in');
		document.removeEventListener('keydown', onKey);
		setTimeout(() => backdrop.remove(), 200);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') close();
	};
	backdrop.querySelector('.tahx-x').addEventListener('click', close);
	backdrop.addEventListener('mousedown', (e) => {
		if (e.target === backdrop) close();
	});
	document.addEventListener('keydown', onKey);

	document.body.appendChild(backdrop);
	requestAnimationFrame(() => backdrop.classList.add('tahx-in'));

	// ── load the user's agents, then render the right state ──────────────────
	formArea.innerHTML = `<div class="tahx-note"><span class="tahx-spin"></span>Loading your agents…</div>`;
	const agents = await fetchMyAgents();

	if (agents === null) {
		formArea.innerHTML = `
			<div class="tahx-alert tahx-alert-warn">Sign in to hire ${escHtml(providerName)} with one of your agents.</div>
			<div class="tahx-actions">
				<a class="tahx-btn tahx-btn-primary" href="/login?next=${encodeURIComponent(location.pathname + location.search)}" style="text-align:center;text-decoration:none;line-height:1.4">Sign in</a>
				<button class="tahx-btn tahx-btn-ghost" type="button" data-close>Close</button>
			</div>`;
		formArea.querySelector('[data-close]')?.addEventListener('click', close);
		return;
	}
	if (!agents.length) {
		formArea.innerHTML = `
			<div class="tahx-alert tahx-alert-warn">You don't have an agent with a wallet yet. Create one to start hiring.</div>
			<div class="tahx-actions">
				<a class="tahx-btn tahx-btn-primary" href="/create" style="text-align:center;text-decoration:none;line-height:1.4">Create an agent</a>
				<button class="tahx-btn tahx-btn-ghost" type="button" data-close>Close</button>
			</div>`;
		formArea.querySelector('[data-close]')?.addEventListener('click', close);
		return;
	}

	// Exclude the provider itself (an agent can't hire its own service).
	const selectable = agents.filter((a) => a.id !== offer?.provider?.id);
	const list = selectable.length ? selectable : agents;
	const defaultId = opts.defaultHirerId && list.some((a) => a.id === opts.defaultHirerId) ? opts.defaultHirerId : list[0].id;

	formArea.innerHTML = `
		<div class="tahx-field">
			<label class="tahx-label" for="tahx-hirer">Hire as</label>
			<select class="tahx-select" id="tahx-hirer">
				${list.map((a) => `<option value="${escAttr(a.id)}"${a.id === defaultId ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('')}
			</select>
		</div>
		<div class="tahx-field">
			<label class="tahx-label" for="tahx-max">Per-call limit (USDC)</label>
			<input class="tahx-input" id="tahx-max" type="number" min="0" step="0.01" inputmode="decimal" value="${priceUsd.toFixed(priceUsd < 1 ? 3 : 2)}" />
			<span class="tahx-hint">Won't pay above this, on top of your agent's standing spend policy.</span>
		</div>
		<div class="tahx-note">Settlement only completes if ${escHtml(providerName)} delivers the work. If it fails, no funds move — you're never charged for nothing.</div>
		<div class="tahx-actions">
			<button class="tahx-btn tahx-btn-primary" id="tahx-go">Hire &amp; pay ${escHtml(fmtUsd(priceUsd))}</button>
			<button class="tahx-btn tahx-btn-ghost" type="button" data-close>Cancel</button>
		</div>
		<div class="tahx-feedback" role="status" aria-live="polite"></div>`;

	formArea.querySelector('[data-close]')?.addEventListener('click', close);
	const goBtn = formArea.querySelector('#tahx-go');
	const feedback = formArea.querySelector('.tahx-feedback');
	const hirerSel = formArea.querySelector('#tahx-hirer');
	const maxInput = formArea.querySelector('#tahx-max');

	// Stable idempotency key per modal session so an accidental double-click or a
	// retry after a transient error never double-charges.
	const idem = (crypto?.randomUUID && crypto.randomUUID()) || `hire-${Date.now()}-${Math.round(performance.now())}`;

	goBtn.addEventListener('click', async () => {
		const hirerAgentId = hirerSel.value;
		const maxUsd = Number(maxInput.value);
		goBtn.disabled = true;
		const original = goBtn.textContent;
		goBtn.innerHTML = `<span class="tahx-spin"></span>Reserving spend & paying…`;
		feedback.innerHTML = '';

		const res = await runHire({
			hirerAgentId,
			serviceSlug: offer.slug,
			input: offer?.input_default ?? null,
			maxUsd: Number.isFinite(maxUsd) ? maxUsd : undefined,
			idempotencyKey: idem,
		});

		if (!res.ok) {
			const ex = explainError(res);
			feedback.innerHTML = `<div class="tahx-alert tahx-alert-${ex.kind}">${ex.html}</div>`;
			goBtn.disabled = false;
			goBtn.textContent = original;
			return;
		}

		// Success — show the embodied hand-off, then the real receipt.
		const hirer = list.find((a) => a.id === hirerAgentId) || { name: 'Your agent', id: hirerAgentId };
		renderSuccess(formArea, modal, offer, hirer, res, { onComplete: opts.onComplete, close });
	});
}

function renderSuccess(formArea, modal, offer, hirer, res, { onComplete, close }) {
	const hire = res.hire || {};
	const provider = offer?.provider || { name: hire.provider_agent_id || 'Provider' };
	const amount = hire.usd != null ? Number(hire.usd) : Number(offer?.price_usdc || 0);

	formArea.innerHTML = `
		<div class="tahx-receipt">
			${renderHandoffStage(hirer, provider, amount)}
			<div class="tahx-feedback-stage"></div>
		</div>`;

	const stage = formArea.querySelector('.tahx-stage');
	const after = formArea.querySelector('.tahx-feedback-stage');

	playHandoff(stage).then(() => {
		const paySig = hire.payment_signature;
		const invSig = hire.invocation_signature;
		const resultText = hire.result_summary || (res.result != null ? (typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)) : null);

		after.innerHTML = `
			<div class="tahx-alert tahx-alert-ok" style="margin-top:12px">Paid ${escHtml(fmtUsd(amount))} to ${escHtml(provider.name)} — work delivered. Real money, real receipt.</div>
			<div class="tahx-receipt-rows" style="margin-top:10px">
				<div class="tahx-rr"><span class="tahx-rr-k">Status</span><span class="tahx-rr-v" style="color:#86efac">${escHtml(hire.status || 'completed')}</span></div>
				<div class="tahx-rr"><span class="tahx-rr-k">Amount</span><span class="tahx-rr-v">${escHtml(fmtUsd(amount))} ${escHtml(hire.currency || 'USDC')}</span></div>
				${explorerRow('Payment tx', paySig, hire.payment_explorer)}
				${explorerRow('Invocation receipt', invSig, hire.invocation_explorer)}
				${hire.invocation_error && !invSig ? `<div class="tahx-rr"><span class="tahx-rr-k">Receipt</span><span class="tahx-rr-v" style="color:#fcd34d">deferred (${escHtml(String(hire.invocation_error).slice(0, 60))})</span></div>` : ''}
			</div>
			${resultText ? `<div class="tahx-result" style="margin-top:10px">${escHtml(String(resultText).slice(0, 600))}</div>` : ''}
			<div style="margin-top:12px">
				<div class="tahx-label" style="margin-bottom:6px">Rate this work</div>
				<div class="tahx-rate" id="tahx-rate">
					${[1, 2, 3, 4, 5].map((n) => `<button class="tahx-star" type="button" data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
					<span class="tahx-rate-msg tahx-hint" style="margin-left:6px"></span>
				</div>
			</div>
			<div class="tahx-actions" style="margin-top:14px">
				<a class="tahx-btn tahx-btn-ghost" href="/galaxy" style="text-align:center;text-decoration:none;line-height:1.4;flex:1" title="Watch this payment flow between the two agents live">See it in the Money-Cam ↗</a>
				<button class="tahx-btn tahx-btn-primary" type="button" data-done>Done</button>
			</div>`;

		// Rating wiring.
		const rateWrap = after.querySelector('#tahx-rate');
		const rateMsg = after.querySelector('.tahx-rate-msg');
		let rated = false;
		const paint = (val) => rateWrap.querySelectorAll('.tahx-star').forEach((s) => s.classList.toggle('tahx-on', Number(s.dataset.n) <= val));
		rateWrap.querySelectorAll('.tahx-star').forEach((star) => {
			star.addEventListener('mouseenter', () => !rated && paint(Number(star.dataset.n)));
			star.addEventListener('mouseleave', () => !rated && paint(0));
			star.addEventListener('click', async () => {
				if (rated) return;
				const n = Number(star.dataset.n);
				rated = true;
				paint(n);
				rateMsg.textContent = 'Saving…';
				const r = await submitRating(hire.id, n);
				rateMsg.textContent = r.ok ? 'Thanks — recorded.' : r.message;
				if (!r.ok) rated = false;
			});
		});

		after.querySelector('[data-done]')?.addEventListener('click', close);
	});

	if (typeof onComplete === 'function') {
		// Let live views refresh their stats immediately, in parallel with the anim.
		try { onComplete(hire); } catch { /* a caller error must not break the receipt */ }
	}
}
