/**
 * Interactive "try it" actions for the /create-review feature grid.
 *
 * Each of the six capability tiles on /create-review opens a real preview of
 * that capability — not a marketing modal. Voice spins up the actual talk
 * overlay against the staged GLB; the others render concrete, copy-able
 * examples (embed snippet, USDC pricing, Solana wallet shape, reputation
 * card) so the user sees what they're signing up for *before* the auth wall.
 *
 * Wiring lives in create-review.js. This module only owns: feature-modal DOM,
 * emote-strip behaviour, and the talk-overlay invocation.
 */

import { openTalkMode } from './voice/talk-mode.js';
import { downloadAvatar } from './avatar-export.js';
import { fbxFromBlob, downloadUrl } from './remesh-convert.js';
import { log } from './shared/log.js';

// ── Live platform stats ──────────────────────────────────────────────────────

// Real, public network counts from /api/home-stats. That endpoint's contract is
// "real numbers or { available:false }" — it never fabricates — so callers that
// get null here must hide their metric strip rather than invent figures.
async function fetchPlatformStats() {
	try {
		const res = await fetch('/api/home-stats', { headers: { accept: 'application/json' } });
		if (!res.ok) return null;
		const data = await res.json();
		return data && data.available ? data : null;
	} catch (err) {
		log.warn('[features] home-stats fetch failed:', err?.message || err);
		return null;
	}
}

// Compact human count: 1_204 → "1.2k", 2_000_000 → "2M".
function fmtCount(n) {
	const v = Number(n) || 0;
	if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + 'M';
	if (v >= 1_000) return (v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1) + 'k';
	return String(v);
}

// Compact USD for large figures: 3_435_701 → "$3.4M", 264_453 → "$264.5K".
function fmtUsd(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
	if (v >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'K';
	return '$' + v.toFixed(2);
}

// Token price, which can be sub-cent: 0.003435 → "$0.003435", 12.5 → "$12.50".
function fmtPrice(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || v <= 0) return null;
	if (v >= 1) return '$' + v.toFixed(2);
	// Show four significant digits below $1 so sub-cent prices stay legible.
	return '$' + v.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
}

// Signed 24h percent: -14.14 → "-14.1%", 8 → "+8.0%".
function fmtPct(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// ── Feature-preview modal ────────────────────────────────────────────────────

let activeModal = null;
let escHandler = null;
let keyTrapHandler = null;
let lastFocusedBeforeOpen = null;
const FOCUSABLE_SEL =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open a feature-preview modal. Body may be an HTMLElement or HTML string. */
export function openFeatureModal({ icon, title, lede, body, actions, dialogClass }) {
	closeFeatureModal();

	// Remember the tile (or any element) the user came from so focus can return
	// there on close — keyboard users get dropped back exactly where they were.
	lastFocusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;

	const backdrop = document.createElement('div');
	backdrop.className = 'fm-backdrop';
	backdrop.setAttribute('role', 'dialog');
	backdrop.setAttribute('aria-modal', 'true');
	backdrop.setAttribute('aria-labelledby', 'fm-title');
	backdrop.setAttribute('aria-describedby', 'fm-lede');
	backdrop.innerHTML = `
		<div class="fm-dialog${dialogClass ? ' ' + dialogClass : ''}" tabindex="-1">
			<div class="fm-head">
				<div class="fm-icon" aria-hidden="true">${icon}</div>
				<div class="fm-head-text">
					<h3 id="fm-title"></h3>
					<p id="fm-lede"></p>
				</div>
				<button class="fm-close" type="button" aria-label="Close">✕</button>
			</div>
			<div class="fm-body"></div>
			<div class="fm-actions"></div>
		</div>
	`;
	backdrop.querySelector('#fm-title').textContent = title;
	backdrop.querySelector('#fm-lede').textContent = lede;

	const bodyEl = backdrop.querySelector('.fm-body');
	if (body instanceof HTMLElement) bodyEl.appendChild(body);
	else if (typeof body === 'string') bodyEl.innerHTML = body;

	const actionsEl = backdrop.querySelector('.fm-actions');
	if (Array.isArray(actions) && actions.length) {
		for (const a of actions) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'fm-cta' + (a.ghost ? ' ghost' : '');
			btn.textContent = a.label;
			btn.addEventListener('click', () => {
				a.onClick?.();
				if (a.dismiss !== false) closeFeatureModal();
			});
			actionsEl.appendChild(btn);
		}
	} else {
		actionsEl.remove();
	}

	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) closeFeatureModal();
	});
	backdrop.querySelector('.fm-close').addEventListener('click', closeFeatureModal);

	escHandler = (e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			closeFeatureModal();
		}
	};
	document.addEventListener('keydown', escHandler);

	// Tab/Shift-Tab cycles focus inside the dialog only. Without this, the
	// underlying page tabs through anchors *behind* the modal — screen readers
	// and keyboard users see "modal open but focus is on the nav header."
	keyTrapHandler = (e) => {
		if (e.key !== 'Tab') return;
		const focusables = Array.from(backdrop.querySelectorAll(FOCUSABLE_SEL))
			.filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
		if (!focusables.length) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};
	backdrop.addEventListener('keydown', keyTrapHandler);

	// Lock page scroll while the modal owns the viewport.
	document.documentElement.style.overflow = 'hidden';

	document.body.appendChild(backdrop);
	activeModal = backdrop;

	// Wire any "Copy" buttons rendered inside the body.
	for (const copyBtn of backdrop.querySelectorAll('.fm-copy')) {
		copyBtn.addEventListener('click', async () => {
			const codeEl = copyBtn.closest('.fm-code');
			const text = codeEl?.dataset.copy ?? codeEl?.textContent.replace(/Copy\s*$/, '').trim();
			if (!text) return;
			try {
				await navigator.clipboard.writeText(text);
				copyBtn.classList.add('copied');
				copyBtn.textContent = 'Copied';
				setTimeout(() => {
					copyBtn.classList.remove('copied');
					copyBtn.textContent = 'Copy';
				}, 1600);
			} catch {
				copyBtn.textContent = 'Press ⌘C';
			}
		});
	}

	// Initial focus: first interactive control inside the body (CTA, copy
	// button, input) rather than the close X — this lets keyboard users hit
	// Enter immediately to act, not just dismiss.
	requestAnimationFrame(() => {
		const initial =
			backdrop.querySelector('.fm-body button, .fm-body a[href], .fm-body input') ||
			backdrop.querySelector('.fm-cta') ||
			backdrop.querySelector('.fm-close');
		initial?.focus({ preventScroll: true });
	});

	return backdrop;
}

