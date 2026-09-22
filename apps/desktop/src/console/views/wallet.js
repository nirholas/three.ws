// Wallet: an agent's Solana balance and holdings, what it is asking to do
// (pending autopilot proposals), and sending SOL out of it.
//
// Nothing here moves money in one step. Every send and every proposal goes:
//   1. Preview: the main process simulates it on-chain (or dry-runs the
//      proposal) and stores the exact request under a single-use preview id.
//   2. Review: this view shows recipient, amount, token, chain and the
//      simulation result, with a countdown to when the preview expires.
//   3. Approve: sends only the preview id. The main process then asks one last
//      time in a native OS dialog built from its own stored copy.
// Cancel discards the preview id; an expired one must be previewed again.

import { html, raw, mount, onAction, emptyState, errorState, skeletonLines } from '../lib/dom.js';
import { agentPicker, bindPicker } from '../lib/agents-store.js';
import { formatAmount, formatUsd, shortAddress, relativeTime } from '../../shared/normalize.js';

const addrExplorer = (addr, network) => `https://solscan.io/account/${encodeURIComponent(addr)}${network === 'devnet' ? '?cluster=devnet' : ''}`;

export function previewCard(p, now = Date.now()) {
	const s = p.summary || {};
	const left = Math.max(0, Math.round((p.expiresAt - now) / 1000));
	const expired = left <= 0;
	const rows = [
		['Action', s.action],
		s.recipient ? ['Recipient', s.recipient] : null,
		s.amount != null ? ['Amount', `${formatAmount(s.amount, 9)} ${s.token || ''}`.trim()] : null,
		s.token ? ['Token', s.token] : null,
		s.chain ? ['Chain', s.chain] : null,
		s.usd != null ? ['Value', `about ${formatUsd(s.usd)}`] : null,
		s.computeUnits != null ? ['Simulation', s.simulationError ? `Would fail: ${s.simulationError}` : `Succeeds (${formatAmount(s.computeUnits, 0)} compute units)`] : null,
	].filter(Boolean);
	const blocked = Boolean(s.simulationError || s.blocked);
	return html`<section class="card preview" aria-labelledby="preview-title" data-preview="${p.previewId}">
		<h3 id="preview-title"><span class="ico ico-alert" aria-hidden="true" style="color:var(--amber)"></span>${p.financial ? 'Review before anything moves' : 'Review this action'}</h3>
		<table class="table" style="margin-top:8px"><tbody>${rows.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td></tr>`)}</tbody></table>
		${s.checks?.length ? html`<ul class="checks">${s.checks.map((c) => html`<li><span class="${c.ok ? 'ok' : 'no'}">${c.ok ? 'Pass' : 'Fail'}</span>${c.label}${c.detail ? html` <span style="color:var(--dim)">(${c.detail})</span>` : ''}</li>`)}</ul>` : ''}
		${s.note ? html`<p style="color:var(--muted);font-size:12.5px;margin-top:8px">${s.note}</p>` : ''}
		<div class="preview-actions">
			<button type="button" class="btn ${p.financial ? 'btn-go' : 'btn-primary'}" data-action="approve" ${expired || blocked ? raw('disabled') : ''}>${p.financial ? 'Approve and send' : 'Approve'}</button>
			<button type="button" class="btn" data-action="cancel-preview">Cancel</button>
			${expired
				? html`<button type="button" class="btn btn-ghost" data-action="repreview">Preview again</button><span class="expires">Expired</span>`
				: html`<span class="expires" aria-live="off">Expires in ${left}s</span>`}
		</div>
		${blocked ? html`<p style="color:var(--red);font-size:12.5px;margin-top:10px">A check failed, so this cannot be approved. Fix it and preview again.</p>` : ''}
	</section>`;
}

export function mountWallet(root, ctx) {
	const { bridge, agents, toast } = ctx;
	let phase = 'loading';
	let error = null;
	let wallet = null;
	let preview = null;
	let lastInput = null;
	let busy = null;
	let result = null;
	let form = { destination: '', amount: '', network: 'mainnet' };
	let hint = null;
	let ticker = null;

	// A hand-off from chat: the agent proposed a send. Prefill, never execute.
	if (ctx.handoff?.type === 'send') {
		const h = ctx.handoff;
		ctx.handoff = null;
		if (h.agentId) agents.select(h.agentId);
		form.destination = h.destination || '';
		hint = h.usd != null ? `Your agent proposed sending ${formatUsd(h.usd)} of SOL${h.destination ? '' : ' (it named no address, so enter one)'}. Enter the SOL amount and preview it.` : null;
	}

	function balanceCard() {
		const w = wallet;
		if (!w.address) {
			return emptyState({ icon: 'wallet', title: 'This agent has no Solana wallet yet', message: 'Open the agent on three.ws to provision its wallet. It is created for the agent and held in custody for you.', actions: [{ action: 'open-agent', label: 'Open on three.ws', primary: true }] });
		}
		return html`<div class="card">
			<div class="balance">
				<div>
					<div class="label">Balance${w.network === 'devnet' ? ' (devnet)' : ''}</div>
					<div class="big">${w.sol != null ? formatAmount(w.sol, 6) : 'Unavailable'}<small>SOL</small></div>
					${w.balanceError ? html`<div style="color:var(--amber);font-size:12.5px">${w.balanceError}</div>` : ''}
				</div>
				<div style="text-align:right">
					<div class="addr selectable" title="${w.address}">${shortAddress(w.address, 6, 6)}
						<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="copy" aria-label="Copy wallet address"><span class="ico ico-copy" aria-hidden="true"></span></button>
						<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="explorer" aria-label="View on explorer"><span class="ico ico-out" aria-hidden="true"></span></button>
					</div>
					${!w.signable ? html`<span class="chip chip-warn">${w.signableReason || 'Cannot sign right now'}</span>` : html`<span class="chip chip-ok">Ready to sign</span>`}
				</div>
			</div>
			${w.tokens.length ? html`<h2>Tokens <small>${w.tokens.length}</small></h2>
				<table class="table"><thead><tr><th>Token</th><th style="text-align:right">Amount</th></tr></thead><tbody>
				${w.tokens.map((t) => html`<tr><td class="mono" title="${t.mint}">${shortAddress(t.mint, 6, 6)}${t.stable ? html` <span class="chip chip-plain">Stablecoin</span>` : ''}</td><td class="num">${formatAmount(t.amount, 6)}</td></tr>`)}
				</tbody></table>` : ''}
			${w.holdingsError ? html`<p style="color:var(--muted);font-size:12.5px;margin-top:8px">Token holdings could not load: ${w.holdingsError}</p>` : ''}
		</div>`;
	}

	function approvals() {
		if (wallet.proposalsError) return html`<p style="color:var(--muted);font-size:13px">Pending approvals could not load: ${wallet.proposalsError}</p>`;
		if (!wallet.proposals.length) return html`<div class="card" style="color:var(--muted);font-size:13px">Nothing is waiting on you. When this agent's autopilot proposes an action, it appears here to approve or dismiss.</div>`;
		return html`<div class="list">${wallet.proposals.map((p) => html`<div class="list-item" style="cursor:default">
			<div class="top"><span class="chip ${p.financial ? 'chip-warn' : 'chip-info'}">${p.financial ? 'Moves funds' : p.kind.replace(/_/g, ' ')}</span><span class="sub">${relativeTime(p.createdAt)}</span></div>
			<div class="goal">${p.title}</div>
			${p.rationale ? html`<div class="sub selectable">${p.rationale}</div>` : ''}
			<div style="display:flex;gap:6px;margin-top:6px">
				<button type="button" class="btn btn-sm btn-primary" data-action="review-proposal" data-id="${p.id}" ${busy ? raw('disabled') : ''}>Review</button>
				<button type="button" class="btn btn-sm btn-ghost" data-action="dismiss" data-id="${p.id}" ${busy ? raw('disabled') : ''}>Dismiss</button>
			</div>
		</div>`)}</div>`;
	}

	function sendForm() {
		if (!wallet.address) return '';
		return html`<form class="card" id="send-form" novalidate>
			${hint ? html`<div class="banner warn">${hint}</div>` : ''}
			<div class="row">
				<div class="field" style="flex:2;min-width:240px"><label for="dest">Recipient address</label><input class="input mono" id="dest" value="${form.destination}" placeholder="Solana address" spellcheck="false" autocomplete="off" required /></div>
				<div class="field"><label for="amount">Amount (SOL)</label><input class="input" id="amount" inputmode="decimal" value="${form.amount}" placeholder="0.10" /></div>
				<div class="field" style="flex:0 0 130px;min-width:130px"><label for="network">Network</label>
					<select class="select" id="network"><option value="mainnet" ${form.network === 'mainnet' ? 'selected' : ''}>Mainnet</option><option value="devnet" ${form.network === 'devnet' ? 'selected' : ''}>Devnet</option></select></div>
			</div>
			<div class="row" style="margin-top:12px">
				<button type="submit" class="btn btn-primary" ${busy ? raw('disabled') : ''}>${busy === 'send' ? raw('<span class="spin" aria-hidden="true"></span>Simulating') : 'Preview send'}</button>
				<button type="button" class="btn btn-ghost" data-action="max" ${busy ? raw('disabled') : ''}>Send maximum</button>
			</div>
		</form>`;
	}

	function resultCard() {
		if (!result) return '';
		return html`<section class="card result" role="status">
			<h3 style="font-size:15px">${result.status === 'executed' ? 'Done' : 'Cancelled, nothing was sent'}</h3>
			${result.signature ? html`<p class="mono selectable" style="margin-top:6px;font-size:12px;overflow-wrap:anywhere">${result.signature}</p>` : ''}
			<div class="preview-actions">
				${result.explorer ? html`<button type="button" class="btn btn-sm" data-action="open-tx">View transaction</button>` : ''}
				<button type="button" class="btn btn-sm btn-ghost" data-action="clear-result">Dismiss</button>
			</div>
		</section>`;
	}

	function body() {
		if (phase === 'loading') return html`<div class="card">${skeletonLines(3)}</div><div class="sk sk-block" style="margin-top:12px"></div>`;
		if (phase === 'no-agents') return emptyState({ icon: 'wallet', title: 'No agents yet', message: 'Each agent you create on three.ws gets its own Solana wallet, shown here.', actions: [{ action: 'create', label: 'Create an agent', primary: true }] });
		if (phase === 'error') return errorState(error, { title: 'The wallet could not load' });
		return html`${balanceCard()}
			${preview ? html`<div style="margin-top:12px">${previewCard(preview)}</div>` : ''}
			${resultCard()}
			<h2>Waiting for your approval ${wallet.proposals.length ? html`<small>${wallet.proposals.length}</small>` : ''}</h2>
			${approvals()}
			${wallet.address ? html`<h2>Send SOL</h2>${sendForm()}` : ''}`;
	}

	function render() {
		const list = agents.list();
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Wallet</h1><p>Balances, approvals and sends. Nothing moves without your confirmation.</p></div>
				<div class="head-actions">
					${list.length ? agentPicker(list, agents.selectedId(), 'Agent') : ''}
					<button type="button" class="btn btn-ghost btn-icon" data-action="retry" aria-label="Refresh wallet"><span class="ico ico-refresh" aria-hidden="true"></span></button>
				</div>
			</header>
			${body()}
		</div>`);
		const f = root.querySelector('#send-form');
		if (f) {
			f.addEventListener('input', () => {
				form = { destination: f.querySelector('#dest').value.trim(), amount: f.querySelector('#amount').value.trim(), network: f.querySelector('#network').value };
			});
			f.addEventListener('submit', (e) => {
				e.preventDefault();
				startPreview('withdraw', { agentId: agents.selectedId(), ...form });
			});
		}
	}

	// Only the countdown changes each second; repaint just that text.
	function tick() {
		const el = root.querySelector('.preview .expires');
		if (!preview || !el) return;
		const left = Math.round((preview.expiresAt - Date.now()) / 1000);
		if (left <= 0) render();
		else el.textContent = `Expires in ${left}s`;
	}

	async function startPreview(kind, input) {
		if (preview) await bridge.previews.cancel(preview.previewId).catch(() => {});
		busy = kind === 'withdraw' ? 'send' : 'proposal';
		preview = null;
		result = null;
		lastInput = { kind, input };
		render();
		try {
			preview = await bridge.previews.create(kind, input);
			hint = null;
		} catch (err) {
			toast(err.message, 'bad');
		}
		busy = null;
		render();
		root.querySelector('.preview [data-action="approve"]')?.focus();
	}

	async function load() {
		phase = 'loading';
		render();
		try {
			await agents.load();
			if (!agents.selectedId()) {
				phase = 'no-agents';
				render();
				return;
			}
			wallet = await bridge.wallet.get(agents.selectedId());
			phase = 'ready';
		} catch (err) {
			phase = 'error';
			error = err;
		}
		render();
	}

	const offPicker = bindPicker(root, agents, () => {
		if (preview) bridge.previews.cancel(preview.previewId).catch(() => {});
		preview = null;
		result = null;
		load();
	});

	const offActions = onAction(root, {
		retry: load,
		create: () => bridge.app.openExternal('/create'),
		'open-agent': () => bridge.app.openExternal(`/agents/${encodeURIComponent(agents.selectedId())}`),
		copy: async () => {
			try {
				await navigator.clipboard.writeText(wallet.address);
				toast('Address copied.', 'ok');
			} catch {
				toast('Copy failed. Select the address and copy it by hand.', 'bad');
			}
		},
		explorer: () => bridge.app.openExternal(addrExplorer(wallet.address, wallet.network)),
		max: () => startPreview('withdraw', { agentId: agents.selectedId(), ...form, amount: 'max' }),
		'review-proposal': (el) => startPreview('proposal', { agentId: agents.selectedId(), proposalId: el.dataset.id }),
		dismiss: async (el) => {
			busy = 'dismiss';
			render();
			try {
				await bridge.wallet.dismissProposal(agents.selectedId(), el.dataset.id);
				wallet.proposals = wallet.proposals.filter((p) => p.id !== el.dataset.id);
				toast('Dismissed. Your agent learns from this.', 'ok');
			} catch (err) {
				toast(err.message, 'bad');
			}
			busy = null;
			render();
		},
		repreview: () => lastInput && startPreview(lastInput.kind, lastInput.input),
		'cancel-preview': async () => {
			const id = preview?.previewId;
			preview = null;
			render();
			if (id) await bridge.previews.cancel(id).catch(() => {});
			toast('Cancelled. Nothing was sent.');
		},
		approve: async (el) => {
			if (!preview) return;
			el.disabled = true;
			el.innerHTML = '<span class="spin" aria-hidden="true"></span>Waiting for confirmation';
			try {
				result = await bridge.previews.approve(preview.previewId);
				preview = null;
				if (result.status === 'executed') {
					toast('Sent.', 'ok');
					wallet = await bridge.wallet.get(agents.selectedId()).catch(() => wallet);
				}
			} catch (err) {
				preview = null;
				toast(err.message, 'bad');
			}
			render();
		},
		'open-tx': () => result?.explorer && bridge.app.openExternal(result.explorer),
		'clear-result': () => {
			result = null;
			render();
		},
	});

	ticker = setInterval(tick, 1000);
	load();
	return () => {
		clearInterval(ticker);
		if (preview) bridge.previews.cancel(preview.previewId).catch(() => {});
		offPicker();
		offActions();
	};
}
