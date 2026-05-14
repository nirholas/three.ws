// Launchpad Studio — the "Wix of 3D avatars + Stripe of x402 payments" surface.
//
// Lets a user pick a template (Token Launchpad, Paid Concierge, …), fill a
// short form (slug, wallet, website, brand, avatar, monetization), see a live
// preview, and publish to a hosted profile at /p/<slug> that anyone can resell
// or embed. The same config emits a copyable agent-skill JSON for the x402
// bazaar and a one-line <script> embed snippet for any third-party site.
//
// This module is NEW — it does not replace src/editor/embed-editor.js. The
// classic embed editor remains the place-and-scale UX; this is the
// template-driven creation surface.
//
// Usage: import { mountLaunchpadStudio } from './launchpad-studio.js';
//        mountLaunchpadStudio(rootEl, { template, slug, wallet, website });

import '../element.js'; // ensures <agent-3d> is registered

// ──────────────────────────────────────────────────────────────────────────
// Templates — each describes the public-facing page that gets generated.
// Adding a template here surfaces it in the picker and the renderer.
// ──────────────────────────────────────────────────────────────────────────
const TEMPLATES = [
	{
		id: 'token-launchpad',
		label: 'Token Launchpad',
		tagline: 'White-label Pump.fun launcher with a 3D avatar host',
		hint: 'Visitors land on a 3D-hosted page and mint a Pump.fun coin in one click. Creator wallet receives the launch fee split.',
		fields: ['slug', 'brand', 'wallet', 'website', 'avatar', 'tokenName', 'tokenTicker', 'tagline', 'cta'],
		monetize: { kind: 'pump-launch', defaultPrice: 0.02, currency: 'SOL', chain: 'solana' },
		defaultCta: 'Launch your coin',
		defaultTagline: 'Mint a Pump.fun coin in seconds — hosted by your own 3D agent.',
	},
	{
		id: 'paid-concierge',
		label: 'Paid Concierge',
		tagline: '3D avatar that answers questions for x402 USDC',
		hint: 'A hosted agent page that charges a per-question fee via x402. Replies stream from the configured agent skill.',
		fields: ['slug', 'brand', 'wallet', 'website', 'avatar', 'skill', 'price', 'tagline', 'cta'],
		monetize: { kind: 'x402-call', defaultPrice: 0.01, currency: 'USDC', chain: 'base' },
		defaultCta: 'Ask the concierge',
		defaultTagline: 'Get an answer from the team in 5 seconds — paid in USDC.',
	},
	{
		id: 'gated-showroom',
		label: 'Gated 3D Showroom',
		tagline: 'Pay-to-enter glTF gallery with avatar greeter',
		hint: 'Visitors pay a small USDC fee to unlock a private 3D scene. Use for product reveals, premium models, or NFT preview rooms.',
		fields: ['slug', 'brand', 'wallet', 'website', 'avatar', 'sceneSrc', 'price', 'tagline', 'cta'],
		monetize: { kind: 'x402-unlock', defaultPrice: 0.05, currency: 'USDC', chain: 'base' },
		defaultCta: 'Unlock the room',
		defaultTagline: 'Step inside a private 3D space — one-time USDC pass.',
	},
];

const DEFAULT_AVATAR_SRC = '/avatars/default.glb';
const AGENT_3D_VERSION = '1.5.1';
const AGENT_3D_HOST = 'https://three.ws';
const STORAGE_KEY = 'launchpadStudio:draft';

