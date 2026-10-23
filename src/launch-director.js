// launch-director.js — turn an agent's screen into a live coin-launch console.
//
// The owner types a launch command in the /agent-screen task bar
// ("launch a coin named … ticker … uri https://…"). This module:
//   1. parses that command into real launch params (pure, testable),
//   2. runs the launch through the REAL endpoints stage by stage, and
//   3. paints a launch-console HUD per stage + narrates each step, pushing both
//      to /api/agent-screen-push so the owner AND every remote viewer watch the
//      same live "go live" moment on the agent's screen.
//
// Nothing here fabricates progress. Each stage is a real operation: read the
// metadata, read the agent's spend ceiling, broadcast via the custodial wallet,
// confirm the on-chain signature, then verify the coin on the /launches feed.
// The success state is rendered ONLY after a real signature returns.
//
// The coin launcher is coin-agnostic runtime plumbing: the mint is supplied at
// runtime from the user's command + the agent wallet. The platform promotes one
// coin only — $THREE. No other mint is ever hardcoded, named, or recommended.

// ── pure logic (no DOM, no network) — covered by tests ──────────────────────

// Endpoint limits mirror launchAgentSchema in api/pump/[action].js. Keep these
// in sync with the server so the HUD rejects what the endpoint would reject,
// instead of round-tripping a doomed request.
import { shortAddress as truncMid } from './shared/address.js';

export const LAUNCH_LIMITS = Object.freeze({ name: 32, symbol: 10, uri: 200 });

// Ordered launch stages. The HUD status rail and the narration both walk this
// list; a viewer who misses a 500ms poll still sees the rail jump ahead because
// each frame carries the cumulative state.
export const LAUNCH_STAGES = Object.freeze([
	{ key: 'prepare', label: 'Prepare' },
	{ key: 'metadata', label: 'Metadata' },
	{ key: 'policy', label: 'Spend policy' },
	{ key: 'broadcast', label: 'Broadcast' },
	{ key: 'confirm', label: 'Confirmed' },
	{ key: 'feed', label: 'Live feed' },
]);

export function stageIndex(key) {
	return LAUNCH_STAGES.findIndex((s) => s.key === key);
}

// Parse a natural-language launch command into launch params. Returns null when
// the text is not a launch command at all (so the caller can fall through to the
// normal task path). Returns a params object — possibly incomplete — when it is;
// validateLaunchParams() then reports what's missing.
export function parseLaunchCommand(input) {
	if (typeof input !== 'string') return null;
	const text = input.trim();
	// Must start with "launch", but never hijack "launchpad …".
	if (!/^launch(?!pad)\b/i.test(text)) return null;
	// Only intercept when it actually reads like a coin launch — otherwise
	// ("launch the research report") fall through to the normal task path.
	const looksLikeLaunch =
		/\b(coin|token|meme(?:coin)?)\b/i.test(text) ||
		/\bhttps?:\/\//i.test(text) ||
		/\b(?:ticker|symbol)\b/i.test(text) ||
		/(?:^|\s)\$[A-Za-z]/.test(text);
	if (!looksLikeLaunch) return null;

	// Metadata URI — first http(s) URL in the command, trailing punctuation trimmed.
	const urlMatch = text.match(/\bhttps?:\/\/\S+/i);
	const uri = urlMatch ? urlMatch[0].replace(/[.,)\]]+$/, '') : null;

	// Network — defaults to mainnet unless devnet is named.
	const network = /\bdevnet\b/i.test(text) ? 'devnet' : 'mainnet';

	// Creator-fee buyback — "buyback 4.2%", "4.2% buyback", or "buyback 420 bps".
	let buyback_bps = 0;
	const bpsM = text.match(/buyback\s+(\d{1,5})\s*bps/i);
	const pctM =
		text.match(/buyback\s+(\d{1,3}(?:\.\d+)?)\s*%/i) ||
		text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*buyback/i);
	if (bpsM) buyback_bps = clampInt(parseInt(bpsM[1], 10), 0, 10_000);
	else if (pctM) buyback_bps = clampInt(Math.round(parseFloat(pctM[1]) * 100), 0, 10_000);

	// Optional SOL dev buy — "dev buy 0.5 sol", "buy-in 0.5 sol", "with 0.5 sol".
	let sol_buy_in = 0;
	const buyM = text.match(/(?:dev\s+buy|buy(?:[-\s]?in)?|with)\s+(\d+(?:\.\d+)?)\s*sol\b/i);
	if (buyM) sol_buy_in = Math.max(0, parseFloat(buyM[1]) || 0);

	// Ticker / symbol — explicit keyword first, then a leading $TICKER token.
	let symbol = null;
	const symKw = text.match(/(?:ticker|symbol)\s+\$?([A-Za-z0-9]{1,10})/i);
	if (symKw) symbol = symKw[1].toUpperCase();
	else {
		const dollar = text.match(/(?:^|\s)\$([A-Za-z][A-Za-z0-9]{0,9})\b/);
		if (dollar) symbol = dollar[1].toUpperCase();
	}

	// Name — quoted wins; else "named/name/called X" up to the next keyword.
	let name = null;
	const quoted = text.match(/["“']([^"”']{1,64})["”']/);
	if (quoted) name = quoted[1].trim();
	if (!name) {
		const nameKw = text.match(
			/(?:named|name|called)\s+(.+?)(?=\s+(?:ticker|symbol|uri|metadata|on\s+(?:dev|main)net|devnet|mainnet|buyback|dev\s+buy|buy(?:[-\s]?in)?\b|with\b|https?:\/\/|\$[A-Za-z])|$)/i,
		);
		if (nameKw) name = nameKw[1].trim().replace(/[.,]+$/, '');
	}

	return { name, symbol, uri, network, buyback_bps, sol_buy_in };
}

