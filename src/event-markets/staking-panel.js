// Stake panel for /event-markets/:slug, shown next to the free pick ONLY when the
// server says staking is offered and the viewer's region and age gate is open.
// Everyone else sees the free-to-play market exactly as before.
//
// The server builds an UNSIGNED transaction plus the preview; the wallet signs it
// here, after an explicit confirm that restates recipient, amount, token and chain.
// Nothing is sent without that click. Staked standings are never merged with the
// free-to-play leaderboard. Guide: docs/event-markets-staking.md.

import { api, h, pct, when } from './common.js';

const PROVIDERS = [
	{ name: 'Phantom', detect: () => window.phantom?.solana || (window.solana?.isPhantom && window.solana) },
	{ name: 'Solflare', detect: () => window.solflare },
	{ name: 'Backpack', detect: () => window.backpack?.solana || (window.solana?.isBackpack && window.solana) },
];

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** "12.5" -> 12500000n for a token with `decimals`. Returns null when the text is not a valid amount. */
export function toBaseUnits(text, decimals) {
	const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(String(text).trim());
	if (!m || (m[2] || '').length > decimals) return null;
	return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] || '').padEnd(decimals, '0') || '0');
}

export function fromBaseUnits(v, decimals) {
	const s = BigInt(v).toString().padStart(decimals + 1, '0');
	const frac = s.slice(-decimals).replace(/0+$/, '');
	return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

export function stakingPanel({ slug, getMarket, signedIn, requireSignIn, toast, announce }) {
	const box = h('div', { 'data-staking': '' });
	const S = { view: null, wallet: null, busy: false, outcomeId: null, amount: '', quote: null, error: '', note: '' };
	const path = (suffix) => `/${encodeURIComponent(slug)}/staking${suffix}`;

	async function load() {
		try {
			S.view = await api(path(S.wallet ? `?wallet=${encodeURIComponent(S.wallet.address)}` : ''));
		} catch {
			S.view = { offered: false };
		}
		draw();
	}

	async function connect() {
		const entry = PROVIDERS.map((p) => ({ ...p, provider: p.detect() })).find((p) => p.provider);
		if (!entry) throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack.');
		const r = await entry.provider.connect();
		const pk = r?.publicKey ?? entry.provider.publicKey;
		S.wallet = { provider: entry.provider, name: entry.name, address: typeof pk === 'string' ? pk : pk.toBase58() };
	}

	async function signAndSend(base64Tx) {
		const { Transaction } = await import('@solana/web3.js');
		const tx = Transaction.from(b64ToBytes(base64Tx));
		const res = await S.wallet.provider.signAndSendTransaction(tx);
		return res?.signature ?? res;
	}

	async function guard(fn) {
		S.busy = true; S.error = ''; draw();
		try { await fn(); }
		catch (err) { S.error = err?.message || 'Something went wrong. Nothing was sent.'; }
		S.busy = false; draw();
	}

	const attest = (age, region) => guard(async () => {
		if (!signedIn() && !(await requireSignIn())) return;
		await api(path('/attest'), { method: 'POST', body: { confirmed_age: age, confirmed_region: region } });
		await load();
	});

	const quote = () => guard(async () => {
		if (!signedIn() && !(await requireSignIn())) return;
		if (!S.wallet) await connect();
		const units = toBaseUnits(S.amount, S.view.token.decimals);
		if (!S.outcomeId) throw new Error('Choose who you think wins.');
		if (units == null || units === 0n) throw new Error(`Enter an amount in ${S.view.token.symbol} with at most ${S.view.token.decimals} decimals.`);
		S.quote = await api(path('/stake'), { method: 'POST', body: { wallet: S.wallet.address, outcome_id: S.outcomeId, amount: units.toString() } });
	});

	const confirmStake = () => guard(async () => {
		const q = S.quote;
		const signature = await signAndSend(q.transaction);
		await api(path('/record'), { method: 'POST', body: { signature } });
		S.quote = null; S.amount = '';
		S.note = `Stake sent: ${q.confirm.amount_display} ${q.confirm.token}. It appears in the pool once confirmed on Solana.`;
		toast?.('Stake sent');
		announce?.(S.note);
		await load();
	});

	const payout = (kind) => guard(async () => {
		if (!S.wallet) await connect();
		const built = await api(path('/payout'), { method: 'POST', body: { wallet: S.wallet.address, kind } });
		const signature = await signAndSend(built.transaction);
		await api(path('/record'), { method: 'POST', body: { signature } });
		S.note = kind === 'claim' ? 'Winnings claimed to your wallet.' : 'Refund sent to your wallet.';
		toast?.(S.note);
		await load();
	});

	function quoteTable(q) {
		const rows = [
			['Chain', `Solana (${q.confirm.cluster})`], ['Token', `${q.confirm.token}`], ['You stake', `${q.confirm.amount_display} ${q.confirm.token}`],
			['Pool', q.confirm.pool_address], ['Your wallet', q.confirm.wallet],
			['Pool after your stake', `${fromBaseUnits(q.preview.pool_after, S.view.token.decimals)} ${q.confirm.token}`],
			['Fee if it resolves', `${fromBaseUnits(q.preview.fee_if_resolved, S.view.token.decimals)} ${q.confirm.token} (${S.view.fee.fee_bps / 100}% of the pool)`],
			['Payout if you are right', `${fromBaseUnits(q.preview.payout_if_right, S.view.token.decimals)} ${q.confirm.token}`],
			['Profit if you are right', `${fromBaseUnits(q.preview.profit_if_right, S.view.token.decimals)} ${q.confirm.token}`],
		];
		return h('dl', { class: 'em-stake-kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
	}

	function draw() {
		const v = S.view;
		const m = getMarket();
		if (!v) { box.replaceChildren(h('section', { class: 'em-panel' }, h('div', { class: 'em-skel', style: 'height:8rem' }))); return; }
		if (!v.offered || v.gate?.reason === 'disabled') { box.replaceChildren(); return; }
		const pos = v.position;
		const kids = [h('h2', { id: 'em-h-stake' }, `Stake ${v.token.symbol}`)];

		if (pos && (pos.claimable || pos.refundable)) {
			kids.push(
				h('p', null, pos.claimable
					? `You called it. Your payout is ${fromBaseUnits(pos.payout, v.token.decimals)} ${v.token.symbol}.`
					: `This market was voided. Your ${fromBaseUnits(pos.amount, v.token.decimals)} ${v.token.symbol} stake is refunded in full, with no fee.`),
				h('button', { class: 'em-btn primary', type: 'button', disabled: S.busy, onclick: () => payout(pos.claimable ? 'claim' : 'refund') }, pos.claimable ? 'Claim winnings' : 'Claim refund'));
		} else if (v.status !== 'open') {
			kids.push(h('p', { class: 'em-note' }, v.status === 'resolved' ? 'This staked market is resolved. Winners claim from their own wallet.' : 'This staked market is closed.'));
		} else if (!v.gate.available && !v.gate.needs_attestation) {
			kids.push(h('p', { class: 'em-note' }, v.gate.message));
		} else if (v.gate.needs_attestation) {
			const age = h('input', { type: 'checkbox', id: 'em-att-age' });
			const region = h('input', { type: 'checkbox', id: 'em-att-reg' });
			kids.push(
				h('p', { class: 'em-note' }, v.gate.message),
				h('label', { for: 'em-att-age', class: 'em-check' }, age, ` I am at least ${v.gate.min_age} years old.`),
				h('label', { for: 'em-att-reg', class: 'em-check' }, region, ' Staking real tokens is lawful where I live.'),
				h('button', { class: 'em-btn primary', type: 'button', disabled: S.busy, onclick: () => attest(age.checked, region.checked) }, 'Confirm and continue'));
		} else {
			const outcomes = m.outcomes;
			const select = h('select', { id: 'em-stake-out', 'aria-label': 'Who wins', onchange: (e) => { S.outcomeId = e.target.value; S.quote = null; } },
				h('option', { value: '' }, 'Choose who wins'),
				v.outcomes.map((o) => {
					const label = outcomes.find((x) => x.id === o.outcome_id)?.label ?? 'Entrant';
					return h('option', { value: o.outcome_id, selected: S.outcomeId === o.outcome_id }, `${label} (${pct(o.share * 100)} of the pool)`);
				}));
			const amount = h('input', { id: 'em-stake-amt', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: `${fromBaseUnits(v.limits.min, v.token.decimals)} min`, value: S.amount, oninput: (e) => { S.amount = e.target.value; S.quote = null; } });
			kids.push(
				h('p', { class: 'em-note' }, `Real ${v.token.symbol} on Solana (${v.cluster}). Pool of ${fromBaseUnits(v.total_staked, v.token.decimals)} ${v.token.symbol}, ${v.fee.fee_bps / 100}% fee. Min ${fromBaseUnits(v.limits.min, v.token.decimals)}, max ${fromBaseUnits(v.limits.max_stake, v.token.decimals)} per account. Locks ${when(v.lock_at)}. If the market is voided, or nobody picked the winner, every stake is refunded.`),
				h('label', { for: 'em-stake-out' }, 'Your call'), select,
				h('label', { for: 'em-stake-amt' }, `Amount (${v.token.symbol})`), amount,
				S.quote ? quoteTable(S.quote) : null,
				S.quote?.preview.note ? h('p', { class: 'em-note' }, S.quote.preview.note) : null,
				h('div', { class: 'row' },
					S.quote
						? [h('button', { class: 'em-btn', type: 'button', disabled: S.busy, onclick: () => { S.quote = null; draw(); } }, 'Edit'),
							h('button', { class: 'em-btn primary', type: 'button', disabled: S.busy, onclick: confirmStake }, `Confirm and sign ${S.quote.confirm.amount_display} ${S.quote.confirm.token}`)]
						: h('button', { class: 'em-btn primary', type: 'button', disabled: S.busy, onclick: quote }, S.wallet ? 'Preview stake' : 'Connect wallet and preview')),
				pos ? h('p', { class: 'em-note' }, `Your stake: ${fromBaseUnits(pos.amount, v.token.decimals)} ${v.token.symbol}.`) : null);
		}
		if (S.error) kids.push(h('p', { class: 'em-err', role: 'alert' }, S.error));
		if (S.note) kids.push(h('p', { class: 'em-note', role: 'status' }, S.note));
		box.replaceChildren(h('section', { class: 'em-panel', 'aria-labelledby': 'em-h-stake' }, kids));
	}

	load();
	return { el: box, reload: load };
}
