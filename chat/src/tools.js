export const curatedToolPacks = [
	{
		id: 'tradingview',
		name: 'TradingView Charts',
		description: 'Display interactive TradingView price charts for any symbol.',
		schema: [
			{
				clientDefinition: {
					id: 'tradingview-chart-001',
					name: 'TradingViewChart',
					description: 'Displays an interactive TradingView chart for a given symbol.',
					arguments: [
						{ name: 'symbol', type: 'string', description: 'Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL' },
						{ name: 'interval', type: 'string', description: 'Chart interval: 1, 5, 15, 30, 60, D, W, M' },
						{ name: 'theme', type: 'string', description: 'light or dark' },
					],
					body: `const symbol = args.symbol || 'BINANCE:BTCUSDT';
const interval = args.interval || 'D';
const theme = args.theme || 'light';
const html = \`<!DOCTYPE html>
<html>
<head><style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style></head>
<body>
<div id="tv_chart" style="width:100%;height:100vh"></div>
<script src="https://s3.tradingview.com/tv.js"><\\/script>
<script>
new TradingView.widget({
  container_id:"tv_chart",
  symbol:\${JSON.stringify(symbol)},
  interval:\${JSON.stringify(interval)},
  theme:\${JSON.stringify(theme)},
  style:"1",
  width:"100%",
  height:"100%",
  toolbar_bg:"#f1f3f6",
  hide_side_toolbar:false,
  allow_symbol_change:true
});
<\\/script>
</body></html>\`;
return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'TradingViewChart',
					description: 'Display an interactive TradingView chart. Use for any request to show a price chart, candlestick chart, or market data visualization.',
					parameters: {
						type: 'object',
						properties: {
							symbol: { type: 'string', description: 'Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL, FX:EURUSD' },
							interval: { type: 'string', enum: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], description: 'Chart interval' },
							theme: { type: 'string', enum: ['light', 'dark'], description: 'Chart theme' },
						},
						required: ['symbol'],
					},
				},
			},
		],
	},
	{
		id: 'price-chart-3d',
		name: '3D Price Chart',
		description: 'Render an extruded 3D price chart for any crypto asset over a chosen window.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-price-chart-3d-001',
					name: 'PriceChart3D',
					description: 'Show a rotating 3D bar chart of price history for a crypto asset.',
					arguments: [
						{ name: 'id', type: 'string', description: 'CoinGecko id (e.g. bitcoin) or ticker (e.g. BTC).' },
						{ name: 'days', type: 'number', description: 'Window size in days (1, 7, 14, 30, 90, 180, 365, max).' },
					],
					body: `const raw = String(args.id || '').trim().toLowerCase();
if (!raw) throw new Error('id required');
const days = String(args.days || 30);
let id = raw;
if (raw.length <= 6 && !raw.includes('-')) {
  const s = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(raw));
  if (!s.ok) throw new Error('CoinGecko search failed: ' + s.status);
  const sj = await s.json();
  const hit = (sj.coins || []).find(c => c.symbol?.toLowerCase() === raw) || (sj.coins || [])[0];
  if (!hit?.id) throw new Error('No CoinGecko match for "' + raw + '"');
  id = hit.id;
}
const html = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0d10;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
#hud{position:absolute;left:12px;top:10px;font-size:13px;line-height:1.45}
#err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#fca5a5;padding:24px;text-align:center}
</style></head><body>
<div id="hud">Loading…</div><div id="err"></div>
<script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
const ID = \${JSON.stringify(id)}, DAYS = \${JSON.stringify(days)};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x0b0d10);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); });
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 1000); cam.position.set(0, 18, 28);
const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.target.set(0, 4, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(10, 20, 10); scene.add(key);
function err(m){ document.getElementById('err').style.display='flex'; document.getElementById('err').textContent=m; }
async function load(){
  const r = await fetch('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(ID) + '/market_chart?vs_currency=usd&days=' + encodeURIComponent(DAYS));
  if (!r.ok) return err('CoinGecko market_chart failed: ' + r.status);
  const j = await r.json();
  const prices = j.prices || [];
  if (!prices.length) return err('No price data');
  const N = prices.length, vals = prices.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals), range = Math.max(1e-9, max - min);
  const width = 30, gap = width / N, barW = gap * 0.85;
  const group = new THREE.Group();
  for (let i = 0; i < N; i++) {
    const h = ((vals[i] - min) / range) * 14 + 0.05;
    const g = new THREE.BoxGeometry(barW, h, barW);
    const t = i / (N - 1);
    const col = new THREE.Color().setHSL(0.58 - 0.55 * t, 0.7, 0.55);
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.2 });
    const cube = new THREE.Mesh(g, m);
    cube.position.set(-width/2 + i * gap + gap/2, h/2, 0);
    group.add(cube);
  }
  scene.add(group);
  const last = vals[vals.length - 1], first = vals[0];
  const chg = ((last - first) / first) * 100;
  document.getElementById('hud').innerHTML =
    '<b>' + ID.toUpperCase() + '</b> · ' + DAYS + 'd<br>' +
    'Last $' + last.toLocaleString(undefined,{maximumFractionDigits:6}) + '<br>' +
    'Δ ' + chg.toFixed(2) + '% over window';
}
function tick(){ ctl.update(); renderer.render(scene, cam); requestAnimationFrame(tick); }
tick(); load();
</script></body></html>\`;
return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'PriceChart3D',
					description: 'Render an interactive 3D bar chart of crypto price history. Use whenever the user asks for a 3D chart, historical price visualization, or sparkline of a coin.',
					parameters: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'CoinGecko id (e.g. ethereum) or ticker (e.g. ETH).' },
							days: { type: 'number', enum: [1, 7, 14, 30, 90, 180, 365], description: 'Window in days.' },
						},
						required: ['id'],
					},
				},
			},
		],
	},
	{
		id: 'token-price',
		name: 'Token Price',
		description: 'Look up real-time crypto prices and 24h change via CoinGecko.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-token-price-001',
					name: 'TokenPrice',
					description: 'Returns current USD price, 24h change %, and market cap for a crypto asset.',
					arguments: [
						{ name: 'id', type: 'string', description: 'CoinGecko id (e.g. bitcoin, ethereum, solana) OR a ticker symbol like BTC, ETH, SOL.' },
					],
					body: `const raw = String(args.id || '').trim().toLowerCase();
