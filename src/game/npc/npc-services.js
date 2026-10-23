// Townsfolk-as-services: every interactive NPC fronts a real three.ws x402
// endpoint. Walk up, press E, fill the little counter form, pay the micro-fee
// from your wallet, and the service runs for real — no mocks, no "coming soon".
//
// This module owns two things:
//   1. SERVICES — a registry mapping a short id to one paid endpoint: its
//      price, the form fields the player fills in, how to turn those into the
//      request, and how to render the settled result in-world.
//   2. openService(id, { npc, ui }) — the panel that npc-catalog.js calls on
//      interact. It renders the counter, runs the wallet payment through the
//      shared window.X402.pay() checkout, and shows the result the NPC "sells".
//
// Payment is the canonical browser path used everywhere else in the app
// (public/tutor.js, public/bazaar.js, public/x402-paywall.js): window.X402.pay
// mounts the on-chain checkout, settles USDC on Base or Solana, and resolves
// { ok, result } where `result` is the endpoint's 200 JSON body.
//
// The x402 SDK (public/x402.js) is not loaded by the world page, so we import
// it on demand the first time a player transacts — one network fetch, cached
// (src/shared/x402-loader.js).

import { ensureX402 } from '../../shared/x402-loader.js';
import { shortAddress as shortAddr } from '../../shared/address.js';

// ── tiny DOM helper (self-contained; mirrors the app's el() conventions) ──────
function el(tag, attrs, kids) {
	const node = document.createElement(tag);
	if (attrs) {
		for (const [k, v] of Object.entries(attrs)) {
			if (v == null || v === false) continue;
			if (k === 'class') node.className = v;
			else if (k === 'text') node.textContent = v;
			else if (k === 'html') node.innerHTML = v;
			else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
			else node.setAttribute(k, v === true ? '' : v);
		}
	}
	for (const kid of [].concat(kids || [])) {
		if (kid == null || kid === false) continue;
		node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
	}
	return node;
}

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// ── small render helpers shared by result views ──────────────────────────────
function kv(label, value) {
	return el('div', { class: 'npc-svc-kv' }, [
		el('span', { class: 'npc-svc-kv-k', text: label }),
		el('span', { class: 'npc-svc-kv-v', text: value }),
	]);
}
function pill(text, tone) {
	return el('span', { class: `npc-svc-pill${tone ? ' is-' + tone : ''}`, text });
}
function fmtUsd(n) {
	if (n == null || Number.isNaN(Number(n))) return '—';
	const v = Number(n);
	if (v >= 1) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
	return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}
