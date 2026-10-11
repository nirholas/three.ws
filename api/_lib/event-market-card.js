// Pure rendering for the Event Market share surfaces: the 1200x630 SVG card and the
// plain-language copy that the crawlable share page repeats. Takes a market view
// (api/_lib/event-markets/view.js shape) so the picture, the page and the API agree.

const FONT = 'Inter,system-ui,sans-serif';
const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const OTHER = '#8a8a85';
const STATUS_COLOR = { open: '#34d399', locked: '#fbbf24', resolved: '#a78bfa', void: '#94a3b8' };
const STATUS_WORD = { open: 'OPEN', locked: 'LOCKED', resolved: 'RESOLVED', void: 'VOID' };

export function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function trunc(s, n) {
	const v = String(s ?? '');
	return v.length <= n ? v : `${v.slice(0, n - 1)}…`;
}

/** Shrink the headline as the question lengthens so it never overflows the card. */
export function titleSize(text) {
	const len = String(text || '').length;
	if (len <= 28) return 54;
	if (len <= 44) return 44;
	if (len <= 64) return 36;
	return 30;
}

/** Split a long title over at most two lines at word boundaries. */
export function wrapTitle(text, perLine) {
	const words = String(text || '').split(/\s+/).filter(Boolean);
	const lines = [];
	let cur = '';
	for (const w of words) {
		if (cur && `${cur} ${w}`.length > perLine) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
		if (lines.length === 2) break;
	}
	if (lines.length < 2 && cur) lines.push(cur);
	if (lines.length === 2 && words.join(' ').length > lines.join(' ').length + 1) lines[1] = trunc(lines[1], perLine);
	return lines.slice(0, 2).map((l) => trunc(l, perLine));
}

export function pctLabel(p) {
	const n = Number(p);
	if (!Number.isFinite(n)) return '0%';
	return n >= 10 || Number.isInteger(n) ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;
}

/** "2d 4h", "3h 12m", "45m": how long is left, or null once picks are closed. */
export function timeLeft(view, now = Date.now()) {
	if (view.status !== 'open') return null;
	const ms = Math.max(0, Date.parse(view.locks_at) - now);
	const m = Math.floor(ms / 60000);
	const hrs = Math.floor(m / 60);
	if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
	if (hrs >= 1) return `${hrs}h ${m % 60}m`;
	return `${Math.max(1, m)}m`;
}

export function timeLine(view, now = Date.now()) {
	const left = timeLeft(view, now);
	if (left) return `Picks lock in ${left}`;
	if (view.status === 'locked') return 'Picks are locked. Waiting on the result.';
	if (view.status === 'resolved') return view.winner ? `${view.winner.label} won` : 'Resolved';
	return 'Market voided';
}

/** Outcomes with their stable slot color (position in the market, not rank), best odds first. */
export function rankedEntrants(view) {
	const slot = new Map(view.outcomes.map((o, i) => [o.id, i]));
	return [...view.outcomes]
		.sort((a, b) => b.percent - a.percent || a.position - b.position)
		.map((o) => ({ ...o, color: slot.get(o.id) < SLOTS.length ? SLOTS[slot.get(o.id)] : OTHER }));
}

export function shareDescription(view, { pickId = null, now = Date.now() } = {}) {
	const ranked = rankedEntrants(view);
	const picked = pickId ? ranked.find((o) => o.id === pickId) : null;
	const lead = ranked[0];
	const parts = [];
	if (picked) parts.push(`A friend picked ${picked.label} to win. Do you agree?`);
	if (view.status === 'resolved' && view.winner) parts.push(`${view.winner.label} won.`);
	else if (lead) parts.push(view.odds?.even_prior ? `${ranked.length} entrants, even odds until the crowd weighs in.` : `${lead.label} leads at ${pctLabel(lead.percent)}.`);
	parts.push(timeLine(view, now) + '.');
	parts.push('Free-to-play points on three.ws Event Markets.');
	return parts.join(' ');
}

function entrantRow(o, i, y, { highlight }) {
	const barW = 520;
	const w = Math.max(6, Math.round((barW * o.percent) / 100));
	return `<g>
		<rect x="72" y="${y}" width="1056" height="58" rx="12" fill="#0e1015" stroke="${highlight ? o.color : '#1f2937'}" stroke-width="${highlight ? 2 : 1}"/>
		<rect x="72" y="${y}" width="6" height="58" rx="3" fill="${o.color}"/>
		<text x="100" y="${y + 37}" font-family="${FONT}" font-size="24" font-weight="700" fill="#f9fafb">${esc(trunc(o.label, 26))}</text>
		<rect x="520" y="${y + 24}" width="${barW}" height="10" rx="5" fill="#1f2937"/>
		<rect x="520" y="${y + 24}" width="${w}" height="10" rx="5" fill="${o.color}"/>
		<text x="1104" y="${y + 39}" font-family="${FONT}" font-size="28" font-weight="800" fill="#f9fafb" text-anchor="end">${esc(pctLabel(o.percent))}</text>
	</g>`;
}