if (!raw) throw new Error('id required');
let id = raw;
if (raw.length <= 6 && !raw.includes('-')) {
  const s = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(raw));
  if (!s.ok) throw new Error('CoinGecko search failed: ' + s.status);
  const sj = await s.json();
  const hit = (sj.coins || []).find(c => c.symbol?.toLowerCase() === raw) || (sj.coins || [])[0];
  if (hit?.id) id = hit.id;
}
const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + encodeURIComponent(id));
if (!r.ok) throw new Error('CoinGecko markets failed: ' + r.status);
const arr = await r.json();
if (!arr.length) throw new Error('No CoinGecko match for "' + raw + '"');
const c = arr[0];
return {
  id: c.id,
  symbol: c.symbol,
  name: c.name,
  price_usd: c.current_price,
  change_24h_pct: c.price_change_percentage_24h,
  market_cap_usd: c.market_cap,
  volume_24h_usd: c.total_volume,
  last_updated: c.last_updated,
};`,
				},
				type: 'function',
				function: {
					name: 'TokenPrice',
					description: 'Get the current USD price, 24h change %, market cap, and 24h volume for a crypto asset by CoinGecko id or ticker symbol.',
					parameters: {
						type: 'object',
						properties: { id: { type: 'string', description: 'CoinGecko id (e.g. solana) or symbol (e.g. SOL).' } },
						required: ['id'],
					},
				},
			},
		],
	},
	{
		id: 'token-ticker-3d',
		name: '3D Token Ticker',
		description: 'Render a live rotating 3D coin and price plate for any crypto asset.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-token-ticker-3d-001',
					name: 'TokenTicker3D',
					description: 'Show a live 3D rotating coin with current USD price and 24h change.',
					arguments: [
						{ name: 'id', type: 'string', description: 'CoinGecko id (e.g. solana) or ticker (e.g. SOL).' },
					],
					body: `const raw = String(args.id || '').trim().toLowerCase();
if (!raw) throw new Error('id required');
let id = raw;
if (raw.length <= 6 && !raw.includes('-')) {
  const s = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(raw));
  if (!s.ok) throw new Error('CoinGecko search failed: ' + s.status);
  const sj = await s.json();
  const hit = (sj.coins || []).find(c => c.symbol?.toLowerCase() === raw) || (sj.coins || [])[0];
  if (!hit?.id) throw new Error('No CoinGecko match for "' + raw + '"');
  id = hit.id;
}
const html = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0d10;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
#info{position:absolute;left:12px;top:12px;font-size:14px;letter-spacing:.02em}
#price{font-size:28px;font-weight:600}
#chg{font-size:14px}
.up{color:#22c55e}.dn{color:#ef4444}
#err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#fca5a5;padding:24px;text-align:center}
</style></head><body>
<div id="info"><div id="name">Loading…</div><div id="price">—</div><div id="chg">—</div></div>
<div id="err"></div>
<script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
const ID = \${JSON.stringify(id)};
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); });
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100); cam.position.set(0, 0, 4);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 4, 5); scene.add(key);
const coinGeo = new THREE.CylinderGeometry(1, 1, 0.18, 96);
let coin = null;
function setError(msg) { document.getElementById('err').style.display = 'flex'; document.getElementById('err').textContent = msg; }
async function load() {
  const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + encodeURIComponent(ID));
  if (!r.ok) return setError('CoinGecko markets failed: ' + r.status);
  const arr = await r.json();
  if (!arr.length) return setError('No data for ' + ID);
  const c = arr[0];
  document.getElementById('name').textContent = c.name + ' · ' + c.symbol.toUpperCase();
  document.getElementById('price').textContent = '$' + Number(c.current_price).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const chg = Number(c.price_change_percentage_24h || 0);
  const chgEl = document.getElementById('chg');
  chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% (24h)';
  chgEl.className = chg >= 0 ? 'up' : 'dn';
  if (!coin) {
    const tex = await new THREE.TextureLoader().loadAsync(c.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    const edge = new THREE.MeshStandardMaterial({ color: 0xc9a64b, roughness: 0.35, metalness: 0.85 });
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.5 });
    coin = new THREE.Mesh(coinGeo, [edge, face, face]);
    coin.rotation.x = Math.PI / 2;
    scene.add(coin);
  }
}
function tick() { if (coin) coin.rotation.z += 0.012; renderer.render(scene, cam); requestAnimationFrame(tick); }
tick(); load(); setInterval(load, 30000);
<\\/script></body></html>\`;
return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'TokenTicker3D',
					description: 'Render a live 3D rotating coin with the current USD price and 24h change for a crypto asset.',
					parameters: {
						type: 'object',
						properties: { id: { type: 'string', description: 'CoinGecko id (e.g. ethereum) or ticker (e.g. ETH).' } },
						required: ['id'],
					},
				},
			},
		],
	},
	{
		id: 'web-search',
		name: 'Web Search',
		description: 'Search the web via DuckDuckGo and return a summary and top results.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-websearch-001',
					name: 'WebSearch',
					description: 'Search the web via DuckDuckGo.',
					arguments: [{ name: 'query', type: 'string', description: 'Search query' }],
					body: `const res = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(args.query) + '&format=json&no_html=1');