const DEMO_AVATARS = [
	{ id: 'demo-cz', name: 'CZ', model_url: '/avatars/cz.glb' },
	{ id: 'demo-default', name: 'Default', model_url: '/avatars/default.glb' },
	{ id: 'demo-robot', name: 'Robot Expressive', model_url: '/animations/robotexpressive.glb' },
	{ id: 'demo-soldier', name: 'Soldier', model_url: '/animations/soldier.glb' },
	{ id: 'demo-michelle', name: 'Michelle', model_url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/Michelle.glb' },
	{ id: 'demo-xbot', name: 'Xbot', model_url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/Xbot.glb' },
];

const STYLE = `
	.studio-root {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: 320px 1fr 360px;
		grid-template-rows: 56px minmax(0, 1fr);
		grid-template-areas: 'topbar topbar topbar' 'sidebar stage rail';
		background: #0b0d10;
		color: #f4f4f5;
		font: 14px/1.45 system-ui, -apple-system, sans-serif;
	}
	.topbar {
		grid-area: topbar;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 0 20px;
		background: #0f1216;
		border-bottom: 1px solid #1c2128;
	}
	.topbar .brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.topbar .brand .dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: linear-gradient(135deg, #6366f1, #ec4899);
	}
	.topbar .pill {
		padding: 4px 10px;
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #a1a1aa;
		background: #1a1d22;
		border-radius: 999px;
	}
	.topbar .actions { display: flex; gap: 8px; align-items: center; }
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: #f4f4f5;
		background: #1f2329;
		border: 1px solid #2a2f37;
		border-radius: 8px;
		cursor: pointer;
		text-decoration: none;
		transition: background 0.12s, border 0.12s;
	}
	.btn:hover { background: #262b32; border-color: #353c46; }
	.btn.primary {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		border-color: transparent;
	}
	.btn.primary:hover { filter: brightness(1.1); }
	.btn.ghost { background: transparent; border-color: transparent; color: #a1a1aa; }
	.btn.ghost:hover { color: #f4f4f5; background: #1a1d22; }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.sidebar {
		grid-area: sidebar;
		overflow-y: auto;
		background: #0f1216;
		border-right: 1px solid #1c2128;
		padding: 20px 0;
	}
	.sidebar h3 {
		margin: 0 0 8px;
		padding: 0 20px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #71717a;
	}
	.template-card {
		display: block;
		margin: 8px 16px;
		padding: 14px;
		background: #181b21;
		border: 1px solid #232830;
		border-radius: 10px;
		cursor: pointer;
		transition: border 0.12s, background 0.12s;
	}
	.template-card:hover { border-color: #3a4150; background: #1c2027; }
	.template-card.active {
		border-color: #6366f1;
		background: linear-gradient(180deg, rgba(99,102,241,0.08), rgba(99,102,241,0));
	}
	.template-card .label { font-weight: 600; margin-bottom: 4px; }
	.template-card .tagline { color: #a1a1aa; font-size: 12px; line-height: 1.45; }
	.template-card .hint { color: #71717a; font-size: 11px; line-height: 1.5; margin-top: 8px; }

	.stage {
		grid-area: stage;
		overflow: auto;
		background: #15181d;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 32px 28px;
	}
	.stage-frame {
		width: 100%;
		max-width: 980px;
		min-height: calc(100vh - 56px - 64px);
		background: var(--page-bg, #ffffff);
		color: var(--page-fg, #0f172a);
		border-radius: 16px;
		box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5), 0 0 0 1px #1c2128;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.stage-frame header {
		padding: 20px 32px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid rgba(0,0,0,0.06);
	}
	.stage-frame header .brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
	}
	.stage-frame header .brand .swatch {
		width: 18px;
		height: 18px;
		border-radius: 5px;
		background: var(--brand, #6366f1);
	}
	.stage-frame header .links {
		display: flex;
		gap: 18px;
		font-size: 13px;
		color: #64748b;
	}
	.stage-frame header .links a { color: inherit; text-decoration: none; }
	.stage-frame header .links a:hover { color: var(--brand, #6366f1); }
	.stage-frame .hero {
		flex: 1;
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: 32px;
		padding: 48px 32px 64px;
		align-items: center;
	}
	.stage-frame .hero-copy h1 {
		font-size: clamp(28px, 4vw, 44px);
		line-height: 1.1;
		margin: 0 0 16px;
		letter-spacing: -0.02em;
	}
	.stage-frame .hero-copy p {
		font-size: 17px;
		line-height: 1.55;
		color: #475569;
		margin: 0 0 28px;
	}
	.stage-frame .cta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 14px 22px;
		font-size: 15px;
		font-weight: 600;
		color: #fff;
		background: var(--brand, #6366f1);
		border: 0;
		border-radius: 12px;
		cursor: pointer;
		box-shadow: 0 6px 20px -8px var(--brand, #6366f1);
		transition: transform 0.12s;
	}
	.stage-frame .cta:hover { filter: brightness(1.06); }
	.stage-frame .price-chip {
		margin-left: 12px;
		font-size: 13px;
		color: #64748b;
	}
	.stage-frame .avatar-stage {
		position: relative;
		min-height: 360px;
		border-radius: 16px;
		background: linear-gradient(160deg, var(--brand, #6366f1) 0%, #1e1b4b 100%);
		overflow: hidden;
	}
	.stage-frame .avatar-stage agent-3d {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.stage-frame footer {
		padding: 14px 32px;
		font-size: 12px;
		color: #94a3b8;
		text-align: center;
		border-top: 1px solid rgba(0,0,0,0.05);
	}
	.stage-frame footer a { color: inherit; text-decoration: underline; }

	.rail {
		grid-area: rail;
		overflow-y: auto;
		background: #0f1216;
		border-left: 1px solid #1c2128;
	}
	.panel {
		padding: 18px 20px;
		border-bottom: 1px solid #1c2128;
	}
	.panel h4 {
		margin: 0 0 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #71717a;
	}
	.field { margin-bottom: 12px; }
	.field:last-child { margin-bottom: 0; }
	.field label {
		display: block;
		font-size: 12px;
		color: #a1a1aa;
		margin-bottom: 5px;
	}
	.field input, .field select, .field textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		color: #f4f4f5;
		background: #181b21;
		border: 1px solid #262b32;
		border-radius: 7px;
		outline: none;
	}
	.field input:focus, .field select:focus, .field textarea:focus {
		border-color: #6366f1;
	}
	.field textarea { min-height: 60px; resize: vertical; }
	.field .help { color: #71717a; font-size: 11px; margin-top: 4px; line-height: 1.4; }
	.field .row { display: flex; gap: 8px; }
	.field .row > * { flex: 1; }
	.color-input {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.color-input input[type=color] {
		width: 36px;
		height: 32px;
		padding: 0;
		border: 1px solid #262b32;
		border-radius: 6px;
		background: #181b21;
		cursor: pointer;
	}
	.color-input input[type=text] {
		font-family: ui-monospace, monospace;
		text-transform: uppercase;
	}

	.avatar-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.avatar-tile {
		aspect-ratio: 1;
		background: #181b21;
		border: 1px solid #262b32;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 4px;
		font-size: 10px;
		color: #a1a1aa;
		text-align: center;
		overflow: hidden;
		transition: border 0.12s;
	}
	.avatar-tile:hover { border-color: #3a4150; }
	.avatar-tile.active { border-color: #6366f1; box-shadow: inset 0 0 0 1px #6366f1; }

	.publish-status {
		font-size: 12px;
		color: #a1a1aa;
		line-height: 1.5;
	}
	.publish-status.ok { color: #4ade80; }
	.publish-status.err { color: #f87171; }
	.share-url {
		display: flex;
		gap: 6px;
		margin-top: 10px;
	}
	.share-url input {
		flex: 1;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}

	.snippet {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		line-height: 1.5;
		background: #0a0c0f;
		color: #cbd5e1;
		border: 1px solid #1c2128;
		border-radius: 8px;
		padding: 10px 12px;
		max-height: 220px;
		overflow: auto;
		white-space: pre;
	}
	.snippet-actions { display: flex; gap: 6px; margin-top: 8px; }

	.stage-frame.dark { --page-bg: #0f1216; --page-fg: #f4f4f5; }
	.stage-frame.dark header { border-bottom-color: rgba(255,255,255,0.06); }
	.stage-frame.dark header .links { color: #94a3b8; }
	.stage-frame.dark .hero-copy p { color: #cbd5e1; }
	.stage-frame.dark .price-chip { color: #94a3b8; }
	.stage-frame.dark footer { border-top-color: rgba(255,255,255,0.05); color: #64748b; }
`;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (s) =>
	String(s || '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);

function loadDraft() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}
function saveDraft(state) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// quota — non-fatal; published config is the source of truth.
	}
}

