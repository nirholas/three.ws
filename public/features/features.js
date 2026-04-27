/**
 * /features — page wiring.
 *
 * - Lazy-boots Act 2 and Act 3 <agent-3d> elements when scrolled into view
 *   (Act 1 has [eager] in markup so it boots immediately).
 * - Wires Act 2 emotion chips → element.expressEmotion(trigger).
 * - Fetches a real on-chain agent for Act 3 and shows its passport tag.
 * - Populates the chain ribbon (Act 3 background) from a fixed list — kept
 *   in sync visually with src/erc8004/chains.js but not imported (this page
 *   is a static asset, no module graph connection to /src).
 * - Wires the embed-snippet copy button.
 * - Reveals the agent (fade in) once it dispatches `agent:ready`.
 *
 * No build step. Plain ES module loaded via <script type="module">.
 */

const ROOT = document;

// Mirror of the mainnet labels in src/erc8004/chains.js — visual ribbon only.
const CHAIN_LABELS = [
	'Ethereum',
	'Optimism',
	'BNB',
	'Gnosis',
	'Polygon',
	'Fantom',
	'zkSync',
	'Moonbeam',
	'Mantle',
	'Base',
	'Arbitrum',
	'Celo',
	'Avalanche',
	'Linea',
	'Scroll',
	'Mode',
	'Blast',
	'opBNB',
	'Sepolia',
	'Holesky',
];

const SHORT_NAME_BY_CHAIN = new Map([
	[1, 'Ethereum'],
	[10, 'Optimism'],
	[56, 'BNB'],
	[100, 'Gnosis'],
	[137, 'Polygon'],
	[324, 'zkSync'],
	[1284, 'Moonbeam'],
	[5000, 'Mantle'],
	[8453, 'Base'],
	[42161, 'Arbitrum'],
	[42220, 'Celo'],
	[43114, 'Avalanche'],
	[59144, 'Linea'],
	[534352, 'Scroll'],
	[97, 'BNB Testnet'],
	[11155111, 'Sepolia'],
	[17000, 'Holesky'],
]);

// ── Helpers ──────────────────────────────────────────────────────────────

function shortAddr(s = '') {
	return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function chainLabel(chainId) {
	return SHORT_NAME_BY_CHAIN.get(Number(chainId)) || `chain ${chainId}`;
}

function onAgentReady(agentEl, fn) {
	agentEl.addEventListener('agent:ready', fn, { once: true });
}

// ── Lazy-boot Acts 2 & 3 when their stage scrolls into view ──────────────

function setupLazyBoot() {
	const lazyEls = ROOT.querySelectorAll(
		'agent-3d:not([eager])[data-role^="act"]',
	);
	if (!lazyEls.length) return;

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target;
				// Setting `eager` triggers an internal boot path on agent-3d,
				// or we just rely on the existing IntersectionObserver inside
				// the element. Setting `eager` is a belt-and-braces nudge.
				el.setAttribute('eager', '');
				io.unobserve(el);
			}
		},
		{ rootMargin: '200px 0px', threshold: 0.05 },
	);

	for (const el of lazyEls) io.observe(el);
}

// ── Reveal each agent on `agent:ready` ───────────────────────────────────

function setupReveal() {
	for (const el of ROOT.querySelectorAll('agent-3d.act-agent')) {
		// If the agent dispatched agent:ready before this listener attached,
		// the data-ready guard catches the case via mutation fallback.
		onAgentReady(el, () => {
			el.dataset.ready = 'true';
		});
		// Safety: reveal after 6s even if ready never fires (network failure
		// shouldn't leave a perpetually invisible blob on the page).
		setTimeout(() => {
			if (!el.dataset.ready) el.dataset.ready = 'true';
		}, 6000);
	}
}

// ── Act 2: emotion chip → expressEmotion ─────────────────────────────────