const d = await res.json();
const topics = (d.RelatedTopics || []).slice(0, 3).map(t => t.Text).filter(Boolean);
return JSON.stringify({ abstract: d.AbstractText || '', topics });`,
				},
				type: 'function',
				function: {
					name: 'WebSearch',
					description: 'Search the web via DuckDuckGo and return an abstract and top related topics.',
					parameters: {
						type: 'object',
						properties: { query: { type: 'string', description: 'Search query' } },
						required: ['query'],
					},
				},
			},
		],
	},
	{
		id: 'date-time',
		name: 'Date & Time',
		description: 'Get the current time and timezone.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-datetime-001',
					name: 'GetCurrentTime',
					description: 'Returns the current date and time as an ISO string.',
					arguments: [],
					body: 'return new Date().toISOString();',
				},
				type: 'function',
				function: {
					name: 'GetCurrentTime',
					description: 'Returns the current date and time as an ISO 8601 string.',
					parameters: { type: 'object', properties: {} },
				},
			},
			{
				clientDefinition: {
					id: 'pack-datetime-002',
					name: 'GetTimezone',
					description: "Returns the user's current timezone.",
					arguments: [],
					body: "return Intl.DateTimeFormat().resolvedOptions().timeZone;",
				},
				type: 'function',
				function: {
					name: 'GetTimezone',
					description: "Returns the user's current IANA timezone string.",
					parameters: { type: 'object', properties: {} },
				},
			},
		],
	},

	{
		id: 'pump-launch',
		name: 'Pump.fun Launch',
		description: 'Launch a real pump.fun token on Solana from chat (requires connected Solana wallet).',
		schema: [
			{
				clientDefinition: {
					id: 'pack-pump-launch-001',
					name: 'LaunchPumpToken',
					description: 'Create a new pump.fun token. Returns the real mint address on success.',
					arguments: [
						{ name: 'agent_id', type: 'string', description: 'UUID of your 3D agent identity (required to bind the token).' },
						{ name: 'name', type: 'string', description: 'Token name.' },
						{ name: 'symbol', type: 'string', description: 'Token symbol (1-10 chars).' },
						{ name: 'uri', type: 'string', description: 'Metadata JSON URL (Arweave/IPFS URI with name, symbol, image, description fields).' },
						{ name: 'network', type: 'string', description: 'mainnet or devnet (default mainnet).' },
						{ name: 'sol_buy_in', type: 'number', description: 'Initial creator buy in SOL (>= 0, default 0).' },
						{ name: 'buyback_bps', type: 'number', description: 'Buyback basis points 0-10000 (default 0).' },
					],
					body: `if (!window.solana || !window.solana.isConnected) {
  try { await window.solana?.connect(); } catch(e) { throw new Error('Solana wallet not connected: ' + (e?.message||e)); }
}
const pubkey = window.solana?.publicKey?.toBase58?.();
if (!pubkey) throw new Error('No Solana public key available — connect a wallet first.');
const agentId = String(args.agent_id || '').trim();
const name = String(args.name || '').trim();
const symbol = String(args.symbol || '').trim();
const uri = String(args.uri || '').trim();
if (!agentId) throw new Error('agent_id required');
if (!name || !symbol || !uri) throw new Error('name, symbol, uri required');
const network = args.network === 'devnet' ? 'devnet' : 'mainnet';
const sol_buy_in = Number(args.sol_buy_in || 0);
const buyback_bps = Number(args.buyback_bps || 0);
const prep = await fetch('/api/pump/launch-prep', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ agent_id: agentId, wallet_address: pubkey, name, symbol, uri, network, sol_buy_in, buyback_bps }),
});
if (!prep.ok) throw new Error('launch-prep failed: ' + prep.status + ' ' + await prep.text());
const { prep_id, mint, mint_secret_key_b64, tx_base64 } = await prep.json();
if (!prep_id || !mint || !tx_base64) throw new Error('launch-prep returned incomplete data');
const { VersionedTransaction, Keypair } = await import('https://esm.sh/@solana/web3.js@1');
const txBytes = Uint8Array.from(atob(tx_base64), c => c.charCodeAt(0));
const tx = VersionedTransaction.deserialize(txBytes);
if (mint_secret_key_b64) {
  const mintKp = Keypair.fromSecretKey(Uint8Array.from(atob(mint_secret_key_b64), c => c.charCodeAt(0)));
  tx.sign([mintKp]);
}
const result = await window.solana.signAndSendTransaction(tx);
const tx_signature = result?.signature ?? String(result);
if (!tx_signature) throw new Error('wallet did not return a transaction signature');
const conf = await fetch('/api/pump/launch-confirm', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ prep_id, tx_signature }),
});
if (!conf.ok) throw new Error('launch-confirm failed: ' + conf.status + ' ' + await conf.text());
const confirmed = await conf.json();
return { mint, tx_signature, pump_url: 'https://pump.fun/' + mint, pump_agent_mint: confirmed.pump_agent_mint };`,
				},
				type: 'function',
				function: {
					name: 'LaunchPumpToken',
					description: 'Launch a real pump.fun token on Solana. Requires a connected Solana wallet and an existing agent identity. Calls launch-prep then wallet signs and submits then launch-confirm.',
					parameters: {
						type: 'object',
						properties: {
							agent_id: { type: 'string', description: 'UUID of the 3D agent identity to bind this token to.' },
							name: { type: 'string', description: 'Token name.' },
							symbol: { type: 'string', description: 'Token symbol (1-10 chars).' },
							uri: { type: 'string', description: 'Metadata JSON URL (Arweave/IPFS URI).' },
							network: { type: 'string', enum: ['mainnet', 'devnet'], description: 'Solana network (default mainnet).' },
							sol_buy_in: { type: 'number', description: 'Initial creator buy in SOL (default 0).' },
							buyback_bps: { type: 'number', description: 'Buyback basis points 0-10000 (default 0).' },
						},
						required: ['agent_id', 'name', 'symbol', 'uri'],
					},
				},
			},
		],
	},
	{
		id: 'tx-explain',
		name: 'Tx Explainer',
		description: 'Decode a real Solana or Ethereum transaction into plain English plus a 3D flow diagram.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-tx-explain-001',
					name: 'TxExplain',
					description: 'Explain an on-chain transaction and visualize the token flow in 3D.',
					arguments: [
						{ name: 'chain', type: 'string', description: 'solana | evm' },
						{ name: 'sig', type: 'string', description: 'Transaction signature (Solana) or hash (EVM).' },
					],
					body: `const chain = String(args.chain || '').toLowerCase();
