// Sentiment Scout on /coin-intel: the "Scout" tab (the live board) and the
// Scout section inside a coin's detail drawer.
//
// Data: GET /api/pump/sentiment-scout (api/pump/sentiment-scout.js). The board
// loads in two passes so it is never held hostage by the LLM chain: first the
// evidence (fast, deterministic), then the same board with the Scout's written
// read per candidate, patched into the cards that are already on screen.
//
// Honesty on the page mirrors the API: every evidence line shows its source
// link, the time the fact was true, and (for social or paid claims) the
// on-chain facts it was checked against. Sources that could not be read are
// named, never filled in.

import { shortAddress as short } from './shared/address.js';

const API = '/api/pump/sentiment-scout';
const REFRESH_MS = 60_000;
// Notes already written for a coin survive the next refresh, so a card does
// not lose its summary (and shift under the reader) every minute.
const noteCache = new Map();

function withCachedNote(c) {
	if (c.note) {
		noteCache.set(c.mint, { note: c.note, note_model: c.note_model });
		return c;
	}
	const hit = noteCache.get(c.mint);
	return hit ? { ...c, ...hit } : c;
}

const TYPE_META = {
	volume_spike: { label: 'Volume', tone: 'chain' },
	fresh_buyers: { label: 'Buyers', tone: 'chain' },
	smart_money: { label: 'Smart money', tone: 'chain' },
	graduation_approach: { label: 'Curve', tone: 'chain' },
	social_mention: { label: 'Social', tone: 'social' },
	paid_signal: { label: 'Paid read', tone: 'paid' },
	news_match: { label: 'News', tone: 'social' },
};

const PART_LABEL = {
	volume: 'Volume',
	buyers: 'Buyers',
	buy_pressure: 'Buy pressure',
	smart_money: 'Smart money',
	curve: 'Curve',
	social: 'Social',
	risk_penalty: 'Risk',
};