function defaultStateFor(templateId) {
	const tpl = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
	return {
		template: tpl.id,
		identity: { slug: '', brand: '#6366f1', wallet: '', website: '', theme: 'light' },
		avatar: { src: DEFAULT_AVATAR_SRC, name: 'Default' },
		copy: { tagline: tpl.defaultTagline, cta: tpl.defaultCta, headline: tpl.label },
		token: { name: '', ticker: '', supply: 1_000_000_000 },
		skill: { name: 'concierge', priceUsdc: 0.01 },
		scene: { src: '' },
		monetize: {
			kind: tpl.monetize.kind,
			price: tpl.monetize.defaultPrice,
			currency: tpl.monetize.currency,
			chain: tpl.monetize.chain,
		},
		published: null, // { slug, url, publishedAt }
	};
}

function mergeOptions(state, opts) {
	if (opts.template && TEMPLATES.find((t) => t.id === opts.template)) state.template = opts.template;
	if (opts.slug) state.identity.slug = slugify(opts.slug);
	if (opts.wallet) state.identity.wallet = String(opts.wallet);
	if (opts.website) state.identity.website = String(opts.website);
	if (opts.avatarSrc) state.avatar = { src: String(opts.avatarSrc), name: 'Custom' };
	return state;
}

// ──────────────────────────────────────────────────────────────────────────
// Snippets — what the user copies out
// ──────────────────────────────────────────────────────────────────────────
function buildEmbedSnippet(state) {
	const slug = state.identity.slug || '<your-slug>';
	return `<!-- Drop on any page to mount your three.ws launchpad -->
<script type="module"
  src="${AGENT_3D_HOST}/launchpad.js?v=${AGENT_3D_VERSION}"
  data-slug="${slug}">
</script>`;
}

