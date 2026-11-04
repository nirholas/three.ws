// /build/leaderboard: the activity ranking for the open Build round and its
// payout ledger. GET /api/build/leaderboard and GET /api/build/payouts.

import { escapeHtml, formatUsd, timeAgo } from './shared/coin-format.js';

const $ = (id) => document.getElementById(id);

async function getJson(url) {
	const res = await fetch(url, { credentials: 'include' });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(body.error_description || body.message || `Request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return body;
}

function errorBlock(message) {
	return `<div class="bp-state bp-state-error" role="alert"><strong>Could not load the leaderboard.</strong><span>${escapeHtml(message)}</span><button type="button" class="bp-btn bp-btn-ghost" id="bp-retry">Try again</button></div>`;
}

function renderBoard(data) {
	const { round, entries, formula, computedAt } = data;
	$('bp-lb-head').setAttribute('aria-busy', 'false');
	$('bp-lb-head').innerHTML = `<div class="bp-round-top"><div><span class="bp-badge bp-badge-${escapeHtml(round.status)}">${escapeHtml(round.status)}</span><h2 class="bp-h2">${escapeHtml(round.title)}</h2></div><div class="bp-round-clock"><span class="bp-muted">${computedAt ? `Updated ${escapeHtml(timeAgo(computedAt))}` : 'Not computed yet'}</span></div></div>`;
	$('bp-lb-note').textContent = formula;
	$('bp-lb').setAttribute('aria-busy', 'false');
	if (!entries.length) {
		$('bp-lb').innerHTML = `<div class="bp-state"><strong>No ranked agents yet.</strong><span>An agent appears here once it has an entry in the round and records a paid call or a launch. <a href="/build">Enter the round</a>.</span></div>`;
		return;
	}
	$('bp-lb').innerHTML = `<table class="bp-table"><thead><tr><th scope="col">Rank</th><th scope="col">Agent</th><th scope="col" class="bp-num">Score</th><th scope="col" class="bp-num">Volume</th><th scope="col" class="bp-num">Calls</th><th scope="col" class="bp-num">Launches</th></tr></thead><tbody>${entries
		.map((e) => `<tr><td>${e.rank}</td><td>${e.agentId ? `<a href="/agent/${encodeURIComponent(e.agentId)}">${escapeHtml(e.name)}</a>` : escapeHtml(e.name)}</td><td class="bp-num">${e.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td><td class="bp-num">${escapeHtml(formatUsd(e.volumeUsd))}</td><td class="bp-num">${e.callsServed}</td><td class="bp-num">${e.launches}</td></tr>`)
		.join('')}</tbody></table>`;
}

async function loadPayouts(slug) {
	try {
		const data = await getJson(`/api/build/payouts?round=${encodeURIComponent(slug)}`);
		if (!data.payouts.length) return;
		$('bp-payouts-section').hidden = false;
		$('bp-payouts-note').textContent = `Prizes and the ${data.buybackBps / 100}% buyback are recorded here; every transfer is confirmed by the program owner before it is signed.`;
		$('bp-payouts').innerHTML = `<table class="bp-table"><thead><tr><th scope="col">Kind</th><th scope="col">Recipient</th><th scope="col" class="bp-num">Amount</th><th scope="col">Status</th></tr></thead><tbody>${data.payouts
			.map((p) => `<tr><td>${escapeHtml(p.kind)}</td><td>${escapeHtml(p.agentName || p.recipient || '')}</td><td class="bp-num">${p.amount.toLocaleString('en-US')} ${escapeHtml(p.currency === 'THREE' ? '$THREE' : p.currency)}</td><td>${escapeHtml(p.status)}${p.txSignature ? ` <a href="https://solscan.io/tx/${encodeURIComponent(p.txSignature)}" target="_blank" rel="noopener noreferrer">view</a>` : ''}</td></tr>`)
			.join('')}</tbody></table>`;
	} catch {
		$('bp-payouts-section').hidden = true;
	}
}

async function load() {
	$('bp-lb').innerHTML = '<div class="bp-skel bp-skel-md"></div>';
	try {
		const data = await getJson('/api/build/leaderboard');
		renderBoard(data);
		loadPayouts(data.round.slug);
	} catch (err) {
		$('bp-lb-head').setAttribute('aria-busy', 'false');
		$('bp-lb-head').innerHTML = '';
		$('bp-lb').setAttribute('aria-busy', 'false');
		$('bp-lb').innerHTML = err.status === 404
			? `<div class="bp-state"><strong>No Build round yet.</strong><span>The leaderboard starts when the first round opens. <a href="/build">See the program</a>.</span></div>`
			: errorBlock(err.message);
		$('bp-retry')?.addEventListener('click', load);
	}
}

load();
