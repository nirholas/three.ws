/**
 * Agent launch card: the primary next step on an owner's agent page.
 *
 * Most new agents never launch a coin (see docs/experiments-agent-launch-funnel.md),
 * so the coin is the default path instead of a button in a menu. The platform
 * has already drafted the coin from the agent's own name and persona; this card
 * shows that draft, whether the launch wallet can pay for it, and one button
 * that opens the launch confirmation screen. Nothing is signed or spent here:
 * the confirmation screen shows recipient, amount and chain and waits for the
 * owner's explicit yes.
 *
 * Reports funnel steps through POST /api/agents/tokens/funnel and the
 * allowlisted analytics events: plan_viewed, wallet_funded, launch_confirm_opened.
 */

import { track, ANALYTICS_EVENTS } from './analytics.js';
import { openCoinLaunch } from './shared/agent-coin.js';

const API = '/api/agents/tokens';
const STYLE_ID = 'tws-agent-launch-card-styles';

const STYLES = `
.alc { border: 1px solid var(--ad-line, rgba(255,255,255,.1)); border-radius: 14px; padding: 16px 18px; margin: 0 0 16px; background: linear-gradient(135deg, rgba(120,90,255,.10), rgba(60,200,160,.06)); }
.alc-eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ad-muted, rgba(231,233,238,.6)); margin: 0 0 6px; }
.alc-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; color: var(--ad-text, #e7e9ee); }
.alc-sub { font-size: 13px; line-height: 1.5; margin: 0 0 12px; color: var(--ad-muted, rgba(231,233,238,.65)); overflow-wrap: anywhere; }
.alc-steps { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
.alc-steps li { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--ad-text, #e7e9ee); }
.alc-dot { flex: none; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.3); }
.alc-steps li.done .alc-dot { background: #57c785; border-color: #57c785; }
.alc-steps li.todo .alc-dot { border-color: #e6b450; }
.alc-addr { font-family: ui-monospace, monospace; font-size: 12px; overflow-wrap: anywhere; }
.alc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.alc-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: var(--ad-text, #e7e9ee); cursor: pointer; text-decoration: none; transition: background .15s, transform .1s, border-color .15s; }
.alc-btn:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.3); }
.alc-btn:active { transform: translateY(1px); }
.alc-btn:focus-visible { outline: 2px solid #8f7bff; outline-offset: 2px; }
.alc-btn[disabled] { opacity: .55; cursor: progress; }
.alc-btn.primary { background: #6d5aff; border-color: #6d5aff; color: #fff; }
.alc-btn.primary:hover { background: #8171ff; border-color: #8171ff; }
.alc-skel { height: 14px; border-radius: 7px; margin: 0 0 10px; background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.1), rgba(255,255,255,.04)); background-size: 200% 100%; animation: alc-shimmer 1.2s linear infinite; }
@keyframes alc-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
@media (prefers-reduced-motion: reduce) { .alc-skel { animation: none } .alc-btn { transition: none } }
.alc-err { font-size: 13px; color: #ff8f8f; margin: 0 0 10px; }
`;