/**
 * @param {object} view  market view
 * @param {{ pickId?: string|null, now?: number }} [opts]
 */
export function cardSvg(view, { pickId = null, now = Date.now() } = {}) {
	const ranked = rankedEntrants(view);
	const picked = pickId ? ranked.find((o) => o.id === pickId) : null;
	const color = STATUS_COLOR[view.status] || STATUS_COLOR.open;
	const headline = picked && view.status === 'open' ? `Pick ${picked.label} to win` : view.title;
	const size = titleSize(headline);
	const lines = wrapTitle(headline, Math.floor(1056 / (size * 0.52)));
	const shown = ranked.slice(0, 3);
	if (picked && !shown.some((o) => o.id === picked.id)) shown[2] = picked;
	const more = ranked.length - shown.length;
	const baseY = 100 + size;
	const titleSvg = lines.map((l, i) => `<text x="72" y="${baseY + i * (size + 8)}" font-family="${FONT}" font-size="${size}" font-weight="900" fill="#f9fafb">${esc(l)}</text>`).join('\n\t');
	const listTop = Math.max(300, baseY + (lines.length - 1) * (size + 8) + 52);
	const rowH = 66;
	const rows = shown.length
		? shown.map((o, i) => entrantRow(o, i, listTop + i * rowH, { highlight: picked ? o.id === picked.id : view.winner?.outcome_id === o.id })).join('\n\t')
		: `<text x="72" y="${listTop + 30}" font-family="${FONT}" font-size="22" fill="#6b7280">No entrants yet.</text>`;
	const note = view.odds?.even_prior && view.status === 'open' ? 'Even odds until the crowd weighs in' : `${view.pick_count} ${view.pick_count === 1 ? 'pick' : 'picks'}${more > 0 ? ` · ${more} more ${more === 1 ? 'entrant' : 'entrants'}` : ''}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(trunc(view.title, 120))}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f0f13"/><stop offset="1" stop-color="#08080b"/></linearGradient>
		<radialGradient id="glow" cx="0.8" cy="0.15" r="0.7"><stop offset="0" stop-color="${color}" stop-opacity=".14"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
	</defs>
	<rect width="1200" height="630" fill="url(#bg)"/>
	<rect width="1200" height="630" fill="url(#glow)"/>
	<rect x="0" y="0" width="6" height="630" fill="${color}" opacity=".75"/>
	<text x="72" y="62" font-family="${FONT}" font-size="13" font-weight="700" letter-spacing=".14em" fill="#6b7280">THREE.WS &#183; EVENT MARKETS</text>
	<text x="1128" y="62" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing=".1em" fill="${color}" text-anchor="end">${esc(STATUS_WORD[view.status] || 'OPEN')}</text>
	<line x1="72" y1="80" x2="1128" y2="80" stroke="#1f2937" stroke-width="1"/>
	${titleSvg}
	${rows}
	<rect x="0" y="566" width="1200" height="64" fill="#050507"/>
	<text x="72" y="605" font-family="${FONT}" font-size="16" font-weight="600" fill="#9ca3af">${esc(timeLine(view, now))}</text>
	<text x="600" y="605" font-family="${FONT}" font-size="14" fill="#4b5563" text-anchor="middle">${esc(note)}</text>
	<text x="1128" y="605" font-family="${FONT}" font-size="14" font-weight="600" fill="#6b7280" text-anchor="end">three.ws/event-markets</text>
</svg>`;
}

/** Branded card for an unknown or unreadable market: an unfurl must never 404. */
export function fallbackSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Event Markets">
	<rect width="1200" height="630" fill="#0b0b0f"/>
	<rect x="0" y="0" width="6" height="630" fill="#34d399" opacity=".7"/>
	<text x="72" y="62" font-family="${FONT}" font-size="13" font-weight="700" letter-spacing=".14em" fill="#6b7280">THREE.WS &#183; EVENT MARKETS</text>
	<text x="72" y="316" font-family="${FONT}" font-size="62" font-weight="900" fill="#f9fafb">Event Markets</text>
	<text x="72" y="366" font-family="${FONT}" font-size="22" fill="#6b7280">Call the winner of every three.ws event. Free-to-play points.</text>
	<text x="1128" y="605" font-family="${FONT}" font-size="14" font-weight="600" fill="#6b7280" text-anchor="end">three.ws/event-markets</text>
</svg>`;
}
