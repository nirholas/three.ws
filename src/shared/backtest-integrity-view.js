// Renders the backtest integrity report (look-ahead audit + dataset manifest)
// returned by POST /api/sniper/backtest. Shared by the wallet hub Strategy tab
// and the strategy settings panel so both show the same verdict.

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BOX = 'margin-top:12px;padding:10px 12px;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:8px;font-size:.78rem;line-height:1.55;';
const TAG = (color, text) => `<b style="color:${color}">${text}</b>`;

/**
 * @param {object} r  A backtest response.
 * @returns {string}  HTML, or '' when the response carries no integrity data and
 *                    is not an old snapshot (nothing truthful to say).
 */
export function renderIntegrity(r) {
	if (!r || typeof r !== 'object') return '';
	const i = r.integrity || {};
	const la = i.lookahead;
	const m = i.manifest;
	const rows = [];

	if (la) {
		if (la.ok) {
			rows.push(`${TAG('var(--ok,#4ade80)', 'Look-ahead audit passed.')} ${la.checked} of ${la.total} entry decisions were replayed with every later launch removed and none changed.`);
		} else {
			const idx = (la.offending || []).slice(0, 8).join(', ');
			const priors = la.priors_causal === false ? ' Creator history counters moved backwards in time.' : '';
			rows.push(`${TAG('var(--err,#f87171)', 'Look-ahead audit failed.')} ${(la.offending || []).length ? `Decision${la.offending.length === 1 ? '' : 's'} at index ${esc(idx)}${la.offending_truncated ? ' and more' : ''} changed when future data was removed.` : ''}${priors} Do not trust these numbers.`);
		}
	}

	if (m && r.reproducible !== false) {
		rows.push(`${TAG('var(--ok,#4ade80)', 'Reproducible.')} Dataset <code>${esc(m.id)}</code>, ${Number(m.row_count).toLocaleString()} rows, ${esc((m.range?.from || '').slice(0, 10))} to ${esc((m.range?.to || '').slice(0, 10))}, hash <code title="${esc(m.content_hash)}">${esc(String(m.content_hash).slice(0, 12))}</code>.`);
	} else if (r.reproducible === false) {
		rows.push(`${TAG('var(--warn,#fbbf24)', 'Unreproducible.')} ${esc(i.unreproducible_reason || 'No dataset manifest was recorded for this run.')} Run the backtest again to get a pinned result.`);
	}

	return rows.length ? `<div class="bt-integrity" role="note" style="${BOX}">${rows.map((x) => `<div>${x}</div>`).join('')}</div>` : '';
}