const sig = String(args.sig || '').trim();
if (!['solana','evm'].includes(chain)) throw new Error('chain must be solana or evm');
if (!sig) throw new Error('sig required');
const r = await fetch('/api/tx/explain', { method: 'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ chain, sig }) });
if (!r.ok) throw new Error('tx explain failed: ' + r.status + ' ' + await r.text());
const d = await r.json();
const transfers = chain === 'solana'
  ? [...(d.tokenTransfers||[]).map(t => ({from: t.fromUserAccount, to: t.toUserAccount, amount: t.tokenAmount, label: t.mint || 'TOKEN'})),
     ...(d.nativeTransfers||[]).map(t => ({from: t.fromUserAccount, to: t.toUserAccount, amount: t.amount/1e9, label: 'SOL'}))]
  : (d.logs||[]).map(t => ({from: t.from, to: t.to, amount: t.amount, label: t.token}));
const html = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0d10;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
#hud{position:absolute;left:12px;top:10px;font-size:12px;background:rgba(0,0,0,.45);padding:8px 10px;border-radius:8px;max-width:380px;line-height:1.45}
</style></head><body>
<div id="hud"></div>
<script type="module">
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
const TX = \${JSON.stringify(d)}, T = \${JSON.stringify(transfers)};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x0b0d10);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); });
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.01, 1000); cam.position.set(0, 6, 14);
const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const k = new THREE.DirectionalLight(0xffffff,1); k.position.set(5,8,6); scene.add(k);
const accounts = Array.from(new Set(T.flatMap(t => [t.from, t.to]).filter(Boolean)));
const pos = new Map();
accounts.forEach((a, i) => {
  const ang = (i / Math.max(1,accounts.length)) * Math.PI * 2;
  const r = 5 + (accounts.length > 6 ? 2 : 0);
  pos.set(a, new THREE.Vector3(Math.cos(ang)*r, 0, Math.sin(ang)*r));
});
accounts.forEach(a => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 24), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4 }));
  m.position.copy(pos.get(a)); scene.add(m);
});
T.forEach(t => {
  const a = pos.get(t.from), b = pos.get(t.to); if (!a || !b) return;
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x60a5fa }));
  scene.add(line);
});
let html = '<div><b>' + (TX.summary || TX.description || (TX.type || 'transaction')) + '</b></div>';
html += '<div style="margin-top:6px">' + T.length + ' transfer(s) across ' + accounts.length + ' account(s)</div>';
T.slice(0,8).forEach(t => { html += '<div>' + (t.label||'TOKEN') + ': ' + (t.amount||'?') + '</div>'; });
document.getElementById('hud').innerHTML = html;
function tick(){ ctl.update(); renderer.render(scene, cam); requestAnimationFrame(tick); }
tick();
<\/script><\/body><\/html>\`;
return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'TxExplain',
					description: 'Decode a real Solana or Ethereum transaction by signature/hash and render a 3D flow diagram of the transfers.',
					parameters: {
						type: 'object',
						properties: {
							chain: { type: 'string', enum: ['solana', 'evm'] },
							sig: { type: 'string' },
						},
						required: ['chain', 'sig'],
					},
				},
			},
		],
	},
	{
		id: 'mint-scene-nft',
		name: 'Mint Scene NFT',
		description: 'Snapshot the live 3D scene and mint it as a real Solana NFT via NFT.Storage + Metaplex.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-mint-scene-001',
					name: 'MintScene',
					description: 'Mint the current 3D scene as a Solana NFT.',
					arguments: [
						{ name: 'name', type: 'string', description: 'NFT name.' },
						{ name: 'description', type: 'string', description: 'NFT description.' },
					],
					body: `if (!window.solana?.publicKey) {
  try { await window.solana?.connect(); } catch(e) { throw new Error('Connect a Solana wallet first: ' + (e?.message||e)); }
}
const owner = window.solana.publicKey.toBase58();
// Request GLB + screenshot from the viewer iframe.
const viewer = document.querySelector('iframe[data-three-ws-viewer]') || document.querySelector('iframe');
if (!viewer?.contentWindow) throw new Error('No 3D viewer iframe found in the page.');
function ask(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = 'mint-scene-' + Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.id !== id) return;
      window.removeEventListener('message', onMsg);
      if (d.error) reject(new Error(d.error)); else resolve(d.result);
    };
    window.addEventListener('message', onMsg);
    viewer.contentWindow.postMessage({ id, action, input: payload }, '*');
    setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error('viewer timeout for ' + action)); }, 15000);
  });
}
const glbBase64 = await ask('exportGLB');
const thumbnailBase64 = await ask('takeScreenshot', { width: 512, height: 512 });
if (!glbBase64 || !thumbnailBase64) throw new Error('Viewer returned empty asset(s).');
const prep = await fetch('/api/nft/mint-scene', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ ownerPubkey: owner, glbBase64, thumbnailBase64, name: String(args.name||'').trim(), description: String(args.description||'').trim() }) });
if (!prep.ok) throw new Error('mint-scene prep failed: ' + prep.status + ' ' + await prep.text());
const { unsignedTxBase64, metadataUri, mint } = await prep.json();
const bin = Uint8Array.from(atob(unsignedTxBase64), c => c.charCodeAt(0));
const signed = await window.solana.signTransaction({ serialize: () => bin, _raw: bin });
const signedTxBase64 = btoa(String.fromCharCode(...(signed.serialize?.() || signed._raw || bin)));
const conf = await fetch('/api/nft/mint-scene-confirm', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ signedTxBase64 }) });
if (!conf.ok) throw new Error('mint confirm failed: ' + conf.status + ' ' + await conf.text());
const { signature } = await conf.json();
return { mint, signature, metadataUri, explorer: 'https://solscan.io/tx/' + signature };`,
				},
				type: 'function',
				function: {
					name: 'MintScene',
					description: 'Mint the currently displayed 3D scene as a real Solana NFT. Asks the viewer to export GLB + screenshot, uploads to NFT.Storage, and mints via Metaplex.',
					parameters: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							description: { type: 'string' },
						},
						required: ['name'],
					},
				},
			},
		],
	},
	{
		id: 'nft-3d-import',
		name: 'NFT 3D Import',
		description: 'Fetch a real NFT and render its 3D model (or image plane fallback) in an orbit viewer.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-nft-3d-import-001',
					name: 'NFTImport3D',
					description: 'Resolve an NFT and render it in 3D.',
					arguments: [
						{ name: 'chain', type: 'string', description: 'solana | evm' },
						{ name: 'id', type: 'string', description: 'For solana: mint pubkey. For evm: "contract:tokenId" (Ethereum mainnet).' },
					],
					body: `const chain = String(args.chain || '').toLowerCase();
	const id = String(args.id || '').trim();
	if (!['solana','evm'].includes(chain)) throw new Error('chain must be solana or evm');
	if (!id) throw new Error('id required');
	const r = await fetch('/api/nft/resolve', { method: 'POST', headers: {'content-type':'application/json'}, credentials: 'include', body: JSON.stringify({ chain, id }) });
	if (!r.ok) throw new Error('NFT resolve failed: ' + r.status + ' ' + await r.text());
	const meta = await r.json();
	const html = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
	html,body{margin:0;height:100%;background:#0b0d10;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
	#hud{position:absolute;left:12px;top:10px;font-size:13px;background:rgba(0,0,0,.4);padding:6px 10px;border-radius:8px}
	</style></head><body>
	<div id="hud">\${meta.name || 'NFT'}</div>
	<script type="module">
	import * as THREE from 'https://esm.sh/three@0.160.0';
	import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
	import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
	const META = \${JSON.stringify(meta)};
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x0b0d10);
	document.body.appendChild(renderer.domElement);
	addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); });
	const scene = new THREE.Scene();
	const cam = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.01, 1000); cam.position.set(0, 1.2, 3);
	const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
	scene.add(new THREE.AmbientLight(0xffffff, 0.6));
	const k = new THREE.DirectionalLight(0xffffff, 1); k.position.set(3, 4, 5); scene.add(k);
	async function loadModel(url){
	  const gltf = await new GLTFLoader().loadAsync(url);
	  const m = gltf.scene;
	  const box = new THREE.Box3().setFromObject(m);
	  const size = box.getSize(new THREE.Vector3()).length();
	  const center = box.getCenter(new THREE.Vector3());
	  m.position.sub(center); cam.position.set(0, 0, size * 1.4); ctl.target.set(0,0,0);
	  scene.add(m);
	}
	async function loadPlane(url){
	  const tex = await new THREE.TextureLoader().loadAsync(url);
	  tex.colorSpace = THREE.SRGBColorSpace;
	  const aspect = (tex.image && tex.image.width && tex.image.height) ? tex.image.width / tex.image.height : 1;
	  const w = 2.4, h = w / aspect;
	  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
	  scene.add(mesh);
	}
	(async () => {
	  if (META.model) await loadModel(META.model);
	  else if (META.image) await loadPlane(META.image);
	  else { document.getElementById('hud').textContent = 'No renderable asset returned.'; }
	})();
	function tick(){ ctl.update(); renderer.render(scene, cam); requestAnimationFrame(tick); }
	tick();
	</script></body></html>\`;
	return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'NFTImport3D',
					description: 'Resolve a real NFT (Solana mint or Ethereum contract:tokenId) and render its 3D model or image in an orbit viewer.',
					parameters: {
						type: 'object',
						properties: {
							chain: { type: 'string', enum: ['solana', 'evm'] },
							id: { type: 'string' },
						},
						required: ['chain', 'id'],
					},
				},
			},
		],
	},
	{
		id: 'wallet-balances',
		name: 'Wallet Balances',
		description: 'Real on-chain balances for a Solana or EVM wallet with a 3D coin-stack visualization.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-wallet-balances-001',
					name: 'WalletBalances',
					description: 'Look up native + top token balances for a wallet and render a 3D coin stack.',
					arguments: [
						{ name: 'chain', type: 'string', description: 'solana | evm' },
						{ name: 'address', type: 'string', description: 'Wallet address (base58 for Solana, 0x… for EVM).' },
					],
					body: `const chain = String(args.chain || '').toLowerCase();
	const address = String(args.address || '').trim();
	if (!['solana','evm'].includes(chain)) throw new Error('chain must be solana or evm');
	if (!address) throw new Error('address required');
	const r = await fetch('/api/wallet/balances', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ chain, address }) });
	if (!r.ok) throw new Error('balances failed: ' + r.status + ' ' + await r.text());
	const d = await r.json();
	const top = [d.native, ...(d.tokens || [])].filter(Boolean).slice(0, 10);
	const html = \`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
	html,body{margin:0;height:100%;background:#0b0d10;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden}
	#hud{position:absolute;left:12px;top:10px;font-size:12px;background:rgba(0,0,0,.4);padding:8px 10px;border-radius:8px;max-width:280px}
	.row{display:flex;justify-content:space-between;gap:8px}.row b{color:#fff}
	</style></head><body>
	<div id="hud"></div>
	<script type="module">
	import * as THREE from 'https://esm.sh/three@0.160.0';
	import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
	const TOP = \${JSON.stringify(top)};
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x0b0d10);
	document.body.appendChild(renderer.domElement);
	addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); });
	const scene = new THREE.Scene();
	const cam = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.01, 1000); cam.position.set(0, 8, 14);
	const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.target.set(0, 2, 0);
	scene.add(new THREE.AmbientLight(0xffffff, 0.6));
	const k = new THREE.DirectionalLight(0xffffff, 1); k.position.set(5, 10, 7); scene.add(k);
	const totalUsd = TOP.reduce((s,t) => s + (Number(t.usd)||0), 0) || 1;
	const colors = [0xf7931a, 0x627eea, 0x14f195, 0x9945ff, 0xe6007a, 0xf3ba2f, 0xff007a, 0xfcd535, 0x2a5ada, 0x8a2be2];
	TOP.forEach((t, i) => {
	  const usd = Number(t.usd) || 0;
	  const stackH = Math.max(0.05, (usd / totalUsd) * 6);
	  const x = (i - TOP.length/2) * 1.4;
	  const geo = new THREE.CylinderGeometry(0.5, 0.5, stackH, 48);
	  const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], metalness: 0.85, roughness: 0.3 });
	  const m = new THREE.Mesh(geo, mat); m.position.set(x, stackH/2, 0); scene.add(m);
	});
	let html = '<div><b>' + TOP.length + ' assets · $' + totalUsd.toLocaleString(undefined,{maximumFractionDigits:2}) + '</b></div>';
	TOP.forEach(t => { html += '<div class="row"><span>' + t.symbol + '</span><span>' + Number(t.amount||0).toLocaleString(undefined,{maximumFractionDigits:6}) + ' · $' + Number(t.usd||0).toLocaleString(undefined,{maximumFractionDigits:2}) + '</span></div>'; });
	document.getElementById('hud').innerHTML = html;
	function tick(){ ctl.update(); renderer.render(scene, cam); requestAnimationFrame(tick); }
	tick();
	</script></body></html>\`;
	return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'WalletBalances',
					description: 'Look up real on-chain native + token balances for a wallet (Solana or EVM) and render a 3D coin-stack visualization.',
					parameters: {
						type: 'object',
						properties: {
							chain: { type: 'string', enum: ['solana', 'evm'] },
							address: { type: 'string' },
						},
						required: ['chain', 'address'],
					},
				},
			},
		],
	},
	{
		id: 'token-gate-scene',
		name: 'Token-Gate Scene',
		description: 'Create a shareable URL for the current 3D scene that only loads for wallets holding a specific token or NFT.',
		schema: [
			{
				clientDefinition: {
					id: 'pack-token-gate-001',
					name: 'TokenGateScene',
					description: 'Token-gate the current scene and return a share URL.',
					arguments: [
						{ name: 'sceneRef', type: 'string', description: 'Identifier for the current scene (the chat already exposes one via the viewer share API — pass the same string the existing /share command uses).' },
						{ name: 'chain', type: 'string', description: 'solana | evm' },
						{ name: 'kind', type: 'string', description: 'spl | collection | erc20 | erc721' },
						{ name: 'address', type: 'string', description: 'Token mint, collection address, or contract address.' },
						{ name: 'minBalance', type: 'number', description: 'Minimum required balance (in whole units; default 1).' },
					],
					body: `const sceneRef = String(args.sceneRef||'').trim();