const UNAVAILABLE_LABEL = {
	callouts: 'pump.fun callouts',
	x_posts: 'X posts',
	bonding_curve: 'live bonding curve',
	paid_signals: 'paid market reads',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgSrc = (uri, seed) => {
	if (!uri) return `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(seed || 'x')}`;
	if (uri.startsWith('data:') || uri.startsWith('/')) return uri;
	return `/api/img?url=${encodeURIComponent(uri)}&seed=${encodeURIComponent(seed || 'x')}`;
};

function fmtCount(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
	return String(Math.round(v));
}

function ago(iso) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const d = Date.now() - t;
	if (d < 45_000) return 'just now';
	const m = d / 60_000;
	if (m < 60) return `${Math.round(m)}m ago`;
	const h = m / 60;
	if (h < 24) return `${Math.round(h)}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

function timeTag(iso) {
	if (!iso) return '';
	const abs = new Date(iso).toUTCString().replace(' GMT', ' UTC');
	return `<time datetime="${esc(iso)}" title="${esc(abs)}">${esc(ago(iso))}</time>`;
}

function srcLink(href, label = 'Source') {
	if (!href || !/^https?:\/\//.test(href)) return '';
	return `<a class="sc-src" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span aria-hidden="true"> ↗</span><span class="sc-sr"> (opens in a new tab)</span></a>`;
}

function scoreTone(score) {
	if (score >= 70) return 'hi';
	if (score >= 50) return 'mid';
	return 'lo';
}

function scoreBlock(c) {
	const parts = Object.entries(c.score_parts || {})
		.filter(([, v]) => v != null)
		.map(([k, v]) => `<li><span>${esc(PART_LABEL[k] || k)}</span><b class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${esc(v)}</b></li>`)
		.join('');
	return `<div class="sc-score sc-score-${scoreTone(c.momentum_score)}">
		<span class="sc-score-n">${esc(c.momentum_score)}</span><span class="sc-score-t">/100 momentum</span>
		${parts ? `<details class="sc-why"><summary>Why ${esc(c.momentum_score)}?</summary><ul>${parts}</ul></details>` : ''}
	</div>`;
}

function evidenceItem(e) {
	const meta = TYPE_META[e.type] || { label: String(e.type || '').replace(/_/g, ' '), tone: 'chain' };
	const label = `${meta.label}${e.platform ? ` · ${e.platform}` : ''}`;
	const linkLabel = e.platform === 'x' ? 'Post' : e.type === 'paid_signal' ? 'Payment tx' : 'Source';
	return `<li class="sc-ev">
		<span class="sc-type sc-type-${meta.tone}">${esc(label)}</span>
		<div class="sc-ev-body">
			<p class="sc-ev-detail">${esc(e.detail)}</p>
			<p class="sc-meta">${timeTag(e.at)}${e.at && e.source ? '<span aria-hidden="true"> · </span>' : ''}${srcLink(e.source, linkLabel)}</p>
			${e.checked_against ? `<p class="sc-check"><span class="sc-check-k">Checked against</span> ${esc(e.checked_against)}</p>` : ''}
		</div>
	</li>`;
}

function postsBlock(c) {
	if (!c.posts?.length) return '';
	const items = c.posts.map((p) => `<li class="sc-post">
		<p class="sc-post-head"><b>${p.author ? `@${esc(p.author)}` : 'An account'}</b>${p.followers != null ? ` <span>${esc(fmtCount(p.followers))} followers</span>` : ''}${p.verified ? ' <span class="sc-verified">verified</span>' : ''} <span aria-hidden="true">·</span> ${timeTag(p.at)}</p>
		<p class="sc-post-text">${esc(p.text)}</p>
		<p class="sc-meta">${esc(p.likes)} likes · ${esc(p.reposts)} reposts · ${srcLink(p.url, 'Open post')}</p>
	</li>`).join('');
	const x = c.x;
	const head = x ? `${esc(x.posts)} post${x.posts === 1 ? '' : 's'} on X quoted this exact contract address, from ${esc(x.authors)} account${x.authors === 1 ? '' : 's'}` : 'Posts quoting this contract';
	return `<div class="sc-posts"><h4>${head}</h4><ul>${items}</ul></div>`;
}

function unavailableLine(c) {
	const list = (c.unavailable || []).map((k) => UNAVAILABLE_LABEL[k] || k);
	if (!list.length) return '';
	return `<p class="sc-unavail" title="Left out, never estimated">Not readable this time: ${esc(list.join(', '))}</p>`;
}

function noteBlock(c) {
	if (!c.note) return '';
	return `<p class="sc-note"><span class="sc-note-k">Scout's read</span> ${esc(c.note)}<span class="sc-note-by">Written${c.note_model ? ` by ${esc(c.note_model)}` : ''} from the evidence below, and checked so it adds no number or name the evidence does not hold.</span></p>`;
}

