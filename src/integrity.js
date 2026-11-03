/**
 * Public /integrity page — the platform-wide face of provable custody.
 *
 * Fetches the no-auth aggregate (latest epoch, Merkle root, on-chain anchor,
 * wallet count, aggregate SOL) and then VERIFIES the latest root on-chain right
 * here: it reads the anchor transaction straight from a public Solana RPC and
 * confirms the committed root matches what the API reported. Anyone — no account —
 * gets a green "verified on-chain" or an honest red/pending state. Never shows
 * per-wallet private data.
 */

import { readOnchainAnchor } from './proof-of-custody/verifier.js';
import { shortAddress } from './shared/address.js';

const root = document.getElementById('intg-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function short(s, h = 10, t = 10) { return shortAddress(s, h, t); }
function fmtTime(iso) {
	if (!iso) return '—';
	try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(iso); }
}
function fmtSol(lamports) {
	const n = Number(BigInt(String(lamports || '0'))) / 1e9;
	return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

async function main() {
	root.innerHTML = `<div class="intg-card intg-skel" aria-busy="true"><span style="height:70px"></span><span style="height:120px"></span><span style="height:200px"></span></div>`;

	let data;
	try {
		const res = await fetch('/api/custody/integrity', { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`integrity request failed (${res.status})`);
		data = (await res.json())?.data;
	} catch (err) {
		root.innerHTML = `<div class="intg-card"><h2 class="intg-h2">Couldn't load integrity data</h2><p class="intg-p">${esc(err.message)}</p><button class="intg-btn" id="intg-retry" type="button">Try again</button></div>`;
		document.getElementById('intg-retry')?.addEventListener('click', main);
		return;
	}

	const latest = data?.latest;
	if (!latest) {
		root.innerHTML = `<div class="intg-card">
			<h2 class="intg-h2">No attestations yet</h2>
			<p class="intg-p">The first custody attestation epoch hasn't been committed yet. Once the snapshot job runs, the latest Merkle root and its on-chain anchor will appear here, verifiable by anyone.</p>
			${explainBlock()}
		</div>`;
		return;
	}

	const anchored = Number(data.epochs_anchored || 0);
	const total = Number(data.epochs_total || 0);
	const target = data.latest_anchored || null;
	const latestIsAnchored = latest.anchor_status === 'anchored' && !!latest.anchor_sig;
	const firstAnchor = data.first_anchored_at ? fmtTime(data.first_anchored_at) : null;
	const backlogNote = anchored > 0 && Number(data.backlog) > 0
		? `<p class="intg-p" id="intg-backlog">Anchoring began on ${esc(firstAnchor)}. The ${esc(data.backlog)} earlier epoch${Number(data.backlog) === 1 ? ' was' : 's were'} recorded and are still verifiable against their stored roots, but were not timestamped on-chain, so they are left as they are rather than anchored late.</p>`
		: '';
	const banner = !latestIsAnchored
		? `<div class="intg-status is-pending" role="status" id="intg-banner"><div class="intg-seal">◷</div><div class="intg-status-main"><div class="intg-status-title">Latest epoch #${esc(latest.epoch)} is not anchored</div><div class="intg-status-sub">Its snapshot is recorded (status: ${esc(latest.anchor_status)}) but the root has no on-chain transaction. ${target ? `The verification below is for the newest anchored epoch, #${esc(target.epoch)}.` : 'Nothing below is verified on-chain yet.'}</div></div></div>`
		: '';

	root.innerHTML = `
		<div class="intg-card">
			<p class="intg-p" id="intg-coverage"><strong>${esc(anchored)} of ${esc(total)}</strong> epochs anchored on Solana.</p>
			${backlogNote}
			${banner}
			<div class="intg-status is-pending" id="intg-status">
				<div class="intg-seal" id="intg-seal"><span class="intg-spin" aria-hidden="true"></span></div>
				<div class="intg-status-main">
					<div class="intg-status-title" id="intg-status-title">Verifying the latest root on-chain…</div>
					<div class="intg-status-sub" id="intg-status-sub">Reading the anchor transaction directly from a public Solana RPC.</div>
				</div>
			</div>
			<div class="intg-grid">
				<div class="intg-stat"><div class="intg-stat-k">Latest epoch</div><div class="intg-stat-v">#${esc(latest.epoch)}</div></div>
				<div class="intg-stat"><div class="intg-stat-k">Wallets attested</div><div class="intg-stat-v">${esc(latest.wallet_count)}</div></div>
				<div class="intg-stat"><div class="intg-stat-k">Aggregate balance</div><div class="intg-stat-v">${esc(fmtSol(latest.total_lamports))} SOL</div></div>
				<div class="intg-stat"><div class="intg-stat-k">Snapshot</div><div class="intg-stat-v" style="font-size:.8rem">${esc(fmtTime(latest.created_at))}</div></div>
				<div class="intg-stat"><div class="intg-stat-k">Merkle root</div><div class="intg-stat-v" style="font-size:.78rem" title="${esc(latest.merkle_root)}">${esc(short(latest.merkle_root))}</div></div>
				<div class="intg-stat"><div class="intg-stat-k">On-chain anchor</div><div class="intg-stat-v" style="font-size:.8rem">${latest.anchor_explorer
					? `<a href="${esc(latest.anchor_explorer)}" target="_blank" rel="noopener" title="${esc(latest.anchor_sig)}">${esc(short(latest.anchor_sig, 8, 8))} ↗</a>`
					: `<span class="intg-pill ${esc(latest.anchor_status)}">${esc(latest.anchor_status)}</span>`}</div></div>
			</div>
		</div>

		<div class="intg-card">
			<h2 class="intg-h2">How verification works</h2>
			<p class="intg-p">No trust required. The check above ran in your browser; here's exactly what it did.</p>
			${explainBlock()}
		</div>

		${recentBlock(data.recent, latest.epoch)}

		<div class="intg-card">
			<h2 class="intg-h2">Own an agent wallet?</h2>
			<p class="intg-p">Verify your own wallet's inclusion proof — recompute your leaf and confirm it sits under this anchored root.</p>
			<a class="intg-btn" href="/proof">Verify my custody →</a>
		</div>
	`;

	verifyLatest(target);
}

async function verifyLatest(latest) {
	const statusEl = document.getElementById('intg-status');
	const seal = document.getElementById('intg-seal');
	const title = document.getElementById('intg-status-title');
	const sub = document.getElementById('intg-status-sub');
	const set = (cls, ico, t, s) => {
		statusEl.className = `intg-status ${cls}`;
		seal.innerHTML = ico;
		title.textContent = t;
		sub.innerHTML = s;
	};

	if (!latest || !latest.anchor_sig) {
		set('is-pending', '◷', 'No epoch is anchored on-chain yet',
			'Snapshots are recorded, but until a root is committed in a Solana transaction there is nothing to verify on-chain here.');
		return;
	}

	try {
		const onchain = await readOnchainAnchor(latest.anchor_sig, latest.anchor_network || 'mainnet');
		const apiRoot = String(latest.merkle_root || '').toLowerCase();
		const match = onchain.root === apiRoot && Number(onchain.epoch) === Number(latest.epoch);
		if (match) {
			set('is-verified', '✓', `Custody verified on-chain · epoch #${latest.epoch}`,
				`The Merkle root reported here exactly matches the root committed in <a href="${esc(latest.anchor_explorer)}" target="_blank" rel="noopener">the anchor transaction</a> on Solana ${esc(latest.anchor_network || 'mainnet')}. Verified ${esc(fmtTime(new Date().toISOString()))}.`);
		} else {
			set('is-failed', '✕', 'Root mismatch',
				`The root committed on-chain (${esc(short(onchain.root))}) does not match the reported root. This should never happen — do not trust until resolved.`);
		}
	} catch (err) {
		set('is-pending', '◷', 'Could not read the anchor on-chain',
			`We couldn't independently fetch the anchor transaction right now (${esc(err.message)}). Treating as unverified rather than trusting the server — retry shortly.`);
	}
}

function explainBlock() {
	return `<div class="intg-explain">
		<div class="intg-step"><div class="intg-step-n">01</div><div class="intg-step-t">Snapshot</div><div class="intg-step-d">Every wallet's address, live on-chain balance and authorized-state head are hashed into a leaf.</div></div>
		<div class="intg-step"><div class="intg-step-n">02</div><div class="intg-step-t">Merkle root</div><div class="intg-step-d">All leaves are folded into one root — a single fingerprint of every wallet's state this epoch.</div></div>
		<div class="intg-step"><div class="intg-step-n">03</div><div class="intg-step-t">Anchor on Solana</div><div class="intg-step-d">The root is committed in a signed transaction on-chain, where it can't be altered after the fact.</div></div>
		<div class="intg-step"><div class="intg-step-n">04</div><div class="intg-step-t">Verify</div><div class="intg-step-d">Your browser reads that transaction straight from a public RPC and confirms the root matches.</div></div>
	</div>`;
}

function recentBlock(recent, latestEpoch) {
	if (!Array.isArray(recent) || recent.length === 0) return '';
	const rows = recent.map((e) => {
		const sig = e.anchor_sig
			? `<a href="${esc(explorer(e.anchor_sig, e.anchor_network))}" target="_blank" rel="noopener">${esc(short(e.anchor_sig, 6, 6))} ↗</a>`
			: `<span class="intg-pill ${esc(e.anchor_status)}">${esc(e.anchor_status)}</span>`;
		return `<tr>
			<td>#${esc(e.epoch)}${Number(e.epoch) === Number(latestEpoch) ? ' <span class="intg-pill anchored" style="margin-left:4px">latest</span>' : ''}</td>
			<td>${esc(e.wallet_count)}</td>
			<td>${esc(fmtSol(e.total_lamports))}</td>
			<td>${esc(short(e.merkle_root, 6, 6))}</td>
			<td>${sig}</td>
			<td style="font-size:.74rem">${esc(fmtTime(e.created_at))}</td>
		</tr>`;
	}).join('');
	return `<div class="intg-card">
		<h2 class="intg-h2">Attestation history</h2>
		<p class="intg-p">Epochs are monotonic and append-only, so a rollback or replay is detectable. Each root is independently anchored.</p>
		<table class="intg-table">
			<thead><tr><th>Epoch</th><th>Wallets</th><th>Agg. SOL</th><th>Root</th><th>Anchor</th><th>Snapshot</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>
	</div>`;
}

function explorer(sig, network) {
	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return `https://solscan.io/tx/${sig}${cluster}`;
}

main();