const chain = String(args.chain||'').toLowerCase();
const kind = String(args.kind||'').toLowerCase();
const address = String(args.address||'').trim();
const minBalance = Number(args.minBalance ?? 1);
if (!sceneRef) throw new Error('sceneRef required');
if (!['solana','evm'].includes(chain)) throw new Error('chain must be solana or evm');
if (!['spl','collection','erc20','erc721'].includes(kind)) throw new Error('kind must be spl|collection|erc20|erc721');
if (!address) throw new Error('address required');
const r = await fetch('/api/scene/gate-create', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({ sceneRef, gate: { chain, kind, address, minBalance } }) });
if (!r.ok) throw new Error('gate-create failed: ' + r.status + ' ' + await r.text());
const { shareUrl, gateId } = await r.json();
return { shareUrl, gateId, gate: { chain, kind, address, minBalance } };`,
				},
				type: 'function',
				function: {
					name: 'TokenGateScene',
					description: 'Create a real shareable, token-gated URL for the current 3D scene. Visitors connect a wallet and prove ownership before the scene loads.',
					parameters: {
						type: 'object',
						properties: {
							sceneRef: { type: 'string' },
							chain: { type: 'string', enum: ['solana', 'evm'] },
							kind: { type: 'string', enum: ['spl', 'collection', 'erc20', 'erc721'] },
							address: { type: 'string' },
							minBalance: { type: 'number' },
						},
						required: ['sceneRef', 'chain', 'kind', 'address'],
					},
				},
			},
		],
	},
];

export const defaultToolSchema = [
	{
		name: 'Client-side',
		schema: [
			{
				clientDefinition: {
					id: 'tradingview-chart-001',
					name: 'TradingViewChart',
					description: 'Displays an interactive TradingView chart for a given symbol.',
					arguments: [
						{ name: 'symbol', type: 'string', description: 'Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL' },
						{ name: 'interval', type: 'string', description: 'Chart interval: 1, 5, 15, 30, 60, D, W, M' },
						{ name: 'theme', type: 'string', description: 'light or dark' },
					],
					body: `const symbol = args.symbol || 'BINANCE:BTCUSDT';
