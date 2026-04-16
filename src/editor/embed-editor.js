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

const STYLE = `
	.editor-root {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-columns: 1fr 360px;
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
		background:
			linear-gradient(#ffffff, #fafbfc);
		color: #111827;
		padding: 64px 72px;
		overflow: auto;
	}
	.placeholder-site .hero { height: 280px; border-radius: 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); margin-bottom: 32px; }
	.placeholder-site .row { height: 18px; background: #e5e7eb; border-radius: 999px; margin: 12px 0; }
	.placeholder-site .row.short { width: 60%; }
	.placeholder-site .row.long { width: 92%; }
	.placeholder-site h1 { font: 700 36px/1.2 system-ui; margin-bottom: 16px; }
	.placeholder-site p { color: #4b5563; max-width: 640px; }

	.agent-wrap {
		position: absolute;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	.agent-wrap.dragging { cursor: grabbing; }
	.agent-wrap agent-3d { width: 100%; height: 100%; }
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
	}
	.actions { display: flex; gap: 8px; margin-top: 12px; }
	.btn {
		flex: 1;
		background: #3b82f6;
		color: white;
		border: 0;
		border-radius: 8px;
		padding: 10px 12px;
		font: 600 14px system-ui;
		cursor: pointer;
	}
	.btn.secondary { background: transparent; border: 1px solid #1f2937; color: #e5e7eb; }
	.btn:hover { filter: brightness(1.1); }
	.btn[data-copied="true"] { background: #22c55e; }

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

	/* Device viewport frame — shown when simulating tablet/mobile */
	.device-frame {
		position: absolute;
		top: 50%;
		left: 50%;
		transform-origin: top left;
		background: white;
		box-shadow: 0 0 0 2px #374151, 0 12px 40px rgba(0,0,0,0.5);
		border-radius: 8px;
		overflow: hidden;
		transition: width 0.2s, height 0.2s;
	}
	.device-frame .placeholder-site,
	.device-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
`;

