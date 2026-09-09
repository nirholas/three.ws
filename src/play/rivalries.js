// rivalries.js: the grudge-match strip under the arena leaderboard.
//
// A leaderboard says who is ahead. This strip says what changed: who passed
// whom since the board looked different, who is closing, and who just arrived.
// It reads /api/sniper/rivalries, which derives every matchup from the same
// position ledger the board above it is ranked from, so the two can never
// disagree. Every number rendered here came back from that endpoint; nothing on
// this page computes a standing of its own.
//
// The strip is supplementary, so it never takes space it has not earned: while
// it loads it shows one skeleton row, with nothing to say it says so in one
// line, and a failed fetch degrades to a single amber line with a retry rather
// than an empty box or a hole where a section used to be.

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const KIND_LABEL = { overtake: 'Passed', debut: 'Debut', chase: 'Chasing' };

/** Two stacked avatars, or the initial when a trader has no image. */
function facePair(a, b) {
	const face = (t, cls) => (t.image
		? `<img class="rv-face ${cls}" src="${esc(t.image)}" alt="" loading="lazy" decoding="async" />`
		: `<span class="rv-face rv-face-fb ${cls}" aria-hidden="true">${esc((t.name || '?').slice(0, 1).toUpperCase())}</span>`);
	return `<span class="rv-faces">${face(a, 'rv-a')}${face(b, 'rv-b')}</span>`;
}

function rowHtml(r) {
	const kind = KIND_LABEL[r.kind] || 'Chasing';
	const shared = r.shared_coins && r.shared_coins.length ? r.shared_coins[0] : null;
	const sharedLine = shared && shared.symbol
		? `<span class="rv-shared">Both traded ${esc(shared.symbol)}: ${shared.leader_pnl_sol >= 0 ? '+' : ''}${shared.leader_pnl_sol.toFixed(2)} vs ${shared.chaser_pnl_sol >= 0 ? '+' : ''}${shared.chaser_pnl_sol.toFixed(2)} SOL</span>`
		: '';
	return `
		<div class="rv-row">
			${facePair(r.leader, r.chaser)}
			<div class="rv-body">
				<div class="rv-l1"><span class="rv-kind ${esc(r.kind)}">${esc(kind)}</span><b>${esc(r.headline)}</b></div>
				<div class="rv-l2">${esc(r.subline)}</div>
				${sharedLine}
				<div class="rv-cta">
					<a href="${esc(r.links.leader_profile)}">${esc(r.leader.name)}'s record</a>
					<a href="${esc(r.links.ghost_copy_leader)}">Ghost-copy</a>
				</div>
			</div>
		</div>`;
}

/**
 * Mount the strip into `el` and keep it fresh.
 *
 * Returns a handle with `refresh()` and `stop()` so the arena can tie the strip's
 * polling to the page's own lifecycle instead of leaving a timer running behind a
 * hidden tab.
 */
export function mountRivalries(el, { network = 'mainnet', window: win = '7d', lookback = '24h', limit = 2, intervalMs = 90_000 } = {}) {
	if (!el) return { refresh: () => {}, stop: () => {} };
	let timer = null;
	let stopped = false;
	let painted = false;

	const shell = (inner) => { el.innerHTML = inner; el.hidden = false; };

	const skeleton = () => shell(`
		<div class="rv-head">Grudge matches <i>vs the board ${esc(lookback)} ago</i></div>
		<div class="rv-row rv-skel" role="status" aria-label="Loading rivalries"><i class="rv-sk-face"></i><i class="rv-sk-l1"></i><i class="rv-sk-l2"></i></div>`);

	const emptyState = (boardSize, minClosed) => shell(`
		<div class="rv-head">Grudge matches</div>
		<div class="rv-note">${boardSize > 0
			? `One trader has a settled record on this board. A rivalry needs two, each with at least ${Number(minClosed) || 3} closed round-trips.`
			: `No trader has cleared ${Number(minClosed) || 3} closed round-trips on this board yet. The first one to do it starts the rivalry.`}</div>`);

	const errorState = () => {
		if (painted) return; // keep the last good matchups on screen
		shell(`
			<div class="rv-head">Grudge matches</div>
			<div class="rv-note rv-err"><b>Can't reach the rivalry feed.</b> <button type="button" class="rv-retry">Retry</button></div>`);
		const btn = el.querySelector('.rv-retry');
		if (btn) btn.addEventListener('click', () => { skeleton(); load(); });
	};

	async function load() {
		if (stopped) return;
		try {
			const q = new URLSearchParams({ network, window: win, lookback, limit: String(limit) });
			const res = await fetch(`/api/sniper/rivalries?${q}`, { headers: { accept: 'application/json' } });
			if (!res.ok) throw new Error(`http ${res.status}`);
			const data = await res.json();
			if (stopped) return;
			const list = Array.isArray(data.rivalries) ? data.rivalries : [];
			if (!list.length) { painted = false; emptyState(data.board_size, data.min_closed); return; }
			shell(`
				<div class="rv-head">Grudge matches <i>vs the board ${esc(data.lookback)} ago</i></div>
				${list.map(rowHtml).join('')}`);
			painted = true;
		} catch {
			errorState();
		}
	}

	skeleton();
	load();
	if (intervalMs > 0) timer = setInterval(load, intervalMs);

	return {
		refresh: load,
		stop() { stopped = true; if (timer) clearInterval(timer); timer = null; },
	};
}