const interval = args.interval || 'D';
const theme = args.theme || 'light';
const html = \`<!DOCTYPE html>
<html>
<head><style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style></head>
<body>
<div id="tv_chart" style="width:100%;height:100vh"></div>
<script src="https://s3.tradingview.com/tv.js"><\\/script>
<script>
new TradingView.widget({
  container_id:"tv_chart",
  symbol:\${JSON.stringify(symbol)},
  interval:\${JSON.stringify(interval)},
  theme:\${JSON.stringify(theme)},
  style:"1",
  width:"100%",
  height:"100%",
  toolbar_bg:"#f1f3f6",
  hide_side_toolbar:false,
  allow_symbol_change:true
});
<\\/script>
</body></html>\`;
return { contentType: 'text/html', content: html };`,
				},
				type: 'function',
				function: {
					name: 'TradingViewChart',
					description: 'Display an interactive TradingView chart. Use for any request to show a price chart, candlestick chart, or market data visualization.',
					parameters: {
						type: 'object',
						properties: {
							symbol: { type: 'string', description: 'Trading symbol e.g. BINANCE:BTCUSDT, NASDAQ:AAPL, FX:EURUSD' },
							interval: { type: 'string', enum: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], description: 'Chart interval' },
							theme: { type: 'string', enum: ['light', 'dark'], description: 'Chart theme' },
						},
						required: ['symbol'],
					},
				},
			},
			{
				clientDefinition: {
					id: '95c15b96-7bba-44e7-98a7-ffe268b884c5',
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					arguments: [
						{
							name: 'htmlContent',
							type: 'string',
							description: 'The HTML content to be displayed as a webpage',
						},
					],
					body: "return { contentType: 'text/html' };",
				},
				type: 'function',
				function: {
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					parameters: {
						type: 'object',
						properties: {
							htmlContent: {
								type: 'string',
								description: 'The HTML content to be displayed as a webpage',
							},
						},
						required: ['htmlContent'],
					},
				},
			},
			{
				clientDefinition: {
					id: '1407c581-fab6-4dd5-995a-d53ba05ec6e8',
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					arguments: [
						{
							name: 'code',
							type: 'string',
							description:
								'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
						},
					],
					body: "let consoleOutput = [];\nconst originalConsoleLog = console.log;\nconsole.log = (...args) => {\n  consoleOutput.push(args.map(arg => JSON.stringify(arg)).join(' '));\n  originalConsoleLog.apply(console, args);\n};\n\ntry {\n  let result = eval(`(() => { ${args.code} })()`);\n  return JSON.stringify({\n    result: result,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} catch (error) {\n  return JSON.stringify({\n    error: error.message,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} finally {\n  console.log = originalConsoleLog;\n}",
				},
				type: 'function',
				function: {
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					parameters: {
						type: 'object',
						properties: {
							code: {
								type: 'string',
								description:
									'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
							},
						},
						required: ['code'],
					},
				},
			},
			{
				clientDefinition: {
					id: '5b9b21b8-c8f2-40df-aea7-9634dec55b6b',
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					arguments: [
						{
							name: 'choices',
							type: 'string_array',
							description: 'The options the user can choose from.',
						},
						{
							name: 'question',
							type: 'string',
							description: 'What you are asking the user.',
						},
					],
					body: 'return await choose(args.question, args.choices);',
				},
				type: 'function',
				function: {
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					parameters: {
						type: 'object',
						properties: {
							choices: {
								type: 'array',
								items: {
									type: 'string',
								},
								description: 'The options the user can choose from.',
							},
							question: {
								type: 'string',
								description: 'What you are asking the user.',
							},
						},
						required: ['choices', 'question'],
					},
				},
			},
		],
	},
];