function buildSkillManifest(state) {
	const tpl = TEMPLATES.find((t) => t.id === state.template) || TEMPLATES[0];
	const slug = state.identity.slug || 'unpublished';
	const manifest = {
		name: `launchpad.${slug}`,
		version: '1.0.0',
		description: `${tpl.label} hosted by ${state.copy.headline || slug} on three.ws`,
		template: tpl.id,
		homepage: `${AGENT_3D_HOST}/p/${slug}`,
		input_schema:
			tpl.id === 'token-launchpad'
				? {
					type: 'object',
					properties: { tokenName: { type: 'string' }, tokenTicker: { type: 'string' } },
					required: ['tokenName', 'tokenTicker'],
				}
				: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
		pricing: {
			price: state.monetize.price,
			currency: state.monetize.currency,
			chain: state.monetize.chain,
			payout_address: state.identity.wallet || null,
		},
		x402: {
			endpoint: `${AGENT_3D_HOST}/api/launchpad/invoke?slug=${slug}`,
			facilitator: state.monetize.chain === 'base' ? 'cdp' : 'pump',
		},
	};
	return JSON.stringify(manifest, null, 2);
}

function formatPrice(m) {
	if (!m || !m.price) return '';
	const n = Number(m.price);
	if (!isFinite(n) || n <= 0) return '';
	return `${n} ${m.currency || ''}`.trim();
}
function short(addr) {
	if (!addr) return '';
	const s = String(addr);
	if (s.length <= 12) return s;
	return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
function extraCopyFor(state, tpl) {
	if (tpl.id === 'token-launchpad') {
		const t = state.token;
		const parts = [];
		if (t.name) parts.push(t.name);
		if (t.ticker) parts.push(`($${t.ticker})`);
		if (parts.length)
			return `Launching ${parts.join(' ')} on Pump.fun. Creator fees route to ${short(state.identity.wallet) || 'your wallet'}.`;
		return 'Set a token name and ticker on the right to seed the launch.';
	}
	if (tpl.id === 'paid-concierge') {
		return `Ask a question and pay ${formatPrice(state.monetize)} per call in USDC. Replies stream from the configured agent skill.`;
	}
	if (tpl.id === 'gated-showroom') {
		return `One-time ${formatPrice(state.monetize)} pass unlocks a private 3D scene${state.scene.src ? '' : ' — drop in any glTF/GLB URL on the right.'}`;
	}
	return tpl.tagline;
}

function buildPagePreviewHTML(state) {
	const tpl = TEMPLATES.find((t) => t.id === state.template) || TEMPLATES[0];
	const brand = state.identity.brand || '#6366f1';
	const headline = state.copy.headline || tpl.label;
	const tagline = state.copy.tagline || tpl.defaultTagline;
	const cta = state.copy.cta || tpl.defaultCta;
	const website = state.identity.website || '';
	const avatarSrc = state.avatar.src || DEFAULT_AVATAR_SRC;
	const themeClass = state.identity.theme === 'dark' ? 'dark' : '';
	const priceLabel = formatPrice(state.monetize);
	const slug = state.identity.slug || 'preview';
	return `
		<div class="stage-frame ${themeClass}" style="--brand: ${esc(brand)}">
			<header>
				<div class="brand">
					<span class="swatch"></span>
					<span>${esc(headline)}</span>
				</div>
				<nav class="links">
					${website ? `<a href="${esc(website)}" target="_blank" rel="noopener">Website</a>` : ''}
					<a href="${AGENT_3D_HOST}/p/${esc(slug)}" target="_blank" rel="noopener">Powered by three.ws</a>
				</nav>
			</header>
			<div class="hero">
				<div class="hero-copy">
					<h1>${esc(tagline)}</h1>
					<p>${esc(extraCopyFor(state, tpl))}</p>
					<button class="cta" type="button" data-preview-cta>${esc(cta)}</button>
					${priceLabel ? `<span class="price-chip">${esc(priceLabel)}</span>` : ''}
				</div>
				<div class="avatar-stage">
					<agent-3d
						src="${esc(avatarSrc)}"
						background="transparent"
						camera-controls="auto"
						auto-rotate
					></agent-3d>
				</div>
			</div>
			<footer>
				Hosted on <a href="${AGENT_3D_HOST}" target="_blank" rel="noopener">three.ws</a> ·
				wallet ${esc(short(state.identity.wallet) || 'not connected')}
			</footer>
		</div>
	`;
}

// ──────────────────────────────────────────────────────────────────────────
// Avatar gallery — pulls real public avatars from /api/avatars/public.
// ──────────────────────────────────────────────────────────────────────────
async function fetchPublicAvatars() {
	try {
		const r = await fetch('/api/avatars/public?limit=18');
		if (!r.ok) return [];
		const data = await r.json();
		return Array.isArray(data?.avatars) ? data.avatars : [];
	} catch {
		return [];
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Publish — POST to /api/launchpad/publish, real backend.
// ──────────────────────────────────────────────────────────────────────────
async function publishLaunchpad(state) {
	const slug = slugify(state.identity.slug);
	if (!slug) throw new Error('Choose a URL slug first.');
	if (!state.identity.wallet) throw new Error('Add your payout wallet address.');

	const body = {
		slug,
		template: state.template,
		identity: state.identity,
		avatar: state.avatar,
		copy: state.copy,
		token: state.token,
		skill: state.skill,
		scene: state.scene,
		monetize: state.monetize,
	};
	const r = await fetch('/api/launchpad/publish', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(data?.error || `Publish failed (${r.status})`);
	return data;
}

// ──────────────────────────────────────────────────────────────────────────
// Mount
// ──────────────────────────────────────────────────────────────────────────
export function mountLaunchpadStudio(root, options = {}) {
	if (!root) throw new Error('mountLaunchpadStudio: root element required');

	const styleEl = document.createElement('style');
	styleEl.textContent = STYLE;
	document.head.appendChild(styleEl);

	const state = mergeOptions(loadDraft() || defaultStateFor(options.template || 'token-launchpad'), options);

	root.innerHTML = `
		<div class="studio-root">
			<div class="topbar">
				<div class="brand">
					<span class="dot"></span>
					<span>Launchpad Studio</span>
					<span class="pill">Template-driven</span>
				</div>
				<div class="actions">
					<a class="btn ghost" href="/embed" title="The original place-and-scale embed editor">Open classic editor</a>
					<button class="btn" data-action="reset">Reset draft</button>
					<button class="btn primary" data-action="publish">Publish</button>
				</div>
			</div>
			<aside class="sidebar">
				<h3>Templates</h3>
				<div data-templates></div>
				<h3 style="margin-top: 18px">Avatars</h3>
				<div class="panel" style="border:0; padding-top: 0">
					<div class="avatar-grid" data-avatar-grid></div>
				</div>
			</aside>
			<main class="stage" data-stage></main>
			<aside class="rail" data-rail></aside>
		</div>
	`;

	const tplWrap = $('[data-templates]', root);
	tplWrap.innerHTML = TEMPLATES.map(
		(t) => `
		<div class="template-card ${t.id === state.template ? 'active' : ''}" data-template-id="${t.id}">
			<div class="label">${esc(t.label)}</div>
			<div class="tagline">${esc(t.tagline)}</div>
			<div class="hint">${esc(t.hint)}</div>
		</div>`,
	).join('');
	tplWrap.addEventListener('click', (e) => {
		const card = e.target.closest('[data-template-id]');
		if (!card) return;
		const id = card.dataset.templateId;
		if (id === state.template) return;
		state.template = id;
		const tpl = TEMPLATES.find((t) => t.id === id);
		state.copy.headline = tpl.label;
		state.copy.tagline = tpl.defaultTagline;
		state.copy.cta = tpl.defaultCta;
		state.monetize = {
			kind: tpl.monetize.kind,
			price: tpl.monetize.defaultPrice,
			currency: tpl.monetize.currency,
			chain: tpl.monetize.chain,
		};
		render();
	});

	const avatarWrap = $('[data-avatar-grid]', root);
	function renderAvatars(list) {
		avatarWrap.innerHTML = list
			.map(
				(a) => `
			<div class="avatar-tile ${a.model_url === state.avatar.src ? 'active' : ''}"
				data-avatar-src="${esc(a.model_url)}"
				data-avatar-name="${esc(a.name || a.id)}"
				title="${esc(a.name || a.id)}">
				${esc((a.name || a.id || '').slice(0, 14))}
			</div>`,
			).join('');
	}
	renderAvatars(DEMO_AVATARS);
	fetchPublicAvatars().then((extras) => {
		const seen = new Set(DEMO_AVATARS.map((a) => a.model_url));
		const merged = [...DEMO_AVATARS, ...extras.filter((a) => a.model_url && !seen.has(a.model_url))];
		renderAvatars(merged);
	});
	avatarWrap.addEventListener('click', (e) => {
		const tile = e.target.closest('[data-avatar-src]');
		if (!tile) return;
		state.avatar = { src: tile.dataset.avatarSrc, name: tile.dataset.avatarName };
		render();
	});

	root.addEventListener('click', async (e) => {
		const action = e.target.closest('[data-action]')?.dataset.action;
		if (!action) return;
		if (action === 'reset') {
			localStorage.removeItem(STORAGE_KEY);
			Object.assign(state, defaultStateFor(state.template));
			render();
			return;
		}
		if (action === 'publish') {
			const btn = e.target.closest('[data-action="publish"]');
			btn.disabled = true;
			const orig = btn.textContent;
			btn.textContent = 'Publishing…';
			try {
				const result = await publishLaunchpad(state);
				state.published = {
					slug: result.slug,
					url: result.url || `${AGENT_3D_HOST}/p/${result.slug}`,
					publishedAt: result.publishedAt || new Date().toISOString(),
				};
			} catch (err) {
				state.published = { error: err.message || String(err) };
			} finally {
				btn.disabled = false;
				btn.textContent = orig;
				render();
			}
			return;
		}
		if (action === 'copy-embed' || action === 'copy-skill' || action === 'copy-share') {
			const text =
				action === 'copy-embed'
					? buildEmbedSnippet(state)
					: action === 'copy-skill'
						? buildSkillManifest(state)
						: state.published?.url || '';
			if (!text) return;
			try {
				await navigator.clipboard.writeText(text);
				const btn = e.target.closest('button');
				const orig = btn.textContent;
				btn.textContent = 'Copied';
				setTimeout(() => { btn.textContent = orig; }, 1200);
			} catch {
				// Clipboard blocked — select the snippet so the user can ⌘C manually.
				const snip = e.target.closest('.panel')?.querySelector('.snippet');
				if (snip) {
					const range = document.createRange();
					range.selectNodeContents(snip);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				}
			}
		}
	});

	function render() {
		saveDraft(state);
		const stage = $('[data-stage]', root);
		stage.innerHTML = buildPagePreviewHTML(state);
		const cta = stage.querySelector('[data-preview-cta]');
		if (cta) {
			cta.addEventListener('click', () => {
				cta.style.transform = 'scale(0.97)';
				setTimeout(() => { cta.style.transform = ''; }, 120);
			});
		}
		$('[data-rail]', root).innerHTML = buildRailHTML(state);
		bindRailInputs(root, state, render);
		root.querySelectorAll('[data-template-id]').forEach((el) => {
			el.classList.toggle('active', el.dataset.templateId === state.template);
		});
		root.querySelectorAll('[data-avatar-src]').forEach((el) => {
			el.classList.toggle('active', el.dataset.avatarSrc === state.avatar.src);
		});
	}

	render();

	return {
		getState: () => JSON.parse(JSON.stringify(state)),
		render,
	};
}

// ──────────────────────────────────────────────────────────────────────────
// Right rail — form panels driven by template, plus publish + snippets.
// ──────────────────────────────────────────────────────────────────────────
function buildRailHTML(state) {
	const tpl = TEMPLATES.find((t) => t.id === state.template) || TEMPLATES[0];
	const has = (f) => tpl.fields.includes(f);

	const identityPanel = `
		<div class="panel">
			<h4>Identity</h4>
			${has('slug') ? field('Public URL slug', `<input type="text" data-bind="identity.slug" value="${esc(state.identity.slug)}" placeholder="yourname" />`, `Your page will live at ${AGENT_3D_HOST}/p/${state.identity.slug || '<slug>'}`) : ''}
			${has('brand') ? field('Brand color', `
				<div class="color-input">
					<input type="color" data-bind="identity.brand" value="${esc(state.identity.brand)}" />
					<input type="text" data-bind="identity.brand" value="${esc(state.identity.brand)}" />
				</div>`) : ''}
			${has('wallet') ? field('Payout wallet', `<input type="text" data-bind="identity.wallet" value="${esc(state.identity.wallet)}" placeholder="${state.monetize.chain === 'solana' ? 'Sol... (base58)' : '0x... (EVM)'}" />`, 'Receives launch fees / x402 payments.') : ''}
			${has('website') ? field('Your website (optional)', `<input type="text" data-bind="identity.website" value="${esc(state.identity.website)}" placeholder="https://your-site.com" />`) : ''}
			${field('Theme', `
				<select data-bind="identity.theme">
					<option value="light" ${state.identity.theme === 'light' ? 'selected' : ''}>Light</option>
					<option value="dark" ${state.identity.theme === 'dark' ? 'selected' : ''}>Dark</option>
				</select>`)}
		</div>
	`;

	const copyPanel = `
		<div class="panel">
			<h4>Page copy</h4>
			${field('Headline', `<input type="text" data-bind="copy.headline" value="${esc(state.copy.headline)}" />`)}
			${field('Tagline', `<textarea data-bind="copy.tagline">${esc(state.copy.tagline)}</textarea>`)}
			${field('CTA button label', `<input type="text" data-bind="copy.cta" value="${esc(state.copy.cta)}" />`)}
		</div>
	`;

	let templatePanel = '';
	if (tpl.id === 'token-launchpad') {
		templatePanel = `
			<div class="panel">
				<h4>Token</h4>
				${field('Token name', `<input type="text" data-bind="token.name" value="${esc(state.token.name)}" placeholder="My Coin" />`)}
				${field('Ticker', `<input type="text" data-bind="token.ticker" value="${esc(state.token.ticker)}" placeholder="MOON" maxlength="10" />`)}
				${field('Initial supply', `<input type="number" data-bind="token.supply" value="${state.token.supply}" min="1" />`)}
				${field('Launch fee (SOL)', `<input type="number" step="0.001" data-bind="monetize.price" value="${state.monetize.price}" />`, 'Charged to each visitor that mints. Routes to your wallet via Pump.fun creator fee split.')}
			</div>
		`;
	} else if (tpl.id === 'paid-concierge') {
		templatePanel = `
			<div class="panel">
				<h4>Skill</h4>
				${field('Skill name', `<input type="text" data-bind="skill.name" value="${esc(state.skill.name)}" placeholder="concierge" />`)}
				${field('Price per call (USDC)', `<input type="number" step="0.001" data-bind="monetize.price" value="${state.monetize.price}" />`, 'x402 charges visitors per question. Settled instantly to your wallet.')}
				${field('Chain', `
					<select data-bind="monetize.chain">
						<option value="base" ${state.monetize.chain === 'base' ? 'selected' : ''}>Base</option>
						<option value="polygon" ${state.monetize.chain === 'polygon' ? 'selected' : ''}>Polygon</option>
					</select>`)}
			</div>
		`;
	} else if (tpl.id === 'gated-showroom') {
		templatePanel = `
			<div class="panel">
				<h4>Gated scene</h4>
				${field('Scene URL (glTF / GLB)', `<input type="text" data-bind="scene.src" value="${esc(state.scene.src)}" placeholder="https://.../room.glb" />`)}
				${field('Unlock fee (USDC)', `<input type="number" step="0.001" data-bind="monetize.price" value="${state.monetize.price}" />`, 'One-time payment unlocks the scene for the visitor wallet for 24 h.')}
			</div>
		`;
	}

	const publishPanel = `
		<div class="panel">
			<h4>Publish</h4>
			${publishStatusHTML(state)}
		</div>
	`;

	const snippetsPanel = `
		<div class="panel">
			<h4>Embed snippet</h4>
			<div class="snippet">${esc(buildEmbedSnippet(state))}</div>
			<div class="snippet-actions">
				<button class="btn" data-action="copy-embed">Copy embed</button>
			</div>
		</div>
		<div class="panel">
			<h4>Agent skill manifest</h4>
			<div class="snippet">${esc(buildSkillManifest(state))}</div>
			<div class="snippet-actions">
				<button class="btn" data-action="copy-skill">Copy skill JSON</button>
			</div>
		</div>
	`;

	return identityPanel + copyPanel + templatePanel + publishPanel + snippetsPanel;
}

function publishStatusHTML(state) {
	if (!state.published) {
		return `<div class="publish-status">Set a slug + payout wallet, then hit Publish to mint your hosted page at ${AGENT_3D_HOST}/p/&lt;slug&gt;.</div>`;
	}
	if (state.published.error) {
		return `<div class="publish-status err">${esc(state.published.error)}</div>`;
	}
	const url = state.published.url || `${AGENT_3D_HOST}/p/${state.published.slug}`;
	return `
		<div class="publish-status ok">Live at ${esc(url)}</div>
		<div class="share-url">
			<input type="text" readonly value="${esc(url)}" />
			<button class="btn" data-action="copy-share">Copy</button>
		</div>
	`;
}

function field(label, input, help) {
	return `
		<div class="field">
			<label>${esc(label)}</label>
			${input}
			${help ? `<div class="help">${esc(help)}</div>` : ''}
		</div>
	`;
}

function bindRailInputs(root, state, render) {
	root.querySelectorAll('[data-bind]').forEach((el) => {
		const path = el.dataset.bind.split('.');
		el.addEventListener('input', () => {
			let cur = state;
			for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] = cur[path[i]] || {};
			let value = el.type === 'number' ? Number(el.value) : el.value;
			if (path[path.length - 1] === 'slug') value = slugify(value);
			cur[path[path.length - 1]] = value;
			// Brand color: keep both inputs in sync, hot-update preview, skip full re-render.
			if (el.dataset.bind === 'identity.brand') {
				root.querySelectorAll('[data-bind="identity.brand"]').forEach((peer) => {
					if (peer !== el) peer.value = value;
				});
				const frame = root.querySelector('.stage-frame');
				if (frame) frame.style.setProperty('--brand', value);
				saveDraft(state);
				return;
			}
			render();
		});
	});
}
