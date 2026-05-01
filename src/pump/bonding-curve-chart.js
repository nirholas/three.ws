// Pump.fun launch bonding curve chart — plain SVG, no deps.
// price(supply) = supply / (1073000000 - supply) * 30 SOL
// X: 0 to 800M tokens, Y: price in SOL per token (normalized to chart height)

const MAX_SUPPLY = 800_000_000;
const VIRTUAL_TOKENS = 1_073_000_000;
const VIRTUAL_SOL = 30;
const W = 280, H = 120;
const PL = 36, PR = 8, PT = 8, PB = 22;
const PW = W - PL - PR;
const PH = H - PT - PB;
const BOT = PT + PH;

function _price(supply) {
	return supply / (VIRTUAL_TOKENS - supply) * VIRTUAL_SOL;
}

const MAX_PRICE = _price(MAX_SUPPLY);

function _cx(s) { return PL + (s / MAX_SUPPLY) * PW; }
function _cy(p) { return PT + PH * (1 - p / MAX_PRICE); }

const CURVE_PATH = (() => {
	const n = 80;
	let d = '';
	for (let i = 0; i <= n; i++) {
		const s = (i / n) * MAX_SUPPLY;
		const x = _cx(s).toFixed(1);
		const y = _cy(_price(s)).toFixed(1);
		d += `${i === 0 ? 'M' : 'L'}${x},${y} `;
	}
	return d.trimEnd();
})();

const FILL_PATH = `M${PL},${BOT} ${CURVE_PATH.slice(1)} L${(PL + PW).toFixed(1)},${BOT} Z`;

function _fmtSol(v) {
	if (v >= 100) return `${v.toFixed(0)} SOL`;
	if (v >= 1) return `${v.toFixed(2)} SOL`;
	return `${v.toFixed(4)} SOL`;
}

/**
 * Mount the pump.fun bonding curve chart into `el`.
 * Marks launch position at supply = 0 (price = 0).
 *
 * @param {HTMLElement} el
 * @returns {{ destroy: () => void }}
 */
export function mountLaunchBondingCurve(el) {
	const launchX = _cx(0).toFixed(1);
	const gradX = (PL + PW).toFixed(1);

	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
  style="width:100%;height:auto;display:block"
  role="img" aria-label="Bonding curve — price rises as tokens are bought">
  <defs>
    <linearGradient id="lbc-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(120,200,140,0.2)"/>
      <stop offset="100%" stop-color="rgba(120,200,140,0.02)"/>
    </linearGradient>
  </defs>
  <!-- axes -->
  <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${BOT}"
        stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
  <line x1="${PL}" y1="${BOT}" x2="${PL + PW}" y2="${BOT}"
        stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
  <!-- graduation line -->
  <line x1="${gradX}" y1="${PT}" x2="${gradX}" y2="${BOT}"
        stroke="rgba(164,240,188,0.22)" stroke-width="1" stroke-dasharray="3,3"/>
  <!-- area fill -->
  <path d="${FILL_PATH}" fill="url(#lbc-fill)" stroke="none"/>
  <!-- curve -->
  <path d="${CURVE_PATH}" fill="none"
        stroke="rgba(120,200,140,0.85)" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- launch marker -->
  <circle cx="${launchX}" cy="${BOT}" r="4.5"
          fill="rgba(255,215,80,0.9)" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>
  <text x="${parseFloat(launchX) + 7}" y="${BOT - 3}" font-size="8"
        fill="rgba(255,215,80,0.85)" font-family="ui-monospace,monospace">you are here</text>
  <!-- axis labels -->
  <text x="${PL - 2}" y="${BOT + 12}" text-anchor="end" font-size="7"
        fill="rgba(255,255,255,0.3)" font-family="ui-monospace,monospace">0</text>
  <text x="${gradX}" y="${BOT + 12}" text-anchor="end" font-size="7"
        fill="rgba(164,240,188,0.5)" font-family="ui-monospace,monospace">800M</text>
  <text x="${PL - 3}" y="${BOT}" text-anchor="end" font-size="7"
        fill="rgba(255,255,255,0.3)" font-family="ui-monospace,monospace">0</text>
  <text x="${PL - 3}" y="${PT + 7}" text-anchor="end" font-size="7"
        fill="rgba(255,255,255,0.3)" font-family="ui-monospace,monospace">${_fmtSol(MAX_PRICE)}</text>
  <!-- axis titles -->
  <text x="${PL + PW / 2}" y="${H - 2}" text-anchor="middle" font-size="7"
        fill="rgba(255,255,255,0.25)" font-family="ui-monospace,monospace">supply (tokens)</text>
</svg>`;

	return {
		destroy() { el.innerHTML = ''; },
	};
}