export const agentToolSchema = {
	name: '3D Agent',
	schema: [
		{
			clientDefinition: {
				id: 'agent-wave-a1b2c3',
				name: 'agent_wave',
				description: 'Makes the 3D avatar wave at the user.',
				arguments: [],
				body: 'if (window.__threewsAgent) window.__threewsAgent.wave(); return "waved";',
			},
			type: 'function',
			function: {
				name: 'agent_wave',
				description: 'Wave the 3D avatar at the user. Use to greet or celebrate.',
				parameters: { type: 'object', properties: {} },
			},
		},
		{
			clientDefinition: {
				id: 'agent-express-d4e5f6',
				name: 'agent_express',
				description: 'Express an emotion on the 3D avatar.',
				arguments: [
					{ name: 'trigger', type: 'string', description: 'celebration | concern | curiosity | empathy | patience' },
				],
				body: 'if (window.__threewsAgent) window.__threewsAgent.expressEmotion(args.trigger); return "expressed: " + args.trigger;',
			},
			type: 'function',
			function: {
				name: 'agent_express',
				description: 'Make the 3D avatar express an emotion. Use to show enthusiasm, empathy, or concern.',
				parameters: {
					type: 'object',
					properties: {
						trigger: {
							type: 'string',
							enum: ['celebration', 'concern', 'curiosity', 'empathy', 'patience'],
							description: 'The emotion to express.',
						},
					},
					required: ['trigger'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'agent-speak-g7h8i9',
				name: 'agent_speak',
				description: 'Trigger the avatar talking animation for a given text.',
				arguments: [{ name: 'text', type: 'string', description: 'Text to animate talking for' }],
				body: 'if (window.__threewsAgent) window.__threewsAgent.speak(args.text); return "speaking";',
			},
			type: 'function',
			function: {
				name: 'agent_speak',
				description: 'Trigger the 3D avatar talking animation. Useful for emphasis on a key statement.',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'The text being spoken (used to calculate animation duration).' },
					},
					required: ['text'],
				},
			},
		},
	],
};

const _pumpMcp = `
const _r = await fetch('/api/pump-fun-mcp', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:_TOOL_,arguments:args}})});
const _d = await _r.json();
if (_d.error) return JSON.stringify({error: _d.error.message});
const _c = _d.result?.content;
return Array.isArray(_c) ? _c.map(x => x.text || JSON.stringify(x)).join('\\n') : JSON.stringify(_c, null, 2);
`.trim();

function pumpBody(toolName) {
	return _pumpMcp.replace('_TOOL_', JSON.stringify(toolName));
}

