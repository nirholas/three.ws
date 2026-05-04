/**
 * /features — page wiring.
 *
 * - Wires Act 2 emotion chips → robotexpressive animation playback.
 * - Fetches a real on-chain agent and shows its passport tag on Act 3.
 * - Populates the chain ribbon (Act 3 background) from a fixed list — kept
 *   in sync visually with src/erc8004/chains.js but not imported (this page
 *   is a static asset, no module graph connection to /src).
 * - Wires the embed-snippet copy button.
 *
 * No build step. Plain ES module loaded via <script type="module">.
 */

const ROOT = document;

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

// ── Act 2: emotion chip → robotexpressive animation ──────────────────────

const EMOTION_TO_ANIM = {
	celebration: 'Dance',
	curiosity: 'Wave',
	empathy: 'ThumbsUp',
	concern: 'No',
	patience: 'Yes',
};

function setupEmotionChips() {
	const wrap = ROOT.querySelector('[data-role="emotion-chips"]');
	const agentEl = ROOT.querySelector('[data-role="act2-agent"]');
	if (!wrap || !agentEl) return;

	wrap.addEventListener('click', (e) => {
		const btn = e.target.closest('.emotion-chip');
		if (!btn) return;
		const trigger = btn.getAttribute('data-emotion');
		if (!trigger) return;

		btn.dataset.active = 'true';
		setTimeout(() => delete btn.dataset.active, 600);

		const animName = EMOTION_TO_ANIM[trigger];
		if (animName && (agentEl.availableAnimations || []).includes(animName)) {
			agentEl.animationName = animName;
			agentEl.play();
		}
	});
}

// ── Act 3: on-chain passport ─────────────────────────────────────────────

async function loadOnChainAgent() {
	const passport = ROOT.querySelector('[data-role="passport"]');
	const idEl = ROOT.querySelector('[data-role="passport-id"]');
	const chainEl = ROOT.querySelector('[data-role="passport-chain"]');
	const codeIdEl = ROOT.querySelector('[data-role="code-agent-id"]');
	const statAgents = ROOT.querySelector('[data-role="stat-agents"]');

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

// ── Star field canvas renderer ───────────────────────────────────────────

function initStarFields() {
	for (const canvas of ROOT.querySelectorAll('[data-role="star-canvas"]')) {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = window.innerWidth * dpr;
		const h = window.innerHeight * 8 * dpr; // double-tall so 120s drift loops cleanly
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		const tint = canvas.dataset.tint || '255,255,255';
		const count = parseInt(canvas.dataset.count || '250', 10);
		for (let i = 0; i < count; i++) {
			const x = Math.random() * w;
			const y = Math.random() * h;
			const r = (Math.random() * 1.4 + 0.3) * dpr;
			const a = Math.random() * 0.65 + 0.2;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${tint},${a})`;
			ctx.fill();
		}
		// A handful of brighter "star clusters"
		for (let i = 0; i < 12; i++) {
			const x = Math.random() * w;
			const y = Math.random() * h;
			const grd = ctx.createRadialGradient(x, y, 0, x, y, 6 * dpr);
			grd.addColorStop(0, `rgba(${tint},0.9)`);
			grd.addColorStop(1, `rgba(${tint},0)`);
			ctx.beginPath();
			ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
			ctx.fillStyle = grd;
			ctx.fill();
		}
	}
}

// ── Progress dots ────────────────────────────────────────────────────────

function setupProgressDots() {
	const dots = ROOT.querySelectorAll('.act-dot[data-act]');
	const acts = ROOT.querySelectorAll('.parallax-act[data-act]');
	const scroll = ROOT.querySelector('.parallax');
	if (!dots.length || !acts.length || !scroll) return;

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const actNum = entry.target.dataset.act;
				dots.forEach((d) => {
					d.dataset.active = d.dataset.act === actNum ? 'true' : 'false';
				});
			}
		},
		{ root: scroll, threshold: 0.5 },
	);

	acts.forEach((act) => io.observe(act));
}

// ── Boot ─────────────────────────────────────────────────────────────────

function setupScrollHint() {
	const hint = document.querySelector('[data-role="scroll-hint"]');
	if (!hint) return;
	const container = document.querySelector('.parallax') || window;
	function hide() {
		hint.classList.add('scroll-hint--hidden');
		hint.addEventListener('transitionend', () => {
			hint.hidden = true;
		}, { once: true });
		container.removeEventListener('scroll', hide);
	}
	container.addEventListener('scroll', hide, { passive: true });
}

function setupAuthNav() {
	try {
		const raw = localStorage.getItem('3dagent:auth-hint');
		if (raw && JSON.parse(raw).authed) {
			const el = document.getElementById('home-nav-my-agents-li');
			if (el) el.hidden = false;
		}
	} catch (_) {}
}

function init() {
	initStarFields();
	setupEmotionChips();
	setupCopyEmbed();
	setupProgressDots();
	loadOnChainAgent();
	setupScrollHint();
	setupAuthNav();
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
	init();
}