export function mountEmbedEditor(root, options = {}) {
	const defaults = {
		src: options.src || '',
		mode: options.mode || 'floating',
		position: options.position || 'bottom-right',
		offset: options.offset || '24px 24px',
		width: options.width || '320px',
		height: options.height || '420px',
		device: 'desktop',
		responsivePreset: 'desktop-first',
		...options,
	};

	const state = { ...defaults };
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
					<div class="placeholder-site" id="placeholder">
						<h1>Your site goes here</h1>
						<p>This is a preview of what the agent will look like placed on a real page. Paste your site URL above to see the embed on your actual content, or drag the agent around this mock page.</p>
						<div class="hero"></div>
						<div class="row long"></div>
						<div class="row long"></div>
						<div class="row short"></div>
						<div class="row long"></div>
						<div class="row short"></div>
					</div>
					<iframe id="preview-frame" hidden></iframe>
					<div class="agent-wrap" id="agent-wrap">
						<div class="size-readout" id="size-readout"></div>
						<agent-3d eager kiosk id="preview-agent"></agent-3d>
						<div class="resize-handle nw" data-h="nw"></div>
						<div class="resize-handle ne" data-h="ne"></div>
						<div class="resize-handle sw" data-h="sw"></div>
						<div class="resize-handle se" data-h="se"></div>
					</div>
				</div>
			</div>
			<aside class="panel">
				<div class="panel-header">
					<h2>Embed editor</h2>
					<span style="font-size:11px;color:#6b7280">beta</span>
				</div>
				<div class="panel-body">
					<div class="section-title">Source</div>
					<div class="field-row">
						<label>src</label>
						<input id="src-input" placeholder="agent://base/42 or ipfs://...">
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
							<option value="on">controls on</option>
							<option value="off">controls off</option>
						</select>
					</div>
					<div class="field-row">
						<label>AR</label>
						<select id="ar-select">
							<option value="off">off</option>
							<option value="on">on</option>
						</select>
					</div>

					<div class="section-title">Embed snippet</div>
					<div class="snippet-box" id="snippet"></div>
					<div class="actions">
						<button class="btn" id="copy-btn">Copy snippet</button>
						<button class="btn secondary" id="reset-btn">Reset</button>
					</div>
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
		btn.addEventListener('click', () => { state.device = d.id; syncDevice(); writeSnippet(); });
		deviceBar.appendChild(btn);
	}

	const stage = $('#stage');
	const agentWrap = $('#agent-wrap');
	const agentEl = $('#preview-agent');
	const readout = $('#size-readout');
	const snippetEl = $('#snippet');
	const srcInput = $('#src-input');
	const wInput = $('#w-input');
	const hInput = $('#h-input');
	const copyBtn = $('#copy-btn');

	srcInput.value = state.src;
	if (state.src) agentEl.setAttribute('src', state.src);

	// Mode cards
	const modeGrid = $('#mode-grid');
	for (const m of MODES) {
		const card = document.createElement('div');
		card.className = 'mode-card';
		card.dataset.mode = m.id;
		card.setAttribute('aria-pressed', String(m.id === state.mode));
		card.tabIndex = 0;
		card.innerHTML = `<div class="ml">${m.label}</div><div class="mh">${m.hint}</div>`;
		card.addEventListener('click', () => { state.mode = m.id; sync(); });
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
		btn.addEventListener('click', () => { state.position = p.id; sync(); });
		posGrid.appendChild(btn);
	}

	// Input bindings
	srcInput.addEventListener('change', () => { state.src = srcInput.value; sync(); });
	wInput.addEventListener('change', () => { state.width = wInput.value; sync(); });
	hInput.addEventListener('change', () => { state.height = hInput.value; sync(); });
	$('#voice-select').addEventListener('change', (e) => { state.voice = e.target.value === 'off' ? false : true; sync(); });
	$('#camera-select').addEventListener('change', (e) => { state.cameraControls = e.target.value === 'on'; sync(); });
	$('#ar-select').addEventListener('change', (e) => { state.ar = e.target.value === 'on'; sync(); });
	$('#responsive-select').addEventListener('change', (e) => { state.responsivePreset = e.target.value; writeSnippet(); });

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

	// Drag
	let dragState = null;
	agentWrap.addEventListener('pointerdown', (e) => {
		if (e.target.closest('.resize-handle')) return;
		const rect = stage.getBoundingClientRect();
		const agentRect = agentWrap.getBoundingClientRect();
		dragState = {
			kind: 'move',
			offsetX: e.clientX - agentRect.left,
			offsetY: e.clientY - agentRect.top,
			stageRect: rect,
		};
		agentWrap.classList.add('dragging');
		agentWrap.setPointerCapture(e.pointerId);
	});

	// Resize handles
	$$('.resize-handle').forEach((h) => {
		h.addEventListener('pointerdown', (e) => {
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
			const snapped = snapToCorner(x, y, agentWrap.offsetWidth, agentWrap.offsetHeight, rect.width, rect.height);
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
			let w = dragState.startW, h = dragState.startH;
			let left = dragState.startLeft, top = dragState.startTop;
			if (dragState.handle.includes('e')) w = dragState.startW + dx;
			if (dragState.handle.includes('s')) h = dragState.startH + dy;
			if (dragState.handle.includes('w')) { w = dragState.startW - dx; left = dragState.startLeft + dx; }
			if (dragState.handle.includes('n')) { h = dragState.startH - dy; top = dragState.startTop + dy; }
			w = Math.max(160, w); h = Math.max(200, h);
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

	copyBtn.addEventListener('click', async () => {
		await navigator.clipboard.writeText(buildSnippet());
		copyBtn.textContent = 'Copied ✓';
		copyBtn.dataset.copied = 'true';
		setTimeout(() => {
			copyBtn.textContent = 'Copy snippet';
			copyBtn.dataset.copied = 'false';
		}, 1500);
	});

	$('#reset-btn').addEventListener('click', () => {
		Object.assign(state, defaults);
		srcInput.value = state.src;
		wInput.value = state.width;
		hInput.value = state.height;
		$('#responsive-select').value = state.responsivePreset;
		sync();
	});

	// Show appropriate resize handles based on position
	function syncPositionButtons() {
		for (const btn of $$('.pos-btn')) btn.setAttribute('aria-pressed', String(btn.dataset.pos === state.position));
	}
	function syncModeCards() {
		for (const card of $$('.mode-card')) card.setAttribute('aria-pressed', String(card.dataset.mode === state.mode));
	}

	function applyToPreview() {
		// Size
		agentWrap.style.width = state.width;
		agentWrap.style.height = state.height;
		readout.textContent = `${state.width} × ${state.height}`;

		// Position — place the wrap inside the stage per mode + position
		agentWrap.style.left = agentWrap.style.right = agentWrap.style.top = agentWrap.style.bottom = '';
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

		// Agent attrs
		if (state.src) agentEl.setAttribute('src', state.src); else agentEl.removeAttribute('src');
	}

	function buildSnippet() {
		const attrs = [];
		if (state.src) attrs.push(`src="${escapeAttr(state.src)}"`);
		if (state.mode && state.mode !== 'inline') attrs.push(`mode="${state.mode}"`);
		if (state.mode === 'floating') {
			if (state.position !== 'bottom-right') attrs.push(`position="${state.position}"`);
			if (state.offset && state.offset !== '24px 24px') attrs.push(`offset="${state.offset}"`);
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

		const script = `<script type="module" src="https://cdn.3d-agent.io/agent-3d.js"></script>`;
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

	function syncDevice() {
		const device = DEVICES.find((d) => d.id === state.device) || DEVICES[0];
		for (const btn of $$('.device-btn')) {
			btn.setAttribute('aria-pressed', String(btn.dataset.device === state.device));
		}

		const stageRect = stage.getBoundingClientRect();
		const stageW = stageRect.width || stage.offsetWidth;
		const stageH = stageRect.height || stage.offsetHeight;

		if (state.device === 'desktop') {
			// No frame — fills stage normally
			$('#placeholder').style.cssText = '';
			const iframe = $('#preview-frame');
			if (iframe) iframe.style.cssText = '';
			stage.removeAttribute('data-device');
		} else {
			// Show device frame scaled to fit the stage
			const scaleX = stageW / device.w;
			const scaleY = stageH / device.h;
			const scale = Math.min(scaleX, scaleY, 1) * 0.9;
			const frameW = device.w * scale;
			const frameH = device.h * scale;
			const offsetX = (stageW - frameW) / 2;
			const offsetY = (stageH - frameH) / 2;

			const placeholder = $('#placeholder');
			placeholder.style.cssText = `
				width: ${device.w}px; height: ${device.h}px;
				transform: scale(${scale}); transform-origin: top left;
				top: ${offsetY / scale}px; left: ${offsetX / scale}px;
				position: absolute;
			`;
			const iframe = $('#preview-frame');
			if (iframe && !iframe.hidden) {
				iframe.style.cssText = `
					width: ${device.w}px; height: ${device.h}px;
					transform: scale(${scale}); transform-origin: top left;
					top: ${offsetY / scale}px; left: ${offsetX / scale}px;
					position: absolute; border: 0;
				`;
			}
			stage.setAttribute('data-device', state.device);
		}
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
				const offV = c.corner.startsWith('top') ? `${Math.round(c.cy)}px` : `${Math.round(stageH - h - c.cy)}px`;
				const offH = c.corner.endsWith('left') ? `${Math.round(c.cx)}px`
					: c.corner.endsWith('right') ? `${Math.round(stageW - w - c.cx)}px`
					: '0px';
				return { x: c.cx, y: c.cy, corner: c.corner, offsetV: offV, offsetH: offH };
			}
		}
		return { x, y };
	}

	function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

	sync();
	return { state, host };
}