// Validate parsed params against the real endpoint limits. Returns
// { ok, errors[] } — errors are holder-readable, one per problem.
export function validateLaunchParams(p) {
	const errors = [];
	if (!p || typeof p !== 'object') return { ok: false, errors: ['Nothing to launch.'] };
	if (!p.name) errors.push('Give the coin a name — try: named "My Coin".');
	else if (p.name.length > LAUNCH_LIMITS.name)
		errors.push(`Name is too long (${p.name.length}/${LAUNCH_LIMITS.name} characters).`);
	if (!p.symbol) errors.push('Add a ticker — try: ticker MYC.');
	else if (p.symbol.length > LAUNCH_LIMITS.symbol)
		errors.push(`Ticker is too long (${p.symbol.length}/${LAUNCH_LIMITS.symbol} characters).`);
	if (!p.uri) errors.push('A launch needs a metadata URI — include uri https://…');
	else if (!/^https?:\/\//i.test(p.uri)) errors.push('Metadata URI must be an http(s) URL.');
	else if (p.uri.length > LAUNCH_LIMITS.uri)
		errors.push(`Metadata URI is too long (${p.uri.length}/${LAUNCH_LIMITS.uri} characters).`);
	if (p.network && p.network !== 'mainnet' && p.network !== 'devnet')
		errors.push('Network must be mainnet or devnet.');
	return { ok: errors.length === 0, errors };
}

// Map a stage + the live launch context to one holder-readable narration line.
// Every value here is real — pulled from the command, the metadata, the spend
// policy, or the endpoint response.
export function narrate(stage, ctx = {}) {
	const sym = ctx.symbol ? `$${ctx.symbol}` : 'the coin';
	const net = ctx.network || 'mainnet';
	switch (stage) {
		case 'prepare':
			return `Preparing launch — ${ctx.name || 'coin'} (${sym}) on ${net}`;
		case 'metadata':
			return ctx.metaHost
				? `Metadata loaded from ${ctx.metaHost}`
				: 'Reading token metadata…';
		case 'policy':
			return ctx.ceilingSol != null
				? `Spend policy OK — ceiling ${formatSol(ctx.ceilingSol)} SOL/tx, dev buy ${formatSol(ctx.solBuyIn || 0)} SOL`
				: 'Checking spend policy…';
		case 'broadcast':
			return `Building mint transaction & broadcasting to ${net}…`;
		case 'confirm':
			return ctx.signature
				? `Live! ${truncMid(ctx.mint)} · sig ${truncMid(ctx.signature)}`
				: 'Confirming on-chain…';
		case 'feed':
			return ctx.onFeed
				? `Surfaced on the launches feed — ${sym} is live for everyone`
				: 'Surfacing to the launches feed…';
		default:
			return '';
	}
}

function clampInt(n, lo, hi) {
	n = Math.round(Number(n) || 0);
	return Math.min(hi, Math.max(lo, n));
}

export function formatSol(n) {
	const v = Number(n) || 0;
	if (v === 0) return '0';
	if (v < 0.001) return v.toExponential(1);
	return String(Math.round(v * 10000) / 10000);
}

// Middle-truncate a Solana address / signature for compact display.
export { truncMid };

// ── HUD rendering (browser only — needs document/canvas/Image) ───────────────

const HUD_W = 1280;
const HUD_H = 720;

// Render the launch-console HUD for one stage and return a PNG data URL.
//   state: { params, stageKey, status: 'active'|'done'|'error', token?, result?, error? }
// token: { imageUrl?, name, symbol }  result: { mint, signature, pumpfunUrl, explorerUrl, onFeed }
export async function renderLaunchHud(state) {
	const canvas = document.createElement('canvas');
	canvas.width = HUD_W;
	canvas.height = HUD_H;
	const ctx = canvas.getContext('2d');
	const p = state.params || {};
	const curIdx = stageIndex(state.stageKey);
	const errored = state.status === 'error';

	// Background — deep navy with a soft top glow.
	ctx.fillStyle = '#0a0d1a';
	ctx.fillRect(0, 0, HUD_W, HUD_H);
	const glow = ctx.createRadialGradient(HUD_W / 2, -120, 60, HUD_W / 2, -120, 720);
	glow.addColorStop(0, errored ? 'rgba(255,90,90,0.16)' : 'rgba(110,130,255,0.18)');
	glow.addColorStop(1, 'rgba(10,13,26,0)');
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, HUD_W, HUD_H);

	// Header.
	ctx.fillStyle = errored ? '#ff6b6b' : '#8fa2ff';
	ctx.font = '700 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText('● LAUNCH DIRECTOR', 56, 72);
	drawBadge(ctx, (p.network || 'mainnet').toUpperCase(), HUD_W - 56, 72);

	// Token card (left).
	const cardX = 56;
	const cardY = 132;
	const cardW = 540;
	const cardH = 500;
	roundRect(ctx, cardX, cardY, cardW, cardH, 22);
	ctx.fillStyle = 'rgba(255,255,255,0.04)';
	ctx.fill();
	ctx.strokeStyle = 'rgba(255,255,255,0.08)';
	ctx.lineWidth = 1.5;
	ctx.stroke();

	const artSize = 300;
	const artX = cardX + (cardW - artSize) / 2;
	const artY = cardY + 40;
	const img = await loadImageSafe(state.token?.imageUrl);
	roundRect(ctx, artX, artY, artSize, artSize, 18);
	ctx.save();
	ctx.clip();
	if (img) {
		const s = Math.max(artSize / img.width, artSize / img.height);
		const dw = img.width * s;
		const dh = img.height * s;
		ctx.drawImage(img, artX + (artSize - dw) / 2, artY + (artSize - dh) / 2, dw, dh);
	} else {
		// Generated monogram — a real, deterministic fallback (never fake art).
		const g = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
		g.addColorStop(0, '#3a4a8f');
		g.addColorStop(1, '#6e57c8');
		ctx.fillStyle = g;
		ctx.fillRect(artX, artY, artSize, artSize);
		ctx.fillStyle = 'rgba(255,255,255,0.92)';
		ctx.font = '700 132px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText((p.symbol || p.name || '?').slice(0, 3).toUpperCase(), artX + artSize / 2, artY + artSize / 2 + 4);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
	}
	ctx.restore();

	// Name + ticker.
	ctx.textAlign = 'center';
	ctx.fillStyle = '#f4f5fb';
	ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif';
	ctx.fillText(clip(ctx, p.name || 'Untitled', cardW - 60), cardX + cardW / 2, artY + artSize + 70);
	ctx.fillStyle = '#9aa6d8';
	ctx.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
	ctx.fillText(p.symbol ? `$${p.symbol}` : '—', cardX + cardW / 2, artY + artSize + 108);
	if (p.buyback_bps) {
		ctx.fillStyle = '#7fd6a8';
		ctx.font = '600 18px ui-sans-serif, system-ui, sans-serif';
		ctx.fillText(`creator-fee buyback ${(p.buyback_bps / 100).toFixed(p.buyback_bps % 100 ? 1 : 0)}%`, cardX + cardW / 2, artY + artSize + 140);
	}
	ctx.textAlign = 'left';

	// Status rail (right).
	const railX = 660;
	let railY = 168;
	const rowH = 64;
	LAUNCH_STAGES.forEach((s, i) => {
		const done = !errored && i < curIdx;
		const active = i === curIdx;
		const isErr = errored && i === curIdx;
		// Marker.
		ctx.beginPath();
		ctx.arc(railX + 14, railY - 8, 12, 0, Math.PI * 2);
		if (done) {
			ctx.fillStyle = '#7fd6a8';
			ctx.fill();
		} else if (isErr) {
			ctx.fillStyle = '#ff6b6b';
			ctx.fill();
		} else if (active) {
			ctx.fillStyle = '#8fa2ff';
			ctx.fill();
		} else {
			ctx.strokeStyle = 'rgba(255,255,255,0.22)';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
		// Connector.
		if (i < LAUNCH_STAGES.length - 1) {
			ctx.strokeStyle = done ? 'rgba(127,214,168,0.5)' : 'rgba(255,255,255,0.12)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(railX + 14, railY + 6);
			ctx.lineTo(railX + 14, railY + rowH - 22);
			ctx.stroke();
		}
		// Mark glyph.
		if (done) {
			ctx.strokeStyle = '#0a0d1a';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(railX + 9, railY - 8);
			ctx.lineTo(railX + 13, railY - 4);
			ctx.lineTo(railX + 19, railY - 13);
			ctx.stroke();
		}
		// Label.
		ctx.fillStyle = active || isErr ? '#f4f5fb' : done ? '#c8d0f0' : 'rgba(255,255,255,0.4)';
		ctx.font = `${active || isErr ? '700' : '500'} 22px ui-sans-serif, system-ui, sans-serif`;
		ctx.fillText(s.label, railX + 44, railY);
		railY += rowH;
	});

	// Narration / result block — sits in the open right column UNDER the status
	// rail, clear of the token card on the left.
	const infoX = railX;
	const infoW = HUD_W - railX - 56;
	let infoY = railY + 28;
	ctx.fillStyle = errored ? '#ff8e8e' : '#aeb8e6';
	ctx.font = '500 22px ui-sans-serif, system-ui, sans-serif';
	const line = errored ? state.error || 'Launch failed' : state.narration || '';
	for (const wrapped of wrapText(ctx, line, infoW).slice(0, 2)) {
		ctx.fillText(wrapped, infoX, infoY);
		infoY += 30;
	}

	if (state.result?.signature) {
		infoY += 8;
		ctx.fillStyle = '#7f8bbf';
		ctx.font = '500 18px ui-monospace, Menlo, monospace';
		ctx.fillText(`mint ${truncMid(state.result.mint, 6, 6)}`, infoX, infoY);
		ctx.fillText(`pump.fun/coin/${truncMid(state.result.mint, 6, 6)}`, infoX, infoY + 30);
		ctx.fillText(`solscan.io/tx/${truncMid(state.result.signature, 6, 6)}`, infoX, infoY + 60);
	}

	// JPEG, not PNG: the screen-push API caps a frame at ~800 KB of base64, and a
	// 1280×720 PNG with an embedded cover image blows past that and gets truncated
	// into a corrupt frame. JPEG at 0.85 keeps the same HUD well under the cap.
	return canvas.toDataURL('image/jpeg', 0.85);
}

function drawBadge(ctx, text, rightX, baselineY) {
	ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
	const w = ctx.measureText(text).width + 28;
	const x = rightX - w;
	const y = baselineY - 22;
	roundRect(ctx, x, y, w, 30, 15);
	ctx.fillStyle = 'rgba(143,162,255,0.16)';
	ctx.fill();
	ctx.fillStyle = '#aeb8e6';
	ctx.fillText(text, x + 14, baselineY - 2);
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function clip(ctx, text, maxW) {
	if (ctx.measureText(text).width <= maxW) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
	return `${t}…`;
}

// Greedy word-wrap into lines no wider than maxW.
function wrapText(ctx, text, maxW) {
	const words = String(text || '').split(/\s+/).filter(Boolean);
	const lines = [];
	let line = '';
	for (const w of words) {
		const candidate = line ? `${line} ${w}` : w;
		if (ctx.measureText(candidate).width > maxW && line) {
			lines.push(line);
			line = w;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	return lines.length ? lines : [''];
}

// Load an image without tainting the canvas. crossOrigin='anonymous' keeps
// toDataURL() working when the host serves CORS (IPFS/Arweave gateways do);
// otherwise we resolve null and the HUD draws its monogram fallback.
function loadImageSafe(url) {
	return new Promise((resolve) => {
		if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return resolve(null);
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
		// Don't hang the launch on a slow gateway.
		setTimeout(() => resolve(null), 6000);
	});
}