function fmtPct(n) {
	if (n == null || Number.isNaN(Number(n))) return '—';
	const v = Number(n);
	return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function atomicsToUsdc(a) {
	const n = Number(a);
	return Number.isFinite(n) ? '$' + (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
}

// ── service registry ─────────────────────────────────────────────────────────
// Each entry:
//   title       headline shown in the panel
//   merchant    name shown in the wallet checkout
//   price       human price chip ("$0.01")
//   action      verb on the pay button ("Get signal")
//   intro       one-line description of what the player buys
//   endpoint    base path; GET services append a query string
//   method      'GET' | 'POST'
//   fields[]    { name, label, type, placeholder?, default?, required?, options?, help? }
//   query(v)    -> object of GET query params (GET services)
//   body(v)     -> request body object (POST services)
//   render(r,m) -> append a DOM result view for the settled response `r` to `m`
export const SERVICES = {
	'crypto-intel': {
		title: 'Market Signal',
		merchant: 'three.ws Trading Desk',
		price: '$0.01',
		action: 'Get the read',
		intro: 'A live bullish / bearish / neutral call on any token — price, 24h move, and a two-line rationale off real CoinGecko data.',
		endpoint: '/api/x402/crypto-intel',
		method: 'POST',
		fields: [
			{ name: 'topic', label: 'Token', type: 'text', placeholder: 'sol · btc · eth · doge…', default: 'sol', required: true, help: 'Ticker or CoinGecko id.' },
		],
		body: (v) => ({ topic: v.topic.trim().toLowerCase() }),
		render: (r, m) => {
			const tone = r.signal === 'bullish' ? 'up' : r.signal === 'bearish' ? 'down' : 'flat';
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [
				pill((r.signal || 'neutral').toUpperCase(), tone),
				el('span', { class: 'npc-svc-topic', text: String(r.topic || '').toUpperCase() }),
			]));
			if (r.headline) m.appendChild(el('p', { class: 'npc-svc-lede', text: r.headline }));
			m.appendChild(el('div', { class: 'npc-svc-grid' }, [
				kv('Price', fmtUsd(r.price_usd)),
				kv('24h', fmtPct(r.change_24h)),
				kv('Confidence', r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'),
			]));
			if (r.rationale) m.appendChild(el('p', { class: 'npc-svc-note', text: r.rationale }));
		},
	},

	'fact-check': {
		title: 'Fact Check',
		merchant: 'three.ws Verification',
		price: '$0.10',
		action: 'Get the verdict',
		intro: 'Bring a claim. Multi-source search, stance analysis, and a weighted verdict come back with citations and an on-chain attestation.',
		endpoint: '/api/x402/fact-check',
		method: 'POST',
		fields: [
			{ name: 'claim', label: 'Claim', type: 'textarea', placeholder: 'e.g. Solana settles transactions in under a second.', required: true, maxlength: 500 },
			{ name: 'strictness', label: 'Strictness', type: 'select', default: 'medium', options: [
				{ value: 'high', label: 'High — demand strong sourcing' },
				{ value: 'medium', label: 'Medium — balanced' },
				{ value: 'low', label: 'Low — quick read' },
			] },
		],
		body: (v) => ({ claim: v.claim.trim(), strictness: v.strictness }),
		render: (r, m) => {
			const verdict = String(r.verdict || 'unverified').toLowerCase();
			const tone = /true|support/.test(verdict) ? 'up' : /false|refut/.test(verdict) ? 'down' : 'flat';
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [
				pill(verdict.toUpperCase(), tone),
				r.confidence != null ? el('span', { class: 'npc-svc-topic', text: Math.round(r.confidence * 100) + '% sure' }) : null,
			]));
			if (r.claim) m.appendChild(el('p', { class: 'npc-svc-lede', text: `“${r.claim}”` }));
			const sources = Array.isArray(r.sources) ? r.sources.slice(0, 5) : [];
			if (sources.length) {
				m.appendChild(el('div', { class: 'npc-svc-sublabel', text: 'Sources' }));
				m.appendChild(el('ul', { class: 'npc-svc-list' }, sources.map((s) =>
					el('li', {}, [el('a', { href: s.url || s.link || '#', target: '_blank', rel: 'noopener', text: s.title || s.url || s.link || 'source' })]),
				)));
			}
			if (r.attestation) m.appendChild(el('p', { class: 'npc-svc-mono', text: 'attestation ' + shortAddr(r.attestation.hash || r.attestation) }));
		},
	},

	'dance-tip': {
		title: 'Tip the Floor',
		merchant: 'three.ws Saloon',
		price: '$0.001',
		action: 'Send the tip',
		intro: 'Drop a coin and a dancer takes the stage at the club — pick the slot and the routine.',
		endpoint: '/api/x402/dance-tip',
		method: 'GET',
		fields: [
			{ name: 'dancer', label: 'Stage slot', type: 'select', default: '1', options: [
				{ value: '1', label: 'Dancer 1' }, { value: '2', label: 'Dancer 2' },
				{ value: '3', label: 'Dancer 3' }, { value: '4', label: 'Dancer 4' },
			] },
			{ name: 'dance', label: 'Routine', type: 'select', default: 'rumba', options: [
				{ value: 'rumba', label: 'Rumba' }, { value: 'hiphop', label: 'Hip Hop' },
				{ value: 'thriller', label: 'Thriller' }, { value: 'capoeira', label: 'Capoeira' },
				{ value: 'silly', label: 'Silly' }, { value: 'spin', label: 'Pole Spin' },
				{ value: 'climb', label: 'Climb + Invert' }, { value: 'combo', label: 'Pole Combo' },
			] },
		],
		query: (v) => ({ dancer: v.dancer, dance: v.dance }),
		render: (r, m) => {
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [pill(r.label || 'Booked', 'up')]));
			m.appendChild(el('p', { class: 'npc-svc-lede', text: `${r.label || 'A routine'} is queued on stage ${r.dancer || ''}.` }));
			if (r.durationSec) m.appendChild(kv('Length', r.durationSec + 's'));
			m.appendChild(el('p', { class: 'npc-svc-note', text: 'Head to the club to watch it play out — the floor remembers who paid.' }));
		},
	},

	vanity: {
		title: 'Vanity Grinder',
		merchant: 'three.ws Vanity',
		price: 'from $0.01',
		action: 'Grind a key',
		intro: 'I’ll mine you a brand-new Solana address that starts and/or ends with letters you choose. You keep the secret key.',
		endpoint: '/api/x402/vanity',
		method: 'GET',
		fields: [
			{ name: 'prefix', label: 'Starts with', type: 'text', placeholder: 'sun', help: 'Base58 only. Combined with suffix, max 3 chars.' },
			{ name: 'suffix', label: 'Ends with', type: 'text', placeholder: 'gg' },
		],
		validate: (v) => {
			const p = (v.prefix || '').trim(), s = (v.suffix || '').trim();
			if (!p && !s) return 'Enter a prefix, a suffix, or both.';
			if ((p + s).length > 3) return 'Keep prefix + suffix to 3 characters total.';
			if (/[0OIl]/.test(p + s)) return 'Base58 excludes 0, O, I and l — pick other letters.';
			return null;
		},
		query: (v) => ({ prefix: (v.prefix || '').trim() || undefined, suffix: (v.suffix || '').trim() || undefined }),
		render: (r, m) => {
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [pill('Minted', 'up')]));
			m.appendChild(el('div', { class: 'npc-svc-address' }, [
				el('code', { text: r.address || '' }),
				el('button', { class: 'npc-svc-copy', type: 'button', text: 'Copy', onclick: () => navigator.clipboard?.writeText(r.address || '') }),
			]));
			m.appendChild(el('div', { class: 'npc-svc-secret' }, [
				el('div', { class: 'npc-svc-sublabel', text: 'Secret key — save it now, shown once' }),
				el('code', { class: 'npc-svc-mono', text: r.privateKey || r.privateKeyBase58 || (Array.isArray(r.privateKey64) ? r.privateKey64.join(',') : '') }),
				el('button', { class: 'npc-svc-copy', type: 'button', text: 'Copy secret', onclick: () => navigator.clipboard?.writeText(r.privateKey || r.privateKeyBase58 || (Array.isArray(r.privateKey64) ? r.privateKey64.join(',') : '')) }),
			]));
			if (r.iterations) m.appendChild(kv('Tries', Number(r.iterations).toLocaleString()));
		},
	},

	'symbol-availability': {
		title: 'Symbol Check',
		merchant: 'three.ws Assay Office',
		price: '$0.001',
		action: 'Check the name',
		intro: 'Before you stake a ticker, I’ll tell you if it collides — exact matches plus look-alikes across pump.fun mints we index.',
		endpoint: '/api/x402/symbol-availability',
		method: 'GET',
		fields: [
			{ name: 'ticker', label: 'Ticker', type: 'text', placeholder: 'HELIO', required: true, maxlength: 16 },
			{ name: 'network', label: 'Network', type: 'select', default: 'mainnet', options: [
				{ value: 'mainnet', label: 'Mainnet' }, { value: 'devnet', label: 'Devnet' },
			] },
		],
		query: (v) => ({ ticker: v.ticker.trim().toUpperCase(), network: v.network }),
		render: (r, m) => {
			const taken = r.exact_collision;
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [
				pill(taken ? 'TAKEN' : 'AVAILABLE', taken ? 'down' : 'up'),
				el('span', { class: 'npc-svc-topic', text: String(r.ticker || '') }),
			]));
			if (r.recommendation) m.appendChild(el('p', { class: 'npc-svc-lede', text: r.recommendation }));
			const similar = Array.isArray(r.similar) ? r.similar.slice(0, 4) : [];
			if (similar.length) {
				m.appendChild(el('div', { class: 'npc-svc-sublabel', text: 'Look-alikes' }));
				m.appendChild(el('ul', { class: 'npc-svc-list' }, similar.map((s) =>
					el('li', { text: `${s.ticker} · ${(s.similarity * 100).toFixed(0)}% — ${s.name || shortAddr(s.mint)}` }),
				)));
			}
		},
	},

	'mint-to-mesh': {
		title: 'Mint → Mesh',
		merchant: 'three.ws Foundry',
		price: '$0.001',
		action: 'Forge the mesh',
		intro: 'Hand me a token mint and I’ll forge a themed 3D glTF cube from its on-chain metadata — colored by the mint, textured with its image.',
		endpoint: '/api/x402/mint-to-mesh',
		method: 'GET',
		fields: [
			{ name: 'mint', label: 'Token mint', type: 'text', placeholder: THREE_MINT, default: THREE_MINT, required: true },
		],
		query: (v) => ({ mint: v.mint.trim() }),
		render: (r, m) => {
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [pill('Forged', 'up')]));
			m.appendChild(el('p', { class: 'npc-svc-lede', text: 'Your glTF mesh is ready — drop it into any Three.js scene.' }));
			const b64 = r.glb || r.glbBase64 || r.model || r.data;
			if (b64) {
				const href = 'data:model/gltf-binary;base64,' + String(b64).replace(/^data:[^,]*,/, '');
				m.appendChild(el('a', { class: 'npc-svc-btn', href, download: (r.name || r.symbol || 'mesh') + '.glb', text: 'Download .glb' }));
			}
			if (r.name) m.appendChild(kv('Token', `${r.name}${r.symbol ? ' · ' + r.symbol : ''}`));
		},
	},

	'pump-agent-audit': {
		title: 'Books Audit',
		merchant: 'three.ws Audit Desk',
		price: '$0.02',
		action: 'Run the audit',
		intro: 'Give me a pump-agent token’s mint and I’ll pull its full payment ledger — volume in, payer count, distribution history, and risk flags.',
		endpoint: '/api/x402/pump-agent-audit',
		method: 'GET',
		fields: [
			{ name: 'mint', label: 'Token mint', type: 'text', placeholder: 'pump.fun SPL mint…', required: true },
		],
		query: (v) => ({ mint: v.mint.trim() }),
		render: (r, m) => {
			const flags = Array.isArray(r.risk_flags) ? r.risk_flags : [];
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [
				pill(flags.length ? `${flags.length} FLAG${flags.length > 1 ? 'S' : ''}` : 'CLEAN', flags.length ? 'down' : 'up'),
				el('span', { class: 'npc-svc-topic', text: r.symbol || r.name || shortAddr(r.mint) }),
			]));
			const p = r.payments || {};
			m.appendChild(el('div', { class: 'npc-svc-grid' }, [
				kv('Paid in', atomicsToUsdc(p.total_in_atomics)),
				kv('Payers', p.distinct_payers != null ? String(p.distinct_payers) : '—'),
				kv('Confirmed', p.confirmed_count != null ? String(p.confirmed_count) : '—'),
				kv('Failed', p.failed_count != null ? String(p.failed_count) : '—'),
			]));
			if (flags.length) {
				m.appendChild(el('div', { class: 'npc-svc-sublabel', text: 'Risk flags' }));
				m.appendChild(el('ul', { class: 'npc-svc-list' }, flags.slice(0, 5).map((f) => el('li', { text: String(f) }))));
			}
		},
	},

	'agent-reputation': {
		title: 'Reputation Oracle',
		merchant: 'three.ws Oracle',
		price: '$0.01',
		action: 'Read the record',
		intro: 'Name an agent and I’ll read its on-chain record — coins deployed, USDC taken in, distinct payers, and attestation count.',
		endpoint: '/api/x402/agent-reputation',
		method: 'GET',
		fields: [
			{ name: 'agent_id', label: 'Agent id', type: 'text', placeholder: 'three.ws agent UUID', required: true },
		],
		query: (v) => ({ agent_id: v.agent_id.trim() }),
		render: (r, m) => {
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [
				pill('On record', 'up'),
				el('span', { class: 'npc-svc-topic', text: r.name || shortAddr(r.agent_id) }),
			]));
			const p = r.payments || {};
			m.appendChild(el('div', { class: 'npc-svc-grid' }, [
				kv('Coins', r.deployed_mints != null ? String(r.deployed_mints) : '—'),
				kv('Taken in', atomicsToUsdc(p.confirmed_amount_atomics)),
				kv('Payers', p.distinct_payers != null ? String(p.distinct_payers) : '—'),
			]));
			if (r.wallet_address) m.appendChild(kv('Wallet', shortAddr(r.wallet_address)));
		},
	},

	tutor: {
		title: 'Ask the Schoolmarm',
		merchant: 'three.ws Tutor',
		price: '$0.01',
		action: 'Ask',
		intro: 'A cent a question. Ask anything — code, crypto, the world — and get a structured, level-tuned answer with an example and a follow-up.',
		endpoint: '/api/x402/tutor',
		method: 'POST',
		fields: [
			{ name: 'question', label: 'Question', type: 'textarea', placeholder: 'Why does my recursive function overflow the stack?', required: true, maxlength: 600 },
			{ name: 'level', label: 'Level', type: 'select', default: 'intermediate', options: [
				{ value: 'beginner', label: 'Beginner' },
				{ value: 'intermediate', label: 'Intermediate' },
				{ value: 'expert', label: 'Expert' },
			] },
		],
		body: (v) => ({ question: v.question.trim(), level: v.level }),
		render: (r, m) => {
			if (r.answer) m.appendChild(el('p', { class: 'npc-svc-lede', text: r.answer }));
			const points = Array.isArray(r.keyPoints) ? r.keyPoints : [];
			if (points.length) {
				m.appendChild(el('div', { class: 'npc-svc-sublabel', text: 'Key points' }));
				m.appendChild(el('ul', { class: 'npc-svc-list' }, points.slice(0, 5).map((k) => el('li', { text: String(k) }))));
			}
			if (r.example) m.appendChild(el('pre', { class: 'npc-svc-code', text: String(r.example) }));
			if (r.followUp) m.appendChild(el('p', { class: 'npc-svc-note', text: 'Next: ' + r.followUp }));
		},
	},

	'pump-launch': {
		title: 'Launch a Coin',
		merchant: 'three.ws Launchpad',
		price: '$5.00',
		action: 'Deploy it',
		intro: 'Name it, give it a ticker and an image, and I deploy a live pump.fun token in one call — I front the SOL, you get the mint.',
		endpoint: '/api/x402/pump-launch',
		method: 'POST',
		fields: [
			{ name: 'name', label: 'Name', type: 'text', placeholder: 'Helios', required: true, maxlength: 32 },
			{ name: 'symbol', label: 'Ticker', type: 'text', placeholder: 'HELIO', required: true, maxlength: 10 },
			{ name: 'imageUrl', label: 'Image URL', type: 'text', placeholder: 'https://…/logo.png', required: true },
			{ name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional one-liner.', maxlength: 280 },
		],
		body: (v) => ({ name: v.name.trim(), symbol: v.symbol.trim().toUpperCase(), imageUrl: v.imageUrl.trim(), description: (v.description || '').trim() || undefined }),
		render: (r, m) => {
			m.appendChild(el('div', { class: 'npc-svc-headline' }, [pill('Live', 'up')]));
			m.appendChild(el('p', { class: 'npc-svc-lede', text: 'Your coin is deployed on pump.fun.' }));
			m.appendChild(el('div', { class: 'npc-svc-address' }, [
				el('code', { text: r.mint || '' }),
				el('button', { class: 'npc-svc-copy', type: 'button', text: 'Copy mint', onclick: () => navigator.clipboard?.writeText(r.mint || '') }),
			]));
			if (r.pumpFunUrl) m.appendChild(el('a', { class: 'npc-svc-btn', href: r.pumpFunUrl, target: '_blank', rel: 'noopener', text: 'Open on pump.fun' }));
		},
	},
};

