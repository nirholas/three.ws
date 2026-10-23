// aixbt pay HUD — a small left-edge panel that mirrors a live x402 payment made
// through aixbt's Intelligence Terminal, so a player watches USDC settle on
// Solana from the corner of the screen.
//
// It is driven by npc-aixbt.js's runPayment() off the SAME /api/x402-pay SSE
// lifecycle the in-modal stepper follows — no mock data, no second request. Its
// reason to exist alongside that stepper: it lives on document.body above the
// terminal overlay, so the payment keeps animating (and lands its receipt) on
// the left even if the player closes the terminal mid-settlement, then it
// auto-hides. Single instance, pure DOM, self-managing.

import { shortAddress } from '../../shared/address.js';

const STAGES = [
	{ id: 'challenge', label: '402' },
	{ id: 'built', label: 'Sign' },
	{ id: 'verified', label: 'Verify' },
	{ id: 'settled', label: 'Settle' },
	{ id: 'done', label: 'Confirmed' },
];

const fmtUsdc = (micro) => `${((Number(micro) || 0) / 1e6).toFixed(4)} USDC`;
const shortAddr = (a) => shortAddress(a, 4, 4, { empty: '\u2014' });

function injectStyles() {
	if (document.getElementById('aixbt-payhud-styles')) return;
	const s = document.createElement('style');
	s.id = 'aixbt-payhud-styles';
	s.textContent = `
	.aixbt-payhud {
		position: fixed; left: 16px; top: 50%; z-index: 130;
		width: 216px; box-sizing: border-box; padding: 13px 14px 12px;
		background: var(--cc-panel-solid, #0c0c0c); color: var(--cc-text, #f5f5f6);
		border: 1px solid rgba(39,224,196,0.34); border-radius: var(--cc-radius, 6px);
		box-shadow: 0 10px 34px rgba(0,0,0,0.55), 0 0 0 1px rgba(39,224,196,0.05);
		font: 500 13px Inter, system-ui, sans-serif;
		transform: translate(-130%, -50%); opacity: 0; pointer-events: none;
		transition: transform .26s cubic-bezier(.2,.8,.2,1), opacity .26s ease;
	}
	.aixbt-payhud.is-in { transform: translate(0, -50%); opacity: 1; pointer-events: auto; }
	.aixbt-payhud-head { display:flex; align-items:center; gap:7px; margin-bottom:11px; }
	.aixbt-payhud-tag { font-size:11px; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; color:var(--cc-text,#f5f5f6); }
	.aixbt-payhud-tag .ic { color:#27e0c4; margin-right:3px; }
	.aixbt-payhud-live { margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-size:9.5px; font-weight:800; letter-spacing:0.08em; color:#27e0c4; }
	.aixbt-payhud-live::before { content:''; width:6px; height:6px; border-radius:50%; background:#27e0c4; box-shadow:0 0 7px #27e0c4; animation:aixbt-payhud-pulse 1.6s ease-in-out infinite; }
	.aixbt-payhud.is-done .aixbt-payhud-live { color:#27e0c4; }
	.aixbt-payhud.is-err .aixbt-payhud-live { color:#ff7a8a; }
	.aixbt-payhud.is-err .aixbt-payhud-live::before { background:#ff7a8a; box-shadow:0 0 7px #ff7a8a; animation:none; }
	@keyframes aixbt-payhud-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
	.aixbt-payhud-who { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:11px; }
	.aixbt-payhud-who-t { font-size:12px; color:var(--cc-muted,#9a9aa2); }
	.aixbt-payhud-who-t b { color:var(--cc-text,#f5f5f6); font-weight:800; }
	.aixbt-payhud-amt { font-size:12px; font-weight:800; font-variant-numeric:tabular-nums; color:#9ff4e6; white-space:nowrap; }
	.aixbt-payhud-steps { display:flex; gap:5px; margin-bottom:9px; }
	.aixbt-payhud-step { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; font-size:8.5px; font-weight:800; letter-spacing:0.03em; text-transform:uppercase; color:#5a5a60; }
	.aixbt-payhud-step .dot { width:100%; height:3px; border-radius:2px; background:rgba(255,255,255,0.08); transition:background .2s ease; }
	.aixbt-payhud-step.is-active { color:#9a9aa2; }
	.aixbt-payhud-step.is-active .dot { background:rgba(39,224,196,0.5); animation:aixbt-payhud-step 1s ease-in-out infinite; }
	.aixbt-payhud-step.is-done { color:var(--cc-text,#e9e9ec); }
	.aixbt-payhud-step.is-done .dot { background:#27e0c4; box-shadow:0 0 7px rgba(39,224,196,0.6); }
	.aixbt-payhud-step.is-err .dot { background:#ff7a8a; box-shadow:0 0 7px rgba(255,122,138,0.5); }
	@keyframes aixbt-payhud-step { 0%,100%{opacity:0.5} 50%{opacity:1} }
	.aixbt-payhud-note { font-size:11.5px; line-height:1.4; color:var(--cc-muted,#9a9aa2); min-height:16px; }
	.aixbt-payhud-note.is-err { color:#ffb4be; }
	.aixbt-payhud-receipt { margin-top:10px; padding-top:9px; border-top:1px solid var(--cc-edge, rgba(255,255,255,0.1)); font-size:11.5px; }
	.aixbt-payhud-receipt a { color:#9ff4e6; text-decoration:none; border-bottom:1px solid rgba(159,244,230,0.4); }
	.aixbt-payhud-receipt a:hover { border-bottom-color:#9ff4e6; }
	@media (prefers-reduced-motion: reduce) {
		.aixbt-payhud { transition:opacity .2s ease; transform:translate(0,-50%); }
		.aixbt-payhud-step.is-active .dot { animation:none; }
		.aixbt-payhud-live::before { animation:none; }
	}
	/* The terminal becomes a full-width bottom sheet on phones; its in-modal
	   stepper covers that case, so the floating HUD stands down to avoid overlap. */
	@media (max-width: 720px) { .aixbt-payhud { display:none; } }`;
	document.head.appendChild(s);
}

