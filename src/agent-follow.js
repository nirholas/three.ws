/**
 * Follow this agent: one tap on an agent page, with a spend cap set at the tap.
 *
 * Wraps the existing copy-trading engine (POST /api/copy/subscriptions) in the
 * shortest honest path: a Follow button in the hero, a compact dialog that asks
 * for the three numbers that bound the relationship (a lifetime spend cap, a
 * per-trade max, and a drawdown stop), and a live "Following" state that shows
 * how much of the cap is used. Non-custodial like the rest of copy trading:
 * the follower supplies their own Solana wallet, the platform records sized
 * intents, and the follower signs every trade from that wallet.
 *
 * Narration: while the viewer follows this agent and the page is visible, new
 * copy intents for this leader are read from GET /api/copy/executions and
 * announced through src/copy-narrator.js, which makes the hero avatar speak and
 * gesture (or falls back to a toast when no avatar is mounted).
 *
 * Solana agents only in this cut: the caller mounts it only when the agent has a
 * Solana wallet, and the copy engine is Solana-native.
 */

import { apiFetch } from './api.js';
import { startCopyNarration } from './copy-narrator.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Mirrors COPY_MAX_SPEND_CAP_SOL in api/_lib/copy-engine.js; the server is the
// authority and rejects anything above it with a readable message.
const MAX_CAP_SOL = 25;
const DEFAULTS = { cap: 0.5, perTrade: 0.05, drawdown: 25 };

const api = (path, opts = {}) =>
	apiFetch(path, {
		allowAnonymous: true,
		headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
		...opts,
	});

const fmtSol = (v) => {
	const n = Number(v) || 0;
	return n >= 1 ? n.toFixed(2) : n.toFixed(n === 0 ? 0 : 3).replace(/0+$/, '').replace(/\.$/, '');
};

function h(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'text') node.textContent = v;
		else if (k === 'class') node.className = v;
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of [].concat(children)) if (c != null) node.append(c);
	return node;
}

/**
 * Mount the Follow control.
 *
 * @param {object} p
 * @param {HTMLElement} p.host   where the button goes (the hero action row).
 * @param {{id:string,name?:string,isOwner?:boolean}} p.agent
 * @param {() => object|null} [p.getAvatar]  the hero avatar handle (playGesture), when mounted.
 * @returns {{ destroy(): void }}
 */
