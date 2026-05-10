// GET /api/x402-pay/og?tx=<signature>
// Dynamic 1200×630 PNG card for /pay/calls/<tx> permalinks. When pasted into
// X / Slack / Discord / iMessage, the link expands to a branded summary of the
// paid x402 call (tool, amount, payer, timestamp).

import sharp from 'sharp';
import { Redis } from '@upstash/redis';
import { env } from '../_lib/env.js';

const FALLBACK_TITLE = 'three.ws · pay-per-call (x402)';
const FALLBACK_SUB = 'Live demo — agent pays $0.001 USDC per MCP tool call.';

let _redis = null;
function redis() {
	if (_redis !== null) return _redis;
	if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
		_redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
	} else _redis = false;
	return _redis;
}

async function readCall(tx) {
	const r = redis();
	if (!r) return null;
	try {
		const row = await r.get(`x402:pay:call:${tx}`);
		if (typeof row === 'string') { try { return JSON.parse(row); } catch {} }
		else if (row && typeof row === 'object') return row;
	} catch {}
	return null;
}

function escapeSvg(s) {
	return String(s).replace(/[<>&"]/g, (c) => ({
		'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
	}[c]));
}

function shortTx(tx) {
	if (!tx) return '—';
	return `${tx.slice(0, 10)}…${tx.slice(-6)}`;
}

function shortAddr(a) {
	if (!a) return '—';
	return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relativeAgo(ts) {
	if (!ts) return '';
	const d = Math.max(0, Date.now() - ts);
	if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
	if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
	if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
	return `${Math.floor(d / 86_400_000)}d ago`;
}

function svgFor(record, txParam) {
	const tool = record?.tool || 'paid call';
	const args = record?.argsSummary || '';
	const tx = record?.tx || txParam || '';
	const payer = record?.payer || '';
	const amount = ((Number(record?.amount || 1000)) / 1e6).toFixed(6);
	const ago = relativeAgo(record?.ts);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0b10"/>
      <stop offset="1" stop-color="#14161f"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.18" cy="0.18" r="0.55">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.85" cy="0.92" r="0.5">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="logoG" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <!-- top brand row -->
  <g transform="translate(72 72)">
    <rect x="0" y="0" width="44" height="44" rx="11" fill="url(#logoG)"/>
    <text x="60" y="22" font-family="-apple-system, system-ui, Inter, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#e6e8f0" letter-spacing="-0.2">three.ws</text>
    <text x="60" y="42" font-family="ui-monospace, Menlo, monospace" font-size="14" fill="#8a90a8">pay-per-call · x402</text>
  </g>

  <!-- settled badge -->
  <g transform="translate(972 80)">
    <rect x="0" y="0" width="156" height="40" rx="20" fill="#22c55e" fill-opacity="0.14" stroke="#22c55e" stroke-opacity="0.6" stroke-width="1"/>
    <circle cx="22" cy="20" r="5" fill="#22c55e"/>
    <text x="38" y="25" font-family="ui-monospace, Menlo, monospace" font-size="13" fill="#22c55e" letter-spacing="1.3">SETTLED ON-CHAIN</text>
  </g>

  <!-- main title block -->
  <g transform="translate(72 200)">
    <rect x="0" y="-36" width="6" height="56" fill="url(#accent)" rx="3"/>
    <text x="22" y="0" font-family="ui-monospace, Menlo, monospace" font-size="46" font-weight="700" fill="#e6e8f0">${escapeSvg(tool)}</text>
    ${args ? `<text x="22" y="36" font-family="-apple-system, system-ui, Inter, Helvetica, Arial, sans-serif" font-size="22" fill="#8a90a8">${escapeSvg(args.slice(0, 80))}</text>` : ''}
  </g>

  <!-- stat strip -->
  <g transform="translate(72 320)" font-family="ui-monospace, Menlo, monospace">
    <g>
      <text x="0" y="0" font-size="13" fill="#8a90a8" letter-spacing="1.6">AMOUNT</text>
      <text x="0" y="30" font-size="28" fill="#e6e8f0" font-weight="600">${amount} USDC</text>
    </g>
    <g transform="translate(280 0)">
      <text x="0" y="0" font-size="13" fill="#8a90a8" letter-spacing="1.6">NETWORK</text>
      <text x="0" y="30" font-size="28" fill="#e6e8f0" font-weight="600">Solana mainnet</text>
    </g>
    <g transform="translate(660 0)">
      <text x="0" y="0" font-size="13" fill="#8a90a8" letter-spacing="1.6">PAYER</text>
      <text x="0" y="30" font-size="28" fill="#e6e8f0" font-weight="600">${escapeSvg(shortAddr(payer))}</text>
    </g>
    ${ago ? `<g transform="translate(900 0)">
      <text x="0" y="0" font-size="13" fill="#8a90a8" letter-spacing="1.6">WHEN</text>
      <text x="0" y="30" font-size="28" fill="#e6e8f0" font-weight="600">${escapeSvg(ago)}</text>
    </g>` : ''}
  </g>

  <!-- tx hash -->
  <g transform="translate(72 430)" font-family="ui-monospace, Menlo, monospace">
    <text x="0" y="0" font-size="13" fill="#8a90a8" letter-spacing="1.6">TX</text>
    <text x="0" y="30" font-size="22" fill="#22d3ee">${escapeSvg(shortTx(tx))}</text>
  </g>

  <!-- footer -->
  <g transform="translate(72 540)" font-family="-apple-system, system-ui, Inter, Helvetica, Arial, sans-serif">
    <text x="0" y="0" font-size="22" fill="#e6e8f0" font-weight="500">No keys. No signup. $0.001 per call, settled per request.</text>
    <text x="0" y="34" font-size="18" fill="#8a90a8">three.ws/pay  →  try it yourself</text>
  </g>
</svg>`;
}

function fallbackSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0b10"/><stop offset="1" stop-color="#14161f"/></linearGradient>
    <linearGradient id="logoG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g transform="translate(120 240)">
    <rect x="0" y="0" width="60" height="60" rx="14" fill="url(#logoG)"/>
    <text x="80" y="40" font-family="-apple-system, system-ui, sans-serif" font-size="46" font-weight="700" fill="#e6e8f0">${escapeSvg(FALLBACK_TITLE)}</text>
    <text x="80" y="78" font-family="-apple-system, system-ui, sans-serif" font-size="22" fill="#8a90a8">${escapeSvg(FALLBACK_SUB)}</text>
  </g>
  <text x="120" y="540" font-family="-apple-system, system-ui, sans-serif" font-size="20" fill="#22d3ee">three.ws/pay</text>
</svg>`;
}

export default async function handler(req, res) {
	res.setHeader('access-control-allow-origin', '*');
	if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
	if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }

	const url = new URL(req.url, `http://${req.headers.host || 'three.ws'}`);
	const tx = url.searchParams.get('tx') || '';

	let record = null;
	if (tx && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx)) {
		record = await readCall(tx);
	}
	const svg = record ? svgFor(record, tx) : fallbackSvg();

	try {
		const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
		res.statusCode = 200;
		res.setHeader('content-type', 'image/png');
		res.setHeader('cache-control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
		return res.end(png);
	} catch (err) {
		// Graceful fallback to SVG if sharp can't render (some envs).
		res.statusCode = 200;
		res.setHeader('content-type', 'image/svg+xml');
		res.setHeader('cache-control', 'public, max-age=300');
		return res.end(svg);
	}
}
