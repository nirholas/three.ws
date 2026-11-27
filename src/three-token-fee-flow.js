// "Where every $100 goes" on /three-token.
//
// Renders every $THREE split policy the platform enforces, read live from
// GET /api/token/config (`split_policies`, basis points per role), as "of every
// $100 paid for <surface>". No split figure is typed here: the numbers come
// from the API, so a policy added to SPLIT_POLICIES in api/_lib/token/config.js
// shows up on the page with no change to this file (an unknown key gets a
// readable label derived from its name).
//
// Under the breakdown, "where the money is": the treasury and reserve
// wallets with copy buttons, Solscan links and their live $THREE and USDC
// balances (GET /api/three-token/wallets, real RPC reads), plus a summary of
// the buyback history the page already loads for its buyback panel.

import { errorStateHTML } from './shared/state-kit.js';

// ── human labels: the ONE place a policy key or role gets its words ─────────
// Keys match SPLIT_POLICIES. Copy only; never a number.
export const POLICY_COPY = {
	consumption: {
		label: 'Paid compute',
		detail: 'Forge paid tiers, voice cloning, 3D generation over MCP, selfie to avatar',
	},
	marketplace_sale: {
		label: 'Marketplace sales',
		detail: 'Skills, animations, avatars, assets and collectible resales',
		roles: { seller: 'Seller or creator' },
	},
	scarcity_mint: {
		label: 'Scarcity mints',
		detail: 'Limited drops, rare-name auctions and pay-to-mint',
	},
	spin: {
		label: 'Spins',
		detail: 'Paid spins of the in-app wheel',
	},
	copy_performance_fee: {
		label: 'Copy-trading performance fees',
		detail: 'Charged only on a copier\'s realized profit',
		roles: { seller: 'Trader you copy' },
	},
};

export const ROLE_COPY = {
	seller: { label: 'Seller or creator', note: 'keeps the sale' },
	treasury: { label: 'Treasury', note: 'may fund discretionary $THREE purchases' },
	rewards: { label: 'Platform reserve', note: 'retained by the platform' },
};

// Display order: the policies people meet most first. Anything not listed
// (a newly added policy) follows in the order the API returns it.
const POLICY_ORDER = ['consumption', 'marketplace_sale', 'scarcity_mint', 'spin', 'copy_performance_fee'];

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "copy_performance_fee" becomes "Copy performance fee". */
export function humanizeKey(key) {
	const s = String(key || '').replace(/[_-]+/g, ' ').trim();
	return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}

export function policyLabel(key) {
	return POLICY_COPY[key]?.label || humanizeKey(key);
}

export function roleLabel(role, policyKey) {
	return POLICY_COPY[policyKey]?.roles?.[role] || ROLE_COPY[role]?.label || humanizeKey(role);
}

/** Dollars out of $100 for a leg in basis points (10,000 bps = $100). */
export function dollarsOfHundred(bps) {
	return Number(bps) / 100;
}