export function mountFollowButton({ host, agent, getAvatar = () => null }) {
	const leaderName = agent.name || 'this agent';
	const state = { signedIn: null, subs: [], current: null, error: null };
	let narration = null;
	let destroyed = false;

	const btn = h('button', {
		type: 'button',
		class: 'af-btn is-loading',
		'aria-haspopup': 'dialog',
		'aria-busy': 'true',
		disabled: true,
	}, [h('span', { class: 'af-btn-sk', 'aria-hidden': 'true' }), h('span', { class: 'af-btn-label', text: 'Follow' })]);
	host.append(btn);

	const dialog = h('dialog', { class: 'af-dialog', 'aria-labelledby': `af-title-${agent.id}` });
	document.body.append(dialog);
	dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

	btn.addEventListener('click', () => {
		renderDialog();
		dialog.showModal();
		dialog.querySelector('[autofocus]')?.focus();
	});

	function setButton() {
		btn.classList.remove('is-loading', 'is-following', 'is-paused');
		btn.removeAttribute('aria-busy');
		btn.disabled = false;
		const label = btn.querySelector('.af-btn-label');
		const cur = state.current;
		if (cur && cur.status === 'active') {
			btn.classList.add('is-following');
			label.textContent = cur.spend_cap_sol != null
				? `Following · ${fmtSol(cur.cap_spent_sol)} / ${fmtSol(cur.spend_cap_sol)} SOL`
				: 'Following';
			btn.setAttribute('aria-label', `Following ${leaderName}. Open follow settings`);
		} else if (cur && cur.status === 'paused') {
			btn.classList.add('is-paused');
			label.textContent = 'Follow paused';
			btn.setAttribute('aria-label', `Your follow of ${leaderName} is paused. Open follow settings`);
		} else {
			label.textContent = 'Follow';
			btn.setAttribute('aria-label', `Follow ${leaderName}: copy its trades with a spend cap`);
		}
	}

	function syncNarration() {
		const following = state.current?.status === 'active';
		if (following && !narration) {
			narration = startCopyNarration({ leaderAgentId: agent.id, leaderName, getAvatar, onSpend: refresh });
		} else if (!following && narration) {
			narration.stop();
			narration = null;
		}
	}

	async function load() {
		try {
			const res = await api('/api/copy/subscriptions');
			if (res.status === 401) {
				state.signedIn = false;
				state.subs = [];
			} else if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			} else {
				const body = await res.json();
				state.signedIn = true;
				state.subs = body.subscriptions || [];
			}
			state.error = null;
		} catch (err) {
			state.error = 'We could not load your follows. Check your connection and try again.';
			state.signedIn = state.signedIn ?? null;
		}
		if (destroyed) return;
		state.current = state.subs.find((s) => s.leader_agent_id === agent.id && s.status !== 'stopped') || null;
		setButton();
		syncNarration();
		if (dialog.open) renderDialog();
	}

	async function refresh() { await load(); }

	// ── Dialog ────────────────────────────────────────────────────────────────

	function head(title, sub) {
		return h('header', { class: 'af-head' }, [
			h('div', {}, [
				h('h2', { id: `af-title-${agent.id}`, class: 'af-title', text: title }),
				sub ? h('p', { class: 'af-sub', text: sub }) : null,
			]),
			h('button', { type: 'button', class: 'af-x', 'aria-label': 'Close', onclick: () => dialog.close() }, '×'),
		]);
	}

	function renderDialog() {
		dialog.replaceChildren();
		if (state.error && state.signedIn == null) return renderError();
		if (state.signedIn === false) return renderSignedOut();
		if (agent.isOwner) return renderOwner();
		if (state.current) return renderFollowing();
		return renderForm();
	}

	function renderError() {
		dialog.append(
			head(`Follow ${leaderName}`),
			h('div', { class: 'af-body' }, [
				h('p', { class: 'af-err', role: 'alert', text: state.error }),
				h('div', { class: 'af-actions' }, [
					h('button', { type: 'button', class: 'af-primary', autofocus: true, onclick: async (e) => {
						e.currentTarget.disabled = true;
						e.currentTarget.textContent = 'Retrying…';
						await load();
					} }, 'Try again'),
				]),
			]),
		);
	}

	function renderSignedOut() {
		const next = encodeURIComponent(location.pathname + location.search);
		dialog.append(
			head(`Follow ${leaderName}`, 'Mirror its trades into your own wallet, inside a spend cap you set now.'),
			h('div', { class: 'af-body' }, [
				h('ul', { class: 'af-points' }, [
					h('li', { text: 'You set a total SOL cap. Nothing past it is ever copied.' }),
					h('li', { text: `${leaderName} explains each trade out loud as it fires.` }),
					h('li', { text: 'You sign every trade yourself. We never hold your keys.' }),
				]),
				h('div', { class: 'af-actions' }, [
					h('a', { class: 'af-primary', href: `/login?next=${next}`, autofocus: true }, 'Sign in to follow'),
				]),
			]),
		);
	}

	function renderOwner() {
		dialog.append(
			head(`You own ${leaderName}`),
			h('div', { class: 'af-body' }, [
				h('p', { class: 'af-note', text: 'Following your own agent would pay its performance fee back to you and inflate its copier count, so it is not allowed. Share this page instead so others can follow it.' }),
				followList(),
				h('div', { class: 'af-actions' }, [
					h('button', { type: 'button', class: 'af-secondary', autofocus: true, onclick: () => dialog.close() }, 'Close'),
				]),
			]),
		);
	}

	// Every agent the viewer follows, so the dialog doubles as the follow list.
	function followList() {
		const live = state.subs.filter((s) => s.status !== 'stopped');
		const wrap = h('section', { class: 'af-list', 'aria-label': 'Agents you follow' }, [
			h('h3', { class: 'af-list-h', text: 'Your follows' }),
		]);
		if (!live.length) {
			wrap.append(h('p', { class: 'af-empty' }, [
				'You are not following anyone yet. Follow a trading agent and it will narrate every trade it makes for you. ',
				h('a', { href: '/leaderboard' }, 'Browse top traders'),
			]));
			return wrap;
		}
		const ul = h('ul', { class: 'af-list-ul' });
		for (const s of live) {
			ul.append(h('li', {}, [
				h('a', { href: `/agent/${encodeURIComponent(s.leader_agent_id)}` }, s.leader_name || 'Agent'),
				h('span', { class: `af-chip ${s.status === 'paused' ? 'is-paused' : ''}`, text: s.status === 'paused' ? 'Paused' : (s.spend_cap_sol != null ? `${fmtSol(s.cap_spent_sol)} / ${fmtSol(s.spend_cap_sol)} SOL` : 'Uncapped') }),
				s.network === 'devnet' ? h('span', { class: 'af-chip', text: 'Devnet' }) : null,
			]));
		}
		wrap.append(ul);
		return wrap;
	}

	function renderFollowing() {
		const cur = state.current;
		const cap = cur.spend_cap_sol != null ? Number(cur.spend_cap_sol) : null;
		const used = Number(cur.cap_spent_sol) || 0;
		const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
		const errEl = h('p', { class: 'af-err', role: 'alert', hidden: true });
		const paused = cur.status === 'paused';

		const act = async (e, op) => {
			const b = e.currentTarget;
			b.disabled = true;
			errEl.hidden = true;
			try {
				const res = op === 'unfollow'
					? await api(`/api/copy/subscriptions?id=${encodeURIComponent(cur.id)}`, { method: 'DELETE' })
					: await api('/api/copy/subscriptions', { method: 'POST', body: JSON.stringify({ id: cur.id, status: op === 'pause' ? 'paused' : 'active' }) });
				const body = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(body.error_description || `Request failed (${res.status})`);
				await load();
				if (op === 'unfollow') btn.focus();
			} catch (err) {
				errEl.textContent = `${err.message} Your follow is unchanged.`;
				errEl.hidden = false;
				b.disabled = false;
			}
		};

		dialog.append(
			head(paused ? `Follow of ${leaderName} is paused` : `Following ${leaderName}`,
				cur.network === 'devnet' ? 'Devnet (paper): no mainnet funds are involved.' : 'Mainnet. You sign each copy from your wallet.'),
			h('div', { class: 'af-body' }, [
				cap != null ? h('div', { class: 'af-meter' }, [
					h('div', { class: 'af-meter-row' }, [
						h('span', { text: 'Spend cap used' }),
						h('b', { text: `${fmtSol(used)} of ${fmtSol(cap)} SOL` }),
					]),
					h('div', { class: 'af-meter-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(cap), 'aria-valuenow': String(used), 'aria-label': 'Spend cap used' }, [
						h('span', { style: `width:${pct}%` }),
					]),
				]) : h('p', { class: 'af-note', text: 'This follow was set up without a cap. Unfollow and follow again here to add one.' }),
				h('dl', { class: 'af-facts' }, [
					h('dt', { text: 'Per trade' }), h('dd', { text: `${fmtSol(cur.per_trade_cap_sol)} SOL max` }),
					h('dt', { text: 'Stop' }), h('dd', { text: cur.max_drawdown_pct != null ? `Pause if it falls ${Number(cur.max_drawdown_pct)}% from peak` : 'No drawdown stop' }),
					h('dt', { text: 'Copies' }), h('dd', { text: `${Number(cur.acted_count) || 0} acted, ${Number(cur.pending_count) || 0} waiting` }),
				]),
				paused && cur.paused_reason ? h('p', { class: 'af-note', text: 'Paused automatically: the agent fell past your drawdown stop. Raise or clear the stop on the trader page to resume.' }) : null,
				errEl,
				h('div', { class: 'af-actions' }, [
					h('a', { class: 'af-secondary', href: '/dashboard/copy' }, 'Open copy inbox'),
					h('button', { type: 'button', class: 'af-secondary', onclick: (e) => act(e, paused ? 'resume' : 'pause') }, paused ? 'Resume' : 'Pause'),
					h('button', { type: 'button', class: 'af-danger', autofocus: true, onclick: (e) => act(e, 'unfollow') }, 'Unfollow'),
				]),
				followList(),
			]),
		);
	}

	function renderForm() {
		const prior = state.subs.find((s) => s.copier_wallet);
		const errEl = h('div', { class: 'af-err', role: 'alert', hidden: true });
		const field = (id, label, input, hint) => h('label', { class: 'af-field', for: id }, [
			h('span', { class: 'af-label', text: label }),
			input,
			hint ? h('span', { class: 'af-hint', text: hint }) : null,
		]);
		const num = (id, value, { min, max, step }) => h('input', {
			id, class: 'af-input', type: 'number', inputmode: 'decimal', value, min, max, step, required: true,
		});
		const capId = `af-cap-${agent.id}`;
		const tradeId = `af-trade-${agent.id}`;
		const ddId = `af-dd-${agent.id}`;
		const walletId = `af-wallet-${agent.id}`;
		const netId = `af-net-${agent.id}`;

		const capIn = num(capId, String(DEFAULTS.cap), { min: '0.001', max: String(MAX_CAP_SOL), step: 'any' });
		capIn.setAttribute('autofocus', '');
		const tradeIn = num(tradeId, String(DEFAULTS.perTrade), { min: '0.001', step: 'any' });
		const ddIn = num(ddId, String(DEFAULTS.drawdown), { min: '1', max: '100', step: '1' });
		ddIn.required = false;
		const walletIn = h('input', {
			id: walletId, class: 'af-input af-mono', type: 'text', autocomplete: 'off', spellcheck: 'false',
			placeholder: 'Your Solana wallet address', value: prior?.copier_wallet || '', required: true,
		});
		const netSel = h('select', { id: netId, class: 'af-input' }, [
			h('option', { value: 'mainnet' }, 'Mainnet'),
			h('option', { value: 'devnet' }, 'Devnet (paper, no real funds)'),
		]);

		const provider = window.phantom?.solana || window.solana;
		const connectBtn = provider?.connect ? h('button', { type: 'button', class: 'af-link', onclick: async () => {
			try {
				const r = await provider.connect();
				const key = (r?.publicKey || provider.publicKey)?.toString?.();
				if (key) walletIn.value = key;
			} catch {
				errEl.textContent = 'Your wallet did not share its address. Paste it instead.';
				errEl.hidden = false;
			}
		} }, 'Use connected wallet') : null;

		const submit = h('button', { type: 'submit', class: 'af-primary' }, 'Follow');
		const form = h('form', { class: 'af-body', novalidate: true }, [
			field(capId, 'Spend cap (SOL, total)', capIn, `The most this follow can ever put to work. Up to ${MAX_CAP_SOL} SOL.`),
			h('div', { class: 'af-row' }, [
				field(tradeId, 'Max per trade (SOL)', tradeIn),
				field(ddId, 'Stop at drawdown (%)', ddIn),
			]),
			field(walletId, 'Your Solana wallet', walletIn, 'Copies are sized for this wallet. You sign each one; we never hold keys.'),
			connectBtn,
			field(netId, 'Network', netSel),
			errEl,
			h('div', { class: 'af-actions' }, [
				h('button', { type: 'button', class: 'af-secondary', onclick: () => dialog.close() }, 'Cancel'),
				submit,
			]),
			followList(),
		]);

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			errEl.hidden = true;
			errEl.replaceChildren();
			const cap = Number(capIn.value);
			const perTrade = Number(tradeIn.value);
			const dd = ddIn.value === '' ? null : Number(ddIn.value);
			const wallet = walletIn.value.trim();
			const fail = (msg, focusEl) => {
				errEl.textContent = msg;
				errEl.hidden = false;
				focusEl?.focus();
			};
			if (!(cap > 0) || cap > MAX_CAP_SOL) return fail(`Set a spend cap above 0 and at most ${MAX_CAP_SOL} SOL.`, capIn);
			if (!(perTrade > 0)) return fail('Set a per-trade max above 0.', tradeIn);
			if (perTrade > cap) return fail('The per-trade max cannot be larger than the spend cap.', tradeIn);
			if (dd != null && !(dd > 0 && dd <= 100)) return fail('The drawdown stop must be between 1 and 100%.', ddIn);
			if (!BASE58_RE.test(wallet)) return fail('Enter a valid Solana wallet address.', walletIn);

			submit.disabled = true;
			submit.textContent = 'Following…';
			try {
				const res = await api('/api/copy/subscriptions', {
					method: 'POST',
					body: JSON.stringify({
						follow: true,
						leader_agent_id: agent.id,
						copier_wallet: wallet,
						network: netSel.value,
						sizing_rule: 'fixed',
						fixed_sol: perTrade,
						per_trade_cap_sol: perTrade,
						daily_budget_sol: cap,
						spend_cap_sol: cap,
						max_drawdown_pct: dd,
						copy_sells: true,
					}),
				});
				const body = await res.json().catch(() => ({}));
				if (res.status === 401) { state.signedIn = false; return renderDialog(); }
				if (!res.ok) {
					if (body.error === 'leader_not_copyable' && body.eligibility?.unmet?.length) {
						errEl.append(
							h('p', { text: `${leaderName} cannot be followed yet. It still needs:` }),
							h('ul', {}, body.eligibility.unmet.map((u) => h('li', { text: u.label }))),
							h('p', { text: netSel.value === 'mainnet' ? 'Try Devnet if it trades there, or check back once it has more closed trades.' : 'Check back once it has more closed trades.' }),
						);
						errEl.hidden = false;
					} else {
						fail(body.error_description || `Could not follow (${res.status}). Try again.`);
					}
					return;
				}
				await load();
			} catch {
				fail('Network problem: your follow was not saved. Check your connection and try again.');
			} finally {
				submit.disabled = false;
				submit.textContent = 'Follow';
			}
		});

		dialog.append(head(`Follow ${leaderName}`, 'Copy its trades into your own wallet. You choose the limits now; nothing past them is copied.'), form);
	}

	load();

	return {
		destroy() {
			destroyed = true;
			narration?.stop();
			narration = null;
			if (dialog.open) dialog.close();
			dialog.remove();
			btn.remove();
		},
	};
}
