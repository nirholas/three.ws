/**
 * Claim events panel for the agent home page.
 * Polls the Solana RPC directly for fee-claim transactions by a creator wallet.
 * Mounted beneath the pump.fun card when `creatorWallet` is set on the agent profile.
 */

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SOLANA_RPC = {
	mainnet: 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
};

// Minimum SOL delta (lamports) to qualify as a fee claim rather than tx-fee noise.
const MIN_CLAIM_LAMPORTS = 10_000;

const PANEL_STYLES = `
.three-ws-claims-panel {
	margin-top: 0.6rem;
	padding: 0.9rem 1rem;
	border: 1px solid rgba(255,255,255,0.07);
	border-radius: 12px;
	background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
	color: #e5e5e5;
	font: 13px/1.5 Inter, sans-serif;
}
.three-ws-claims-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 0.5rem;
}
.three-ws-claims-title {
	font-size: 0.7rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: rgba(255,255,255,0.4);
	font-weight: 500;
}
.three-ws-claims-status {
	font-size: 0.68rem;
	color: rgba(255,255,255,0.28);
}
.three-ws-claims-list {
	list-style: none;
	margin: 0;
	padding: 0;
}
.three-ws-claims-item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.32rem 0;
	border-top: 1px solid rgba(255,255,255,0.04);
	font-size: 0.78rem;
}
.three-ws-claims-item:first-child { border-top: none; }
.three-ws-claims-ts {
	flex: 0 0 4.2rem;
	color: rgba(255,255,255,0.38);
	font-size: 0.7rem;
	white-space: nowrap;
}
.three-ws-claims-mint {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: ui-monospace, monospace;
	color: rgba(255,255,255,0.55);
	font-size: 0.7rem;
}
.three-ws-claims-amount {
	flex: 0 0 auto;
	color: #a4f0bc;
	font-weight: 500;
	white-space: nowrap;
	font-size: 0.78rem;
}
.three-ws-claims-link {
	flex: 0 0 auto;
	color: rgba(255,255,255,0.28);
	text-decoration: none;
	font-size: 0.72rem;
	line-height: 1;
}
.three-ws-claims-link:hover { color: rgba(255,255,255,0.65); }
.three-ws-claims-empty {
	color: rgba(255,255,255,0.3);
	font-size: 0.78rem;
	padding: 0.2rem 0;
}
`;

let _stylesInjected = false;
function ensureStyles() {
	if (_stylesInjected) return;
	const el = document.createElement('style');
	el.textContent = PANEL_STYLES;
	document.head.appendChild(el);
	_stylesInjected = true;
}