export function closeFeatureModal() {
	if (!activeModal) return;
	activeModal.remove();
	activeModal = null;
	if (escHandler) {
		document.removeEventListener('keydown', escHandler);
		escHandler = null;
	}
	keyTrapHandler = null;
	document.documentElement.style.overflow = '';
	// Restore focus to whatever the user was on when they opened the modal.
	if (lastFocusedBeforeOpen && document.contains(lastFocusedBeforeOpen)) {
		lastFocusedBeforeOpen.focus({ preventScroll: true });
	}
	lastFocusedBeforeOpen = null;
}

// ── 3D Body: emote chip strip on the viewer ──────────────────────────────────

// Hand-picked subset of the talk-emote bar that reads as "show me the moves"
// rather than "play a 30-second cutscene". Wave/celebrate/dance/pray cover
// happy/social/expressive ranges; idle is the return-to-rest.
const PREVIEW_EMOTES = [
	{ name: 'av-idle-breath', icon: '🧍', label: 'Idle' },
	{ name: 'wave', icon: '👋', label: 'Wave' },
	{ name: 'celebrate', icon: '🎉', label: 'Celebrate' },
	{ name: 'dance', icon: '💃', label: 'Dance' },
	{ name: 'av-arm-flex', icon: '💪', label: 'Flex' },
	{ name: 'reaction', icon: '😲', label: 'React' },
	{ name: 'pray', icon: '🙏', label: 'Pray' },
];

let emoteStripWired = false;

export async function toggleEmoteStrip({ scene, stripEl }) {
	if (!scene || !stripEl) return;
	const emotes = scene.getEmoteController();
	if (!emotes) return;

	// First call: populate the chips. Subsequent calls just toggle visibility.
	if (!emoteStripWired) {
		try {
			await emotes.loadManifest();
		} catch (err) {
			log.warn('[emote-strip] manifest load failed', err);
			// Don't leave a broken empty strip with no signal — show an inline
			// note, surface it, and bail. emoteStripWired stays false so a later
			// open retries the load.
			stripEl.innerHTML =
				`<span class="emote-strip-note" style="font-size:0.72rem;color:var(--muted);padding:0 8px;white-space:nowrap">Animations couldn't load. Try again in a moment.</span>` +
				`<button class="emote-strip-close" type="button" aria-label="Close animations">✕</button>`;
			stripEl.querySelector('.emote-strip-close')?.addEventListener('click', () => {
				stripEl.classList.remove('is-visible');
			});
			stripEl.classList.add('is-visible');
			return;
		}
		const present = new Set(emotes.getAllDefs().map((d) => d.name));
		const available = PREVIEW_EMOTES.filter((e) => present.has(e.name));
		stripEl.innerHTML =
			available
				.map(
					(e) => `
				<button class="emote-chip" type="button" data-emote="${e.name}" title="${e.label}" aria-label="${e.label}">
					<span aria-hidden="true">${e.icon}</span>
				</button>
			`,
				)
				.join('') +
			`<button class="emote-strip-close" type="button" aria-label="Close animations">✕</button>`;

		stripEl.addEventListener('click', async (ev) => {
			const close = ev.target.closest('.emote-strip-close');
			if (close) {
				stripEl.classList.remove('is-visible');
				return;
			}
			const chip = ev.target.closest('.emote-chip');
			if (!chip) return;
			stripEl.querySelectorAll('.emote-chip.is-active').forEach((c) => c.classList.remove('is-active'));
			chip.classList.add('is-active');
			const name = chip.dataset.emote;
			const ok = await scene.playEmote(name);
			if (!ok) chip.classList.remove('is-active');
		});

		emoteStripWired = true;
	}

	stripEl.classList.toggle('is-visible');
}

// ── Voice: open the existing talk overlay against the staged GLB ─────────────

/**
 * Spin up the live talk overlay with the user's in-progress (unsaved) avatar.
 * No agent_id means TalkController falls back to edge TTS for voice and the
 * anonymous Groq tier for chat — both work without sign-in.
 */
export function openVoicePreview({ glbBlob, glbUrl, name }) {
	const previewName = name?.trim() || 'Your new avatar';
	const previewAvatar = {
		id: 'preview-' + Date.now(),
		name: previewName,
		// Prefer the in-memory Blob so TalkScene can use loader.parse() directly
		// (avoids the "Failed to fetch" race if the object URL is invalidated).
		// Fall back to URL for callers that don't have the Blob handy.
		glbBlob: glbBlob || null,
		model_url: glbBlob ? null : glbUrl,
	};
	openTalkMode({
		avatar: previewAvatar,
		systemPromptFn: () =>
			`You are a friendly 3D avatar named "${previewName}" being previewed inside three.ws ` +
			`before its owner saves it. Keep replies short (1–2 sentences), warm, and curious. ` +
			`If asked what you can do, mention: voice, animations, on-chain identity on Solana, ` +
			`paid skills via x402, embedding anywhere with one snippet, and a public reputation.`,
	});
}

// ── Static info modals (identity / paid / embed / reputation) ────────────────

export async function openIdentityModal(ctx = {}) {
	const displayName = escapeHtml(ctx.name || 'Your new avatar');

	let thumbSrc = '';
	if (ctx.canvas) {
		try {
			const size = 96;
			const tmp = document.createElement('canvas');
			tmp.width = tmp.height = size;
			const tc = tmp.getContext('2d');
			if (tc) {
				const src = ctx.canvas;
				const ar = src.width / src.height || 1;
				let dw = size, dh = size;
				if (ar > 1) dh = Math.round(size / ar);
				else dw = Math.round(size * ar);
				tc.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
				thumbSrc = tmp.toDataURL('image/png');
			}
		} catch { /* fallback initial renders fine */ }
	}

	const avatarHtml = thumbSrc
		? `<img loading="lazy" decoding="async" class="fm-id-avatar" src="${thumbSrc}" alt="${displayName}" />`
		: `<div class="fm-id-avatar fm-id-avatar--fallback">${displayName.charAt(0).toUpperCase()}</div>`;

	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>Owned by your wallet, not by three.ws — transfer or sell at any time.</li>
			<li>Metadata (avatar URL, persona, voice) is mutable by you, signed on-chain.</li>
			<li>Discoverable in the agent registry by capability, price, and reputation.</li>
		</ul>
		<div class="fm-id-card" data-state="loading">
			<div class="fm-id-card-top">
				${avatarHtml}
				<div class="fm-id-card-top-right">
					<div class="fm-id-head">
						<span class="fm-id-chain">Solana mainnet</span>
						<span class="fm-id-pill" data-pill>generating…</span>
					</div>
					<div class="fm-id-meta">
						<div><span class="muted">Name</span><strong data-name>${displayName}</strong></div>
						<div><span class="muted">Asset standard</span><strong>Metaplex Core</strong></div>
					</div>
				</div>
			</div>
			<a class="fm-id-addr-link" data-addr-link target="_blank" rel="noopener noreferrer">
				<span class="fm-id-addr" data-addr>—</span>
				<span class="fm-id-explorer-hint" data-explorer-hint>View on Solscan</span>
			</a>
			<p class="fm-id-sample-note" data-sample-note>Sample keypair — your real address is created on save</p>
		</div>
	`;

	openFeatureModal({
		icon: '🪪',
		title: 'On-Chain Identity',
		lede: 'Your agent becomes a Metaplex Core asset on Solana the moment you save — transferable, composable, browsable in any wallet.',
		body,
		actions: [{ label: 'Got it' }],
	});

	try {
		const { Keypair } = await import('@solana/web3.js');
		const kp = Keypair.generate();
		const addr = kp.publicKey.toBase58();
		const card = body.querySelector('.fm-id-card');
		card.dataset.state = 'ready';
		card.querySelector('[data-pill]').textContent = 'preview';

		card.querySelector('[data-addr]').textContent = addr;

		const link = card.querySelector('[data-addr-link]');
		link.href = `https://solscan.io/account/${addr}`;
		link.title = 'Open in Solscan (sample address)';
	} catch (err) {
		const card = body.querySelector('.fm-id-card');
		card.dataset.state = 'error';
		card.querySelector('[data-pill]').textContent = 'unavailable';
		card.querySelector('[data-addr]').textContent =
			'Couldn\'t generate preview — your real address is created on save.';
		const link = card.querySelector('[data-addr-link]');
		link.removeAttribute('href');
		link.style.pointerEvents = 'none';
		card.querySelector('[data-explorer-hint]').hidden = true;
		log.warn('[identity-preview] keypair gen failed', err);
	}
}

