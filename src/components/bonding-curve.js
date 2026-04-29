// Bonding-curve SVG component — no deps, no canvas.
// mountBondingCurve(rootEl, { progressPct, marketCapUsd, graduationCapUsd })
// Returns { update, destroy }.

const W = 300, H = 90;
const PL = 10, PR = 10, PT = 8, PB = 20;
const PW = W - PL - PR;
const PH = H - PT - PB;
const BOT = PT + PH;

let _seq = 0;

// Square-root bonding curve: price ∝ sqrt(tokens_sold_fraction).
function _cx(t) { return PL + t * PW; }
function _cy(t) { return PT + PH * (1 - Math.sqrt(Math.max(0, t))); }

const CURVE_PATH = (() => {
	const n = 64;
	let d = '';
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		d += `${i === 0 ? 'M' : 'L'}${_cx(t).toFixed(2)},${_cy(t).toFixed(2)} `;
	}
	return d.trimEnd();
})();

// Full fill shape (curve top + bottom baseline) — clipped per progress.
const FILL_PATH = (() => {
	const n = 64;
	let d = `M${PL.toFixed(2)},${BOT.toFixed(2)} `;
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		d += `L${_cx(t).toFixed(2)},${_cy(t).toFixed(2)} `;
	}
	d += `L${(W - PR).toFixed(2)},${BOT.toFixed(2)} Z`;
	return d;
})();

function _fmt(usd) {
	if (!usd) return '';
	if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
	if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}k`;
	return `$${usd.toFixed(0)}`;
}

/**
 * Mount a bonding-curve SVG into rootEl.
 * @param {HTMLElement} rootEl
 * @param {{ progressPct?: number, marketCapUsd?: number, graduationCapUsd?: number }} opts
 * @returns {{ update: (opts: { progressPct?: number, marketCapUsd?: number }) => void, destroy: () => void }}
 */
export function mountBondingCurve(rootEl, {
	progressPct = 0,
	marketCapUsd = 0,
	graduationCapUsd = 69_000,
} = {}) {
	const id = ++_seq;
	const gradId = `bc-g${id}`;
	const clipId = `bc-c${id}`;

	const t0 = Math.max(0, Math.min(1, progressPct / 100));
	const mx0 = _cx(t0);
	const my0 = _cy(t0);
	const capText = marketCapUsd ? _fmt(marketCapUsd) : `${progressPct.toFixed(1)}%`;

	rootEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
  style="width:100%;height:auto;display:block"
  aria-label="Bonding curve ${progressPct.toFixed(0)}% to graduation">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(106,147,255,0.28)"/>
      <stop offset="100%" stop-color="rgba(106,147,255,0.02)"/>
    </linearGradient>
    <clipPath id="${clipId}">
      <rect class="bc-clip" x="0" y="0" width="${mx0.toFixed(2)}" height="${H}"/>
    </clipPath>
  </defs>
  <line x1="${PL}" y1="${BOT}" x2="${W - PR}" y2="${BOT}"
        stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
  <path d="${FILL_PATH}" fill="url(#${gradId})" stroke="none"
        clip-path="url(#${clipId})"/>
  <path d="${CURVE_PATH}" fill="none"
        stroke="rgba(255,255,255,0.13)" stroke-width="1.5" stroke-linecap="round"/>
  <path d="${CURVE_PATH}" fill="none"
        stroke="rgba(106,147,255,0.85)" stroke-width="2" stroke-linecap="round"
        clip-path="url(#${clipId})"/>
  <line x1="${(W - PR).toFixed(2)}" y1="${PT}"
        x2="${(W - PR).toFixed(2)}" y2="${BOT}"
        stroke="rgba(164,240,188,0.3)" stroke-width="1" stroke-dasharray="3 3"/>
  <g class="bc-marker"
     style="transform:translate(${mx0.toFixed(2)}px,0);transition:transform 0.2s ease">
    <line x1="0" y1="${PT}" x2="0" y2="${BOT}"
          stroke="rgba(255,255,255,0.38)" stroke-width="1" stroke-dasharray="2 2"/>
    <circle cx="0" cy="${my0.toFixed(2)}" r="4"
            fill="#6a93ff" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>
  </g>
  <text x="${PL}" y="${H - 5}" font-size="9"
        fill="rgba(255,255,255,0.45)" font-family="ui-monospace,monospace"
        class="bc-cap">${capText}</text>
  <text x="${W - PR}" y="${H - 5}" text-anchor="end" font-size="9"
        fill="rgba(164,240,188,0.55)"
        font-family="ui-monospace,monospace">${_fmt(graduationCapUsd) || '$69k'}</text>
</svg>`;

	const svg = rootEl.querySelector('svg');
	const marker = svg.querySelector('.bc-marker');
	const clip = svg.querySelector('.bc-clip');
	const capLabel = svg.querySelector('.bc-cap');
	const circle = marker.querySelector('circle');

	let _pct = progressPct;
	let _cap = marketCapUsd;

	function update({ progressPct: newPct, marketCapUsd: newCap } = {}) {
		if (newPct !== undefined) _pct = newPct;
		if (newCap !== undefined) _cap = newCap;

		const t = Math.max(0, Math.min(1, _pct / 100));
		const mx = _cx(t);
		const my = _cy(t);

		marker.style.transform = `translate(${mx.toFixed(2)}px, 0)`;
		circle.setAttribute('cy', my.toFixed(2));
		if (clip) clip.setAttribute('width', mx.toFixed(2));
		if (capLabel) capLabel.textContent = _cap ? _fmt(_cap) : `${_pct.toFixed(1)}%`;
	}

	function destroy() {
		rootEl.innerHTML = '';
	}

	return { update, destroy };
}