let node = null; // root .aixbt-payhud
let stepsEl = null; // stepper container
let amtEl = null; // amount
let noteEl = null; // status line
let receiptEl = null; // tx receipt (filled on settle)
let amount = null; // microUSDC for this round
let hideTimer = null;

function ensureNode() {
	if (node) return;
	injectStyles();
	node = document.createElement('div');
	node.className = 'aixbt-payhud';
	node.setAttribute('role', 'status');
	node.setAttribute('aria-live', 'polite');
	node.innerHTML = `
		<div class="aixbt-payhud-head">
			<span class="aixbt-payhud-tag"><span class="ic">⚡</span>x402 · aixbt</span>
			<span class="aixbt-payhud-live">LIVE</span>
		</div>
		<div class="aixbt-payhud-who">
			<span class="aixbt-payhud-who-t"><b>three.ws</b> pays for a live read</span>
		</div>
		<div class="aixbt-payhud-who"><span class="aixbt-payhud-who-t">on Solana mainnet</span><span class="aixbt-payhud-amt">— USDC</span></div>
		<div class="aixbt-payhud-steps"></div>
		<div class="aixbt-payhud-note"></div>
		<div class="aixbt-payhud-receipt" hidden></div>`;
	document.body.appendChild(node);
	stepsEl = node.querySelector('.aixbt-payhud-steps');
	amtEl = node.querySelector('.aixbt-payhud-amt');
	noteEl = node.querySelector('.aixbt-payhud-note');
	receiptEl = node.querySelector('.aixbt-payhud-receipt');
}

function paint(activeId, errId = null) {
	const ai = STAGES.findIndex((s) => s.id === activeId);
	stepsEl.textContent = '';
	for (let i = 0; i < STAGES.length; i++) {
		const s = STAGES[i];
		let cls = '';
		if (errId === s.id) cls = 'is-err';
		else if (activeId === 'done' || i < ai) cls = 'is-done';
		else if (i === ai) cls = 'is-active';
		const step = document.createElement('div');
		step.className = `aixbt-payhud-step ${cls}`.trim();
		step.innerHTML = `<span class="dot"></span>${s.label}`;
		stepsEl.appendChild(step);
	}
	if (amount != null) amtEl.textContent = fmtUsdc(amount);
}

function show() {
	ensureNode();
	clearTimeout(hideTimer);
	requestAnimationFrame(() => node.classList.add('is-in'));
}

const NOTES = {
	challenge: 'Issuing the 402 payment challenge…',
	built: 'Signing the Solana transfer…',
	verified: 'Verifying with the facilitator…',
	settled: 'Settling on-chain…',
	done: 'Confirmed on Solana ✓',
};

// The controller npc-aixbt.js drives. Each call mirrors one SSE stage so the
// left HUD animates in lockstep with the terminal's own stepper.
export const aixbtPayHud = {
	// A payment is starting — reveal the panel at the first stage.
	begin() {
		ensureNode();
		amount = null;
		node.classList.remove('is-done', 'is-err');
		receiptEl.hidden = true;
		receiptEl.textContent = '';
		amtEl.textContent = '— USDC';
		noteEl.classList.remove('is-err');
		noteEl.textContent = NOTES.challenge;
		paint('challenge');
		show();
	},
	// Advance to a stage; pass the challenge amount through once it's known.
	setStage(stageId, amt) {
		if (!node) this.begin();
		if (amt != null) amount = amt;
		paint(stageId);
		noteEl.classList.remove('is-err');
		noteEl.textContent = NOTES[stageId] || 'Processing…';
	},
	// Settled on-chain — mark done, drop the receipt, then auto-hide.
	settle(payment = {}) {
		if (!node) return;
		if (payment.amount != null) amount = payment.amount;
		node.classList.add('is-done');
		paint('done');
		noteEl.classList.remove('is-err');
		noteEl.textContent = `Settled · ${shortAddr(payment.payer)} → ${shortAddr(payment.payTo)}`;
		const tx = payment.tx;
		if (tx) {
			receiptEl.hidden = false;
			receiptEl.innerHTML = '';
			const a = document.createElement('a');
			a.href = `https://solscan.io/tx/${tx}`;
			a.target = '_blank';
			a.rel = 'noopener';
			a.textContent = `${String(tx).slice(0, 8)}…${String(tx).slice(-6)} ↗`;
			receiptEl.appendChild(document.createTextNode('View on Solscan: '));
			receiptEl.appendChild(a);
		}
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => this.hide(), 8000);
	},
	// Payment failed at `stageId` — show the error, then auto-hide.
	fail(message, stageId = 'settled') {
		if (!node) return;
		node.classList.add('is-err');
		paint(stageId, stageId);
		noteEl.classList.add('is-err');
		noteEl.textContent = message || 'Payment failed — no funds moved.';
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => this.hide(), 6500);
	},
	hide() {
		clearTimeout(hideTimer);
		if (node) node.classList.remove('is-in');
	},
};