export function openPaidSkillsModal(ctx = {}) {
	const handle = slugify(ctx.name) || 'your-agent';
	const endpoint = `https://three.ws/api/agent/${handle}/ask`;
	const snippets = {
		fetch: `import { withX402 } from '@three-ws/x402-fetch';

// wallet: window.ethereum, a viem account, or privateKeyToWallet(pk).
// On a 402 the wrapper pays in USDC and retries — no extra code.
const fetchPaid = withX402(fetch, { wallet });

const res = await fetchPaid('${endpoint}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'hello' }),
});

const { reply, tx } = await res.json();`,
		curl: `# 1. Hit the endpoint — server quotes a price
curl -sS -X POST ${endpoint} \\
  -H 'content-type: application/json' \\
  -d '{"message":"hello"}'

# HTTP/1.1 402 Payment Required
# {"accepts":[{"network":"solana","asset":"USDC",
#   "amount":"0.05","payTo":"<agent-wallet>"}]}

# 2. Sign a USDC transfer, retry with X-PAYMENT
curl -sS -X POST ${endpoint} \\
  -H 'content-type: application/json' \\
  -H 'x-payment: <base64-signed-payload>' \\
  -d '{"message":"hello"}'

# HTTP/1.1 200 OK
# {"reply":"Hi! How can I help?","tx":"<solana-tx-sig>"}`,
		python: `from three_ws import X402Client

client = X402Client(wallet=wallet, network="solana")

reply = client.post(
    "${endpoint}",
    json={"message": "hello"},
)
print(reply.json())  # {"reply": ..., "tx": "<sig>"}`,
	};

	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>Your agent earns USDC every time another agent or app calls it — no API keys, no invoicing.</li>
			<li>Payments settle on Solana in seconds, signed end-to-end via the <code>x402</code> protocol.</li>
			<li>Set a price per skill after saving — chat, render, or any custom endpoint you define.</li>
		</ul>

		<div class="fm-flow" aria-label="x402 payment flow">
			<div class="fm-flow-step">
				<div class="fm-flow-num" aria-hidden="true">1</div>
				<div class="fm-flow-label"><strong>Request</strong></div>
				<div class="fm-flow-detail">Client hits your endpoint. No auth needed.</div>
				<span class="fm-flow-badge">POST</span>
			</div>
			<div class="fm-flow-connector" aria-hidden="true">
				<div class="fm-flow-line"></div>
				<div class="fm-flow-pulse"></div>
			</div>
			<div class="fm-flow-step fm-flow-step--mid">
				<div class="fm-flow-num" aria-hidden="true">2</div>
				<div class="fm-flow-label"><strong>Quote</strong></div>
				<div class="fm-flow-detail">Server replies <code>402</code> with USDC price.</div>
				<span class="fm-flow-badge fm-flow-badge--warn">402</span>
			</div>
			<div class="fm-flow-connector" aria-hidden="true">
				<div class="fm-flow-line"></div>
				<div class="fm-flow-pulse"></div>
			</div>
			<div class="fm-flow-step fm-flow-step--end">
				<div class="fm-flow-num" aria-hidden="true">3</div>
				<div class="fm-flow-label"><strong>Paid</strong></div>
				<div class="fm-flow-detail">Client signs USDC transfer, retries. Done.</div>
				<span class="fm-flow-badge fm-flow-badge--ok">200</span>
			</div>
		</div>

		<div class="fm-pricing-preview">
			<div class="fm-pricing-head">
				<span class="fm-pricing-title">Skill pricing</span>
				<span class="fm-pricing-pill">YOU SET THE PRICE</span>
			</div>
			<div class="fm-pricing-rows">
				<div class="fm-pricing-row">
					<span class="fm-pricing-skill">Chat</span>
					<span class="fm-pricing-amount">$— <span class="muted">USDC / call</span></span>
				</div>
				<div class="fm-pricing-row">
					<span class="fm-pricing-skill">Render</span>
					<span class="fm-pricing-amount">$— <span class="muted">USDC / call</span></span>
				</div>
				<div class="fm-pricing-row">
					<span class="fm-pricing-skill">Custom endpoint</span>
					<span class="fm-pricing-amount">$— <span class="muted">USDC / call</span></span>
				</div>
			</div>
			<div class="fm-pricing-foot">Set a per-call price for any skill after save. Earnings stream into your agent's wallet, withdrawable any time.</div>
		</div>

		<div class="fm-tabs" role="tablist" aria-label="Client language">
			<button class="fm-tab is-active" role="tab" data-tab="fetch">JavaScript</button>
			<button class="fm-tab" role="tab" data-tab="curl">cURL</button>
			<button class="fm-tab" role="tab" data-tab="python">Python</button>
		</div>
		<div class="fm-code fm-code--highlighted" data-copy-target>
			<pre data-snippet></pre>
			<button class="fm-copy" type="button">Copy</button>
		</div>
		<p class="fm-note">Endpoint uses your avatar's handle — filled in live as you type. Pricing is configured after save.</p>
	`;

	openFeatureModal({
		icon: '💸',
		title: 'Paid Skills (x402)',
		lede: 'Turn every skill into revenue. Other agents pay yours automatically — USDC settles in seconds.',
		body,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});

	const codeEl = body.querySelector('[data-copy-target]');
	const snippetEl = body.querySelector('[data-snippet]');

	function highlightSnippet(lang, raw) {
		const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const lines = raw.split('\n');
		return lines
			.map((line) => {
				const e = esc(line);
				if (lang === 'curl') {
					if (/^\s*#/.test(line)) return `<span class="syn-comment">${e}</span>`;
					return e
						.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="syn-string">$1</span>')
						.replace(/(\b(?:curl)\b)/g, '<span class="syn-keyword">$1</span>');
				}
				if (lang === 'fetch') {
					if (/^\s*\/\//.test(line)) return `<span class="syn-comment">${e}</span>`;
					return e
						.replace(/(import|from|const|await|new)\b/g, '<span class="syn-keyword">$1</span>')
						.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="syn-string">$1</span>')
						.replace(/(`(?:[^`\\]|\\.)*`)/g, '<span class="syn-string">$1</span>');
				}
				if (lang === 'python') {
					if (/^\s*#/.test(line)) return `<span class="syn-comment">${e}</span>`;
					return e
						.replace(/(from|import)\b/g, '<span class="syn-keyword">$1</span>')
						.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="syn-string">$1</span>');
				}
				return e;
			})
			.join('\n');
	}

	function setTab(name) {
		body.querySelectorAll('.fm-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
		snippetEl.innerHTML = highlightSnippet(name, snippets[name]);
		codeEl.dataset.copy = snippets[name];
	}
	body.querySelectorAll('.fm-tab').forEach((t) => {
		t.addEventListener('click', () => setTab(t.dataset.tab));
	});
	setTab('fetch');
}