// ── interaction panel ─────────────────────────────────────────────────────────
let openPanel = null; // single live panel at a time

function closePanel() {
	if (!openPanel) return;
	const { overlay, onKey, opener } = openPanel;
	document.removeEventListener('keydown', onKey, true);
	overlay.classList.remove('is-in');
	const node = overlay;
	setTimeout(() => node.remove(), 180);
	openPanel = null;
	if (opener && typeof opener.focus === 'function') opener.focus();
}

function buildField(field) {
	const id = `npc-svc-f-${field.name}`;
	let input;
	if (field.type === 'select') {
		input = el('select', { id, class: 'npc-svc-input' }, (field.options || []).map((o) =>
			el('option', { value: o.value, selected: (field.default ?? field.options[0]?.value) === o.value }, [o.label]),
		));
	} else if (field.type === 'textarea') {
		input = el('textarea', { id, class: 'npc-svc-input', rows: '3', placeholder: field.placeholder || '', maxlength: field.maxlength });
		if (field.default) input.value = field.default;
	} else {
		input = el('input', { id, class: 'npc-svc-input', type: 'text', placeholder: field.placeholder || '', maxlength: field.maxlength });
		if (field.default) input.value = field.default;
	}
	input.name = field.name;
	// Keep typing out of the world's movement/build handlers (window-level keydown).
	const swallow = (e) => e.stopPropagation();
	input.addEventListener('keydown', swallow);
	input.addEventListener('keyup', swallow);
	const wrap = el('label', { class: 'npc-svc-field', for: id }, [
		el('span', { class: 'npc-svc-field-label', text: field.label }),
		input,
		field.help ? el('span', { class: 'npc-svc-field-help', text: field.help }) : null,
	]);
	return { wrap, input, field };
}