function setupEmotionChips() {
	const wrap = ROOT.querySelector('[data-role="emotion-chips"]');
	const agentEl = ROOT.querySelector('[data-role="act2-agent"]');
	if (!wrap || !agentEl) return;

	wrap.addEventListener('click', (e) => {
		const btn = e.target.closest('.emotion-chip');
		if (!btn) return;
		const trigger = btn.getAttribute('data-emotion');
		if (!trigger) return;

		// Visual feedback (works even if agent hasn't booted yet)
		btn.dataset.active = 'true';
		setTimeout(() => delete btn.dataset.active, 600);

		// Trigger on the live avatar via the public API added in src/element.js.
		// Falls back silently if the method isn't defined (e.g. very old CDN
		// bundle); chips still feel responsive thanks to the visual feedback.
		if (typeof agentEl.expressEmotion === 'function') {
			agentEl.expressEmotion(trigger, 0.95);
		} else {
			// Fallback: dispatch a custom event the integrator can hook on.
			agentEl.dispatchEvent(
				new CustomEvent('emote', {
					detail: { trigger, weight: 0.95 },
					bubbles: true,
				}),
			);
		}
	});
}

// ── Act 3: chain ribbon + on-chain passport ──────────────────────────────

function paintChainRibbon() {
	const host = ROOT.querySelector('[data-role="chain-ribbon"]');
	if (!host) return;
	host.replaceChildren(
		...CHAIN_LABELS.map((label) => {
			const span = document.createElement('span');
			span.className = 'chain-pill';
			span.textContent = label;
			return span;
		}),
	);
}

async function loadOnChainAgent() {
	const passport = ROOT.querySelector('[data-role="passport"]');
	const idEl = ROOT.querySelector('[data-role="passport-id"]');
	const chainEl = ROOT.querySelector('[data-role="passport-chain"]');
	const codeIdEl = ROOT.querySelector('[data-role="code-agent-id"]');
	const statAgents = ROOT.querySelector('[data-role="stat-agents"]');
	const act3Agent = ROOT.querySelector('[data-role="act3-agent"]');

	try {
		// Fetch a recently-registered on-chain agent. /api/agents/suggest needs
		// a query string, so seed with a common letter; the endpoint is rate-
		// limited and public.
		const res = await fetch('/api/agents/suggest?q=a&limit=8', {
			headers: { accept: 'application/json' },
		});
		if (!res.ok) throw new Error(`suggest ${res.status}`);
		const { agents = [] } = await res.json();
		if (statAgents) statAgents.textContent = agents.length ? `${agents.length}+` : '—';

		const onChain = agents.find((a) => a.onChain);
		if (!onChain) return;

		// Load the chosen agent into the Act 3 avatar.
		if (act3Agent) act3Agent.setAttribute('agent-id', onChain.id);

		// Update the embed-code snippet to show a real id.
		if (codeIdEl) codeIdEl.textContent = shortAddr(onChain.id);

		// Show the passport tag.
		if (passport && idEl && chainEl) {
			idEl.textContent = shortAddr(onChain.id);
			chainEl.textContent = chainLabel(onChain.chainId);
			passport.hidden = false;
		}
	} catch (err) {
		// Soft-fail: leave the placeholders. The page still renders.
		console.warn('[features] suggest fetch failed', err);
	}
}

// ── Embed-snippet copy button ────────────────────────────────────────────

function setupCopyEmbed() {
	const btn = ROOT.querySelector('[data-role="copy-embed"]');
	const codeBlock = btn?.closest('.act-code')?.querySelector('code');
	if (!btn || !codeBlock) return;

	btn.addEventListener('click', async () => {
		const text = codeBlock.innerText.trim();
		try {
			await navigator.clipboard.writeText(text);
			btn.dataset.copied = 'true';
			btn.textContent = 'Copied';
			setTimeout(() => {
				delete btn.dataset.copied;
				btn.textContent = 'Copy';
			}, 1800);
		} catch {
			btn.textContent = 'Press ⌘C';
			setTimeout(() => (btn.textContent = 'Copy'), 1800);
		}
	});
}

// ── Boot ─────────────────────────────────────────────────────────────────

function init() {
	paintChainRibbon();
	setupReveal();
	setupLazyBoot();
	setupEmotionChips();
	setupCopyEmbed();
	loadOnChainAgent();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
	init();
}
