// Agora — styles for the Task 07 trust surface (job detail, verifier, the rich
// passport additions, cross-chain handshake). Injected at runtime (id-guarded)
// by trust-surface.js and passport-panel.js so this layer never has to touch the
// shared, concurrently-edited src/agora/agora.css. Matches the Commons theme:
// near-black panels, hairline borders, the blue→violet accent.

export const TRUST_SURFACE_CSS = `
.agora-panel {
	position: fixed; top: 0; right: 0; bottom: 0;
	width: min(420px, 100vw);
	display: flex; flex-direction: column;
	background: rgba(13, 15, 20, 0.94);
	-webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
	border-left: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: -24px 0 80px rgba(0, 0, 0, 0.55);
	z-index: 60;
	transform: translateX(102%); opacity: 0;
	transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease;
	color: rgba(255, 255, 255, 0.9);
	font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
}
.agora-panel.is-open { transform: none; opacity: 1; }
.agora-panel:focus { outline: none; }
.agora-panel-head {
	display: flex; align-items: flex-start; gap: 12px;
	padding: 18px 18px 14px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.agora-panel-head-text { flex: 1; min-width: 0; }
.agora-panel-title {
	font-size: 17px; font-weight: 650; line-height: 1.25;
	color: #fff; word-break: break-word;
}
.agora-panel-sub { margin-top: 4px; font-size: 12px; color: rgba(255, 255, 255, 0.45); }
.agora-panel-close {
	flex: none; width: 30px; height: 30px; border-radius: 8px;
	display: grid; place-items: center; cursor: pointer;
	background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.7);
	border: 1px solid rgba(255, 255, 255, 0.1); font-size: 14px;
	transition: background 0.15s ease, color 0.15s ease;
}
.agora-panel-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.agora-panel-close:focus-visible { outline: 2px solid #6da1ff; outline-offset: 2px; }
.agora-panel-body { flex: 1; overflow-y: auto; padding: 16px 18px 28px; overscroll-behavior: contain; }

/* ── sub-header chips ─────────────────────────────────────────────────────── */
.agora-sub-row { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agora-sub-code { font-family: ui-monospace, monospace; font-size: 11px; color: rgba(255, 255, 255, 0.5); }
.agora-chip {
	display: inline-flex; align-items: center; gap: 5px;
	font-size: 11px; font-weight: 550; letter-spacing: 0.02em;
	padding: 2px 8px; border-radius: 999px;
	background: rgba(255, 255, 255, 0.07); color: rgba(255, 255, 255, 0.78);
	border: 1px solid rgba(255, 255, 255, 0.1);
}
.agora-chip-cluster { text-transform: lowercase; color: #8fb5ff; border-color: rgba(109, 161, 255, 0.3); background: rgba(109, 161, 255, 0.1); }
.agora-chip-prof { color: #d6c3ff; border-color: rgba(150, 120, 255, 0.3); background: rgba(150, 120, 255, 0.1); }

/* ── key/value + facts ────────────────────────────────────────────────────── */
.agora-facts { display: flex; flex-direction: column; gap: 2px; margin: 6px 0; }
.agora-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.agora-kv.wide { flex-direction: column; align-items: stretch; gap: 4px; }
.agora-kv-key { font-size: 12px; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.02em; flex: none; }
.agora-kv-val { font-size: 13px; color: rgba(255, 255, 255, 0.9); text-align: right; word-break: break-word; }
.agora-muted { color: rgba(255, 255, 255, 0.4); }
.agora-mono-sm { font-family: ui-monospace, monospace; font-size: 11px; color: rgba(255, 255, 255, 0.7); word-break: break-all; }

/* ── reward chip ($THREE only) ────────────────────────────────────────────── */
.agora-reward { display: inline-flex; align-items: baseline; gap: 5px; }
.agora-reward-amt { font-size: 14px; font-weight: 650; color: #fff; font-variant-numeric: tabular-nums; }
.agora-reward-coin { font-size: 11px; font-weight: 600; color: #8a6dff; letter-spacing: 0.02em; }

/* ── sections ─────────────────────────────────────────────────────────────── */
.agora-section { margin-top: 22px; }
.agora-section-title { display: flex; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255, 255, 255, 0.5); margin-bottom: 12px; }
.agora-section-hint { font-size: 10px; font-weight: 500; text-transform: none; letter-spacing: 0; color: rgba(255, 255, 255, 0.35); }
.agora-section-empty { font-size: 13px; line-height: 1.55; }
.agora-service-desc { font-size: 13px; line-height: 1.55; color: rgba(255,255,255,0.7); margin-bottom: 8px; }

/* ── badges ───────────────────────────────────────────────────────────────── */
.agora-badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 650; padding: 3px 10px; border-radius: 999px; letter-spacing: 0.03em; text-transform: uppercase; border: 1px solid transparent; }
.agora-badge.is-open { color: #7ee0a8; background: rgba(80, 220, 140, 0.12); border-color: rgba(80, 220, 140, 0.3); }
.agora-badge.is-claimed { color: #ffd27a; background: rgba(255, 200, 90, 0.12); border-color: rgba(255, 200, 90, 0.3); }
.agora-badge.is-completed { color: #8fb5ff; background: rgba(109, 161, 255, 0.14); border-color: rgba(109, 161, 255, 0.32); }
.agora-badge.is-cancelled, .agora-badge.is-expired { color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); }
.agora-badge.is-disputed { color: #ff9a8f; background: rgba(255, 120, 110, 0.12); border-color: rgba(255, 120, 110, 0.3); }
.agora-job-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.agora-job-reward { display: inline-flex; align-items: center; gap: 8px; }

/* ── timeline ─────────────────────────────────────────────────────────────── */
.agora-timeline { list-style: none; margin: 0; padding: 0; }
.agora-timeline-item { position: relative; display: flex; gap: 12px; padding: 0 0 16px 0; }
.agora-timeline-item::before { content: ''; position: absolute; left: 5px; top: 14px; bottom: -2px; width: 1px; background: rgba(255, 255, 255, 0.12); }
.agora-timeline-item:last-child::before { display: none; }
.agora-timeline-dot { flex: none; width: 11px; height: 11px; border-radius: 50%; margin-top: 3px; background: #6da1ff; box-shadow: 0 0 0 3px rgba(109, 161, 255, 0.18); z-index: 1; }
.agora-timeline-item.is-done .agora-timeline-dot { background: linear-gradient(135deg, #5d8bff, #8a6dff); }
.agora-timeline-body { flex: 1; min-width: 0; }
.agora-timeline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.agora-timeline-label { font-size: 13px; font-weight: 600; color: #fff; }
.agora-timeline-time { font-size: 11px; color: rgba(255, 255, 255, 0.4); font-variant-numeric: tabular-nums; }
.agora-timeline-desc { font-size: 12px; color: rgba(255, 255, 255, 0.5); margin-top: 2px; }
.agora-timeline-links { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.agora-timeline-actor { font-size: 12px; }
.agora-tx-link, .agora-addr, .agora-actor-link, .agora-addr-ext, .agora-chaincard-link {
	font-size: 11px; color: #8fb5ff; text-decoration: none; font-family: ui-monospace, monospace;
	border-bottom: 1px solid transparent; transition: border-color 0.15s ease, color 0.15s ease;
}
.agora-tx-link:hover, .agora-addr:hover, .agora-actor-link:hover, .agora-addr-ext:hover, .agora-chaincard-link:hover { color: #b9d2ff; border-bottom-color: rgba(143, 181, 255, 0.5); }
.agora-actor-link { background: none; border: none; cursor: pointer; padding: 0; }
.agora-tx-link:focus-visible, .agora-addr:focus-visible, .agora-actor-link:focus-visible, .agora-copy:focus-visible, .agora-verify-chip:focus-visible { outline: 2px solid #6da1ff; outline-offset: 2px; border-radius: 3px; }

/* ── copy chip ────────────────────────────────────────────────────────────── */
.agora-copy {
	display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
	background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 6px; padding: 2px 6px; font-size: 11px; color: rgba(255, 255, 255, 0.6);
	font-family: ui-monospace, monospace; transition: background 0.15s ease, color 0.15s ease;
}
.agora-copy:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.agora-copy.is-ok { color: #7ee0a8; border-color: rgba(80, 220, 140, 0.4); }
.agora-copy.is-fail { color: #ff9a8f; border-color: rgba(255, 120, 110, 0.4); }
.agora-copy-icon { font-size: 11px; }

/* ── hashes ───────────────────────────────────────────────────────────────── */
.agora-hash-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
.agora-hash-label { font-size: 11px; color: rgba(255, 255, 255, 0.45); flex: none; min-width: 92px; }
.agora-hash, .agora-hash-inline { font-family: ui-monospace, monospace; font-size: 12px; color: rgba(255, 255, 255, 0.82); word-break: break-all; }
.agora-hash.is-ok { color: #7ee0a8; }
.agora-hash.is-bad { color: #ff9a8f; }

/* ── verifier ─────────────────────────────────────────────────────────────── */
.agora-verify { display: flex; flex-direction: column; gap: 10px; }
.agora-verify-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.agora-btn-icon { margin-right: 6px; }
.agora-btn.is-busy { opacity: 0.7; pointer-events: none; }
.agora-btn-ghost { background: transparent; }
.agora-verify-note { font-size: 12px; line-height: 1.55; color: rgba(255, 255, 255, 0.55); }
.agora-verify-progress { display: flex; flex-direction: column; gap: 6px; }
.agora-verify-progress-label { font-size: 12px; color: rgba(255, 255, 255, 0.55); }
.agora-verdict { display: flex; gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid; }
.agora-verdict.is-match { background: rgba(80, 220, 140, 0.08); border-color: rgba(80, 220, 140, 0.3); }
.agora-verdict.is-mismatch { background: rgba(255, 110, 100, 0.08); border-color: rgba(255, 110, 100, 0.32); }
.agora-verdict.is-error { background: rgba(255, 190, 90, 0.08); border-color: rgba(255, 190, 90, 0.3); }
.agora-verdict-icon { flex: none; font-size: 20px; line-height: 1.1; }
.agora-verdict.is-match .agora-verdict-icon { color: #7ee0a8; }
.agora-verdict.is-mismatch .agora-verdict-icon { color: #ff9a8f; }
.agora-verdict.is-error .agora-verdict-icon { color: #ffd27a; }
.agora-verdict-text { display: flex; flex-direction: column; gap: 3px; }
.agora-verdict-text strong { font-size: 13px; color: #fff; }
.agora-verdict-sub { font-size: 12px; line-height: 1.5; color: rgba(255, 255, 255, 0.6); }
.agora-verify-hashes { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
/* Verify → vouch bridge: the one-click attestation offered on a matching verdict. */
.agora-verify-vouch { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; background: rgba(80, 220, 140, 0.06); border: 1px dashed rgba(80, 220, 140, 0.28); }
.agora-verify-vouch-hint { font-size: 12px; color: rgba(255, 255, 255, 0.66); }
.agora-verify-vouch-btn { flex: none; }
.agora-glb-viewer { margin-top: 12px; width: 100%; height: 240px; border-radius: 12px; overflow: hidden; background: #0b0c10; border: 1px solid rgba(255, 255, 255, 0.08); }
.agora-glb-viewer canvas { display: block; width: 100%; height: 100%; cursor: grab; }
.agora-glb-viewer canvas:active { cursor: grabbing; }
.agora-glb-caption { font-size: 11px; color: rgba(255, 255, 255, 0.4); margin-top: 6px; text-align: center; }
.agora-map-card { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-top: 12px; padding: 12px; border-radius: 12px; background: #0b0c10; border: 1px solid rgba(255, 255, 255, 0.08); }
.agora-map-thumb { width: 120px; height: 120px; flex: none; border-radius: 8px; background: rgba(255, 255, 255, 0.04); }
.agora-map-thumb circle { fill: #7cf0c4; opacity: 0.9; }
.agora-map-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 13px; }
.agora-map-link { color: #7cf0c4; text-decoration: underline; border-radius: 4px; width: fit-content; }
.agora-map-link:hover { color: #b5f8de; }
.agora-map-link:focus-visible { outline: 2px solid #7cf0c4; outline-offset: 2px; }
.agora-map-link:active { opacity: 0.7; }
.agora-glb-fail { padding: 16px; font-size: 12px; color: #ff9a8f; }

/* ── states (loading / error / empty) ─────────────────────────────────────── */
.agora-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 40px 16px; }
.agora-state-loading { align-items: stretch; padding: 8px 0; }
.agora-state-icon { font-size: 26px; color: rgba(255, 255, 255, 0.3); }
.agora-state-msg { font-size: 14px; color: rgba(255, 255, 255, 0.75); }
.agora-state-hint { font-size: 12px; color: rgba(255, 255, 255, 0.45); line-height: 1.5; }
.agora-skel { display: block; border-radius: 6px; background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: agora-shimmer 1.4s ease-in-out infinite; }
.agora-skel-line { height: 13px; margin: 7px 0; }
.agora-skel-line.short { width: 60%; }
.agora-skel-block { height: 90px; margin: 12px 0; }
@keyframes agora-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .agora-skel { animation: none; } .agora-panel { transition: opacity 0.2s ease; transform: none; } }

/* ── passport additions (grade / on-chain / stats / handshake) ────────────── */
.agora-passport-id { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.agora-monogram { flex: none; width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; font-size: 22px; font-weight: 700; color: #fff; }
.agora-passport-id-text { flex: 1; min-width: 0; }
.agora-passport-name { font-size: 18px; font-weight: 650; color: #fff; }
.agora-passport-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
.agora-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7); }
.agora-status-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.4); }
.agora-status.is-active .agora-status-dot { background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.7); }
.agora-status.is-busy .agora-status-dot { background: #ffd27a; box-shadow: 0 0 6px rgba(255,210,122,0.7); }
.agora-status.is-idle .agora-status-dot { background: #8fb5ff; }
.agora-status.is-suspended .agora-status-dot { background: #ff9a8f; }
.agora-grade { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
.agora-grade-letter { font-size: 20px; font-weight: 750; line-height: 1; }
.agora-grade-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.45); margin-top: 3px; text-align: center; }
.agora-grade.tier-a .agora-grade-letter { color: #7ee0a8; }
.agora-grade.tier-b .agora-grade-letter { color: #8fb5ff; }
.agora-grade.tier-c .agora-grade-letter { color: #ffd27a; }
.agora-grade.tier-d .agora-grade-letter { color: #ffb38f; }
.agora-grade.tier-e .agora-grade-letter { color: #ff9a8f; }
.agora-grade.tier-new .agora-grade-letter { color: rgba(255,255,255,0.4); }
.agora-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(86px, 1fr)); gap: 8px; margin: 4px 0 4px; }
.agora-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 10px; }
.agora-stat-val { font-size: 17px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
.agora-stat-label { font-size: 11px; color: rgba(255,255,255,0.55); margin-top: 2px; }
.agora-stat-sub { font-size: 9px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 1px; }
.agora-onchain .agora-section-title { color: rgba(143,181,255,0.7); }
.agora-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.8); display: inline-block; animation: agora-pulse 2s ease-in-out infinite; }
@keyframes agora-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.agora-prof-chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* ── activity feed (passport) ─────────────────────────────────────────────── */
.agora-activity { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.agora-activity-item { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.agora-activity-narr { font-size: 13px; color: rgba(255,255,255,0.88); line-height: 1.45; }
.agora-activity-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 5px; }
.agora-activity-time { font-size: 11px; color: rgba(255,255,255,0.4); }
.agora-activity-rep { font-size: 11px; color: #7ee0a8; font-variant-numeric: tabular-nums; }
.agora-activity-links { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.agora-verify-chip { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 11px; font-weight: 600; color: #8fb5ff; background: rgba(109,161,255,0.1); border: 1px solid rgba(109,161,255,0.28); border-radius: 6px; padding: 2px 8px; transition: background 0.15s ease; }
.agora-verify-chip:hover { background: rgba(109,161,255,0.2); }

/* ── handshake ────────────────────────────────────────────────────────────── */
.agora-handshake-explainer { font-size: 13px; line-height: 1.55; color: rgba(255,255,255,0.62); margin-bottom: 14px; }
.agora-handshake-explainer strong { color: #fff; }
.agora-handshake-bridge { display: flex; align-items: stretch; gap: 6px; }
.agora-chaincard { flex: 1; min-width: 0; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.agora-chaincard-head { display: flex; align-items: center; gap: 8px; }
.agora-chaincard-glyph { font-size: 18px; }
.agora-chaincard-chain { font-size: 13px; font-weight: 650; color: #fff; }
.agora-chaincard-standard { font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.05em; }
.agora-chaincard-id { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.agora-chaincard-val { font-family: ui-monospace, monospace; font-size: 12px; color: rgba(255,255,255,0.8); word-break: break-all; }
.agora-handshake-merge { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 0 2px; }
.agora-handshake-merge-line { width: 1px; flex: 1; background: linear-gradient(rgba(138,109,255,0), rgba(138,109,255,0.6)); }
.agora-handshake-merge-line:last-child { background: linear-gradient(rgba(138,109,255,0.6), rgba(138,109,255,0)); }
.agora-handshake-merge-node { font-size: 14px; color: #8a6dff; }
.agora-handshake-canonical { margin-top: 12px; padding: 12px; background: rgba(138,109,255,0.07); border: 1px solid rgba(138,109,255,0.25); border-radius: 12px; }
.agora-handshake-canon-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.agora-handshake-canon-title { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.6); }
.agora-handshake-verified { font-size: 11px; font-weight: 650; color: #7ee0a8; }
.agora-handshake-unverified { font-size: 11px; font-weight: 650; color: #ffd27a; }
.agora-handshake-flags { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.agora-flag { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(255,255,255,0.55); }
.agora-flag-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.3); }
.agora-flag.is-on .agora-flag-dot { background: #4ade80; }
.agora-flag.is-off .agora-flag-dot { background: #ff9a8f; }
.agora-handshake-loading { display: flex; flex-direction: column; gap: 6px; }
.agora-handshake-loading-label { font-size: 12px; color: rgba(255,255,255,0.5); }

/* passport additions layered over agora.css's .agora-pp-* base */
.agora-pp-hero-text { flex: 1; min-width: 0; }
.agora-pp-grade { flex: none; margin-left: auto; }
.agora-pp-statusline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 14px; }

.agora-pp-trust-head { position: relative; display: flex; align-items: center; gap: 8px; }
.agora-pp-help { width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.75); font-size: 11px; font-weight: 700; line-height: 1; cursor: help; transition: background 0.15s, border-color 0.15s; }
.agora-pp-help:hover { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.45); }
.agora-pp-help:active { background: rgba(255,255,255,0.2); }
.agora-pp-help:focus-visible { outline: 2px solid #6da1ff; outline-offset: 2px; }
.agora-pp-tip { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 3; padding: 10px 12px; border-radius: 10px; background: #14171f; border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 8px 24px rgba(0,0,0,0.45); font-size: 11px; font-weight: 400; line-height: 1.5; text-transform: none; letter-spacing: 0; color: rgba(255,255,255,0.8); visibility: hidden; opacity: 0; transition: opacity 0.12s; pointer-events: none; }
.agora-pp-help:hover + .agora-pp-tip, .agora-pp-help:focus-visible + .agora-pp-tip { visibility: visible; opacity: 1; }
.agora-pp-trust { margin: 0 0 6px; display: grid; gap: 4px; }
.agora-pp-trust > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.04); }
.agora-pp-trust dt { color: rgba(255,255,255,0.6); }
.agora-pp-trust dd { margin: 0; text-align: right; color: #fff; font-variant-numeric: tabular-nums; }
.agora-pp-trust dd span { display: block; font-size: 10px; color: rgba(255,255,255,0.4); }
.agora-pp-trust-total { background: rgba(126,224,168,0.08) !important; }
.agora-pp-stat-sub { font-size: 9px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
.agora-pp-section-live { display: flex; align-items: center; gap: 8px; }
.agora-pp-onchain { display: flex; flex-direction: column; gap: 0; padding: 4px 12px; background: rgba(143,181,255,0.05); border: 1px solid rgba(143,181,255,0.16); border-radius: 12px; }
.agora-pp-reward { font-size: 11px; color: #8a6dff; font-weight: 600; }
.agora-pp-feed-time { font-size: 11px; color: rgba(255,255,255,0.4); }

.sr-only, .agora-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

@media (max-width: 480px) {
	.agora-panel { width: 100vw; }
	.agora-handshake-bridge { flex-direction: column; }
	.agora-handshake-merge { flex-direction: row; padding: 4px 0; }
	.agora-handshake-merge-line { width: auto; height: 1px; }
}
`;

let _injected = false;
export function injectTrustSurfaceCss() {
	if (_injected || (typeof document !== 'undefined' && document.getElementById('agora-trust-surface-styles'))) return;
	if (typeof document === 'undefined') return;
	const style = document.createElement('style');
	style.id = 'agora-trust-surface-styles';
	style.textContent = TRUST_SURFACE_CSS;
	document.head.appendChild(style);
	_injected = true;
}