// Open the service counter for an NPC. Resolves nothing — it manages its own
// lifecycle and the wallet checkout runs through window.X402.pay.
export function openService(serviceId, { npc, ui } = {}) {
	const svc = SERVICES[serviceId];
	if (!svc) return;
	closePanel(); // never stack two counters

	const titleId = `npc-svc-title-${serviceId}`;
	const card = el('div', { class: 'npc-svc-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
	const overlay = el('div', { class: 'npc-svc-overlay' }, [card]);
	overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePanel(); });

	// Header — who you're talking to, what they sell, what it costs.
	const close = el('button', { class: 'npc-svc-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: closePanel });
	card.appendChild(el('header', { class: 'npc-svc-head' }, [
		el('div', {}, [
			npc?.def?.name ? el('div', { class: 'npc-svc-who', text: npc.def.name }) : null,
			el('h2', { id: titleId, class: 'npc-svc-title', text: svc.title }),
		]),
		el('div', { class: 'npc-svc-price-wrap' }, [pill(svc.price, 'price')]),
		close,
	]));
	card.appendChild(el('p', { class: 'npc-svc-intro', text: svc.intro }));

	// Form.
	const form = el('form', { class: 'npc-svc-form' });
	const fields = (svc.fields || []).map(buildField);
	fields.forEach((f) => form.appendChild(f.wrap));
	const errBox = el('div', { class: 'npc-svc-error', role: 'alert', hidden: true });
	const result = el('div', { class: 'npc-svc-result', hidden: true });
	const payBtn = el('button', { class: 'npc-svc-pay', type: 'submit' }, [
		el('span', { class: 'npc-svc-pay-label', text: `${svc.action} · ${svc.price}` }),
	]);
	form.appendChild(errBox);
	form.appendChild(el('div', { class: 'npc-svc-actions' }, [
		el('button', { class: 'npc-svc-cancel', type: 'button', text: 'Not now', onclick: closePanel }),
		payBtn,
	]));
	card.appendChild(form);
	card.appendChild(result);

	function showError(msg) {
		errBox.textContent = msg;
		errBox.hidden = false;
	}
	function clearError() { errBox.hidden = true; errBox.textContent = ''; }

	function readValues() {
		const v = {};
		for (const f of fields) v[f.field.name] = f.input.value;
		return v;
	}

	function setBusy(busy) {
		payBtn.disabled = busy;
		payBtn.classList.toggle('is-busy', busy);
		fields.forEach((f) => { f.input.disabled = busy; });
		payBtn.querySelector('.npc-svc-pay-label').textContent = busy ? 'Opening wallet…' : `${svc.action} · ${svc.price}`;
	}

	let busy = false;
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (busy) return;
		clearError();
		const values = readValues();

		// Required + custom validation before we ever open the wallet.
		for (const f of fields) {
			if (f.field.required && !String(values[f.field.name] || '').trim()) {
				showError(`${f.field.label} is required.`);
				f.input.focus();
				return;
			}
		}
		if (svc.validate) {
			const msg = svc.validate(values);
			if (msg) { showError(msg); return; }
		}

		busy = true;
		setBusy(true);
		try {
			const X402 = await ensureX402();
			const opts = { endpoint: svc.endpoint, method: svc.method || 'GET', merchant: svc.merchant, action: svc.action };
			if (svc.method === 'POST' && svc.body) {
				opts.body = svc.body(values);
			} else if (svc.query) {
				const qs = new URLSearchParams();
				for (const [k, val] of Object.entries(svc.query(values))) {
					if (val != null && val !== '') qs.set(k, val);
				}
				const s = qs.toString();
				if (s) opts.endpoint += (opts.endpoint.includes('?') ? '&' : '?') + s;
			}

			const out = await X402.pay(opts);
			if (!out || !out.ok || out.result == null) {
				throw new Error((out && out.error) || 'Payment did not complete.');
			}

			// Settled — swap the form for the NPC's "product".
			form.hidden = true;
			result.hidden = false;
			result.textContent = '';
			result.appendChild(el('div', { class: 'npc-svc-settled', text: 'Paid · settled on-chain' }));
			const body = el('div', { class: 'npc-svc-payload' });
			try { svc.render(out.result, body); }
			catch { body.appendChild(el('pre', { class: 'npc-svc-code', text: JSON.stringify(out.result, null, 2) })); }
			result.appendChild(body);
			result.appendChild(el('div', { class: 'npc-svc-actions' }, [
				el('button', { class: 'npc-svc-cancel', type: 'button', text: 'Done', onclick: closePanel }),
				el('button', { class: 'npc-svc-pay', type: 'button', text: 'Buy again', onclick: () => {
					form.hidden = false; result.hidden = true; result.textContent = '';
					setBusy(false); fields[0]?.input.focus();
				} }),
			]));
			npc?.say?.('Pleasure doing business.');
		} catch (err) {
			const msg = String(err?.message || err || 'Something went wrong.');
			if (err?.code === 'cancelled' || /cancel|reject|denied|closed/i.test(msg)) {
				showError('Payment cancelled — no charge.');
			} else {
				showError(msg);
			}
			ui?.toast?.(svc.title + ' — ' + (/(cancel|reject)/i.test(msg) ? 'cancelled' : 'payment failed'), 'warn');
		} finally {
			busy = false;
			if (!result.hidden) return; // settled view took over
			setBusy(false);
		}
	});

	// Mount + focus + ESC.
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const onKey = (e) => {
		if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePanel(); }
	};
	document.addEventListener('keydown', onKey, true);
	document.body.appendChild(overlay);
	openPanel = { overlay, onKey, opener };
	requestAnimationFrame(() => {
		overlay.classList.add('is-in');
		fields[0]?.input.focus();
	});
}

export function isServicePanelOpen() { return !!openPanel; }