const fmtDollars = (n) =>
	`$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Policies from a public token config, in display order. */
export function orderedPolicies(config) {
	const policies = config?.split_policies && typeof config.split_policies === 'object' ? config.split_policies : {};
	const keys = Object.keys(policies).filter((k) => Array.isArray(policies[k]) && policies[k].length);
	const rank = (k) => {
		const i = POLICY_ORDER.indexOf(k);
		return i === -1 ? POLICY_ORDER.length + keys.indexOf(k) : i;
	};
	return keys.sort((a, b) => rank(a) - rank(b)).map((key) => ({ key, legs: policies[key] }));
}

function roleClass(role) {
	return ROLE_COPY[role] ? `tk-ff-r-${role}` : 'tk-ff-r-other';
}

function renderPolicy({ key, legs }) {
	const detail = POLICY_COPY[key]?.detail;
	const totalBps = legs.reduce((sum, leg) => sum + (Number(leg.bps) || 0), 0) || 1;
	const parts = legs.map((leg) => ({
		role: leg.role,
		bps: Number(leg.bps) || 0,
		label: roleLabel(leg.role, key),
		note: ROLE_COPY[leg.role]?.note || '',
		dollars: dollarsOfHundred(leg.bps),
	}));
	const sentence = parts.map((p) => `${fmtDollars(p.dollars)} to ${p.label.toLowerCase()}`).join(', ');
	const segments = parts
		.map(
			(p) =>
				`<span class="tk-ff-seg ${roleClass(p.role)}" style="flex-grow:${p.bps}">${p.bps * 5 >= totalBps ? `<span class="tk-ff-seg-t">${esc(fmtDollars(p.dollars))}</span>` : ''}</span>`,
		)
		.join('');
	const legend = parts
		.map(
			(p) => `<li class="tk-ff-leg">
				<span class="tk-ff-dot ${roleClass(p.role)}" aria-hidden="true"></span>
				<span class="tk-ff-amt">${esc(fmtDollars(p.dollars))}</span>
				<span class="tk-ff-role">${esc(p.label)}${p.note ? ` <small>${esc(p.note)}</small>` : ''}</span>
			</li>`,
		)
		.join('');
	return `<li class="tk-ff-row" data-policy="${esc(key)}">
		<div class="tk-ff-row-h">
			<h3 class="tk-ff-name">Of every $100 paid for ${esc(policyLabel(key).toLowerCase())}</h3>
			${detail ? `<p class="tk-ff-detail">${esc(detail)}</p>` : ''}
		</div>
		<div class="tk-ff-bar" role="img" aria-label="${esc(`Of every $100: ${sentence}.`)}">${segments}</div>
		<ul class="tk-ff-legend">${legend}</ul>
	</li>`;
}

/** The breakdown list for a public token config. Pure: string in, string out. */
export function renderPolicies(config) {
	const policies = orderedPolicies(config);
	if (!policies.length) {
		return `<p class="tk-ff-note">No split policy is published right now. Every $THREE payment is refused until one is, so no money moves without a published split.</p>`;
	}
	return `<ul class="tk-ff-list">${policies.map(renderPolicy).join('')}</ul>`;
}

// ── where the money is ───────────────────────────────────────────────────────

const WALLET_COPY = {
	treasury: {
		label: 'Treasury',
		note: 'Receives the treasury share of every split and may fund discretionary $THREE purchases.',
	},
	rewards: {
		label: 'Platform reserve wallet',
		note: 'Receives the reserve share of each split and is retained by the platform. It is not paid to holders.',
	},
};

const fmtTokenAmount = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
	if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
	if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
	return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

function renderBalance(b, kind) {
	if (!b || !b.ok) {
		return `<div class="tk-ff-bal"><span class="tk-ff-bal-k">${esc(b?.symbol || kind)}</span><span class="tk-ff-bal-v tk-ff-muted">Balance unavailable</span></div>`;
	}
	const full = Number(b.amount).toLocaleString('en-US', { maximumFractionDigits: 6 });
	const shown = kind === 'usdc'
		? Number(b.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
		: fmtTokenAmount(b.amount);
	return `<div class="tk-ff-bal"><span class="tk-ff-bal-k">${esc(b.symbol)}</span><span class="tk-ff-bal-v" title="${esc(`${full} ${b.symbol}`)}">${esc(shown)}</span></div>`;
}

function renderWallet(w) {
	const copy = WALLET_COPY[w.role] || { label: humanizeKey(w.role), note: '' };
	if (!w.configured || !w.address) {
		return `<li class="tk-ff-wallet" data-wallet="${esc(w.role)}">
			<div class="tk-ff-wallet-h">
				<h3 class="tk-ff-wallet-name">${esc(copy.label)}</h3>
				<span class="tk-ff-pill">Not yet published</span>
			</div>
			<p class="tk-ff-detail">${esc(copy.note)}</p>
			<p class="tk-ff-note">The address has not been published yet. Payments that include this share are paused until it is, so no money is ever sent to an unset address.</p>
		</li>`;
	}
	const addr = esc(w.address);
	return `<li class="tk-ff-wallet" data-wallet="${esc(w.role)}">
		<div class="tk-ff-wallet-h">
			<h3 class="tk-ff-wallet-name">${esc(copy.label)}</h3>
		</div>
		<p class="tk-ff-detail">${esc(copy.note)}</p>
		<div class="tk-ff-addr-row">
			<code class="tk-ff-addr">${addr}</code>
			<button type="button" class="tk-ff-btn" data-ff-copy="${addr}" aria-label="Copy the ${esc(copy.label.toLowerCase())} address">Copy</button>
			<a class="tk-ff-btn" href="https://solscan.io/account/${addr}" target="_blank" rel="noopener" aria-label="View the ${esc(copy.label.toLowerCase())} on Solscan (opens in a new tab)">Solscan ↗</a>
		</div>
		<div class="tk-ff-bals">
			${renderBalance(w.balances?.three, 'three')}
			${renderBalance(w.balances?.usdc, 'usdc')}
		</div>
	</li>`;
}

/** The wallet rows for a GET /api/three-token/wallets snapshot. Pure. */
export function renderWallets(snapshot) {
	const wallets = Array.isArray(snapshot?.wallets) ? snapshot.wallets : [];
	const asOf = snapshot?.as_of ? new Date(snapshot.as_of) : null;
	const anyRead = wallets.some((w) => w.configured);
	const stamp = anyRead && asOf && !Number.isNaN(asOf.getTime())
		? `Balances read from Solana at ${asOf.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`
		: '';
	return `<ul class="tk-ff-wallets">${wallets.map(renderWallet).join('')}</ul>${stamp ? `<p class="tk-ff-src">${esc(stamp)}</p>` : ''}`;
}

/** One-line summary of the buyback history the page already fetched. */
export function renderBuybackSummary(bb) {
	if (!bb) return '';
	const runs = Number(bb.runs) || 0;
	if (!runs) {
		return `<p class="tk-ff-bb">No treasury buyback has run yet. Each one will appear in <a href="#tk-bb-proof">Programmatic buybacks</a> with its Solscan receipt.</p>`;
	}
	const bought = fmtTokenAmount(bb.three_bought);
	return `<p class="tk-ff-bb">${runs.toLocaleString('en-US')} buyback${runs === 1 ? '' : 's'} so far, ${esc(bought)} $THREE bought into the treasury. <a href="#tk-bb-proof">See every receipt</a></p>`;
}

// ── styles (theme tokens come from the page's --tk-* variables) ──────────────
export const FEE_FLOW_CSS = `
	.tk-ff { margin-top:18px; }
	.tk-ff-lead { color:var(--tk-muted); font-size:13.5px; line-height:1.6; margin:0 0 16px; max-width:720px; }
	.tk-ff-lead a, .tk-ff-src a, .tk-ff-bb a { color:var(--tk-link); text-decoration:none; }
	.tk-ff-lead a:hover, .tk-ff-src a:hover, .tk-ff-bb a:hover { text-decoration:underline; }
	.tk-ff-list, .tk-ff-legend, .tk-ff-wallets { list-style:none; margin:0; padding:0; }
	.tk-ff-list { display:grid; gap:14px; }
	.tk-ff-row { padding:14px; border-radius:12px; background:var(--tk-inset); border:1px solid var(--tk-border); transition:border-color .15s; }
	.tk-ff-row:hover { border-color:var(--tk-border-hover); }
	.tk-ff-row-h { margin-bottom:10px; }
	.tk-ff-name { font-size:14.5px; font-weight:700; margin:0; color:var(--tk-text); letter-spacing:-0.01em; }
	.tk-ff-detail { margin:3px 0 0; font-size:12.5px; color:var(--tk-dim); line-height:1.5; }
	.tk-ff-bar { display:flex; gap:2px; height:30px; border-radius:8px; overflow:hidden; }
	.tk-ff-seg { flex-basis:0; min-width:4px; display:flex; align-items:center; justify-content:center; transition:filter .15s; }
	.tk-ff-row:hover .tk-ff-seg { filter:saturate(1.15); }
	.tk-ff-seg-t { font-size:12px; font-weight:700; font-family:ui-monospace,Menlo,monospace; color:#07130c; white-space:nowrap; overflow:hidden; text-overflow:clip; padding:0 6px; }
	.tk-ff-r-seller { background:#a78bfa; }
	.tk-ff-r-treasury { background:#4ade80; }
	.tk-ff-r-rewards { background:#22d3ee; }
	.tk-ff-r-other { background:#fbbf24; }
	.tk-ff-legend { display:flex; flex-wrap:wrap; gap:6px 18px; margin-top:10px; }
	.tk-ff-leg { display:flex; align-items:baseline; gap:7px; font-size:13px; color:var(--tk-text-2); min-width:0; }
	.tk-ff-dot { width:9px; height:9px; border-radius:3px; flex-shrink:0; align-self:center; }
	.tk-ff-amt { font-family:ui-monospace,Menlo,monospace; font-weight:700; color:var(--tk-text); }
	.tk-ff-role small { color:var(--tk-dim); font-size:12px; }
	.tk-ff-sub { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:var(--tk-dim); margin:24px 0 12px; font-weight:600; }
	.tk-ff-wallets { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
	.tk-ff-wallet { padding:14px; border-radius:12px; background:var(--tk-inset); border:1px solid var(--tk-border); min-width:0; }
	.tk-ff-wallet-h { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
	.tk-ff-wallet-name { font-size:14.5px; font-weight:700; margin:0; color:var(--tk-text); }
	.tk-ff-pill { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:3px 8px; border-radius:999px; color:var(--tk-warn); border:1px solid currentColor; }
	.tk-ff-note { margin:10px 0 0; font-size:12.5px; color:var(--tk-muted); line-height:1.55; }
	.tk-ff-addr-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px; min-width:0; }
	.tk-ff-addr { flex:1 1 220px; min-width:0; font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--tk-text-2); background:var(--tk-surface); border:1px solid var(--tk-border); border-radius:8px; padding:7px 9px; overflow-wrap:anywhere; }
	.tk-ff-btn { appearance:none; font:inherit; font-size:12.5px; font-weight:600; color:var(--tk-text); background:var(--tk-btn); border:1px solid var(--tk-border-2); border-radius:8px; padding:7px 11px; cursor:pointer; text-decoration:none; white-space:nowrap; transition:background .15s,border-color .15s,transform .1s; }
	.tk-ff-btn:hover { background:var(--tk-btn-hover); border-color:var(--tk-border-hover); }
	.tk-ff-btn:active { transform:translateY(1px); }
	.tk-ff-btn:focus-visible { outline:2px solid var(--tk-link); outline-offset:2px; }
	.tk-ff-bals { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
	.tk-ff-bal { display:flex; flex-direction:column; gap:3px; min-width:0; }
	.tk-ff-bal-k { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--tk-dim); }
	.tk-ff-bal-v { font-size:18px; font-weight:700; font-family:ui-monospace,Menlo,monospace; color:var(--tk-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.tk-ff-bal-v.tk-ff-muted { font-size:13px; font-weight:600; color:var(--tk-muted); font-family:inherit; }
	.tk-ff-src, .tk-ff-bb { font-size:12.5px; color:var(--tk-dim); margin:12px 0 0; line-height:1.55; }
	.tk-ff-skel-row { height:98px; margin-bottom:14px; }
	@media (max-width:560px){ .tk-ff-bar { height:26px; } .tk-ff-seg-t { font-size:11px; padding:0 3px; } }
	@media (prefers-reduced-motion: reduce){ .tk-ff-row, .tk-ff-seg, .tk-ff-btn { transition:none; } }
`;

const SKELETON_ROWS = (n) => Array.from({ length: n }, () => '<div class="tk-skel tk-ff-skel-row"></div>').join('');

/**
 * Mount the section into `host`. Fetches the config and the wallet snapshot
 * independently so one failing never blanks the other.
 * @param {HTMLElement} host
 * @param {{ copyText: (text: string) => Promise<boolean> }} deps
 * @returns {{ setBuyback: (bb: object|null) => void }}
 */
export function mountFeeFlow(host, { copyText }) {
	host.innerHTML = `
		<h2>Where every $100 goes</h2>
		<p class="tk-ff-lead">Every payment made in $THREE is split on-chain by a published policy, each share paid straight to its wallet. These splits are read live from <a href="/api/token/config" target="_blank" rel="noopener">the public token config</a>, the same one the payment code enforces. The platform never burns $THREE: every share goes to a seller, the treasury, or the platform reserve, and nothing is destroyed. <a href="/docs/three-thesis">How $THREE is used</a></p>
		<div data-ff-policies aria-live="polite" aria-busy="true">${SKELETON_ROWS(3)}</div>
		<h3 class="tk-ff-sub">Where the money is</h3>
		<div data-ff-wallets aria-live="polite" aria-busy="true">${SKELETON_ROWS(1)}</div>
		<div data-ff-bb></div>`;

	const policiesEl = host.querySelector('[data-ff-policies]');
	const walletsEl = host.querySelector('[data-ff-wallets]');
	const bbEl = host.querySelector('[data-ff-bb]');

	const loadJson = (url) =>
		fetch(url, { headers: { accept: 'application/json' } }).then((r) =>
			r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`)),
		);

	const loadPolicies = () => {
		policiesEl.setAttribute('aria-busy', 'true');
		policiesEl.innerHTML = SKELETON_ROWS(3);
		return loadJson('/api/token/config')
			.then((cfg) => { policiesEl.innerHTML = renderPolicies(cfg); })
			.catch(() => {
				policiesEl.innerHTML = errorStateHTML({
					title: 'The split policies did not load',
					body: 'The public token config did not respond. Payments are unaffected; retry, or read the same data directly.',
					actions: [
						{ label: 'Retry', id: 'ff-policies-retry', primary: true },
						{ label: 'Open /api/token/config', id: 'ff-config-open' },
					],
				});
			})
			.finally(() => policiesEl.setAttribute('aria-busy', 'false'));
	};

	const loadWallets = () => {
		walletsEl.setAttribute('aria-busy', 'true');
		walletsEl.innerHTML = SKELETON_ROWS(1);
		return loadJson('/api/three-token/wallets')
			.then((snap) => { walletsEl.innerHTML = renderWallets(snap); })
			.catch(() => {
				walletsEl.innerHTML = errorStateHTML({
					title: 'Wallet balances did not load',
					body: 'The wallet feed did not respond. Retry in a moment; every balance is also readable on Solscan.',
					actions: [{ label: 'Retry', id: 'ff-wallets-retry', primary: true }],
				});
			})
			.finally(() => walletsEl.setAttribute('aria-busy', 'false'));
	};

	host.addEventListener('click', async (e) => {
		const act = e.target.closest('[data-sk-action]')?.dataset.skAction;
		if (act === 'ff-policies-retry') return loadPolicies();
		if (act === 'ff-config-open') return window.open('/api/token/config', '_blank', 'noopener');
		if (act === 'ff-wallets-retry') return loadWallets();
		const copyBtn = e.target.closest('[data-ff-copy]');
		if (copyBtn) {
			const ok = await copyText(copyBtn.dataset.ffCopy);
			const label = copyBtn.dataset.label || (copyBtn.dataset.label = copyBtn.textContent);
			copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
			setTimeout(() => { copyBtn.textContent = label; }, 1600);
		}
	});

	loadPolicies();
	loadWallets();

	return {
		setBuyback(bb) { bbEl.innerHTML = renderBuybackSummary(bb); },
	};
}
