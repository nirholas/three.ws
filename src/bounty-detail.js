// Bounty detail — three.ws/bounty/:taskId
//
// Renders a single pump.fun GO bounty from our cached proxy
// (/api/pump-bounties/:id): the brief + acceptance criteria, the reward
// breakdown, the on-chain escrow bridge (program / vault / creator → Solscan),
// and the public submission feed. Read-only.

import { mdToHtml } from './md.js';

const SOLSCAN = 'https://solscan.io/account/';

const taskId = (() => {
	const seg = location.pathname.split('/').filter(Boolean);
	// /bounty/:id
	const fromPath = seg[0] === 'bounty' ? seg[1] : null;
	return fromPath || new URLSearchParams(location.search).get('id') || '';
})();

async function init() {
	if (!taskId) return fail('No bounty specified.');
	try {
		const r = await fetch(`/api/pump-bounties/${encodeURIComponent(taskId)}`);
		const data = await r.json();
		if (!r.ok) throw new Error(data.error_description || data.error || `HTTP ${r.status}`);
		render(data.bounty, data.submissions || []);
	} catch (err) {
		fail(err.message);
	}
}

function render(b, submissions) {
	document.title = `${b.title || 'Bounty'} · three.ws`;
	const img = b.attachments.filter(
		(a) => a.kind === 'image' || /^image\//.test(a.contentType || ''),
	);

	document.getElementById('root').innerHTML = `
	<div class="crumbs"><a href="/bounties">Bounties</a> · ${esc(statusLabel(b.status))}</div>
	<div class="detail">
		<div>
			<h1>${esc(b.title) || 'Untitled bounty'}</h1>

			<div class="detail-section">
				<h2>The brief</h2>
				<div class="body-md md">${b.bodyMarkdown ? mdToHtml(b.bodyMarkdown) : '<span style="color:var(--muted)">No description provided.</span>'}</div>
			</div>

			${
				b.criteria.length
					? `<div class="detail-section">
				<h2>Acceptance criteria</h2>
				${b.criteria
					.slice()
					.sort((a, c) => (a.order || 0) - (c.order || 0))
					.map(
						(c) => `<div class="criteria-li">
						<span class="chk">${c.required ? '✓' : ''}</span>
						<span>${esc(c.text)}</span>
						${c.required ? '<span class="req">Required</span>' : ''}
					</div>`,
					)
					.join('')}
			</div>`
					: ''
			}

			${
				img.length
					? `<div class="detail-section">
				<h2>Attachments</h2>
				<div class="gallery">${img
					.map(
						(a) =>
							`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(a.url)}" alt="${esc(a.filename || 'attachment')}" loading="lazy" /></a>`,
					)
					.join('')}</div>
			</div>`
					: ''
			}

			<div class="detail-section">
				<h2>Submissions · ${submissions.length}</h2>
				${
					submissions.length
						? submissions.map(submission).join('')
						: `<div style="color:var(--muted);font-size:13px;">No public submissions yet.</div>`
				}
			</div>
		</div>

		<aside>
			<div class="side-card">
				<div class="reward-hero">${b.reward.totalUsd != null ? '$' + fmtNum(b.reward.totalUsd) : '—'}</div>
				<div class="reward-sub">reward pool${b.reward.pricedAt ? ' · priced live' : ''}</div>
				<div style="margin-top:14px">
					${b.reward.legs
						.map(
							(l) => `<div class="leg-row">
							<span>${l.isSol ? '◎ SOL' : `<a class="mono" href="${SOLSCAN}${esc(l.mint)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${shortAddr(l.mint)}</a>`}</span>
							<span style="font-weight:700">${fmtNum(l.amount)}${l.usd != null ? ` <span style="color:var(--muted);font-weight:500">($${fmtNum(l.usd)})</span>` : ''}</span>
						</div>`,
						)
						.join('')}
				</div>
			</div>

			<div class="side-card">
				<div class="kv"><span class="k">Status</span><span class="v">${esc(statusLabel(b.status))}</span></div>
				<div class="kv"><span class="k">Submissions</span><span class="v">${b.counts.submissions}</span></div>
				<div class="kv"><span class="k">Likes</span><span class="v">${b.likeCount}</span></div>
				${b.expiresAt ? `<div class="kv"><span class="k">Expires</span><span class="v">${esc(timeLeft(b.expiresAt))}</span></div>` : ''}
				<div class="kv"><span class="k">Creator</span><span class="v"><a href="${SOLSCAN}${esc(b.creator.address)}" target="_blank" rel="noopener noreferrer">${shortAddr(b.creator.address)}</a>${b.creator.xVerified ? ' <span class="verified">✔</span>' : ''}</span></div>
				${b.coinAddress ? `<div class="kv"><span class="k">Coin</span><span class="v"><a href="https://pump.fun/coin/${esc(b.coinAddress)}" target="_blank" rel="noopener noreferrer">${shortAddr(b.coinAddress)} ↗</a></span></div>` : ''}
			</div>

			<div class="side-card">
				<h2 style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px">On-chain escrow</h2>
				<div class="kv"><span class="k">Program</span><span class="v"><a href="${SOLSCAN}${esc(b.onChain.programId)}" target="_blank" rel="noopener noreferrer">${shortAddr(b.onChain.programId)}</a></span></div>
				${b.onChain.bountyId ? `<div class="kv"><span class="k">Bounty ID</span><span class="v">${esc(b.onChain.bountyId)}</span></div>` : ''}
				${b.reward.legs
					.filter((l) => l.vault)
					.map(
						(l) =>
							`<div class="kv"><span class="k">${l.isSol ? 'SOL vault' : 'Token vault'}</span><span class="v"><a href="${SOLSCAN}${esc(l.vault)}" target="_blank" rel="noopener noreferrer">${shortAddr(l.vault)}</a></span></div>`,
					)
					.join('')}
				${onChainFees(b.onChain.config)}
			</div>

			<a href="https://pump.fun/go/bounties" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="width:100%;justify-content:center">Submit on pump.fun ↗</a>
		</aside>
	</div>`;
}