export function openEmbedModal(ctx = {}) {
	const handle = slugify(ctx.name) || 'your-agent';
	const snippets = {
		script: `<script src="https://three.ws/embed.js"
        data-widget="${handle}"
        data-type="talking-agent"
        async></script>`,
		webcomponent: `<agent-3d agent="${handle}" mode="full"></agent-3d>
<script type="module"
  src="https://three.ws/embed/agent-3d.js"></script>`,
		react: `import { Agent3D } from '@three-ws/react';

export default function Page() {
  return <Agent3D agentId="${handle}" controls="joystick" />;
}`,
		iframe: `<iframe
  src="https://three.ws/widget#widget=${handle}&kiosk=true"
  width="420" height="600"
  style="border:0;border-radius:14px"
  allow="microphone; autoplay"
  loading="lazy"></iframe>`,
	};

	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>WebGL renders in-browser. No install, no plugin.</li>
			<li>Modes: floating bubble, fullscreen, inline card, or sidebar.</li>
			<li>Works in Webflow, Framer, raw HTML, React, Next.js, Squarespace.</li>
		</ul>

		<div class="fm-tabs" role="tablist" aria-label="Embed format">
			<button class="fm-tab is-active" role="tab" data-tab="script">Script tag</button>
			<button class="fm-tab" role="tab" data-tab="webcomponent">Web Component</button>
			<button class="fm-tab" role="tab" data-tab="react">React</button>
			<button class="fm-tab" role="tab" data-tab="iframe">iframe</button>
		</div>
		<div class="fm-code" data-copy-target>
			<pre data-snippet></pre>
			<button class="fm-copy" type="button">Copy</button>
		</div>

		<div class="fm-browser" aria-label="Live embed preview">
			<div class="fm-browser-bar">
				<span class="fm-browser-dot"></span>
				<span class="fm-browser-dot"></span>
				<span class="fm-browser-dot"></span>
				<div class="fm-browser-url">three.ws/@${escapeHtml(handle)}</div>
			</div>
			<div class="fm-browser-stage" data-stage>
				<img loading="lazy" decoding="async" class="fm-browser-shot" alt="" data-shot hidden />
				<div class="fm-browser-skeleton" data-skel>Rendering live preview…</div>
			</div>
		</div>
		<p class="fm-note">Save your avatar to claim the real <code>data-widget</code> ID — copies above keep working with the placeholder.</p>
	`;

	openFeatureModal({
		icon: '🧩',
		title: 'Embed Anywhere',
		lede: 'One tag drops your avatar on any site. Real snippet, real iframe shape, real preview of how it renders.',
		body,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});

	// Wire tabs ↔ snippet swap.
	const codeEl = body.querySelector('[data-copy-target]');
	const snippetEl = body.querySelector('[data-snippet]');
	function setTab(name) {
		body.querySelectorAll('.fm-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
		snippetEl.textContent = snippets[name];
		codeEl.dataset.copy = snippets[name];
	}
	body.querySelectorAll('.fm-tab').forEach((t) => {
		t.addEventListener('click', () => setTab(t.dataset.tab));
	});
	setTab('script');

	// Live preview: capture a snapshot from the actual viewer canvas so the
	// "this is what your embed will look like" frame shows *this avatar*,
	// not a stock image. Falls back to a styled placeholder if the canvas
	// isn't ready.
	const stage = body.querySelector('[data-stage]');
	const shot = body.querySelector('[data-shot]');
	const skel = body.querySelector('[data-skel]');
	const sourceCanvas = document.querySelector('#mv-container canvas');
	if (sourceCanvas) {
		try {
			sourceCanvas.toBlob((b) => {
				if (!b) {
					// Snapshot failed — don't leave the "Rendering…" spinner stuck.
					skel.textContent = 'Preview will render here once your avatar is loaded.';
					return;
				}
				shot.src = URL.createObjectURL(b);
				shot.hidden = false;
				skel.hidden = true;
			}, 'image/png');
		} catch (err) {
			log.warn('[embed-preview] canvas snapshot failed', err);
		}
	} else {
		skel.textContent = 'Preview will render here once your avatar is loaded.';
	}
}

// ── Download: real GLB / USDZ / VRM export from the staged blob ──────────────

const DOWNLOAD_FORMATS = [
	{
		id: 'glb',
		label: 'GLB',
		blurb: 'Universal 3D format. Works in Unity, Unreal, Blender, Sketchfab, model-viewer, every browser.',
		ext: '.glb',
		size: 'original',
	},
	{
		id: 'fbx',
		label: 'FBX',
		blurb: 'Game-engine interchange. Imports into Unity and Unreal with the bone hierarchy, skin weights, and blendshapes intact.',
		ext: '.fbx',
		size: 'similar to GLB',
	},
	{
		id: 'vrm',
		label: 'VRM',
		blurb: 'Humanoid avatar standard (VRM 1.0). Opens in Warudo, VNyan, Resonite and any three-vrm app, and imports into VRChat through Unity.',
		ext: '.vrm',
		size: 'similar to GLB',
	},
	{
		id: 'usdz',
		label: 'USDZ',
		blurb: 'Apple AR. Tap-to-view in Safari on iPhone/iPad via Quick Look.',
		ext: '.usdz',
		size: 'similar to GLB',
	},
];

/**
 * @param {{ blob: Blob, name: string }} ctx
 */
export function openDownloadModal(ctx) {
	const safeName = (ctx?.name || 'avatar').trim() || 'avatar';
	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-download-list" role="list">
			${DOWNLOAD_FORMATS.map(
				(f) => `
				<li>
					<button class="fm-download-row" type="button" data-format="${f.id}">
						<div class="fm-download-head">
							<strong>${f.label}</strong>
							<span class="fm-download-ext">${f.ext}</span>
						</div>
						<div class="fm-download-blurb">${f.blurb}</div>
						<div class="fm-download-status" data-status></div>
					</button>
				</li>
			`,
			).join('')}
		</ul>
		<p class="fm-note">GLB, VRM, and USDZ convert in your browser. FBX renders on our servers (keeps the skeleton for Unity/Unreal) — a few seconds.</p>
	`;

	openFeatureModal({
		icon: '📦',
		title: 'Download your avatar',
		lede: 'Take your avatar anywhere — game engine, VR world, AR scene, sticker pack pipeline.',
		body,
		actions: [{ label: 'Done', ghost: true }],
	});

	body.querySelectorAll('.fm-download-row').forEach((row) => {
		row.addEventListener('click', async () => {
			const format = row.dataset.format;
			const statusEl = row.querySelector('[data-status]');
			if (row.dataset.busy === '1') return;
			row.dataset.busy = '1';
			statusEl.textContent = 'Preparing…';
			statusEl.dataset.tone = 'busy';
			try {
				if (format === 'fbx') {
					// FBX is built server-side from the GLB so the skeleton survives.
					const fbxUrl = await fbxFromBlob(ctx.blob, {
						filename: safeName,
						onStatus: (msg) => { statusEl.textContent = msg; },
					});
					downloadUrl(fbxUrl, `${safeName}.fbx`);
					statusEl.textContent = 'FBX ready — download started.';
					statusEl.dataset.tone = 'ok';
					return;
				}
				const result = await downloadAvatar(ctx.blob, {
					format,
					filename: safeName,
					meta: { name: safeName },
				});
				statusEl.textContent = `Saved ${result.filename} · ${prettyBytes(result.size)}`;
				statusEl.dataset.tone = 'ok';
			} catch (err) {
				log.error('[create-review] download failed', err);
				statusEl.textContent =
					err?.message?.includes('humanoid') && format === 'vrm'
						? "Couldn't write VRM — this avatar's skeleton isn't humanoid enough. Try GLB instead."
						: `Couldn't export ${format.toUpperCase()}: ${err?.message || 'unknown error'}`;
				statusEl.dataset.tone = 'err';
			} finally {
				row.dataset.busy = '0';
			}
		});
	});
}

function prettyBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function openReputationModal(ctx = {}) {
	const handle = slugify(ctx.name) || 'your-agent';

	// Real network reputation: the rep card shows live, platform-wide on-chain
	// reputation scale (signed attestations across registered agents) pulled from
	// /api/home-stats — never fabricated reviews or invented star ratings. Numbers
	// stream in after open; the strip collapses to a copy-only state if the DB is
	// unreachable, so the user never sees made-up figures.
	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>Every paid call is logged with a signed receipt — verifiable, non-repudiable.</li>
			<li>Reviews carry the reviewer's own reputation weight — Sybil-resistant.</li>
			<li>Validators can attest to capability (e.g. "ships valid SQL 9.6/10 of the time").</li>
		</ul>

		<div class="rep-card">
			<div class="rep-card-head">
				<div>
					<strong>${escapeHtml(handle)}</strong>
					<div class="muted">three.ws/@${escapeHtml(handle)}</div>
				</div>
				<span class="rep-sample-pill" data-rep-pill hidden>LIVE</span>
			</div>
			<div class="rep-stats" data-rep-stats aria-busy="true">
				<div><strong class="rep-stat-big" data-stat="attestations">—</strong><span class="muted">on-chain attestations</span></div>
				<div><strong data-stat="onchain_agents">—</strong><span class="muted">agents with passports</span></div>
				<div><strong data-stat="chains">—</strong><span class="muted">chains</span></div>
			</div>
			<p class="rep-card-foot muted" data-rep-foot>Loading live network reputation…</p>
		</div>

		<p class="fm-note">Your starting rep is empty — every paid call and review accrues to your asset, on-chain, and travels with it if you ever transfer.</p>
	`;

	openFeatureModal({
		icon: '⭐',
		title: 'Reputation',
		lede: 'Signed feedback, call history, and validation events accrue to your agent — public, verifiable, portable.',
		body,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});

	fetchPlatformStats().then((stats) => {
		const statsRow = body.querySelector('[data-rep-stats]');
		const foot = body.querySelector('[data-rep-foot]');
		if (!stats) {
			// No real numbers available — drop the metric strip rather than fake it.
			statsRow?.remove();
			if (foot) foot.textContent = 'Reputation accrues on-chain from your first paid call and review — public and portable.';
			return;
		}
		const set = (key, val) => {
			const el = body.querySelector(`[data-stat="${key}"]`);
			if (el) el.textContent = val;
		};
		set('attestations', fmtCount(stats.attestations));
		set('onchain_agents', fmtCount(stats.onchain_agents));
		set('chains', fmtCount(stats.chains));
		statsRow?.setAttribute('aria-busy', 'false');
		const pill = body.querySelector('[data-rep-pill]');
		if (pill) pill.hidden = false;
		if (foot) foot.textContent = `Live across the three.ws network — ${fmtCount(stats.attestations)} signed attestations and counting.`;
	});
}

// ── Voice Library modal ─────────────────────────────────────────────────────

export function openVoiceLibraryModal() {
	const voices = [
		{ name: 'Aria', detail: 'American · Narrative' },
		{ name: 'Roger', detail: 'British · Conversational' },
		{ name: 'Sarah', detail: 'American · Soft' },
		{ name: 'Charlie', detail: 'Australian · Casual' },
		{ name: 'Jessica', detail: 'American · Expressive' },
		{ name: 'Eric', detail: 'American · Friendly' },
	];

	const voiceCards = voices
		.map(
			(v) => `
		<div class="fm-mini-card">
			<div class="fm-mini-card-name">${escapeHtml(v.name)}</div>
			<div class="fm-mini-card-desc">${escapeHtml(v.detail)}</div>
		</div>
	`,
		)
		.join('');

	openFeatureModal({
		icon: '🎙️',
		title: 'Voice Library',
		lede: 'Pick a voice from 100+ options or clone your own. Each agent gets its own voice identity, powered by ElevenLabs.',
		body: `
			<ul class="fm-bullets">
				<li>ElevenLabs-powered library with accent, age, and style filters — narrative, conversational, character voices.</li>
				<li>Clone your own voice from a 30-second recording. Your agent sounds like you, across every conversation.</li>
				<li>Per-agent voice assignment — different agents, different voices, all managed from your dashboard.</li>
			</ul>
			<div class="fm-card-grid">${voiceCards}</div>
			<p class="fm-note">Full voice library and cloning open in your dashboard after save. Preview your avatar's voice live with the Voice &amp; Persona tile.</p>
		`,
		actions: [{ label: 'Got it' }],
	});
}

// ── Video generation modal ──────────────────────────────────────────────────

export function openVideoModal() {
	openFeatureModal({
		icon: '🎬',
		title: 'Video Generation',
		lede: 'Turn your avatar into a talking-head video — upload audio or type a script, get a lip-synced MP4.',
		body: `
			<ul class="fm-bullets">
				<li>Upload any audio clip or paste a script for TTS — the avatar lip-syncs and emotes automatically.</li>
				<li>Renders as 1080p MP4 ready for social media, courses, product demos, and sales outreach.</li>
				<li>Runs on GPU workers — typical turnaround is under two minutes for a 60-second clip.</li>
			</ul>
			<div class="fm-pipeline" aria-label="Video generation flow">
				<div class="fm-pipeline-step">
					<span class="fm-pipeline-icon">🎤</span>
					<span class="fm-pipeline-label">Audio</span>
					<span class="fm-pipeline-sub">Upload or TTS</span>
				</div>
				<span class="fm-pipeline-arrow">→</span>
				<div class="fm-pipeline-step">
					<span class="fm-pipeline-icon">🧍</span>
					<span class="fm-pipeline-label">Avatar</span>
					<span class="fm-pipeline-sub">Your 3D model</span>
				</div>
				<span class="fm-pipeline-arrow">→</span>
				<div class="fm-pipeline-step">
					<span class="fm-pipeline-icon">⚙️</span>
					<span class="fm-pipeline-label">Render</span>
					<span class="fm-pipeline-sub">GPU worker</span>
				</div>
				<span class="fm-pipeline-arrow">→</span>
				<div class="fm-pipeline-step">
					<span class="fm-pipeline-icon">🎬</span>
					<span class="fm-pipeline-label">MP4</span>
					<span class="fm-pipeline-sub">1080p output</span>
				</div>
			</div>
			<p class="fm-note">Video generation is available from your dashboard after saving. Audio can be uploaded directly or generated from text via the agent's assigned voice.</p>
		`,
		actions: [{ label: 'Got it' }],
	});
}

// ── Mocap & Streaming modal ─────────────────────────────────────────────────

export function openMocapModal() {
	openFeatureModal({
		icon: '🎥',
		title: 'Mocap & Streaming',
		lede: 'Drive your avatar with your face, stream it on OBS, or pose it frame-by-frame.',
		body: `
			<div class="fm-sub-features">
				<div class="fm-sub-feature">
					<span class="fm-sub-feature-icon">📷</span>
					<div class="fm-sub-feature-text">
						<div class="fm-sub-feature-name">Face Capture</div>
						<div class="fm-sub-feature-desc">Webcam feeds MediaPipe for real-time ARKit-52 blendshape tracking. Blink, jaw, brow, cheek — full expression mapping. Record clips and replay on any avatar.</div>
					</div>
				</div>
				<div class="fm-sub-feature">
					<span class="fm-sub-feature-icon">📡</span>
					<div class="fm-sub-feature-text">
						<div class="fm-sub-feature-name">OBS Overlay</div>
						<div class="fm-sub-feature-desc">Stream-deck panel with emote hotkeys and mic-driven expressions. Transparent background — drop into OBS as a browser source for live streams.</div>
					</div>
				</div>
				<div class="fm-sub-feature">
					<span class="fm-sub-feature-icon">🦴</span>
					<div class="fm-sub-feature-text">
						<div class="fm-sub-feature-name">Pose Studio</div>
						<div class="fm-sub-feature-desc">Click-to-pose 3D mannequin. Rotate individual bones, set expressions, export a poster-quality PNG screenshot.</div>
					</div>
				</div>
			</div>
			<p class="fm-note">All three tools are in the Labs section of your dashboard. Face capture runs in-browser via your webcam — no install required.</p>
		`,
		actions: [{ label: 'Got it' }],
	});
}

// ── Token Launch modal ──────────────────────────────────────────────────────

export function openTokenLaunchModal() {
	// The KPI strip shows the LIVE $THREE market — the platform's own pump.fun
	// token (mint FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) — so the user sees
	// a real launched-token dashboard, not invented figures. Pulled from
	// /api/three-token/stats; the strip collapses if the market feed is down.
	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>One-click token launch on pump.fun, tied to your agent's on-chain identity and wallet.</li>
			<li>Vanity mint grinding — pick a custom suffix for your token's Solana address.</li>
			<li>Live dashboard with price, holders, volume, bonding curve progress, and full trade history.</li>
			<li>Inline trade panel on your agent's page — visitors can buy and sell without leaving.</li>
		</ul>
		<div class="fm-kpi-row" data-token-row aria-label="Live $THREE market" aria-busy="true">
			<div class="fm-kpi" data-token-cell="price" hidden>
				<span class="fm-kpi-value" data-token="price">—</span>
				<span class="fm-kpi-label">$THREE price</span>
			</div>
			<div class="fm-kpi" data-token-cell="change" hidden>
				<span class="fm-kpi-value" data-token="change">—</span>
				<span class="fm-kpi-label">24h</span>
			</div>
			<div class="fm-kpi" data-token-cell="mcap" hidden>
				<span class="fm-kpi-value" data-token="mcap">—</span>
				<span class="fm-kpi-label">Market cap</span>
			</div>
			<div class="fm-kpi" data-token-cell="vol" hidden>
				<span class="fm-kpi-value" data-token="vol">—</span>
				<span class="fm-kpi-label">Volume 24h</span>
			</div>
		</div>
		<p class="fm-note" data-token-note>Live $THREE market — a real token launched through three.ws. Your own token launches from your agent's dashboard after save, with the same live dashboard.</p>
	`;

	openFeatureModal({
		icon: '🪙',
		title: 'Token Launch',
		lede: 'Your agent can launch a pump.fun token in one click — bonding curve, live stats, trade panel, all wired in.',
		body,
		actions: [{ label: 'Got it' }],
	});

	fetchThreeTokenStats().then((token) => {
		const row = body.querySelector('[data-token-row]');
		if (!token) {
			row?.remove();
			const note = body.querySelector('[data-token-note]');
			if (note) note.textContent = 'Token launch runs from your agent\'s dashboard after save — bonding curve, live price/volume/holders dashboard, and an inline trade panel, all wired in.';
			return;
		}
		// Each cell only appears if its underlying value is real (e.g. holders is
		// often null from the market source) — never a fabricated placeholder.
		const show = (cell, key, val) => {
			if (val == null) return;
			const valEl = body.querySelector(`[data-token="${key}"]`);
			const cellEl = body.querySelector(`[data-token-cell="${cell}"]`);
			if (valEl) valEl.textContent = val;
			if (cellEl) cellEl.hidden = false;
		};
		show('price', 'price', fmtPrice(token.price_usd));
		show('change', 'change', fmtPct(token.price_change_24h));
		show('mcap', 'mcap', fmtUsd(token.market_cap));
		show('vol', 'vol', fmtUsd(token.volume_24h));
		row?.setAttribute('aria-busy', 'false');
		// If the feed returned but every field was null, drop the empty strip.
		if (!body.querySelector('[data-token-cell]:not([hidden])')) row?.remove();
	});
}

