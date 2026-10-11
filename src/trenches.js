// /trenches: live Solana + Robinhood Chain market intelligence from Pulse
// (services/pulse) via /api/trenches. Token names and symbols are untrusted
// on-chain input, so everything is written with textContent.

const POLL_MS = 15000;
const WSOL = 'So11111111111111111111111111111111111111112';
const $ = (id) => document.getElementById(id);
const shell = $('tr-shell');
let timer = null;

const fmt = (n, d = 0) => (n == null || !Number.isFinite(+n) ? '-' : (+n).toLocaleString('en-US', { maximumFractionDigits: d }));
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a || '-');
const ago = (ts) => {
	const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
	return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

function link(href, text) {
	const a = el('a', 'tr-link', text);
	a.href = href;
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	return a;
}

function explorer(chain, kind, id) {
	if (chain === 'solana') return `https://solscan.io/${kind === 'token' ? 'token' : 'account'}/${id}`;
	return `https://explorer.chain.robinhood.com/${kind === 'token' ? 'token' : 'address'}/${id}`;
}

async function get(view, params = {}) {
	const qs = new URLSearchParams({ view, ...params });
	const r = await fetch(`/api/trenches?${qs}`, { headers: { accept: 'application/json' } });
	const body = await r.json().catch(() => ({}));
	if (!r.ok) throw Object.assign(new Error(body.error_description || `HTTP ${r.status}`), { offline: true });
	return body;
}

function counters(ov, health, hotRows) {
	const s = ov.stream || health.stream || {};
	const dl = $('tr-counters');
	dl.replaceChildren();
	const items = [
		['Launches 1h', fmt(s.launches1h), 'new tokens'],
		['Graduations 1h', fmt(s.graduations1h), 'bonding curve to AMM'],
		['Trades 1h', fmt(s.trades1h), 'decoded from the firehose'],
		['Hot volume 1h', `${fmt(hotRows.reduce((a, r) => a + r.vol, 0))} SOL`, 'top tokens, wrapped SOL excluded'],
		['Traders 1h', fmt(s.tradersSeen1h), 'unique wallets'],
		['Tracked tokens', fmt(s.trackedTokens), 'live in memory'],
	];
	for (const [label, value, sub] of items) {
		const d = el('div', 'tr-counter');
		d.append(el('dt', null, label), el('dd', null, value), el('span', 'tr-counter-sub', sub));
		dl.append(d);
	}
}

function emptyRow(tbody, cols, msg) {
	const tr = el('tr');
	const td = el('td', 'tr-empty', msg);
	td.colSpan = cols;
	tr.append(td);
	tbody.replaceChildren(tr);
}

function hot(rows, names) {
	const tb = $('tr-hot');
	if (!rows.length) return emptyRow(tb, 5, 'Waiting for the first trades from the firehose.');
	tb.replaceChildren(
		...rows.slice(0, 15).map((r) => {
			const tr = el('tr');
			const name = names.get(r.mint);
			const t = el('td');
			t.append(link(explorer('solana', 'token', r.mint), name ? `${name.symbol} · ${short(r.mint)}` : short(r.mint)));
			const ratio = r.buys + r.sells ? Math.round((r.buys / (r.buys + r.sells)) * 100) : 0;
			tr.append(t, el('td', 'num', fmt(r.trades)), el('td', 'num', `${ratio}% buys`), el('td', 'num', fmt(r.vol, 1)), el('td', 'num', fmt(r.traders)));
			return tr;
		}),
	);
}

function launches(rows) {
	const ul = $('tr-launches');
	if (!rows.length) {
		ul.replaceChildren(el('li', 'tr-empty', 'No launches recorded yet.'));
		return;
	}
	ul.replaceChildren(
		...rows.slice(0, 20).map((r) => {
			const li = el('li', 'tr-feed-row');
			li.append(el('span', `tr-chip tr-chip--${r.kind}`, r.kind), link(explorer(r.chain, 'token', r.token), `${r.symbol || '?'} ${r.name ? '· ' + r.name : ''}`.slice(0, 48)), el('span', 'tr-meta', `${r.chain} · ${ago(r.ts)}`));
			return li;
		}),
	);
}

function wallets(rows) {
	const tb = $('tr-wallets');
	if (!rows.length) return emptyRow(tb, 6, 'Wallet scores build up as tracked wallets trade. Check back after the first scoring job.');
	tb.replaceChildren(
		...rows.slice(0, 25).map((w) => {
			const tr = el('tr');
			const c = el('td');
			c.append(link(explorer(w.chain, 'address', w.address), w.label || short(w.address)));
			tr.append(c, el('td', null, w.kind || '-'), el('td', 'num', fmt(w.score, 1)), el('td', 'num', w.win_rate == null ? '-' : `${Math.round(w.win_rate * 100)}%`), el('td', 'num', fmt(w.early_hits)), el('td', 'num', w.best_multiple == null ? '-' : `${fmt(w.best_multiple, 1)}x`));
			return tr;
		}),
	);
}

async function refresh() {
	try {
		const [ov, health, la, wa, tk] = await Promise.all([get('overview'), get('health'), get('launches', { limit: 20 }), get('wallets'), get('tokens', { limit: 200, sort: 'new' })]);
		const names = new Map(tk.rows.map((t) => [t.address, t]));
		const hotRows = (ov.hot || []).filter((r) => r.mint !== WSOL);
		counters(ov, health, hotRows);
		hot(hotRows, names);
		launches(la.rows);
		wallets(wa.rows);
		$('tr-offline').hidden = true;
		shell.dataset.state = 'ready';
		$('tr-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
	} catch (e) {
		shell.dataset.state = e.offline ? 'offline' : 'error';
		$('tr-offline').hidden = false;
		$('tr-offline-msg').textContent = e.offline ? `Pulse is not reachable right now (${e.message}). Nothing is shown rather than made-up numbers. Retrying automatically.` : 'Something went wrong loading live data. Retrying automatically.';
	}
}

function schedule() {
	clearTimeout(timer);
	if (!document.hidden) timer = setTimeout(async () => { await refresh(); schedule(); }, POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); } schedule(); });
$('tr-retry').addEventListener('click', refresh);
refresh().then(schedule);
