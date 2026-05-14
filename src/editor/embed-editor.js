// Embed editor — the "place, scale, preview, copy" UX.
// Lets users drop an <agent-3d> exactly where they want on their actual site.
//
// Usage: import and call mountEmbedEditor(rootEl, { src, defaults }).

import '../element.js'; // ensures <agent-3d> is registered

const POSITIONS = [
	{ id: 'top-left', label: '↖' },
	{ id: 'top-center', label: '↑' },
	{ id: 'top-right', label: '↗' },
	{ id: 'bottom-left', label: '↙' },
	{ id: 'bottom-center', label: '↓' },
	{ id: 'bottom-right', label: '↘' },
];

const MODES = [
	{ id: 'floating', label: 'Floating bubble', hint: 'Fixed corner, follows scroll' },
	{ id: 'inline', label: 'Inline', hint: 'Flows with the page content' },
	{ id: 'section', label: 'Section', hint: 'Fills a container' },
	{ id: 'fullscreen', label: 'Fullscreen', hint: 'Takes over the viewport' },
];

const DEVICES = [
	{ id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
	{ id: 'tablet', label: 'Tablet', w: 768, h: 1024 },
	{ id: 'mobile', label: 'Mobile', w: 390, h: 844 },
];

const RESPONSIVE_PRESETS = [
	{ id: 'fixed', label: 'Fixed', hint: 'Exact px — no scaling' },
	{ id: 'mobile-first', label: 'Mobile-first', hint: 'Grows from mobile min' },
	{ id: 'desktop-first', label: 'Desktop-first', hint: 'Shrinks from preferred size' },
];

// Shown in the preview when the user hasn't entered a `src` yet — so the stage
// always renders an actual avatar instead of an empty box. Not emitted in the
// generated snippet.
const DEFAULT_PREVIEW_SRC = '/avatars/default.glb';

// Pinned <agent-3d> library version emitted in the snippet. Matches package.json
// and the production CDN path documented in /docs/web-component.md.
const AGENT_3D_VERSION = '1.5.1';
const AGENT_3D_HOST = 'https://three.ws';

const BACKGROUNDS = [
	{ id: '', label: 'Default' },
	{ id: 'transparent', label: 'Transparent' },
	{ id: 'dark', label: 'Dark' },
	{ id: 'light', label: 'Light' },
];

// Curated demo avatars surfaced at the top of the picker. URLs match
// api/_lib/demo-avatars.js fixtures (HEAD-checked CC-BY / MIT GLBs). The
// picker prepends these before /api/avatars/public results so the gallery
// always opens to something demo-worthy instead of unnamed user uploads.
const DEMO_AVATARS = [
	{ id: 'demo-cz', name: 'CZ', model_url: '/avatars/cz.glb' },
	{ id: 'demo-default', name: 'Default', model_url: '/avatars/default.glb' },
	{ id: 'demo-robot', name: 'Robot Expressive', model_url: '/animations/robotexpressive.glb' },
	{ id: 'demo-soldier', name: 'Soldier (rigged)', model_url: '/animations/soldier.glb' },
	{ id: 'demo-michelle', name: 'Michelle', model_url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/Michelle.glb' },
	{ id: 'demo-xbot', name: 'Xbot', model_url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/Xbot.glb' },
	{ id: 'demo-kira', name: 'Kira', model_url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/kira.glb' },
	{ id: 'demo-cesium', name: 'Cesium Man', model_url: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/CesiumMan/glTF-Binary/CesiumMan.glb' },
];

const STYLE = `
	.editor-root {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: 1fr 360px;
		grid-template-rows: minmax(0, 1fr);
		background: #0b0d10;
		color: #f4f4f5;
		font: 14px/1.4 system-ui, -apple-system, sans-serif;
		z-index: 1;
	}
	.stage-wrap {
		position: relative;
		overflow: hidden;
		background: #1a1d21;
	}
	.stage-wrap iframe {
		width: 100%;
		height: 100%;
		border: 0;
		background: white;
	}
	.stage-wrap .placeholder-site {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
		color: #0f172a;
		overflow: auto;
		font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
	}
	.placeholder-site .nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 48px;
		border-bottom: 1px solid #e5e7eb;
		background: rgba(255,255,255,0.9);
		backdrop-filter: blur(8px);
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.placeholder-site .brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font: 700 17px/1 system-ui;
		color: #0f172a;
	}
	.placeholder-site .brand .logo {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
	}
	.placeholder-site .nav-links {
		display: flex;
		gap: 28px;
		font: 500 14px system-ui;
		color: #475569;
	}
	.placeholder-site .nav-links span { cursor: default; }
	.placeholder-site .nav-cta {
		background: #0f172a;
		color: white;
		padding: 8px 16px;
		border-radius: 8px;
		font: 600 13px system-ui;
	}
	.placeholder-site .hero-wrap {
		max-width: 960px;
		margin: 0 auto;
		padding: 72px 48px 48px;
		text-align: center;
	}
	.placeholder-site .pill {
		display: inline-block;
		padding: 6px 14px;
		border-radius: 999px;
		background: #ede9fe;
		color: #6d28d9;
		font: 600 12px system-ui;
		margin-bottom: 20px;
	}
	.placeholder-site h1 {
		font: 800 48px/1.1 system-ui;
		letter-spacing: -0.02em;
		margin-bottom: 18px;
		color: #0f172a;
	}
	.placeholder-site h1 .accent {
		background: linear-gradient(90deg, #6366f1, #ec4899);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.placeholder-site p.lede {
		font-size: 18px;
		color: #475569;
		max-width: 640px;
		margin: 0 auto 28px;
	}
	.placeholder-site .cta-row {
		display: flex;
		gap: 12px;
		justify-content: center;
		margin-bottom: 56px;
	}
	.placeholder-site .btn-primary {
		background: #0f172a;
		color: white;
		padding: 12px 22px;
		border-radius: 10px;
		font: 600 14px system-ui;
		box-shadow: 0 8px 20px rgba(15,23,42,0.18);
	}
	.placeholder-site .btn-ghost {
		background: white;
		color: #0f172a;
		padding: 12px 22px;
		border-radius: 10px;
		font: 600 14px system-ui;
		border: 1px solid #e5e7eb;
	}
	.placeholder-site .screenshot {
		max-width: 1080px;
		margin: 0 auto;
		padding: 0 48px;
	}
	.placeholder-site .browser {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 14px;
		box-shadow: 0 24px 60px rgba(15,23,42,0.12);
		overflow: hidden;
	}
	.placeholder-site .browser-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		background: #f8fafc;
		border-bottom: 1px solid #e5e7eb;
	}
	.placeholder-site .browser-bar .dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #e5e7eb;
	}
	.placeholder-site .browser-bar .dot:nth-child(1) { background: #fca5a5; }
	.placeholder-site .browser-bar .dot:nth-child(2) { background: #fcd34d; }
	.placeholder-site .browser-bar .dot:nth-child(3) { background: #86efac; }
	.placeholder-site .browser-body {
		height: 340px;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
		position: relative;
	}
	.placeholder-site .browser-body::after {
		content: '';
		position: absolute;
		inset: 24px;
		border-radius: 8px;
		background: rgba(255,255,255,0.12);
		backdrop-filter: blur(8px);
	}
	.placeholder-site .features {
		max-width: 1080px;
		margin: 80px auto 0;
		padding: 0 48px 72px;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
	}
	.placeholder-site .feature {
		padding: 24px;
		border-radius: 12px;
		background: white;
		border: 1px solid #e5e7eb;
	}
	.placeholder-site .feature .icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: linear-gradient(135deg, #ede9fe, #fce7f3);
		margin-bottom: 14px;
	}
	.placeholder-site .feature h3 {
		font: 700 16px system-ui;
		margin-bottom: 6px;
		color: #0f172a;
	}
	.placeholder-site .feature p {
		font-size: 13px;
		color: #64748b;
	}

	.agent-wrap {
		position: absolute;
		cursor: grab;
		user-select: none;
		touch-action: none;
		overflow: hidden;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0,0,0,0.35);
		background: transparent;
	}
	.agent-wrap.dragging { cursor: grabbing; }
	.agent-wrap agent-3d {
		position: absolute;
		inset: 0;
		width: 100% !important;
		height: 100% !important;
		display: block;
	}
	.agent-wrap iframe.widget-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
		background: transparent;
	}
	.widget-badge {
		position: absolute;
		top: -28px;
		right: 0;
		background: #1e293b;
		color: #a7f3d0;
		font: 11px/1 ui-monospace, Menlo, monospace;
		padding: 4px 8px;
		border-radius: 4px;
		border: 1px solid #334155;
	}
	.resize-handle {
		position: absolute;
		width: 14px;
		height: 14px;
		background: white;
		border: 2px solid #3b82f6;
		border-radius: 3px;
		z-index: 2;
	}
	.resize-handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
	.resize-handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
	.resize-handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
	.resize-handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
	.size-readout {
		position: absolute;
		top: -28px;
		left: 0;
		background: #111827;
		color: #f9fafb;
		font: 11px/1 monospace;
		padding: 4px 6px;
		border-radius: 4px;
	}

	.anim-dock {
		position: absolute;
		left: 50%;
		bottom: 16px;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		padding: 6px;
		background: rgba(15, 18, 22, 0.92);
		border: 1px solid #1f2937;
		border-radius: 999px;
		backdrop-filter: blur(8px);
		max-width: calc(100% - 32px);
		overflow-x: auto;
		scrollbar-width: none;
		z-index: 5;
	}
	.anim-dock::-webkit-scrollbar { display: none; }
	.anim-dock[hidden] { display: none; }
	.anim-chip {
		flex: 0 0 auto;
		background: #111827;
		color: #e5e7eb;
		border: 1px solid #1f2937;
		border-radius: 999px;
		padding: 6px 12px;
		font: 500 12px system-ui;
		cursor: pointer;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.anim-chip:hover { background: #1e293b; border-color: #334155; }
	.anim-chip[aria-pressed="true"] { background: #3b82f6; border-color: #3b82f6; color: white; }
	.anim-chip .icon { font-size: 13px; }

	.snapline {
		position: absolute;
		background: #3b82f6;
		opacity: 0.6;
		pointer-events: none;
	}
	.snapline.v { width: 1px; top: 0; bottom: 0; }
	.snapline.h { height: 1px; left: 0; right: 0; }

	.panel {
		background: #0f1216;
		border-left: 1px solid #1f2937;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.panel-header {
		padding: 16px 20px;
		border-bottom: 1px solid #1f2937;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.panel-header h2 { font: 600 16px system-ui; }
	.panel-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
	.section-title { font: 600 11px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin: 16px 0 8px; }

	.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.mode-card {
		padding: 10px 12px;
		border-radius: 10px;
		background: #111827;
		border: 1px solid #1f2937;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.mode-card:hover { border-color: #3b82f6; }
	.mode-card[aria-pressed="true"] { border-color: #3b82f6; background: #1e293b; }
	.mode-card .ml { font-weight: 600; margin-bottom: 2px; }
	.mode-card .mh { font-size: 12px; color: #9ca3af; }

	.pos-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.pos-btn {
		aspect-ratio: 1.8;
		background: #111827;
		border: 1px solid #1f2937;
		color: #9ca3af;
		border-radius: 8px;
		font-size: 18px;
		cursor: pointer;
	}
	.pos-btn[aria-pressed="true"] { background: #3b82f6; color: white; border-color: #3b82f6; }

	.avatar-picker { margin: 4px 0 8px; }
	.avatar-picker-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		max-height: 180px;
		overflow-y: auto;
		padding-right: 4px;
	}
	.avatar-card {
		position: relative;
		aspect-ratio: 1;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		background-size: cover;
		background-position: center;
		border: 1px solid #1f2937;
		border-radius: 8px;
		cursor: pointer;
		overflow: hidden;
		transition: border-color 0.15s, transform 0.1s;
	}
	.avatar-card:hover { border-color: #3b82f6; transform: translateY(-1px); }
	.avatar-card[aria-pressed="true"] { border-color: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.3); }
	.avatar-card.pinned {
		background: linear-gradient(135deg, #1e3a8a 0%, #581c87 100%);
	}
	.avatar-card .tag {
		position: absolute;
		top: 4px;
		right: 4px;
		padding: 2px 6px;
		font: 600 9px system-ui;
		color: #c7d2fe;
		background: rgba(15,23,42,0.85);
		border: 1px solid rgba(199,210,254,0.3);
		border-radius: 4px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.avatar-card .name {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 4px 6px;
		font: 500 10px/1.2 system-ui;
		color: #f4f4f5;
		background: linear-gradient(transparent, rgba(0,0,0,0.85));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.avatar-card.skeleton { background: #111827; animation: skeleton-pulse 1.2s ease-in-out infinite; }
	@keyframes skeleton-pulse { 50% { opacity: 0.4; } }
	.avatar-picker-more {
		width: 100%;
		margin-top: 6px;
		background: transparent;
		border: 1px solid #1f2937;
		color: #9ca3af;
		border-radius: 6px;
		padding: 6px 8px;
		font: 500 12px system-ui;
		cursor: pointer;
	}
	.avatar-picker-more:hover { color: #f4f4f5; border-color: #334155; }
	.avatar-picker-empty {
		text-align: center;
		color: #6b7280;
		font: 12px system-ui;
		padding: 12px;
	}

	.field-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; align-items: center; margin: 6px 0; }
	.field-row label { color: #9ca3af; font-size: 12px; }
	.field-row input, .field-row select {
		background: #111827;
		color: #f4f4f5;
		border: 1px solid #1f2937;
		border-radius: 6px;
		padding: 6px 8px;
		font: 13px system-ui;
		width: 100%;
		box-sizing: border-box;
	}

	.snippet-box {
		background: #0a0d12;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 12px;
		font: 12px/1.5 ui-monospace, Menlo, monospace;
		white-space: pre-wrap;
		word-break: break-all;
		color: #a7f3d0;
		margin-top: 12px;
		max-height: 200px;
		overflow-y: auto;
		transition: max-height 0.2s ease;
	}
	.snippet-box.collapsed {
		max-height: 56px;
		overflow: hidden;
		position: relative;
	}
	.snippet-box.collapsed::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 24px;
		background: linear-gradient(transparent, #0a0d12);
		pointer-events: none;
	}
	.snippet-collapse {
		background: transparent;
		border: 0;
		color: #6b7280;
		font: 500 11px system-ui;
		cursor: pointer;
		padding: 6px 0 0;
		text-align: left;
	}
	.snippet-collapse:hover { color: #e5e7eb; }
	.actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
	.btn {
		flex: 1 1 auto;
		background: #3b82f6;
		color: white;
		border: 0;
		border-radius: 8px;
		padding: 10px 12px;
		font: 600 14px system-ui;
		cursor: pointer;
		min-width: 0;
	}
	.btn.secondary { background: transparent; border: 1px solid #1f2937; color: #e5e7eb; }
	.btn:hover { filter: brightness(1.1); }
	.btn[data-copied="true"] { background: #22c55e; }

	.toast {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translate(-50%, 24px);
		background: #0f172a;
		color: #f4f4f5;
		padding: 10px 18px;
		border-radius: 999px;
		font: 600 13px system-ui;
		box-shadow: 0 12px 32px rgba(0,0,0,0.45);
		border: 1px solid #1f2937;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s, transform 0.2s;
		z-index: 100;
	}
	.toast.visible {
		opacity: 1;
		transform: translate(-50%, 0);
	}
	.toast[data-kind="warn"] {
		background: #78350f;
		border-color: #b45309;
		color: #fef3c7;
	}

	.preview-url-row {
		display: flex;
		gap: 6px;
		padding: 10px 16px;
		background: #0f1216;
		border-bottom: 1px solid #1f2937;
	}
	.preview-url-row input {
		flex: 1;
		background: #111827;
		border: 1px solid #1f2937;
		color: #e5e7eb;
		padding: 6px 10px;
		border-radius: 6px;
	}
	.preview-url-row button { background: #3b82f6; color: white; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }

	.stage-col { display: flex; flex-direction: column; overflow: hidden; }
	.stage-wrap { flex: 1; position: relative; overflow: hidden; background: #1a1d21; }

	.device-bar {
		display: flex;
		gap: 4px;
		padding: 6px 16px;
		background: #0b0d10;
		border-bottom: 1px solid #1f2937;
		align-items: center;
	}
	.device-bar span { font: 11px system-ui; color: #6b7280; margin-right: 4px; }
	.device-btn {
		padding: 3px 10px;
		border-radius: 6px;
		border: 1px solid #1f2937;
		background: #111827;
		color: #9ca3af;
		cursor: pointer;
		font: 12px system-ui;
	}
	.device-btn[aria-pressed="true"] { background: #3b82f6; color: white; border-color: #3b82f6; }

	/* Preview mode — hide chrome, let the wrap render where it would on a real site */
	.editor-root[data-preview="true"] { grid-template-columns: 1fr 0; }
	.editor-root[data-preview="true"] .panel { display: none; }
	.editor-root[data-preview="true"] .preview-url-row,
	.editor-root[data-preview="true"] .device-bar { display: none; }
	.editor-root[data-preview="true"] .agent-wrap { cursor: default; }
	.editor-root[data-preview="true"] .agent-wrap .resize-handle,
	.editor-root[data-preview="true"] .agent-wrap .size-readout,
	.editor-root[data-preview="true"] .agent-wrap .widget-badge { display: none; }
	.exit-preview {
		position: fixed;
		top: 16px;
		left: 16px;
		z-index: 10;
		background: #111827;
		color: #f4f4f5;
		border: 1px solid #1f2937;
		border-radius: 999px;
		padding: 8px 14px;
		font: 600 13px system-ui;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(0,0,0,0.4);
		display: none;
	}
	.editor-root[data-preview="true"] .exit-preview { display: inline-flex; align-items: center; gap: 6px; }
	.exit-preview:hover { background: #1e293b; }
	.preview-toggle {
		background: #1e293b;
		color: #a7f3d0;
		border: 1px solid #334155;
		border-radius: 999px;
		padding: 4px 12px;
		font: 600 12px system-ui;
		cursor: pointer;
		margin-right: 8px;
	}
	.preview-toggle:hover { background: #334155; }
	.lock-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: #1e293b;
		color: #cbd5e1;
		border: 1px solid #334155;
		border-radius: 999px;
		padding: 4px 10px 4px 8px;
		font: 600 12px system-ui;
		cursor: pointer;
	}
	.lock-toggle:hover { background: #334155; }
	.lock-toggle[aria-pressed="true"] {
		background: #b45309;
		color: #fef3c7;
		border-color: #d97706;
	}
	.lock-toggle .lock-icon { font-size: 13px; line-height: 1; }

	/* Locked mode — disables drag/resize on the wrap and signals the state. */
	.editor-root[data-locked="true"] .agent-wrap { cursor: not-allowed; }
	.editor-root[data-locked="true"] .agent-wrap .resize-handle { display: none; }
	.editor-root[data-locked="true"] .agent-wrap .size-readout {
		background: #b45309;
		color: #fef3c7;
	}
	.editor-root[data-locked="true"] .agent-wrap .size-readout::before {
		content: '🔒 ';
	}

	/* Device viewport — wraps placeholder/iframe/agent-wrap so they scale
	   together when simulating tablet/mobile. In desktop mode fills the stage. */
	.device-viewport {
		position: absolute;
		inset: 0;
		transform-origin: top left;
		transition: transform 0.2s, width 0.2s, height 0.2s;
	}
	.device-viewport[data-device="tablet"],
	.device-viewport[data-device="mobile"] {
		inset: auto;
		background: white;
		box-shadow: 0 0 0 2px #374151, 0 12px 40px rgba(0,0,0,0.5);
		border-radius: 12px;
		overflow: hidden;
	}
	.device-viewport .placeholder-site,
	.device-viewport > iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

export function mountEmbedEditor(root, options = {}) {
	const defaults = {
		widgetId: options.widgetId || '',
		src: options.src || '',
		mode: options.mode || 'floating',
		position: options.position || 'bottom-right',
		offset: options.offset || '24px 24px',
		width: options.width || '320px',
		height: options.height || '420px',
		device: 'desktop',
		responsivePreset: 'desktop-first',
		voice: true,
		cameraControls: false,
		ar: false,
		background: '',
		...options,
	};

	const state = { ...defaults, widget: null };
	const host = document.createElement('div');
	const shadow = host.attachShadow({ mode: 'open' });
	root.appendChild(host);

	shadow.innerHTML = `
		<style>${STYLE}</style>
		<div class="editor-root">
			<div class="stage-col">
				<div class="preview-url-row">
					<input type="text" placeholder="Paste your site URL to preview in-place (optional)" id="url-input">
					<button id="url-load">Load site</button>
					<button id="url-clear">Reset</button>
				</div>
				<div class="device-bar" id="device-bar">
					<span>Preview:</span>
				</div>
				<div class="stage-wrap" id="stage">
					<div class="device-viewport" id="device-viewport">
					<div class="placeholder-site" id="placeholder">
						<nav class="nav">
							<div class="brand"><div class="logo"></div>Acme</div>
							<div class="nav-links"><span>Product</span><span>Pricing</span><span>Customers</span><span>Docs</span></div>
							<div class="nav-cta">Sign in</div>
						</nav>
						<div class="hero-wrap">
							<div class="pill">New · Conversational agents</div>
							<h1>Talk to your product, <span class="accent">not just click it.</span></h1>
							<p class="lede">Drop a 3D agent on any page. Visitors ask questions, get demos, and check out — without leaving the screen.</p>
							<div class="cta-row">
								<div class="btn-primary">Start free</div>
								<div class="btn-ghost">See it live</div>
							</div>
						</div>
						<div class="screenshot">
							<div class="browser">
								<div class="browser-bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
								<div class="browser-body"></div>
							</div>
						</div>
						<div class="features">
							<div class="feature"><div class="icon"></div><h3>Embed anywhere</h3><p>One script tag, works in every CMS and framework.</p></div>
							<div class="feature"><div class="icon"></div><h3>Voice + text</h3><p>Real-time speech, streaming responses, multi-language.</p></div>
							<div class="feature"><div class="icon"></div><h3>Owned by you</h3><p>Your brand, your data, your wallet — no platform tax.</p></div>
						</div>
					</div>
					<iframe id="preview-frame" hidden></iframe>
					<div class="agent-wrap" id="agent-wrap">
						<div class="size-readout" id="size-readout"></div>
						<div class="widget-badge" id="widget-badge" hidden></div>
						<iframe class="widget-frame" id="widget-frame" hidden
							allow="autoplay; clipboard-write; microphone; camera; xr-spatial-tracking"></iframe>
						<agent-3d eager kiosk id="preview-agent"></agent-3d>
						<div class="resize-handle nw" data-h="nw"></div>
						<div class="resize-handle ne" data-h="ne"></div>
						<div class="resize-handle sw" data-h="sw"></div>
						<div class="resize-handle se" data-h="se"></div>
					</div>
					</div>
					<div class="anim-dock" id="anim-dock" hidden></div>
				</div>
			</div>
			<button class="exit-preview" id="exit-preview" type="button">← Back to editor</button>
			<aside class="panel">
				<div class="panel-header">
					<h2>Embed editor</h2>
					<div style="display:flex;align-items:center;gap:8px">
						<button class="lock-toggle" id="lock-toggle" type="button" title="Lock the box and freeze avatar motion (L)" aria-pressed="false">
							<span class="lock-icon" aria-hidden="true">🔓</span>
							<span class="lock-label">Lock</span>
						</button>
						<button class="preview-toggle" id="preview-toggle" type="button">Preview</button>
						<span style="font-size:11px;color:#6b7280">beta</span>
					</div>
				</div>
				<div class="panel-body">
					<div class="section-title">Source</div>
					<div class="field-row">
						<label>src</label>
						<input id="src-input" placeholder="agent://base/42 or ipfs://...">
					</div>
					<div class="avatar-picker" id="avatar-picker">
						<div class="avatar-picker-grid" id="avatar-grid"></div>
						<button class="avatar-picker-more" id="avatar-more" type="button" hidden>Load more</button>
						<div class="avatar-picker-empty" id="avatar-empty" hidden>No public avatars found.</div>
					</div>

					<div class="section-title">Mode</div>
					<div class="mode-grid" id="mode-grid"></div>

					<div class="section-title" id="pos-title">Position</div>
					<div class="pos-grid" id="pos-grid"></div>

					<div class="section-title">Size</div>
					<div class="field-row">
						<label>Width</label>
						<input id="w-input" value="${state.width}">
					</div>
					<div class="field-row">
						<label>Height</label>
						<input id="h-input" value="${state.height}">
					</div>

					<div class="section-title">Responsive</div>
					<div class="field-row">
						<label>Preset</label>
						<select id="responsive-select">
							<option value="fixed">Fixed (exact px)</option>
							<option value="mobile-first">Mobile-first (clamp, grows)</option>
							<option value="desktop-first">Desktop-first (clamp, shrinks)</option>
						</select>
					</div>

					<div class="section-title">Options</div>
					<div class="field-row">
						<label>Voice</label>
						<select id="voice-select">
							<option value="">on (default)</option>
							<option value="off">off</option>
						</select>
					</div>
					<div class="field-row">
						<label>Camera</label>
						<select id="camera-select">
							<option value="off">controls off</option>
							<option value="on">controls on</option>
						</select>
					</div>
					<div class="field-row">
						<label>AR</label>
						<select id="ar-select">
							<option value="off">off</option>
							<option value="on">on</option>
						</select>
					</div>
					<div class="field-row">
						<label>Background</label>
						<select id="bg-select">
							<option value="">Default</option>
							<option value="transparent">Transparent</option>
							<option value="dark">Dark</option>
							<option value="light">Light</option>
						</select>
					</div>

					<div class="section-title">Embed snippet</div>
					<div class="snippet-box collapsed" id="snippet"></div>
					<button class="snippet-collapse" id="snippet-collapse" type="button">Show full snippet ▾</button>
					<div class="actions">
						<button class="btn" id="copy-btn" type="button">Copy snippet</button>
						<button class="btn secondary" id="open-btn" type="button" title="Render the snippet against a demo page in a new tab">Open in new tab</button>
						<button class="btn secondary" id="reset-btn" type="button">Reset</button>
					</div>
					<div class="toast" id="toast" role="status" aria-live="polite"></div>
				</div>
			</aside>
		</div>
	`;

	const $ = (sel) => shadow.querySelector(sel);
	const $$ = (sel) => shadow.querySelectorAll(sel);

	// Device preview buttons
	const deviceBar = $('#device-bar');
	for (const d of DEVICES) {
		const btn = document.createElement('button');
		btn.className = 'device-btn';
		btn.dataset.device = d.id;
		btn.setAttribute('aria-pressed', String(d.id === state.device));
		btn.textContent = d.label;
		btn.addEventListener('click', () => {
			state.device = d.id;
			syncDevice();
			writeSnippet();
		});
		deviceBar.appendChild(btn);
	}

	const stage = $('#stage');
	const agentWrap = $('#agent-wrap');
	const agentEl = $('#preview-agent');
	const widgetFrame = $('#widget-frame');
	const widgetBadge = $('#widget-badge');
	const readout = $('#size-readout');
	const snippetEl = $('#snippet');
	const srcInput = $('#src-input');
	const wInput = $('#w-input');
	const hInput = $('#h-input');
	const copyBtn = $('#copy-btn');

	srcInput.value = state.src;
	agentEl.setAttribute('src', state.src || DEFAULT_PREVIEW_SRC);

	const animDock = $('#anim-dock');
	function renderAnimDock() {
		if (state.widgetId) { animDock.hidden = true; return; }
		const clips = (typeof agentEl._listAvailableClips === 'function')
			? agentEl._listAvailableClips()
			: [];
		if (!clips.length) { animDock.hidden = true; return; }
		animDock.replaceChildren();
		for (const clip of clips) {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'anim-chip';
			chip.dataset.name = clip.name;
			chip.setAttribute('aria-pressed', String(state.activeClip === clip.name));
			chip.innerHTML = `<span class="icon">${clip.icon || '✨'}</span><span>${clip.label || clip.name}</span>`;
			chip.addEventListener('click', () => {
				state.activeClip = clip.name;
				agentEl.play?.(clip.name, { loop: clip.loop !== false, fade_ms: 250 });
				for (const c of animDock.querySelectorAll('.anim-chip'))
					c.setAttribute('aria-pressed', String(c.dataset.name === clip.name));
			});
			animDock.appendChild(chip);
		}
		animDock.hidden = false;
	}
	agentEl.addEventListener('agent:ready', renderAnimDock);

	// ── Public avatar picker ──
	const avatarGrid = $('#avatar-grid');
	const avatarMore = $('#avatar-more');
	const avatarEmpty = $('#avatar-empty');
	let avatarCursor = null;
	let avatarLoading = false;

	function renderSkeletons(n) {
		for (let i = 0; i < n; i++) {
			const sk = document.createElement('div');
			sk.className = 'avatar-card skeleton';
			avatarGrid.appendChild(sk);
		}
	}
	function clearSkeletons() {
		for (const el of avatarGrid.querySelectorAll('.skeleton')) el.remove();
	}
	function pickAvatar(card, modelUrl, name) {
		state.src = modelUrl;
		srcInput.value = modelUrl;
		agentEl.setAttribute('src', modelUrl);
		for (const c of avatarGrid.querySelectorAll('.avatar-card'))
			c.setAttribute('aria-pressed', String(c === card));
		writeSnippet();
	}
	function renderAvatarCards(items, { pinned = false } = {}) {
		for (const a of items) {
			if (!a.model_url) continue;
			const card = document.createElement('div');
			card.className = 'avatar-card' + (pinned ? ' pinned' : '');
			card.setAttribute('role', 'button');
			card.setAttribute('tabindex', '0');
			card.dataset.id = a.id;
			card.title = a.name || a.slug || a.id;
			if (a.thumbnail_url) {
				card.style.backgroundImage = `url('${a.thumbnail_url.replace(/'/g, "%27")}')`;
			}
			if (pinned) {
				const tag = document.createElement('div');
				tag.className = 'tag';
				tag.textContent = 'Demo';
				card.appendChild(tag);
			}
			const name = document.createElement('div');
			name.className = 'name';
			name.textContent = a.name || a.slug || 'Avatar';
			card.appendChild(name);
			card.setAttribute('aria-pressed', String(state.src && state.src === a.model_url));
			const activate = () => pickAvatar(card, a.model_url, a.name);
			card.addEventListener('click', activate);
			card.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
			});
			avatarGrid.appendChild(card);
		}
	}
	async function loadAvatarPage() {
		if (avatarLoading) return;
		avatarLoading = true;
		avatarMore.hidden = true;
		const initial = !avatarGrid.children.length;
		if (initial) {
			// Pin the curated demo set first so the gallery opens to something
			// recognisable even before the network call returns.
			renderAvatarCards(DEMO_AVATARS, { pinned: true });
			renderSkeletons(6);
		}
		try {
			const url = new URL(`${location.origin}/api/avatars/public`);
			url.searchParams.set('limit', '24');
			if (avatarCursor) url.searchParams.set('cursor', avatarCursor);
			const res = await fetch(url.toString(), { credentials: 'omit' });
			if (!res.ok) throw new Error(`avatars/public ${res.status}`);
			const data = await res.json();
			clearSkeletons();
			renderAvatarCards(data.avatars || []);
			avatarCursor = data.next_cursor || null;
			avatarMore.hidden = !avatarCursor;
		} catch (err) {
			clearSkeletons();
			if (initial && !DEMO_AVATARS.length) {
				avatarEmpty.textContent = `Couldn't load avatars: ${err.message}`;
				avatarEmpty.hidden = false;
			}
		} finally {
			avatarLoading = false;
		}
	}
	avatarMore.addEventListener('click', loadAvatarPage);
	loadAvatarPage();

	// If a widget id was passed, swap the bare <agent-3d> preview for an
	// iframe loading the live widget renderer (/app#widget=<id>&kiosk=true).
	if (state.widgetId) loadWidget(state.widgetId);

	async function loadWidget(id) {
		const origin = location.origin;
		// Show the live widget immediately — don't wait on the metadata fetch.
		widgetFrame.src = `${origin}/app#widget=${encodeURIComponent(id)}&kiosk=true`;
		widgetFrame.hidden = false;
		agentEl.style.display = 'none';
		widgetBadge.hidden = false;
		widgetBadge.textContent = id;

		try {
			const res = await fetch(`${origin}/api/widgets/${encodeURIComponent(id)}`, {
				credentials: 'include',
			});
			if (!res.ok) {
				widgetBadge.textContent = `${id} · not found`;
				widgetBadge.style.color = '#fca5a5';
				return;
			}
			const { widget } = await res.json();
			state.widget = widget;
			widgetBadge.textContent = `${widget.name || id} · ${widget.type}`;

			// Type-aware preferred sizes (mirrors public/embed.js defaults).
			const TYPE_SIZES = {
				turntable: [600, 600],
				'animation-gallery': [720, 720],
				'talking-agent': [420, 600],
				passport: [480, 560],
				'hotspot-tour': [800, 600],
			};
			const [w, h] = TYPE_SIZES[widget.type] || [600, 600];
			state.width = `${w}px`;
			state.height = `${h}px`;
			wInput.value = state.width;
			hInput.value = state.height;

			// Pre-fill src with the avatar model so a fallback agent-3d snippet
			// works if the user later toggles off the widget id.
			if (widget.avatar?.model_url) {
				state.src = widget.avatar.model_url;
				srcInput.value = state.src;
			}

			sync();
		} catch (err) {
			widgetBadge.textContent = `${id} · ${err.message}`;
			widgetBadge.style.color = '#fca5a5';
		}
	}

	// Mode cards
	const modeGrid = $('#mode-grid');
	for (const m of MODES) {
		const card = document.createElement('div');
		card.className = 'mode-card';
		card.dataset.mode = m.id;
		card.setAttribute('aria-pressed', String(m.id === state.mode));
		card.tabIndex = 0;
		card.innerHTML = `<div class="ml">${m.label}</div><div class="mh">${m.hint}</div>`;
		card.addEventListener('click', () => {
			state.mode = m.id;
			sync();
		});
		modeGrid.appendChild(card);
	}

	// Position buttons
	const posGrid = $('#pos-grid');
	for (const p of POSITIONS) {
		const btn = document.createElement('button');
		btn.className = 'pos-btn';
		btn.dataset.pos = p.id;
		btn.setAttribute('aria-pressed', String(p.id === state.position));
		btn.textContent = p.label;
		btn.addEventListener('click', () => {
			state.position = p.id;
			sync();
		});
		posGrid.appendChild(btn);
	}

	// Input bindings
	srcInput.addEventListener('change', () => {
		state.src = srcInput.value;
		sync();
	});
	wInput.addEventListener('change', () => {
		state.width = wInput.value;
		sync();
	});
	hInput.addEventListener('change', () => {
		state.height = hInput.value;
		sync();
	});
	$('#voice-select').addEventListener('change', (e) => {
		state.voice = e.target.value === 'off' ? false : true;
		applyAgentAttrs();
		sync();
	});
	$('#camera-select').addEventListener('change', (e) => {
		state.cameraControls = e.target.value === 'on';
		applyAgentAttrs();
		sync();
	});
	$('#ar-select').addEventListener('change', (e) => {
		state.ar = e.target.value === 'on';
		applyAgentAttrs();
		sync();
	});
	$('#bg-select').addEventListener('change', (e) => {
		state.background = e.target.value;
		applyAgentAttrs();
		sync();
	});
	$('#responsive-select').addEventListener('change', (e) => {
		state.responsivePreset = e.target.value;
		writeSnippet();
	});

	// URL preview
	const urlInput = $('#url-input');
	$('#url-load').addEventListener('click', () => {
		const u = urlInput.value.trim();
		if (!u) return;
		const iframe = $('#preview-frame');
		iframe.src = u;
		iframe.hidden = false;
		$('#placeholder').hidden = true;
	});
	$('#url-clear').addEventListener('click', () => {
		$('#preview-frame').src = 'about:blank';
		$('#preview-frame').hidden = true;
		$('#placeholder').hidden = false;
	});

	// Drag — also handles click-to-freeze: a pointerdown→pointerup with less
	// than TAP_THRESHOLD pixels of movement is treated as a tap on the avatar
	// and toggles state.avatarFrozen instead of dragging.
	const TAP_THRESHOLD = 5;
	let dragState = null;
	agentWrap.addEventListener('pointerdown', (e) => {
		if (e.target.closest('.resize-handle')) return;
		// Don't intercept clicks on overlay chrome that sits over the wrap.
		if (e.target.closest('.size-readout, .widget-badge')) return;
		const dragAllowed = !state.previewMode && !state.locked;
		const agentRect = agentWrap.getBoundingClientRect();
		dragState = {
			kind: dragAllowed ? 'move' : 'tap-only',
			downX: e.clientX,
			downY: e.clientY,
			moved: false,
			offsetX: e.clientX - agentRect.left,
			offsetY: e.clientY - agentRect.top,
			stageRect: stage.getBoundingClientRect(),
		};
		agentWrap.setPointerCapture(e.pointerId);
	});

	// Resize handles
	$$('.resize-handle').forEach((h) => {
		h.addEventListener('pointerdown', (e) => {
			if (state.locked) return;
			e.stopPropagation();
			const rect = stage.getBoundingClientRect();
			const agentRect = agentWrap.getBoundingClientRect();
			dragState = {
				kind: 'resize',
				handle: h.dataset.h,
				startX: e.clientX,
				startY: e.clientY,
				startW: agentRect.width,
				startH: agentRect.height,
				startLeft: agentRect.left - rect.left,
				startTop: agentRect.top - rect.top,
				stageRect: rect,
			};
			h.setPointerCapture(e.pointerId);
		});
	});

	stage.addEventListener('pointermove', (e) => {
		if (!dragState) return;
		const rect = dragState.stageRect;
		if (dragState.kind === 'move') {
			const x = e.clientX - rect.left - dragState.offsetX;
			const y = e.clientY - rect.top - dragState.offsetY;
			const snapped = snapToCorner(
				x,
				y,
				agentWrap.offsetWidth,
				agentWrap.offsetHeight,
				rect.width,
				rect.height,
			);
			agentWrap.style.left = snapped.x + 'px';
			agentWrap.style.top = snapped.y + 'px';
			if (snapped.corner) {
				state.position = snapped.corner;
				state.offset = `${snapped.offsetV} ${snapped.offsetH}`;
				syncPositionButtons();
				writeSnippet();
			}
		} else if (dragState.kind === 'resize') {
			const dx = e.clientX - dragState.startX;
			const dy = e.clientY - dragState.startY;
			let w = dragState.startW,
				h = dragState.startH;
			let left = dragState.startLeft,
				top = dragState.startTop;
			if (dragState.handle.includes('e')) w = dragState.startW + dx;
			if (dragState.handle.includes('s')) h = dragState.startH + dy;
			if (dragState.handle.includes('w')) {
				w = dragState.startW - dx;
				left = dragState.startLeft + dx;
			}
			if (dragState.handle.includes('n')) {
				h = dragState.startH - dy;
				top = dragState.startTop + dy;
			}
			w = Math.max(160, w);
			h = Math.max(200, h);
			agentWrap.style.width = w + 'px';
			agentWrap.style.height = h + 'px';
			agentWrap.style.left = left + 'px';
			agentWrap.style.top = top + 'px';
			state.width = Math.round(w) + 'px';
			state.height = Math.round(h) + 'px';
			wInput.value = state.width;
			hInput.value = state.height;
			readout.textContent = `${state.width} × ${state.height}`;
			writeSnippet();
		}
	});

	stage.addEventListener('pointerup', () => {
		if (dragState) {
			agentWrap.classList.remove('dragging');
			dragState = null;
		}
	});

	const toastEl = $('#toast');
	let toastTimer = null;
	function showToast(message, { kind = 'success' } = {}) {
		toastEl.textContent = message;
		toastEl.dataset.kind = kind;
		toastEl.classList.add('visible');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2200);
	}

	copyBtn.addEventListener('click', async () => {
		const snippet = buildSnippet();
		try {
			await navigator.clipboard.writeText(snippet);
			showToast('Snippet copied to clipboard');
		} catch (err) {
			// Permissions may block clipboard in some embedded contexts. Fall back
			// to a manual selection so the user can still grab the snippet.
			const range = document.createRange();
			range.selectNodeContents(snippetEl);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
			showToast('Clipboard blocked — snippet selected, press ⌘C', { kind: 'warn' });
		}
		copyBtn.textContent = 'Copied ✓';
		copyBtn.dataset.copied = 'true';
		setTimeout(() => {
			copyBtn.textContent = 'Copy snippet';
			copyBtn.dataset.copied = 'false';
		}, 1500);
	});

	const snippetCollapse = $('#snippet-collapse');
	snippetCollapse.addEventListener('click', () => {
		const collapsed = snippetEl.classList.toggle('collapsed');
		snippetCollapse.textContent = collapsed ? 'Show full snippet ▾' : 'Collapse snippet ▴';
	});

	$('#open-btn').addEventListener('click', () => {
		const html = buildStandalonePage();
		const blob = new Blob([html], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const win = window.open(url, '_blank', 'noopener');
		if (!win) {
			showToast('Popup blocked — allow popups to open the preview', { kind: 'warn' });
			URL.revokeObjectURL(url);
			return;
		}
		// Revoke the blob URL after the new tab has had time to load it. 60s is
		// generous — the document fully parses long before this. Without revoke,
		// the blob lingers for the lifetime of the editor tab.
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	});

	$('#reset-btn').addEventListener('click', () => {
		Object.assign(state, defaults);
		srcInput.value = state.src;
		wInput.value = state.width;
		hInput.value = state.height;
		$('#responsive-select').value = state.responsivePreset;
		$('#voice-select').value = state.voice === false ? 'off' : '';
		$('#camera-select').value = state.cameraControls ? 'on' : 'off';
		$('#ar-select').value = state.ar ? 'on' : 'off';
		$('#bg-select').value = state.background || '';
		sync();
	});

	const editorRoot = shadow.querySelector('.editor-root');
	const previewToggle = $('#preview-toggle');
	const exitPreview = $('#exit-preview');
	function setPreviewMode(on) {
		state.previewMode = !!on;
		editorRoot.setAttribute('data-preview', state.previewMode ? 'true' : 'false');
		previewToggle.textContent = state.previewMode ? 'Editing' : 'Preview';
		applyToPreview();
	}
	previewToggle.addEventListener('click', () => setPreviewMode(!state.previewMode));
	exitPreview.addEventListener('click', () => setPreviewMode(false));
	previewToggle.title = 'Toggle preview (P)';
	exitPreview.title = 'Exit preview (Esc)';

	// ── Lock mode ──
	// Freezes the wrap (drag + resize disabled, handles hidden via CSS) and the
	// avatar itself: the Three.js animation mixer's timeScale is set to 0 so
	// the idle loop stops mid-frame, and OrbitControls is disabled so the
	// camera can't be rotated/panned/zoomed. Toggling off restores both.
	const lockToggle = $('#lock-toggle');
	// state.avatarFrozen — true when the avatar's mixer + camera controls are
	// paused (set by Lock button OR by click-on-avatar). state.locked is the
	// wider Lock-button state that also freezes the wrap.
	function applyAvatarLock() {
		const viewer = agentEl?._viewer;
		if (!viewer) return;
		if (viewer.mixer) viewer.mixer.timeScale = state.avatarFrozen ? 0 : 1;
		if (viewer.controls) viewer.controls.enabled = !state.avatarFrozen;
		editorRoot.setAttribute('data-avatar-frozen', state.avatarFrozen ? 'true' : 'false');
	}
	function setAvatarFrozen(on, { silent = false } = {}) {
		state.avatarFrozen = !!on;
		applyAvatarLock();
		if (!silent) {
			showToast(state.avatarFrozen ? 'Avatar frozen — click again to play' : 'Avatar playing', {
				kind: state.avatarFrozen ? 'warn' : 'success',
			});
		}
	}
	function setLocked(on) {
		state.locked = !!on;
		editorRoot.setAttribute('data-locked', state.locked ? 'true' : 'false');
		lockToggle.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
		lockToggle.querySelector('.lock-icon').textContent = state.locked ? '🔒' : '🔓';
		lockToggle.querySelector('.lock-label').textContent = state.locked ? 'Locked' : 'Lock';
		// Lock button drives both the wrap and the avatar freeze.
		setAvatarFrozen(state.locked, { silent: true });
		showToast(state.locked ? 'Locked — drag, resize, and avatar motion frozen' : 'Unlocked', {
			kind: state.locked ? 'warn' : 'success',
		});
	}
	lockToggle.addEventListener('click', () => setLocked(!state.locked));
	// Re-apply on each agent boot so freezing persists across avatar swaps —
	// _viewer.mixer is rebuilt during setContent() so the timeScale would
	// otherwise reset to 1.
	agentEl.addEventListener('agent:ready', applyAvatarLock);

	// Keyboard shortcuts — Esc exits preview, P toggles. Bound on document so
	// they fire even when focus is on the stage. Suppressed while typing in any
	// text field (the editor's inputs live in the shadow root; check both light
	// DOM target and composedPath() for an editable element).
	function isTextTarget(e) {
		const path = e.composedPath?.() || [];
		for (const node of path) {
			if (!node || node.nodeType !== 1) continue;
			const tag = node.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
			if (node.isContentEditable) return true;
		}
		return false;
	}
	const onKey = (e) => {
		if (e.key === 'Escape' && state.previewMode) {
			e.preventDefault();
			setPreviewMode(false);
			return;
		}
		if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
			if (isTextTarget(e)) return;
			e.preventDefault();
			setPreviewMode(!state.previewMode);
			return;
		}
		if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) {
			if (isTextTarget(e)) return;
			e.preventDefault();
			setLocked(!state.locked);
		}
	};
	document.addEventListener('keydown', onKey);

	// Show appropriate resize handles based on position
	function syncPositionButtons() {
		for (const btn of $$('.pos-btn'))
			btn.setAttribute('aria-pressed', String(btn.dataset.pos === state.position));
	}
	function syncModeCards() {
		for (const card of $$('.mode-card'))
			card.setAttribute('aria-pressed', String(card.dataset.mode === state.mode));
	}

	// Mirror toggleable agent attrs (voice/camera/AR/background) onto the live
	// preview element so flipping the panel selects has an immediate visual effect.
	// Snippet attrs are emitted separately in buildSnippet() — these only drive the
	// in-editor preview agent. Skipped in widget-iframe mode (the iframe owns its
	// own agent instance and reads its config from the widget record).
	function applyAgentAttrs() {
		if (state.widgetId) return;
		if (state.voice === false) agentEl.setAttribute('voice', 'off');
		else agentEl.removeAttribute('voice');
		if (state.cameraControls) agentEl.setAttribute('camera-controls', '');
		else agentEl.removeAttribute('camera-controls');
		if (state.ar) agentEl.setAttribute('ar', '');
		else agentEl.removeAttribute('ar');
		if (state.background) agentEl.setAttribute('background', state.background);
		else agentEl.removeAttribute('background');
	}

	function applyToPreview() {
		// Size
		agentWrap.style.width = state.width;
		agentWrap.style.height = state.height;
		readout.textContent = `${state.width} × ${state.height}`;

		// Position — place the wrap inside the stage per mode + position
		agentWrap.style.left =
			agentWrap.style.right =
			agentWrap.style.top =
			agentWrap.style.bottom =
				'';
		if (state.mode === 'floating') {
			const [vOff, hOff] = (state.offset || '24px 24px').split(/\s+/);
			if (state.position.includes('top')) agentWrap.style.top = vOff;
			else agentWrap.style.bottom = vOff;
			if (state.position.includes('left')) agentWrap.style.left = hOff;
			else if (state.position.includes('right')) agentWrap.style.right = hOff;
			else if (state.position.includes('center')) {
				agentWrap.style.left = '50%';
				agentWrap.style.transform = 'translateX(-50%)';
			}
			$('#pos-title').style.display = '';
			$('#pos-grid').style.display = '';
		} else if (state.mode === 'fullscreen') {
			agentWrap.style.inset = '0';
			agentWrap.style.width = '100%';
			agentWrap.style.height = '100%';
			$('#pos-title').style.display = 'none';
			$('#pos-grid').style.display = 'none';
		} else {
			// inline / section: center on stage
			agentWrap.style.left = `calc(50% - ${parseInt(state.width) / 2}px)`;
			agentWrap.style.top = `calc(50% - ${parseInt(state.height) / 2}px)`;
			$('#pos-title').style.display = 'none';
			$('#pos-grid').style.display = 'none';
		}

		// Agent attrs — skip when a widget is driving the preview iframe so the
		// hidden <agent-3d> doesn't fetch a GLB we'll never show. Fall back to a
		// default avatar when the user hasn't entered a src, so the preview is
		// never an empty box.
		if (!state.widgetId) {
			agentEl.setAttribute('src', state.src || DEFAULT_PREVIEW_SRC);
		}
	}

	function buildSnippet() {
		// Widget snippet — when a saved widget id is loaded, prefer the
		// canonical script-tag embed (matches Studio's "share" modal).
		if (state.widgetId) {
			const origin = location.origin;
			const wPx = parsePx(state.width);
			const hPx = parsePx(state.height);
			const dataAttrs = [
				`data-widget="${escapeAttr(state.widgetId)}"`,
				state.widget?.type ? `data-type="${escapeAttr(state.widget.type)}"` : '',
				wPx ? `data-width="${wPx}"` : '',
				hPx ? `data-height="${hPx}"` : '',
			]
				.filter(Boolean)
				.join(' ');
			return `<script async src="${origin}/embed.js" ${dataAttrs}></` + 'script>';
		}

		const attrs = [];
		if (state.src) attrs.push(`src="${escapeAttr(state.src)}"`);
		if (state.mode && state.mode !== 'inline') attrs.push(`mode="${state.mode}"`);
		if (state.mode === 'floating') {
			if (state.position !== 'bottom-right') attrs.push(`position="${state.position}"`);
			if (state.offset && state.offset !== '24px 24px')
				attrs.push(`offset="${state.offset}"`);
		}

		const wPx = parsePx(state.width);
		const hPx = parsePx(state.height);
		const preset = state.responsivePreset;

		if (preset !== 'fixed' && wPx && hPx) {
			// Emit clamp() CSS custom properties on the style attribute
			const wMin = Math.round(Math.max(160, wPx * 0.65));
			const hMin = Math.round(Math.max(200, hPx * 0.65));
			const wVw = Math.round((wPx / 1440) * 100);
			const hVh = Math.round((hPx / 900) * 100);
			const wClamp = `clamp(${wMin}px, ${wVw}vw, ${wPx}px)`;
			const hClamp = `clamp(${hMin}px, ${hVh}vh, ${hPx}px)`;
			attrs.push(`style="--agent-width: ${wClamp}; --agent-height: ${hClamp};"`);
			attrs.push(`responsive`);
		} else {
			if (state.width) attrs.push(`width="${state.width}"`);
			if (state.height) attrs.push(`height="${state.height}"`);
			attrs.push(`responsive="false"`);
		}

		if (state.voice === false) attrs.push(`voice="off"`);
		if (state.cameraControls) attrs.push(`camera-controls`);
		if (state.ar) attrs.push(`ar`);
		if (state.background) attrs.push(`background="${escapeAttr(state.background)}"`);
		// Face the camera by default — centers the avatar in the frame instead of
		// the slight 3/4 offset that exists to make room for the chat panel in
		// non-kiosk embeds. Users who want the offset can remove this attribute.
		attrs.push(`face-camera`);

		const script = `<script type="module" async src="${AGENT_3D_HOST}/agent-3d/${AGENT_3D_VERSION}/agent-3d.js"></` + 'script>';
		const element = `<agent-3d ${attrs.join(' ')}></agent-3d>`;
		let snippet = `${script}\n${element}`;

		if (preset !== 'fixed') {
			snippet = `<!-- generated responsive styles -->\n${snippet}`;
		}
		return snippet;
	}

	function writeSnippet() {
		snippetEl.textContent = buildSnippet();
	}

	// Build a standalone HTML page that renders the current snippet against a
	// minimal landing-page mock — opened in a new tab by "Open in new tab" so
	// demos can show the embed working in isolation. The script tag URL is
	// swapped to the local dev module when running on localhost so the new
	// tab actually loads (the production CDN path is not routed by Vite).
	function buildStandalonePage() {
		const snippet = buildSnippet();
		const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(location.hostname);
		const localScript = `<script type="module" src="${location.origin}/src/element.js"></` + 'script>';
		// Rewrite ALL relative URLs (src="/...", any "/...glb", etc.) inside the
		// snippet to absolute so they resolve against the live origin instead
		// of the blob: document we're about to open the page from. Blob URLs
		// have no base, so a bare "/avatars/cz.glb" would otherwise hit the
		// Failed-to-parse-URL errors the user saw in the console.
		let wireSnippet = isLocal && !state.widgetId
			? snippet.replace(
					/<script[^>]*src="[^"]*agent-3d\/[^"]+\/agent-3d\.js"[^>]*><\/script>/,
					localScript,
				)
			: snippet;
		// Rewrite any remaining relative src="/foo" → src="${origin}/foo".
		wireSnippet = wireSnippet.replace(
			/(\s)(src|href)="\/([^"]*)"/g,
			`$1$2="${location.origin}/$3"`,
		);
		const title = `Embed preview — ${state.src || state.widgetId || 'agent'}`;
		return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- Anchor relative URLs (fetches inside agent-3d, e.g. /three.svg, /avatars/*.glb)
     against the live origin. Required because this page is served from a blob:
     URL which has no base for resolving "/..." URLs. -->
<base href="${location.origin}/">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
	html, body { margin: 0; padding: 0; min-height: 100vh; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
	.nav { display: flex; align-items: center; justify-content: space-between; padding: 18px 48px; border-bottom: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 1; }
	.brand { display: flex; align-items: center; gap: 10px; font: 700 17px/1 system-ui; }
	.logo { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 2px 8px rgba(99,102,241,0.4); }
	.hero { max-width: 960px; margin: 0 auto; padding: 80px 48px 48px; text-align: center; }
	.pill { display: inline-block; padding: 6px 14px; border-radius: 999px; background: #ede9fe; color: #6d28d9; font: 600 12px system-ui; margin-bottom: 22px; }
	h1 { font: 800 52px/1.1 system-ui; letter-spacing: -0.02em; margin: 0 0 18px; }
	h1 .accent { background: linear-gradient(90deg, #6366f1, #ec4899); -webkit-background-clip: text; background-clip: text; color: transparent; }
	.lede { font-size: 18px; color: #475569; max-width: 640px; margin: 0 auto 28px; }
	.cta { display: flex; gap: 12px; justify-content: center; }
	.btn-primary { background: #0f172a; color: white; padding: 12px 22px; border-radius: 10px; font: 600 14px system-ui; }
	.btn-ghost { background: white; color: #0f172a; padding: 12px 22px; border-radius: 10px; font: 600 14px system-ui; border: 1px solid #e5e7eb; }
	footer { padding: 48px; text-align: center; color: #94a3b8; font-size: 13px; }
	footer code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #334155; font: 12px ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
	<nav class="nav">
		<div class="brand"><div class="logo"></div>Acme</div>
		<div class="btn-primary" style="padding: 8px 16px; font-size: 13px;">Sign in</div>
	</nav>
	<section class="hero">
		<div class="pill">Preview · live snippet</div>
		<h1>Your <span class="accent">agent embed</span><br>on a real page.</h1>
		<p class="lede">This page renders the exact snippet from the editor. Resize, scroll, and click around to see how it behaves in production.</p>
		<div class="cta">
			<div class="btn-primary">Start free</div>
			<div class="btn-ghost">See it live</div>
		</div>
	</section>
	<footer>
		Generated by the three.ws embed editor — close this tab to return.
	</footer>

	<!-- ── Embed snippet ── -->
	${wireSnippet}
</body>
</html>`;
	}

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	const deviceViewport = $('#device-viewport');
	function syncDevice() {
		const device = DEVICES.find((d) => d.id === state.device) || DEVICES[0];
		for (const btn of $$('.device-btn')) {
			btn.setAttribute('aria-pressed', String(btn.dataset.device === state.device));
		}

		// Reset placeholder/iframe inline styles — earlier versions of this code
		// scaled them individually; the viewport now owns the transform.
		const placeholder = $('#placeholder');
		if (placeholder) placeholder.style.cssText = '';
		const iframe = $('#preview-frame');
		if (iframe) iframe.style.cssText = '';

		if (state.device === 'desktop') {
			deviceViewport.style.cssText = '';
			deviceViewport.dataset.device = 'desktop';
			stage.removeAttribute('data-device');
			return;
		}

		// Scale the device viewport (which contains placeholder, iframe, AND the
		// agent wrap) so everything moves together. The wrap stays positioned
		// relative to the viewport, so a floating bubble at bottom-right of a
		// 768×1024 tablet appears at the tablet's bottom-right corner instead
		// of leaking out into the stage.
		const stageRect = stage.getBoundingClientRect();
		const stageW = stageRect.width || stage.offsetWidth;
		const stageH = stageRect.height || stage.offsetHeight;
		const scaleX = stageW / device.w;
		const scaleY = stageH / device.h;
		const scale = Math.min(scaleX, scaleY, 1) * 0.9;
		const frameW = device.w * scale;
		const frameH = device.h * scale;
		const offsetX = (stageW - frameW) / 2;
		const offsetY = (stageH - frameH) / 2;

		deviceViewport.style.cssText = `
			position: absolute;
			top: ${offsetY}px;
			left: ${offsetX}px;
			width: ${device.w}px;
			height: ${device.h}px;
			transform: scale(${scale});
			transform-origin: top left;
		`;
		deviceViewport.dataset.device = state.device;
		stage.setAttribute('data-device', state.device);
	}

	function parsePx(val) {
		if (!val) return 0;
		const m = String(val).match(/^([\d.]+)px$/);
		return m ? parseFloat(m[1]) : 0;
	}

	function sync() {
		syncPositionButtons();
		syncModeCards();
		applyToPreview();
		applyAgentAttrs();
		syncDevice();
		writeSnippet();
	}

	function snapToCorner(x, y, w, h, stageW, stageH) {
		const SNAP = 48;
		const corners = [
			{ corner: 'top-left', cx: 0, cy: 0 },
			{ corner: 'top-right', cx: stageW - w, cy: 0 },
			{ corner: 'bottom-left', cx: 0, cy: stageH - h },
			{ corner: 'bottom-right', cx: stageW - w, cy: stageH - h },
			{ corner: 'top-center', cx: (stageW - w) / 2, cy: 0 },
			{ corner: 'bottom-center', cx: (stageW - w) / 2, cy: stageH - h },
		];
		for (const c of corners) {
			if (Math.abs(x - c.cx) < SNAP && Math.abs(y - c.cy) < SNAP) {
				// Compute offsets from nearest edge
				const offV = c.corner.startsWith('top')
					? `${Math.round(c.cy)}px`
					: `${Math.round(stageH - h - c.cy)}px`;
				const offH = c.corner.endsWith('left')
					? `${Math.round(c.cx)}px`
					: c.corner.endsWith('right')
						? `${Math.round(stageW - w - c.cx)}px`
						: '0px';
				return { x: c.cx, y: c.cy, corner: c.corner, offsetV: offV, offsetH: offH };
			}
		}
		return { x, y };
	}

	function escapeAttr(s) {
		return String(s).replace(/"/g, '&quot;');
	}

	sync();
	return { state, host };
}