// Live $THREE market data from /api/three-token/stats. Returns the token block
// or null on failure — callers must not fabricate figures when null.
async function fetchThreeTokenStats() {
	try {
		const res = await fetch('/api/three-token/stats', { headers: { accept: 'application/json' } });
		if (!res.ok) return null;
		const data = await res.json();
		return data && data.token ? data.token : null;
	} catch (err) {
		log.warn('[features] three-token stats fetch failed:', err?.message || err);
		return null;
	}
}

// ── Analytics modal ─────────────────────────────────────────────────────────

export function openAnalyticsModal() {
	// KPI strip shows REAL, live platform-wide numbers from /api/home-stats — not
	// fabricated per-agent revenue/views. The bullets describe what the user's own
	// dashboard tracks once their agent is live; the strip collapses if the stats
	// endpoint is unreachable so we never render invented figures.
	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>Revenue dashboard: net earnings, payment count, top skills by revenue, withdrawal history.</li>
			<li>Engagement metrics: widget views, transcript count, embed reach, and a real-time visitor activity feed.</li>
			<li>Per-tool usage: MCP call volume, latency percentiles, success rate, and top callers.</li>
		</ul>
		<div class="fm-kpi-row" data-stats-row aria-label="Live platform metrics" aria-busy="true">
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-stat="agents">—</span>
				<span class="fm-kpi-label">Agents</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-stat="onchain_agents">—</span>
				<span class="fm-kpi-label">On-chain</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-stat="widgets">—</span>
				<span class="fm-kpi-label">Widgets</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-stat="attestations">—</span>
				<span class="fm-kpi-label">Attestations</span>
			</div>
		</div>
		<div class="fm-kpi-row" data-oracle-row aria-label="Live oracle trading metrics" aria-busy="true">
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-oracle-stat="armed">—</span>
				<span class="fm-kpi-label">Agents trading</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-oracle-stat="winrate" style="color:#34d399">—</span>
				<span class="fm-kpi-label">Win rate</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-oracle-stat="scored">—</span>
				<span class="fm-kpi-label">Scored today</span>
			</div>
			<div class="fm-kpi">
				<span class="fm-kpi-value" data-oracle-stat="wins">—</span>
				<span class="fm-kpi-label">Total wins</span>
			</div>
		</div>
		<p class="fm-note" data-stats-note>Live three.ws platform metrics. Your own dashboard populates the moment your agent goes live — every API call, widget load, and voice session tracked in real time.</p>
	`;

	openFeatureModal({
		icon: '📊',
		title: 'Analytics',
		lede: 'Revenue, engagement, and usage — tracked automatically from day one.',
		body,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});

	fetchPlatformStats().then((stats) => {
		const row = body.querySelector('[data-stats-row]');
		if (!stats) {
			row?.remove();
			const note = body.querySelector('[data-stats-note]');
			if (note) note.textContent = 'Your dashboard populates the moment your agent goes live — every API call, widget load, and voice session is tracked in real time.';
			return;
		}
		const set = (key, val) => {
			const el = body.querySelector(`[data-stat="${key}"]`);
			if (el) el.textContent = val;
		};
		set('agents', fmtCount(stats.agents));
		set('onchain_agents', fmtCount(stats.onchain_agents));
		set('widgets', fmtCount(stats.widgets));
		set('attestations', fmtCount(stats.attestations));
		row?.setAttribute('aria-busy', 'false');
	});

	// Oracle trading stats — second live data row.
	fetch('/api/oracle/stats', { headers: { accept: 'application/json' } })
		.then((r) => r.ok ? r.json() : null)
		.then((d) => {
			if (!d) { body.querySelector('[data-oracle-row]')?.remove(); return; }
			const oset = (key, val) => {
				const el = body.querySelector(`[data-oracle-stat="${key}"]`);
				if (el) el.textContent = val;
			};
			oset('armed',   fmtCount(d.agents_armed));
			oset('winrate', d.win_rate != null ? `${d.win_rate}%` : '—');
			oset('scored',  fmtCount(d.scored_24h));
			oset('wins',    fmtCount(d.total_wins));
			body.querySelector('[data-oracle-row]')?.setAttribute('aria-busy', 'false');
		})
		.catch(() => body.querySelector('[data-oracle-row]')?.remove());
}

// ── Widgets modal ───────────────────────────────────────────────────────────

export function openWidgetsModal() {
	const widgets = [
		{ icon: '🔄', name: 'Turntable', desc: '360° spin showcase — drag to orbit, auto-rotate' },
		{ icon: '🎭', name: 'Animation Gallery', desc: 'Emote reel — browse and trigger animation clips' },
		{ icon: '🗣️', name: 'Talking Agent', desc: 'Live voice conversation with your avatar' },
		{ icon: '🪪', name: 'Passport', desc: 'Agent identity card — name, wallet, reputation' },
		{ icon: '📍', name: 'Hotspot Tour', desc: 'Interactive 3D walkthrough with clickable points' },
		{ icon: '📈', name: 'Pump.fun Feed', desc: 'Live token claims and graduations, narrated' },
		{ icon: '👁️', name: 'KOL Trades', desc: 'Key opinion leader trade tracking and alerts' },
		{ icon: '🖥️', name: 'Live Trades', desc: 'Real-time 3D trade visualization canvas' },
	];

	const widgetCards = widgets
		.map(
			(w) => `
		<div class="fm-mini-card">
			<span class="fm-mini-card-icon">${w.icon}</span>
			<div class="fm-mini-card-name">${escapeHtml(w.name)}</div>
			<div class="fm-mini-card-desc">${escapeHtml(w.desc)}</div>
		</div>
	`,
		)
		.join('');

	openFeatureModal({
		icon: '🧱',
		title: 'Widgets',
		lede: 'Eight ready-to-embed widget types — each configurable in the visual Widget Studio.',
		body: `
			<ul class="fm-bullets">
				<li>Widget Studio: visual editor with live preview, custom colors, camera angle, and interaction behavior.</li>
				<li>Each widget gets its own embed code — script tag, Web Component, React, or iframe.</li>
				<li>Origin allowlist per widget so you control exactly where it can be loaded.</li>
			</ul>
			<div class="fm-card-grid">${widgetCards}</div>
			<p class="fm-note">Widget Studio opens from your dashboard after save. Each type is fully configurable — colors, camera, content source, interaction mode.</p>
		`,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});
}

// ── Developer API modal ─────────────────────────────────────────────────────

export function openDeveloperModal() {
	const tools = {
		avatar: [
			{ name: 'list_my_avatars', desc: 'List all avatars in your account' },
			{ name: 'get_avatar', desc: 'Get avatar details by ID' },
			{ name: 'search_public_avatars', desc: 'Search the public gallery' },
			{ name: 'render_avatar', desc: 'Server-side render to PNG' },
		],
		model: [
			{ name: 'inspect_model', desc: 'Mesh, material, skeleton analysis' },
			{ name: 'validate_model', desc: 'Khronos glTF spec validation' },
			{ name: 'optimize_model', desc: 'Draco compress, texture resize' },
		],
		solana: [
			{ name: 'solana_agent_passport', desc: 'On-chain agent identity lookup' },
			{ name: 'solana_agent_reputation', desc: 'Reputation score and reviews' },
			{ name: 'solana_agent_attestations', desc: 'Capability attestations' },
		],
		pumpfun: [
			{ name: 'pumpfun_token_intel', desc: 'Token stats, holders, bonding curve' },
			{ name: 'pumpfun_creator_intel', desc: 'Creator history and track record' },
		],
	};

	const snippets = {
		claude: `{
  "mcpServers": {
    "three-ws": {
      "command": "npx",
      "args": ["-y", "@three-ws/mcp-server"],
      "env": {
        "THREE_WS_API_KEY": "<your-key>"
      }
    }
  }
}`,
		cursor: `{
  "mcpServers": {
    "three-ws": {
      "command": "npx",
      "args": ["-y", "@three-ws/mcp-server"],
      "env": {
        "THREE_WS_API_KEY": "<your-key>"
      }
    }
  }
}`,
		http: `POST https://three.ws/api/mcp
Authorization: Bearer <your-key>
Content-Type: application/json

{ "method": "tools/list", "params": {} }`,
	};

	function renderTools(catTools) {
		return catTools
			.map(
				(t) => `
			<div class="fm-tool-item">
				<code>${escapeHtml(t.name)}</code>
				<span class="muted">${escapeHtml(t.desc)}</span>
			</div>
		`,
			)
			.join('');
	}

	const body = document.createElement('div');
	body.innerHTML = `
		<ul class="fm-bullets">
			<li>15 MCP tools spanning avatar management, model analysis, Solana identity, and pump.fun intel.</li>
			<li>API keys with scoped permissions: <code>avatars:read</code>, <code>avatars:write</code>, <code>profile</code>, and more.</li>
			<li>Works with Claude Desktop, Cursor, VS Code, or any MCP-compatible client.</li>
		</ul>

		<div class="fm-tool-catalog">
			<div class="fm-tool-cat">Avatar</div>
			${renderTools(tools.avatar)}
			<div class="fm-tool-cat">Model</div>
			${renderTools(tools.model)}
			<div class="fm-tool-cat">Solana</div>
			${renderTools(tools.solana)}
			<div class="fm-tool-cat">Pump.fun</div>
			${renderTools(tools.pumpfun)}
		</div>

		<div class="fm-tabs" role="tablist" aria-label="MCP client setup">
			<button class="fm-tab is-active" role="tab" data-tab="claude">Claude Desktop</button>
			<button class="fm-tab" role="tab" data-tab="cursor">Cursor</button>
			<button class="fm-tab" role="tab" data-tab="http">HTTP</button>
		</div>
		<div class="fm-code" data-copy-target>
			<pre data-snippet></pre>
			<button class="fm-copy" type="button">Copy</button>
		</div>
		<p class="fm-note">API keys are created in your dashboard after save. Each key can be scoped to specific permissions and rate-limited.</p>
	`;

	openFeatureModal({
		icon: '🛠️',
		title: 'Developer API',
		lede: 'Full MCP tool server, scoped API keys, and HTTP endpoints — build on top of your agent programmatically.',
		body,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});

	const codeEl = body.querySelector('[data-copy-target]');
	const snippetEl = body.querySelector('[data-snippet]');
	function setTab(name) {
		body.querySelectorAll('.fm-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
		snippetEl.textContent = snippets[name];
		codeEl.dataset.copy = snippets[name];
	}
	body.querySelectorAll('.fm-tab').forEach((t) => {
		t.addEventListener('click', () => setTab(t.dataset.tab));
	});
	setTab('claude');
}

// ── Knowledge & Memory modal ────────────────────────────────────────────────

export function openKnowledgeModal() {
	const strategyExample = `{
  "personality": "friendly, concise, technical",
  "topics": ["web3", "3D avatars", "AI agents"],
  "tone": "professional but warm",
  "constraints": [
    "never discuss competitors",
    "always cite sources"
  ]
}`;

	openFeatureModal({
		icon: '🧠',
		title: 'Knowledge & Memory',
		lede: 'Persistent context, editable strategy, and structured memory that survives across every conversation.',
		body: `
			<ul class="fm-bullets">
				<li>Persistent memory your agent recalls across conversations — facts, preferences, and domain context.</li>
				<li>Strategy JSON: freeform instructions read at runtime — personality, constraints, behavioral rules.</li>
				<li>Four memory categories: <code>user</code>, <code>feedback</code>, <code>project</code>, <code>reference</code> — structured and searchable.</li>
			</ul>

			<div class="fm-sub-features">
				<div class="fm-sub-feature">
					<span class="fm-sub-feature-icon">💾</span>
					<div class="fm-sub-feature-text">
						<div class="fm-sub-feature-name">Memory</div>
						<div class="fm-sub-feature-desc">Add notes, facts, and context your agent should always know. Categorized, editable, and queryable at runtime via the agent protocol.</div>
					</div>
				</div>
				<div class="fm-sub-feature">
					<span class="fm-sub-feature-icon">🎯</span>
					<div class="fm-sub-feature-text">
						<div class="fm-sub-feature-name">Strategy</div>
						<div class="fm-sub-feature-desc">JSON config your agent reads on every turn. Define personality, domain focus, constraints, and behavioral rules in one editable block.</div>
					</div>
				</div>
			</div>

			<div class="fm-code" data-copy="${escapeHtml(strategyExample)}">
				<pre>${escapeHtml(strategyExample)}</pre>
				<button class="fm-copy" type="button">Copy</button>
			</div>
			<p class="fm-note">Memory and strategy are managed from your agent's dashboard after save. Both are read at the start of every session.</p>
		`,
		actions: [{ label: 'Got it' }],
		dialogClass: 'fm-dialog--wide',
	});
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** URL-safe slug derived from the user's typed avatar name. */
export function slugify(s) {
	if (!s) return '';
	return String(s)
		.toLowerCase()
		.trim()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);
}