export const pumpToolSchema = {
	name: 'Pump.fun & Crypto',
	schema: [
		{
			clientDefinition: {
				id: 'pump-trending-001',
				name: 'getTrendingTokens',
				description: 'Top pump.fun tokens by market cap.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of tokens (max 50, default 10)' }],
				body: pumpBody('getTrendingTokens'),
			},
			type: 'function',
			function: {
				name: 'getTrendingTokens',
				description: 'Get the top trending pump.fun tokens by market cap right now.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 10, description: 'How many tokens to return (max 50)' } },
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-new-002',
				name: 'getNewTokens',
				description: 'Most recently launched pump.fun tokens.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of tokens (max 50, default 10)' }],
				body: pumpBody('getNewTokens'),
			},
			type: 'function',
			function: {
				name: 'getNewTokens',
				description: 'Get the most recently launched pump.fun tokens.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 10, description: 'How many tokens to return (max 50)' } },
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-koth-003',
				name: 'getKingOfTheHill',
				description: 'Highest-market-cap token still on the bonding curve.',
				arguments: [],
				body: pumpBody('getKingOfTheHill'),
			},
			type: 'function',
			function: {
				name: 'getKingOfTheHill',
				description: 'Get the king of the hill — the highest market cap pump.fun token still on the bonding curve.',
				parameters: { type: 'object', properties: {} },
			},
		},
		{
			clientDefinition: {
				id: 'pump-search-004',
				name: 'searchTokens',
				description: 'Search pump.fun tokens by name, symbol, or mint address.',
				arguments: [
					{ name: 'query', type: 'string', description: 'Search query' },
					{ name: 'limit', type: 'number', description: 'Number of results (max 50, default 10)' },
				],
				body: pumpBody('searchTokens'),
			},
			type: 'function',
			function: {
				name: 'searchTokens',
				description: 'Search pump.fun tokens by name, symbol, or mint address.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Token name, symbol, or mint address' },
						limit: { type: 'integer', default: 10, description: 'Number of results (max 50)' },
					},
					required: ['query'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-details-005',
				name: 'getTokenDetails',
				description: 'Full details for a specific pump.fun token by mint address.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getTokenDetails'),
			},
			type: 'function',
			function: {
				name: 'getTokenDetails',
				description: 'Get full details for a pump.fun token: price, market cap, description, socials, creator.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-curve-006',
				name: 'getBondingCurve',
				description: 'Bonding curve analysis: reserves and graduation progress.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getBondingCurve'),
			},
			type: 'function',
			function: {
				name: 'getBondingCurve',
				description: 'Get bonding curve reserves and graduation progress (0-100%) for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-trades-007',
				name: 'getTokenTrades',
				description: 'Recent buy/sell history for a token.',
				arguments: [
					{ name: 'mint', type: 'string', description: 'Token mint address (base58)' },
					{ name: 'limit', type: 'number', description: 'Number of trades (max 200, default 50)' },
				],
				body: pumpBody('getTokenTrades'),
			},
			type: 'function',
			function: {
				name: 'getTokenTrades',
				description: 'Get recent buy/sell trade history for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: {
						mint: { type: 'string', description: 'Token mint address (base58)' },
						limit: { type: 'integer', default: 50, description: 'Number of trades (max 200)' },
					},
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-holders-008',
				name: 'getTokenHolders',
				description: 'Token holder distribution and concentration.',
				arguments: [{ name: 'mint', type: 'string', description: 'Token mint address (base58)' }],
				body: pumpBody('getTokenHolders'),
			},
			type: 'function',
			function: {
				name: 'getTokenHolders',
				description: 'Get top token holders and concentration metrics for a pump.fun token.',
				parameters: {
					type: 'object',
					properties: { mint: { type: 'string', description: 'Token mint address (base58)' } },
					required: ['mint'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-quote-009',
				name: 'pumpfun_quote_swap',
				description: 'Read-only price quote for a pump.fun swap.',
				arguments: [
					{ name: 'inputMint', type: 'string', description: 'Input token mint (use So11111111111111111111111111111111111111112 for SOL)' },
					{ name: 'outputMint', type: 'string', description: 'Output token mint' },
					{ name: 'amountIn', type: 'number', description: 'Amount in lamports (1 SOL = 1000000000)' },
				],
				body: pumpBody('pumpfun_quote_swap'),
			},
			type: 'function',
			function: {
				name: 'pumpfun_quote_swap',
				description: 'Get a read-only price quote for swapping on pump.fun. Use SOL mint So11111111111111111111111111111111111111112 for SOL side.',
				parameters: {
					type: 'object',
					properties: {
						inputMint: { type: 'string', description: 'Input token mint address' },
						outputMint: { type: 'string', description: 'Output token mint address' },
						amountIn: { type: 'number', description: 'Input amount in raw lamports (1 SOL = 1_000_000_000)' },
						slippageBps: { type: 'number', description: 'Slippage in basis points (default 100 = 1%)' },
					},
					required: ['inputMint', 'outputMint', 'amountIn'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-sns-010',
				name: 'sns_resolve',
				description: 'Resolve a .sol domain to a wallet address.',
				arguments: [{ name: 'name', type: 'string', description: '.sol domain name e.g. "bonfida.sol"' }],
				body: pumpBody('sns_resolve'),
			},
			type: 'function',
			function: {
				name: 'sns_resolve',
				description: 'Resolve a Solana Name Service (.sol) domain to its owner wallet address.',
				parameters: {
					type: 'object',
					properties: { name: { type: 'string', description: '.sol domain name, e.g. "bonfida.sol"' } },
					required: ['name'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-sns-rev-011',
				name: 'sns_reverseLookup',
				description: 'Reverse-lookup a Solana wallet to its .sol domain.',
				arguments: [{ name: 'address', type: 'string', description: 'Base58 Solana wallet address' }],
				body: pumpBody('sns_reverseLookup'),
			},
			type: 'function',
			function: {
				name: 'sns_reverseLookup',
				description: 'Look up the .sol domain name for a Solana wallet address.',
				parameters: {
					type: 'object',
					properties: { address: { type: 'string', description: 'Base58 Solana wallet address' } },
					required: ['address'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'pump-kol-012',
				name: 'kol_radar',
				description: 'Early-detection signals for memecoins from KOL wallets.',
				arguments: [{ name: 'limit', type: 'number', description: 'Number of signals (default 20)' }],
				body: pumpBody('kol_radar'),
			},
			type: 'function',
			function: {
				name: 'kol_radar',
				description: 'Get early-detection alpha signals from key opinion leader (KOL) wallets on pump.fun.',
				parameters: {
					type: 'object',
					properties: { limit: { type: 'integer', default: 20, description: 'Number of signals to return' } },
				},
			},
		},
	],
};