function candidateCard(c, { compact = false } = {}) {
	const name = c.name || c.ticker || short(c.mint);
	const id = `sc-${c.mint.slice(0, 10)}`;
	return `<article class="sc-card${compact ? ' sc-compact' : ''}" data-mint="${esc(c.mint)}" aria-labelledby="${id}">
		<header class="sc-head">
			${compact ? '' : `<img class="sc-avatar" src="${esc(imgSrc(c.image_uri, c.mint))}" alt="" loading="lazy" referrerpolicy="no-referrer" />`}
			<div class="sc-id">
				${compact ? '' : `<h3 class="sc-name" id="${id}">${esc(name)}</h3>`}
				<div class="sc-sub">
					${c.ticker ? `<span class="sc-sym">${esc(c.ticker)}</span>` : ''}
					<button type="button" class="sc-copy" data-copy="${esc(c.mint)}" aria-label="Copy mint address ${esc(c.mint)}">${esc(short(c.mint))}<span aria-hidden="true"> ⧉</span></button>
					${c.first_seen_at ? `<span class="sc-age">launched ${timeTag(new Date(c.first_seen_at).toISOString())}</span>` : ''}
				</div>
			</div>
			${scoreBlock(c)}
		</header>
		<div class="sc-note-slot">${noteBlock(c)}</div>
		<ol class="sc-evidence" aria-label="Evidence, each line with its source">${(c.evidence || []).map(evidenceItem).join('')}</ol>
		${postsBlock(c)}
		<p class="sc-caution"><strong>Main risk</strong> ${esc(c.caution)}</p>
		<footer class="sc-foot">
			${unavailableLine(c)}
			<div class="sc-actions">
				${compact ? '' : `<button type="button" class="sc-btn sc-btn-primary" data-open="${esc(c.mint)}">Full intel</button>`}
				<a class="sc-btn" href="/oracle/coin/${encodeURIComponent(c.mint)}">Oracle</a>
				<a class="sc-btn" href="${esc(c.links?.pump || `https://pump.fun/coin/${encodeURIComponent(c.mint)}`)}" target="_blank" rel="noopener noreferrer">pump.fun<span aria-hidden="true"> ↗</span></a>
			</div>
		</footer>
	</article>`;
}

function trackBlock(t) {
	if (!t) {
		return `<p class="sc-track-empty">The Scout's track record could not be read right now. Every call it makes is recorded and graded against the coin's real outcome once one is labeled.</p>`;
	}
	if (!t.labeled) {
		return `<p class="sc-track-empty"><b>Graded, not claimed.</b> ${t.scouted ? `The Scout has flagged ${esc(t.scouted)} coin${t.scouted === 1 ? '' : 's'} in the last ${esc(t.days)} days;` : 'No flags recorded yet;'} none has an outcome label yet. Coins are labeled about an hour after launch, then this shows how its calls did against every launch the engine watched.</p>`;
	}
	const pct = (r) => (r == null ? 'n/a' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
	const lift = t.lift != null ? `<span class="sc-lift ${t.lift >= 1 ? 'up' : 'down'}">${esc(t.lift)}× the base rate</span>` : '';
	const bands = t.bands.filter((b) => b.labeled).map((b) => {
		const lbl = b.band === '70_plus' ? 'Scored 70+' : b.band === '50_69' ? 'Scored 50 to 69' : 'Under 50';
		return `<li><span>${lbl}</span><b>${pct(b.good_rate)}</b><small>${esc(b.good)} of ${esc(b.labeled)}</small></li>`;
	}).join('');
	return `<div class="sc-track-body">
		<p><b>Graded, not claimed.</b> Of the ${esc(t.labeled)} coins the Scout flagged in the last ${esc(t.days)} days that now have an outcome, <b>${pct(t.good_rate)}</b> graduated or pumped, against <b>${pct(t.base_rate)}</b> for all ${esc(t.base_labeled)} labeled launches over the same days. ${lift}</p>
		${bands ? `<ul class="sc-bands">${bands}</ul>` : ''}
		<p class="sc-track-foot">${esc(t.rugged)} of the flagged coins rugged. Past calls do not predict the next one.</p>
	</div>`;
}

function skeletonCards(n = 3) {
	return Array.from({ length: n }, () => `<div class="sc-card sc-skel" aria-hidden="true">
		<span class="sc-sh" style="width:45%"></span><span class="sc-sh" style="width:92%"></span>
		<span class="sc-sh" style="width:80%"></span><span class="sc-sh" style="width:86%"></span><span class="sc-sh" style="width:60%"></span>
	</div>`).join('');
}

async function getJson(params) {
	const u = new URL(API, location.origin);
	for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
	const r = await fetch(u, { headers: { accept: 'application/json' } });
	if (!r.ok) {
		let msg = `HTTP ${r.status}`;
		try { msg = (await r.json()).error_description || msg; } catch { /* body was not JSON */ }
		throw new Error(msg);
	}
	return r.json();
}

function wireCopy(root, announce) {
	root.addEventListener('click', async (e) => {
		const btn = e.target.closest('.sc-copy');
		if (!btn) return;
		try {
			await navigator.clipboard.writeText(btn.dataset.copy);
			btn.classList.add('is-copied');
			announce('Mint address copied');
			setTimeout(() => btn.classList.remove('is-copied'), 1400);
		} catch {
			announce('Copy failed: select the address and copy it by hand');
		}
	});
}

/**
 * Mount the Scout board.
 * @param {HTMLElement} root  the #view-scout section
 * @param {{ onOpenCoin: (mint: string) => void, onCount?: (n: number) => void }} opts
 */
export function mountScoutBoard(root, { onOpenCoin, onCount = () => {} }) {
	root.innerHTML = `
		<div class="sc-intro">
			<p class="sc-lede">Momentum you can check. The Scout ranks the last hour of pump.fun launches, then backs every claim with its receipt: the post or read it came from, when it was true, and what the chain showed at that moment. It never trades, and it names the main risk on every coin.</p>
			<div class="sc-controls">
				<label class="sc-field">Window
					<select class="ci-select" id="sc-window" aria-label="Launch window to rank against">
						<option value="30">30 min</option>
						<option value="60" selected>1 hour</option>
						<option value="120">2 hours</option>
						<option value="240">4 hours</option>
					</select>
				</label>
				<button type="button" class="sc-btn" id="sc-refresh">Refresh</button>
				<span class="sc-updated" id="sc-updated"></span>
			</div>
		</div>
		<section class="sc-track" id="sc-track" aria-label="Scout track record"></section>
		<div class="sc-list" id="sc-list" aria-live="polite" aria-busy="true"></div>
		<p class="sc-sr" id="sc-announce" role="status" aria-live="polite"></p>`;

	const list = root.querySelector('#sc-list');
	const trackEl = root.querySelector('#sc-track');
	const updated = root.querySelector('#sc-updated');
	const winSel = root.querySelector('#sc-window');
	const announceEl = root.querySelector('#sc-announce');
	const announce = (msg) => { announceEl.textContent = msg; };
	let active = false;
	let seq = 0;
	let timer = null;

	wireCopy(root, announce);
	list.addEventListener('click', (e) => {
		const open = e.target.closest('[data-open]');
		if (open) onOpenCoin(open.dataset.open);
	});

	function renderEmpty(data) {
		list.innerHTML = `<div class="ci-empty">
			<div class="icon" aria-hidden="true">🛰️</div>
			<h3>Nothing clears the bar right now</h3>
			<p>${esc(data.reason || 'No launch in this window has momentum the Scout can back with evidence.')}</p>
			<p>An empty board is an honest answer, not an outage. Widen the window, or check the Radar tab for everything the engine is watching.</p>
			<button type="button" class="ci-retry" id="sc-widen">Try the 4 hour window</button>
		</div>`;
		list.querySelector('#sc-widen').addEventListener('click', () => { winSel.value = '240'; load(); });
	}

	function renderError(msg) {
		list.innerHTML = `<div class="ci-empty">
			<div class="icon" aria-hidden="true">⚠️</div>
			<h3>The Scout could not load</h3>
			<p>${esc(msg)}. The evidence comes from live reads, so a hiccup upstream shows here first.</p>
			<button type="button" class="ci-retry" id="sc-retry">Try again</button>
		</div>`;
		list.querySelector('#sc-retry').addEventListener('click', load);
	}

	function patchNotes(candidates) {
		for (const c of candidates) {
			if (!c.note) continue;
			withCachedNote(c);
			const slot = list.querySelector(`.sc-card[data-mint="${CSS.escape(c.mint)}"] .sc-note-slot`);
			if (slot && !slot.firstElementChild) {
				slot.innerHTML = noteBlock(c);
				slot.firstElementChild?.classList.add('is-new');
			}
		}
	}

	async function load() {
		const my = ++seq;
		const win = winSel.value;
		list.setAttribute('aria-busy', 'true');
		if (!list.querySelector('.sc-card:not(.sc-skel)')) list.innerHTML = skeletonCards();
		if (!trackEl.innerHTML) trackEl.innerHTML = '<span class="sc-sh" style="width:70%"></span>';
		try {
			const data = await getJson({ window: win, notes: 0, track: 1, limit: 6 });
			if (my !== seq) return;
			trackEl.innerHTML = trackBlock(data.track_record);
			onCount(data.candidates.length);
			updated.innerHTML = `Updated ${timeTag(data.generated_at)} · ${esc(data.observed)} launches ranked`;
			if (!data.candidates.length) renderEmpty(data);
			else list.innerHTML = data.candidates.map((c) => candidateCard(withCachedNote(c))).join('');
			list.setAttribute('aria-busy', 'false');
			// Second pass: the same board with the Scout's written read.
			getJson({ window: win, limit: 6 })
				.then((withNotes) => { if (my === seq) patchNotes(withNotes.candidates); })
				.catch(() => { /* the evidence is already on screen; a missing summary is fine */ });
		} catch (err) {
			if (my !== seq) return;
			list.setAttribute('aria-busy', 'false');
			renderError(err.message || 'Network error');
		}
	}

	winSel.addEventListener('change', load);
	root.querySelector('#sc-refresh').addEventListener('click', load);
	document.addEventListener('visibilitychange', () => { if (active && !document.hidden) load(); });

	return {
		setActive(on) {
			active = on;
			clearInterval(timer);
			if (on) {
				load();
				timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
			}
		},
		load,
	};
}

/**
 * The Scout's read of one coin, as a drawer section. Resolves to null when the
 * coin was never observed (the drawer already says so) or the read failed.
 */
export async function scoutDrawerSection(mint) {
	let data;
	try {
		data = await getJson({ mint, notes: 0 });
	} catch {
		return null;
	}
	const c = data.candidates?.[0];
	if (!data.found || !c) return null;
	const sec = document.createElement('div');
	sec.className = 'd-section sc-drawer';
	const status = c.scouted
		? `On the Scout board since ${timeTag(c.scouted.first_at)} (first score ${esc(c.scouted.first_score)}, peak ${esc(c.scouted.peak_score)}).`
		: c.qualifies
			? 'Clears the Scout\'s screen, but has not appeared on the board yet.'
			: 'Not on the Scout board: it did not clear the screen (top-quartile early buying, 3+ buyers, no bundle or dev dump). Its evidence is still shown.';
	sec.innerHTML = `<h4>Sentiment Scout</h4><p class="sc-drawer-status">${status}</p>${candidateCard(c, { compact: true })}`;
	wireCopy(sec, () => {});
	// The written read follows when the LLM chain answers; the evidence never waits for it.
	getJson({ mint })
		.then((d) => {
			const n = d.candidates?.[0];
			const slot = sec.querySelector('.sc-note-slot');
			if (n?.note && slot && !slot.firstElementChild) {
				slot.innerHTML = noteBlock(n);
				slot.firstElementChild?.classList.add('is-new');
			}
		})
		.catch(() => { /* evidence is already shown */ });
	return sec;
}

/** Styles for the board and the drawer section, scoped to .sc-* classes. */
export const SCOUT_CSS = `
.sc-intro{display:flex;flex-wrap:wrap;gap:14px 24px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}
.sc-lede{margin:0;color:var(--ci-muted);font-size:13.5px;line-height:1.55;max-width:680px}
.sc-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sc-field{display:inline-flex;gap:8px;align-items:center;font-size:12px;color:var(--ci-faint)}
.sc-updated{font-size:11.5px;color:var(--ci-faint)}
.sc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sc-btn{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;padding:7px 12px;border-radius:8px;border:1px solid var(--ci-border);
	background:rgba(255,255,255,.05);color:var(--ci-text);text-decoration:none;cursor:pointer;
	transition:background var(--duration-fast),border-color var(--duration-fast),transform var(--duration-fast)}
.sc-btn:hover{background:rgba(255,255,255,.12);border-color:var(--ci-border-strong)}
.sc-btn:active{transform:translateY(1px)}
.sc-btn:focus-visible,.sc-copy:focus-visible,.sc-src:focus-visible,.sc-why summary:focus-visible{outline:2px solid var(--ci-accent);outline-offset:2px}
.sc-btn-primary{background:var(--ci-accent);border-color:var(--ci-accent);color:#fff}
.sc-btn-primary:hover{background:#7c4ded;border-color:#7c4ded}
.sc-track{background:var(--ci-panel);border:1px solid var(--ci-border);border-radius:14px;padding:14px 16px;margin-bottom:16px;min-height:22px}
.sc-track p{margin:0;font-size:13px;line-height:1.55;color:var(--ci-muted)}
.sc-track b{color:var(--ci-text)}
.sc-track-empty{font-size:13px}
.sc-lift{display:inline-block;margin-left:4px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
.sc-lift.up{color:var(--ci-success);background:rgba(52,211,153,.13)}
.sc-lift.down{color:var(--ci-danger);background:rgba(248,113,113,.13)}
.sc-bands{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.sc-bands li{display:flex;align-items:baseline;gap:8px;background:var(--ci-panel-2);border:1px solid var(--ci-border);border-radius:9px;padding:6px 10px;font-size:12px;color:var(--ci-muted)}
.sc-bands b{font-family:var(--font-mono,monospace)}
.sc-bands small{color:var(--ci-faint)}
.sc-track-foot{margin-top:8px!important;font-size:11.5px!important;color:var(--ci-faint)!important}
.sc-list{display:grid;gap:14px}
.sc-card{background:var(--ci-panel);border:1px solid var(--ci-border);border-radius:14px;padding:16px;min-width:0;
	animation:ciFadeIn .35s ease both;transition:border-color var(--duration-fast)}
.sc-card:hover{border-color:var(--ci-border-strong)}
.sc-compact{padding:12px;background:var(--ci-panel-2)}
.sc-head{display:flex;gap:12px;align-items:flex-start}
.sc-avatar{width:46px;height:46px;border-radius:11px;object-fit:cover;background:#15171f;border:1px solid var(--ci-border);flex-shrink:0}
.sc-id{flex:1;min-width:0}
.sc-name{margin:0;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-sub{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;font-size:11.5px;color:var(--ci-faint)}
.sc-sym{font-family:var(--font-mono,monospace);color:var(--ci-neutral)}
.sc-copy{font:inherit;font-family:var(--font-mono,monospace);font-size:11px;color:var(--ci-muted);background:var(--ci-panel-2);border:1px solid var(--ci-border);
	border-radius:6px;padding:2px 7px;cursor:pointer;transition:color var(--duration-fast),border-color var(--duration-fast)}
.sc-copy:hover{color:var(--ci-text);border-color:var(--ci-border-strong)}
.sc-copy.is-copied{color:var(--ci-success);border-color:rgba(52,211,153,.5)}
.sc-score{text-align:right;flex-shrink:0;min-width:92px}
.sc-score-n{font-family:var(--font-mono,monospace);font-size:26px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.sc-score-t{display:block;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ci-faint);margin-top:3px}
.sc-score-hi .sc-score-n{color:var(--ci-success)} .sc-score-mid .sc-score-n{color:var(--ci-warn)} .sc-score-lo .sc-score-n{color:var(--ci-muted)}
.sc-why{margin-top:6px;font-size:11px;color:var(--ci-muted)}
.sc-why summary{cursor:pointer;list-style:none;color:var(--ci-neutral)}
.sc-why summary::-webkit-details-marker{display:none}
.sc-why ul{list-style:none;margin:6px 0 0;padding:8px 10px;background:var(--ci-panel-2);border:1px solid var(--ci-border);border-radius:8px;text-align:left;min-width:150px}
.sc-why li{display:flex;justify-content:space-between;gap:12px;padding:1px 0}
.sc-why b{font-family:var(--font-mono,monospace);color:var(--ci-text)} .sc-why b.neg{color:var(--ci-danger)}
.sc-note-slot:empty{display:none}
.sc-note{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.22);font-size:13.5px;line-height:1.55;color:var(--ci-text)}
.sc-note.is-new{animation:ciFadeIn .35s ease both}
.sc-note-k{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c4b5fd;margin-bottom:3px}
.sc-note-by{display:block;font-size:11px;color:var(--ci-faint);margin-top:5px}
.sc-evidence{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:10px}
.sc-ev{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:start}
.sc-type{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 7px;border-radius:6px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-type-chain{color:#a5b4fc;background:rgba(129,140,248,.12)}
.sc-type-social{color:#67e8f9;background:rgba(34,211,238,.12)}
.sc-type-paid{color:#fcd34d;background:rgba(251,191,36,.12)}
.sc-ev-body{min-width:0}
.sc-ev-detail{margin:0;font-size:13px;line-height:1.5;color:var(--ci-text);overflow-wrap:anywhere}
.sc-meta{margin:3px 0 0;font-size:11.5px;color:var(--ci-faint)}
.sc-src{color:var(--ci-neutral);text-decoration:none;border-bottom:1px dotted currentColor;transition:color var(--duration-fast)}
.sc-src:hover{color:#c7d2fe}
.sc-check{margin:4px 0 0;font-size:11.5px;color:var(--ci-muted);padding-left:8px;border-left:2px solid var(--ci-border-strong)}
.sc-check-k{font-weight:600;color:var(--ci-faint);margin-right:2px}
.sc-posts{margin-top:14px;border-top:1px solid var(--ci-border);padding-top:12px}
.sc-posts h4{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ci-faint)}
.sc-posts ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.sc-post{background:var(--ci-panel-2);border:1px solid var(--ci-border);border-radius:10px;padding:9px 11px}
.sc-post-head{margin:0;font-size:12px;color:var(--ci-faint)} .sc-post-head b{color:var(--ci-text)}
.sc-verified{color:#67e8f9}
.sc-post-text{margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--ci-muted);overflow-wrap:anywhere}
.sc-caution{margin:14px 0 0;padding:9px 12px;border-radius:10px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.22);font-size:12.5px;line-height:1.5;color:var(--ci-text)}
.sc-caution strong{color:var(--ci-warn);margin-right:4px;font-size:11px;letter-spacing:.05em;text-transform:uppercase}
.sc-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-top:12px}
.sc-unavail{margin:0;font-size:11px;color:var(--ci-faint)}
.sc-actions{display:flex;gap:7px;flex-wrap:wrap;margin-left:auto}
.sc-drawer-status{margin:0 0 10px;font-size:12.5px;line-height:1.5;color:var(--ci-muted)}
.sc-skel{height:220px}
.sc-sh{display:block;height:12px;border-radius:6px;margin-bottom:12px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.09),rgba(255,255,255,.04));background-size:200% 100%;animation:ciShimmer 1.4s infinite}
@media (max-width:560px){
	.sc-ev{grid-template-columns:1fr;gap:4px}
	.sc-type{justify-self:start}
	.sc-head{flex-wrap:wrap}
	.sc-score{text-align:left;min-width:0;width:100%;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
	.sc-score-t{display:inline;margin:0}
	.sc-why{width:100%}
	.sc-actions{margin-left:0}
}
@media (prefers-reduced-motion:reduce){.sc-card,.sc-note.is-new,.sc-sh{animation:none}}
`;