function submission(s) {
	const img = s.attachments.filter(
		(a) => a.kind === 'image' || /^image\//.test(a.contentType || ''),
	);
	return `
	<div class="sub">
		<div class="sub-head">
			<span class="sub-avatar"></span>
			<span class="mono">${shortAddr(s.requester)}</span>
			<span>· ${esc(timeAgo(s.createdAt))}</span>
			<span class="sub-likes">♥ ${s.likeCount}</span>
		</div>
		${s.body ? `<div class="sub-body md">${mdToHtml(s.body)}</div>` : ''}
		${
			img.length
				? `<div class="gallery" style="margin-top:10px">${img
						.map(
							(a) =>
								`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(a.url)}" alt="proof" loading="lazy" /></a>`,
						)
						.join('')}</div>`
				: ''
		}
	</div>`;
}

function onChainFees(cfg) {
	if (!cfg) return '';
	const lamports = (v) => (v != null ? Number(v) / 1e9 : null);
	const pub = lamports(cfg.publishFeeLamports);
	const dispute = lamports(cfg.disputeFeeLamports);
	const win =
		cfg.disputeWindowSeconds != null
			? Math.round(Number(cfg.disputeWindowSeconds) / 3600)
			: null;
	const rows = [];
	if (pub != null)
		rows.push(
			`<div class="kv"><span class="k">Publish fee</span><span class="v">◎ ${fmtNum(pub)}</span></div>`,
		);
	if (dispute != null)
		rows.push(
			`<div class="kv"><span class="k">Dispute fee</span><span class="v">◎ ${fmtNum(dispute)}</span></div>`,
		);
	if (win != null)
		rows.push(
			`<div class="kv"><span class="k">Dispute window</span><span class="v">${win}h</span></div>`,
		);
	return rows.join('');
}

// ── States / helpers ──────────────────────────────────────────────────────────

function fail(msg) {
	document.getElementById('root').innerHTML = `
	<div class="errbox" style="padding:90px 20px">
		<div class="ico">⚠️</div>
		<h3>Couldn't load this bounty</h3>
		<p>${esc(msg)}</p>
		<a href="/bounties" class="btn btn-ghost btn-sm">← Back to bounties</a>
	</div>`;
}

function statusLabel(status) {
	const s = String(status || '').replace(/_/g, ' ');
	return s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Bounty';
}
function esc(str) {
	if (str == null) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
function fmtNum(n) {
	const x = Number(n) || 0;
	if (x >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
	if (x >= 1) return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
	return x.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
function timeLeft(iso) {
	if (!iso) return '';
	const ms = new Date(iso) - Date.now();
	if (ms <= 0) return 'expired';
	const d = Math.floor(ms / 86400000);
	const h = Math.floor((ms % 86400000) / 3600000);
	return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
function timeAgo(iso) {
	if (!iso) return '';
	const s = Math.floor((Date.now() - new Date(iso)) / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}
// Addresses come from pump.fun's feed, so the result is escaped for innerHTML.
function shortAddr(a) {
	if (!a) return 'anon';
	const s = String(a);
	return esc(s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
}

init();