function esc(s) {
	return String(s == null ? '' : s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function fmtSol(n) {
	const v = Number(n) || 0;
	return `${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0'} SOL`;
}

async function postJson(path, body, signal) {
	const r = await fetch(`${API}/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'include',
		signal,
		body: JSON.stringify(body),
	});
	const j = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(j.error_description || j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Mount the card for the owner of an agent with no launched coin.
 * @param {HTMLElement} host element the card is appended to
 * @param {{ agent: object, onEditPlan?: () => void }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountAgentLaunchCard(host, { agent, onEditPlan } = {}) {
	if (!host || !agent?.id) return { destroy() {} };
	const doc = host.ownerDocument || document;
	if (!doc.getElementById(STYLE_ID)) {
		const st = doc.createElement('style');
		st.id = STYLE_ID;
		st.textContent = STYLES;
		doc.head.appendChild(st);
	}

	const root = doc.createElement('section');
	root.className = 'alc';
	root.setAttribute('aria-label', 'Launch your agent coin');
	root.setAttribute('aria-busy', 'true');
	root.innerHTML = `<p class="alc-eyebrow">Next step</p>
		<div class="alc-skel" style="width:55%" aria-hidden="true"></div>
		<div class="alc-skel" style="width:90%" aria-hidden="true"></div>
		<div class="alc-skel" style="width:70%" aria-hidden="true"></div>`;
	host.appendChild(root);

	const controller = new AbortController();
	let destroyed = false;

	function renderError(message) {
		if (destroyed) return;
		root.setAttribute('aria-busy', 'false');
		root.innerHTML = `<p class="alc-eyebrow">Next step</p>
			<p class="alc-title">We could not load your coin plan</p>
			<p class="alc-err" role="alert">${esc(message)}</p>
			<div class="alc-actions"><button type="button" class="alc-btn primary" data-act="retry">Try again</button></div>`;
	}

	function renderEmpty() {
		root.setAttribute('aria-busy', 'false');
		root.innerHTML = `<p class="alc-eyebrow">Next step</p>
			<p class="alc-title">Give your agent a coin</p>
			<p class="alc-sub">Design the name, ticker and story below, then launch it from your agent's wallet. You confirm every amount before anything is spent.</p>
			<div class="alc-actions"><button type="button" class="alc-btn primary" data-act="edit">Design the coin</button></div>`;
	}

	function renderPlan(plan, wallet, funding) {
		if (destroyed) return;
		root.setAttribute('aria-busy', 'false');
		const fixed = plan.cost_estimate?.fixed_total_sol ?? 0;
		const funded = funding && funding.sol != null && funding.sol >= (funding.required_sol ?? fixed);
		const blockers = plan.readiness?.blockers || [];
		const walletLine = !wallet
			? 'This agent has no Solana wallet yet. Open the launch screen to set one up.'
			: funded
				? `Launch wallet holds ${esc(fmtSol(funding.sol))}, enough to cover the ${esc(fmtSol(fixed))} of launch rent and fees.`
				: `Send at least ${esc(fmtSol(fixed))} of SOL to <span class="alc-addr">${esc(wallet)}</span> to cover launch rent and fees${
						funding && funding.sol != null ? ` (it holds ${esc(fmtSol(funding.sol))})` : ''
					}.`;
		root.innerHTML = `<p class="alc-eyebrow">Next step</p>
			<p class="alc-title">Launch $${esc(plan.symbol)}: ${esc(plan.name)}</p>
			<p class="alc-sub">${esc(plan.description) || 'Drafted from your agent. Add a description in the plan below.'}</p>
			<ul class="alc-steps">
				<li class="done"><span class="alc-dot"></span><span>Coin drafted from your agent</span></li>
				<li class="${blockers.length ? 'todo' : 'done'}"><span class="alc-dot"></span><span>${
					blockers.length ? esc(blockers[0]) : 'Name and ticker are ready'
				}</span></li>
				<li class="${funded ? 'done' : 'todo'}"><span class="alc-dot"></span><span>${walletLine}</span></li>
			</ul>
			<div class="alc-actions">
				<button type="button" class="alc-btn primary" data-act="launch"${blockers.length ? ' disabled' : ''}>Review and launch</button>
				<button type="button" class="alc-btn" data-act="edit">Edit the plan</button>
			</div>`;
	}

	async function load() {
		root.setAttribute('aria-busy', 'true');
		try {
			const r = await fetch(`${API}/plan?agent_id=${encodeURIComponent(agent.id)}&network=mainnet`, {
				credentials: 'include',
				signal: controller.signal,
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || j.error || `Request failed (${r.status})`);
			if (destroyed) return;
			if (!j.plan || j.plan.status === 'launched') {
				renderEmpty();
				return;
			}
			renderPlan(j.plan, j.launch_wallet, null);
			track(ANALYTICS_EVENTS.PLAN_VIEWED, { agent_id: agent.id, auto_drafted: !!j.plan.auto_drafted });
			postJson('funnel', { agent_id: agent.id, step: 'plan_viewed', network: 'mainnet' }, controller.signal).catch(() => {});
			if (j.launch_wallet) {
				postJson('funnel', { agent_id: agent.id, step: 'wallet_funded', network: 'mainnet' }, controller.signal)
					.then((res) => {
						if (destroyed) return;
						renderPlan(j.plan, j.launch_wallet, { sol: res.sol, required_sol: res.required_sol });
						if (res.recorded) track(ANALYTICS_EVENTS.WALLET_FUNDED, { agent_id: agent.id });
					})
					.catch(() => {});
			}
		} catch (err) {
			if (err?.name === 'AbortError') return;
			renderError(err.message || 'Check your connection and try again.');
		}
	}

	async function launch(btn) {
		btn.disabled = true;
		try {
			track(ANALYTICS_EVENTS.LAUNCH_CONFIRM_OPENED, { agent_id: agent.id, source: 'launch_card' });
			postJson('funnel', { agent_id: agent.id, step: 'launch_confirm_opened', network: 'mainnet' }).catch(() => {});
			await openCoinLaunch(agent);
		} finally {
			btn.disabled = false;
		}
	}

	root.addEventListener('click', (e) => {
		const btn = e.target.closest?.('[data-act]');
		if (!btn) return;
		const act = btn.getAttribute('data-act');
		if (act === 'retry') {
			root.innerHTML = `<p class="alc-eyebrow">Next step</p><div class="alc-skel" style="width:55%" aria-hidden="true"></div><div class="alc-skel" style="width:90%" aria-hidden="true"></div>`;
			load();
		} else if (act === 'edit') onEditPlan?.();
		else if (act === 'launch') launch(btn);
	});

	load();
	return {
		destroy() {
			destroyed = true;
			controller.abort();
			root.remove();
		},
	};
}