function shortMint(m) {
	if (!m) return '—';
	return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

function formatSol(lamports) {
	const n = Number(lamports) / 1e9;
	if (!isFinite(n) || n <= 0) return '—';
	return n >= 1 ? `${n.toFixed(3)} SOL` : `${n.toFixed(5)} SOL`;
}

function timeAgo(unixSec) {
	if (!unixSec) return '';
	const diff = Date.now() - unixSec * 1000;
	if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

function esc(s) {
	return String(s || '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[c]);
}

async function jsonRpc(url, method, params) {
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
	const body = await resp.json();
	if (body.error) throw new Error(body.error.message || 'RPC error');
	return body.result;
}

async function jsonRpcBatch(url, requests) {
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(requests.map((r, i) => ({ jsonrpc: '2.0', id: i, ...r }))),
	});
	if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
	return resp.json();
}

function getKey(k) {
	return typeof k === 'string' ? k : (k?.pubkey ?? '');
}

async function fetchClaimEvents(creator, network) {
	const url = SOLANA_RPC[network] || SOLANA_RPC.mainnet;

	const sigs = await jsonRpc(url, 'getSignaturesForAddress', [creator, { limit: 50 }]);
	if (!sigs?.length) return [];

	const toFetch = sigs.slice(0, 20);
	const batchResults = await jsonRpcBatch(
		url,
		toFetch.map((s) => ({
			method: 'getTransaction',
			params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
		})),
	);

	const claims = [];
	for (let i = 0; i < batchResults.length && claims.length < 10; i++) {
		const tx = batchResults[i]?.result;
		if (!tx) continue;

		const keys = tx.transaction?.message?.accountKeys || [];

		if (!keys.some((k) => getKey(k) === PUMP_PROGRAM)) continue;

		const pre = tx.meta?.preBalances || [];
		const post = tx.meta?.postBalances || [];
		const creatorIdx = keys.findIndex((k) => getKey(k) === creator);
		if (creatorIdx < 0) continue;
		const delta = (post[creatorIdx] || 0) - (pre[creatorIdx] || 0);
		if (delta < MIN_CLAIM_LAMPORTS) continue;

		// Find the mint: first account in the pump program instruction that is not
		// the creator or the program itself, and looks like a token mint (32+ chars).
		let mint = null;
		for (const ix of tx.transaction?.message?.instructions || []) {
			if (ix.programId !== PUMP_PROGRAM) continue;
			for (const acct of ix.accounts || []) {
				const pk = typeof acct === 'string' ? acct : getKey(acct);
				if (pk && pk !== creator && pk !== PUMP_PROGRAM && pk.length >= 32) {
					mint = pk;
					break;
				}
			}
			if (mint) break;
		}

		claims.push({ signature: toFetch[i].signature, blockTime: tx.blockTime, mint, solAmount: delta });
	}

	return claims;
}

/**
 * Mount a fee-claims polling panel beneath `rootEl`.
 *
 * @param {HTMLElement} rootEl   - Container to append the panel to.
 * @param {object}      opts
 * @param {string}      opts.creator    - Creator wallet public key.
 * @param {number}      [opts.intervalMs=30000]
 * @param {string}      [opts.network='mainnet']
 * @returns {() => void} Cleanup function — clears interval and removes panel.
 */
export function mountClaimsPanel(rootEl, { creator, intervalMs = 30_000, network = 'mainnet' } = {}) {
	if (!rootEl || !creator) return () => {};

	ensureStyles();

	const section = document.createElement('section');
	section.className = 'three-ws-claims-panel';
	rootEl.appendChild(section);

	let timer = null;
	let lastFetch = null;

	function setStatus(text) {
		const el = section.querySelector('.three-ws-claims-status');
		if (el) el.textContent = text;
	}

	function render(claims) {
		const statusText = lastFetch ? timeAgo(lastFetch / 1000) : '';
		const rows = claims.length === 0
			? `<li class="three-ws-claims-empty">No recent fee claims</li>`
			: claims.map((c) => {
				const txUrl = network === 'devnet'
					? `https://explorer.solana.com/tx/${esc(c.signature)}?cluster=devnet`
					: `https://solscan.io/tx/${esc(c.signature)}`;
				return `
					<li class="three-ws-claims-item">
						<span class="three-ws-claims-ts">${esc(timeAgo(c.blockTime))}</span>
						<span class="three-ws-claims-mint" title="${esc(c.mint || '')}">${esc(shortMint(c.mint))}</span>
						<span class="three-ws-claims-amount">${esc(formatSol(c.solAmount))}</span>
						<a class="three-ws-claims-link" href="${txUrl}" target="_blank" rel="noopener" title="View on Solscan">↗</a>
					</li>
				`;
			}).join('');

		section.innerHTML = `
			<div class="three-ws-claims-head">
				<span class="three-ws-claims-title">Fee Claims</span>
				<span class="three-ws-claims-status">${esc(statusText)}</span>
			</div>
			<ul class="three-ws-claims-list">${rows}</ul>
		`;
	}

	function renderLoading() {
		section.innerHTML = `
			<div class="three-ws-claims-head">
				<span class="three-ws-claims-title">Fee Claims</span>
				<span class="three-ws-claims-status">loading…</span>
			</div>
		`;
	}

	async function poll() {
		try {
			const claims = await fetchClaimEvents(creator, network);
			lastFetch = Date.now();
			render(claims);
		} catch {
			setStatus('error — retrying');
		}
	}

	renderLoading();
	poll();
	timer = setInterval(poll, intervalMs);

	return function cleanup() {
		clearInterval(timer);
		section.remove();
	};
}
