/**
 * /microsoft partner hub (pages/microsoft/index.html): three live demos of
 * Microsoft open source running in three.ws, and the status of every Microsoft
 * surface three.ws ships to.
 *
 *   TRELLIS strip    /api/forge-gallery?scope=community&backend=<lane>, real
 *                    community creations made by Microsoft Research models,
 *                    each opening /m/<id>; lane status from /api/forge?health=1.
 *   On-device STT    src/runtime/whisper-stt.js with onDeviceOnly, so the
 *                    ONNX Runtime Web path is the only path and no audio uploads.
 *   Adaptive Cards   a real agent's Glance card (/api/glance/card?format=adaptive)
 *                    rendered by Microsoft's open-source adaptivecards renderer.
 *   Surfaces         data/microsoft-surfaces.json plus two live probes:
 *                    /api/microsoft-marketplace/status and the MCP tools/list.
 *
 * Heavy modules (the card renderer, the speech runtime) load on first use.
 */

import surfaceData from '../data/microsoft-surfaces.json';
import {
	MICROSOFT_LANES,
	ageLabel,
	filterByLane,
	forgeLink,
	laneFor,
	marketplaceLine,
	stripCreations,
	tryItLane,
	viewerLink,
} from './microsoft-hub-model.js';

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
	return node;
}

async function getJson(url, init) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, ...init });
	if (!res.ok) throw new Error(`${url.split('?')[0]} answered ${res.status}`);
	return res.json();
}

async function copyText(text, button) {
	const label = button.dataset.label || button.textContent;
	button.dataset.label = label;
	try {
		await navigator.clipboard.writeText(text);
		button.textContent = 'Copied';
		button.classList.add('is-done');
	} catch {
		button.textContent = 'Copy blocked: select and copy by hand';
	}
	clearTimeout(button._resetTimer);
	button._resetTimer = setTimeout(() => {
		button.textContent = label;
		button.classList.remove('is-done');
	}, 1800);
}

function skeletons(container, n, className) {
	container.replaceChildren(...Array.from({ length: n }, () => el('div', { class: `skel ${className}`, 'aria-hidden': 'true' })));
}

function stateBox({ tone = 'empty', title, body, action }) {
	return el(
		'div',
		{ class: `state state-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
		el('strong', { text: title }),
		body ? el('p', { text: body }) : null,
		action || null,
	);
}

/* ─── TRELLIS strip ─────────────────────────────────────────────────────── */

const strip = { rows: [], lane: 'all', health: null };

function stripCard(c) {
	const lane = laneFor(c.backend);
	const prompt = (c.prompt || '').trim() || 'Image to 3D';
	return el(
		'a',
		{ class: 'mcard', href: viewerLink(c.id), 'aria-label': `Open in the viewer: ${prompt}, made with ${lane.label}` },
		el('span', { class: 'mcard-img' }, el('img', { src: c.preview_image_url, alt: '', loading: 'lazy', decoding: 'async', width: 240, height: 240 })),
		el('span', { class: `lane-badge lane-${c.backend}`, text: lane.label }),
		el('span', { class: 'mcard-prompt', text: prompt }),
		el('span', { class: 'mcard-meta', text: ageLabel(c.created_at) }),
	);
}

function renderChips() {
	const chips = $('#lane-chips');
	const counts = Object.fromEntries(MICROSOFT_LANES.map((l) => [l.backend, filterByLane(strip.rows, l.backend).length]));
	const options = [{ backend: 'all', label: 'All Microsoft models', count: strip.rows.length }, ...MICROSOFT_LANES.map((l) => ({ ...l, count: counts[l.backend] }))];
	chips.replaceChildren(
		...options.map((o) =>
			el(
				'button',
				{
					type: 'button',
					class: 'chip',
					'aria-pressed': String(strip.lane === o.backend),
					onclick: () => {
						strip.lane = o.backend;
						renderChips();
						renderStrip();
					},
				},
				o.label,
				el('span', { class: 'chip-count', text: String(o.count) }),
			),
		),
	);
}

function renderStrip() {
	const box = $('#trellis-strip');
	const rows = filterByLane(strip.rows, strip.lane);
	if (rows.length) {
		box.replaceChildren(...rows.map(stripCard));
		return;
	}
	const lane = laneFor(strip.lane);
	const tryLane = lane || tryItLane(strip.health);
	box.replaceChildren(
		stateBox({
			title: lane ? `No public ${lane.label} creations yet` : 'No public creations from these models yet',
			body: lane
				? `Nothing made with ${lane.label} has been shared to the community feed so far. Generate one and it shows up here.`
				: 'Generate a model from a photo and share it to the community feed to see it here.',
			action: el('a', { class: 'btn btn-sec', href: forgeLink(tryLane.backend), text: `Make one with ${tryLane.label}` }),
		}),
	);
}

function renderLaneStatus() {
	const out = $('#lane-status');
	const backends = strip.health?.backends;
	if (!backends) {
		out.replaceChildren(el('span', { class: 'pill pill-unknown', text: 'Lane status unavailable' }));
		return;
	}
	out.replaceChildren(
		...MICROSOFT_LANES.map((l) => {
			const s = backends[l.backend]?.status;
			const up = s === 'ok';
			return el('span', { class: `pill ${up ? 'pill-live' : 'pill-pending'}`, title: backends[l.backend]?.message || '' }, `${l.label}: ${up ? 'running now' : 'not running on this deployment'}`);
		}),
	);
	const lane = tryItLane(strip.health);
	const tryBtn = $('#trellis-try');
	tryBtn.href = forgeLink(lane.backend);
	tryBtn.querySelector('.btn-text').textContent = `Try ${lane.label} in the Forge`;
}

async function loadStrip() {
	const box = $('#trellis-strip');
	skeletons(box, 6, 'skel-card');
	$('#lane-chips').replaceChildren(...Array.from({ length: 3 }, () => el('span', { class: 'skel skel-chip', 'aria-hidden': 'true' })));
	const feed = (backend) => getJson(`/api/forge-gallery?scope=community&backend=${backend}&limit=24`).then((j) => j.creations || []);
	const [feeds, health] = await Promise.all([
		Promise.allSettled(MICROSOFT_LANES.map((l) => feed(l.backend))),
		getJson('/api/forge?health=1').catch(() => null),
	]);
	strip.health = health;
	renderLaneStatus();
	if (feeds.every((r) => r.status === 'rejected')) {
		$('#lane-chips').replaceChildren();
		box.replaceChildren(
			stateBox({
				tone: 'error',
				title: 'The community feed did not answer',
				body: 'The Forge creations could not be loaded. Check your connection and try again.',
				action: el('button', { type: 'button', class: 'btn btn-sec', onclick: loadStrip, text: 'Try again' }),
			}),
		);
		return;
	}
	strip.rows = stripCreations(Object.fromEntries(MICROSOFT_LANES.map((l, i) => [l.backend, feeds[i].status === 'fulfilled' ? feeds[i].value : []])), 24);
	renderChips();
	renderStrip();
}

/* ─── On-device speech to text ──────────────────────────────────────────── */

const stt = { engine: null, mod: null, busy: false };

function sttStatus(text, tone = '') {
	const s = $('#stt-status');
	s.textContent = text;
	s.dataset.tone = tone;
}

function sttProgress(fraction) {
	const bar = $('#stt-progress');
	if (fraction === null || fraction === undefined || fraction >= 1) {
		bar.hidden = true;
		return;
	}
	bar.hidden = false;
	bar.value = Math.round(fraction * 100);
}

function onSttStatus(status) {
	const btn = $('#stt-btn');
	btn.dataset.phase = status.phase;
	const download = status.progress ?? status.modelProgress;
	sttProgress(download ?? null);
	const pct = download !== undefined && download !== null && download < 1 ? ` (model ${Math.round(download * 100)}%)` : '';
	if (status.phase === 'listening') {
		btn.setAttribute('aria-pressed', 'true');
		btn.querySelector('.stt-label').textContent = 'Listening. Press to stop';
		sttStatus(`Listening. Speak now${pct}.`, 'live');
	} else if (status.phase === 'loading-model') {
		sttStatus(`Downloading the speech model once, then it stays cached${pct}.`, 'busy');
	} else if (status.phase === 'transcribing') {
		sttStatus('Transcribing on this device.', 'busy');
	} else {
		btn.setAttribute('aria-pressed', 'false');
		btn.querySelector('.stt-label').textContent = 'Press and speak';
	}
}

async function toggleStt() {
	if (stt.engine?.listening) {
		stt.engine.stop();
		return;
	}
	if (stt.busy) return;
	stt.busy = true;
	const out = $('#stt-transcript');
	try {
		stt.mod ||= await import('./runtime/whisper-stt.js');
		if (!stt.mod.onDeviceSupported()) {
			sttStatus('This browser cannot run on-device speech recognition (it needs WebAssembly, a microphone and Web Audio). Try a current Edge, Chrome, Firefox or Safari.', 'error');
			return;
		}
		stt.engine ||= new stt.mod.WhisperSTT({ language: navigator.language || 'en-US', onDeviceOnly: true });
		out.classList.remove('is-empty');
		out.textContent = '';
		sttStatus('Starting the microphone.', 'busy');
		const text = await stt.engine.listen({ onFinal: (t) => (out.textContent = `${out.textContent} ${t}`.trim()), onStatus: onSttStatus });
		if (text) {
			out.textContent = text;
			sttStatus('Done. Transcribed on this device. Press again to say more.', 'ok');
		} else {
			out.classList.add('is-empty');
			out.textContent = 'Nothing heard.';
			sttStatus('No speech came through. Check the right microphone is selected, then press and speak again.', 'error');
		}
	} catch (err) {
		out.classList.add('is-empty');
		out.textContent = 'No transcript.';
		const name = err?.name || '';
		if (name === 'NotAllowedError' || name === 'SecurityError') sttStatus('Microphone access was blocked. Allow it from the icon in the address bar, then press again.', 'error');
		else if (name === 'NotFoundError') sttStatus('No microphone was found. Plug one in or pick one in your system settings, then press again.', 'error');
		else sttStatus(`On-device recognition failed (${err?.message || 'unknown error'}). Nothing was uploaded. Reload the page to retry the model download.`, 'error');
	} finally {
		stt.busy = false;
		sttProgress(null);
		onSttStatus({ phase: 'idle' });
	}
}

function initStt() {
	const lang = navigator.language || 'en-US';
	const english = /^en\b/i.test(lang);
	$('#stt-model').textContent = english
		? 'Moonshine base (MIT), about 63 MB'
		: 'Whisper base (MIT), about 77 MB, in your browser language';
	$('#stt-btn').addEventListener('click', toggleStt);
}

/* ─── Adaptive Cards ────────────────────────────────────────────────────── */

const card = { mod: null, json: null, agents: [] };

function hostConfig(AC, light) {
	const fg = light
		? { default: '#1d212b', subtle: '#5a616f', accent: '#2563eb', good: '#15803d', warning: '#b45309', attention: '#b91c1c' }
		: { default: '#e8e8e8', subtle: '#9a9a9a', accent: '#7cb4ff', good: '#4ade80', warning: '#fbbf24', attention: '#f87171' };
	const colors = Object.fromEntries(Object.entries(fg).map(([k, v]) => [k, { default: v, subtle: v }]));
	colors.default.subtle = fg.subtle;
	// "dark" and "light" name the ink itself, not the theme.
	colors.dark = { default: '#0a0c12', subtle: '#374151' };
	colors.light = { default: '#ffffff', subtle: '#e5e7eb' };
	return new AC.HostConfig({
		fontFamily: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
		spacing: { small: 4, default: 8, medium: 16, large: 24, extraLarge: 32, padding: 16 },
		fontSizes: { small: 12, default: 14, medium: 17, large: 21, extraLarge: 30 },
		containerStyles: {
			default: { backgroundColor: light ? '#ffffff' : '#141414', foregroundColors: colors },
			emphasis: { backgroundColor: light ? '#f3f4f6' : '#1c1c1c', foregroundColors: colors },
		},
		imageSizes: { small: 48, medium: 80, large: 160 },
		actions: { maxActions: 4, spacing: 'default', buttonSpacing: 8, actionsOrientation: 'horizontal', actionAlignment: 'left', showCard: { actionMode: 'inline' } },
	});
}

function isLight() {
	return document.documentElement.getAttribute('data-theme') === 'light';
}

function renderCard() {
	const box = $('#ac-render');
	if (!card.json || !card.mod) return;
	const AC = card.mod;
	const ac = new AC.AdaptiveCard();
	ac.hostConfig = hostConfig(AC, isLight());
	ac.onExecuteAction = (action) => {
		const url = action instanceof AC.OpenUrlAction ? action.url : null;
		if (url && /^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
	};
	ac.parse(card.json);
	const node = ac.render();
	if (!node) {
		box.replaceChildren(stateBox({ tone: 'error', title: 'The renderer could not draw this card', body: 'Copy the JSON below into the Adaptive Cards designer to see why.' }));
		return;
	}
	box.replaceChildren(node);
}

async function loadCard(agentId) {
	const box = $('#ac-render');
	const jsonOut = $('#ac-json');
	const copyBtn = $('#ac-copy');
	copyBtn.disabled = true;
	skeletons(box, 1, 'skel-ac');
	try {
		const [mod, json] = await Promise.all([card.mod || import('adaptivecards'), getJson(`/api/glance/card?agent=${encodeURIComponent(agentId)}&format=adaptive`)]);
		if (!card.mod) {
			// Glance cards carry plain text only; render it escaped instead of
			// pulling in a markdown library the payload never needs.
			mod.AdaptiveCard.onProcessMarkdown = (text, result) => {
				const holder = document.createElement('span');
				holder.textContent = text;
				result.outputHtml = holder.innerHTML;
				result.didProcess = true;
			};
		}
		card.mod = mod;
		card.json = json;
		jsonOut.textContent = JSON.stringify(json, null, 2);
		copyBtn.disabled = false;
		renderCard();
		const agent = card.agents.find((a) => a.id === agentId);
		$('#ac-open').href = `/glance?agent=${encodeURIComponent(agentId)}`;
		$('#ac-open').hidden = false;
		$('#ac-caption').textContent = `Live Glance card for ${agent?.name || 'this agent'}, schema ${json.version || '1.6'}, drawn by adaptivecards in this tab.`;
	} catch (err) {
		card.json = null;
		jsonOut.textContent = '';
		box.replaceChildren(
			stateBox({
				tone: 'error',
				title: 'The card did not load',
				body: `${err?.message || 'Network error'}. Pick the agent again or try another one.`,
				action: el('button', { type: 'button', class: 'btn btn-sec', onclick: () => loadCard(agentId), text: 'Try again' }),
			}),
		);
	}
}

async function initCards() {
	const select = $('#ac-agent');
	$('#ac-copy').addEventListener('click', (e) => card.json && copyText(JSON.stringify(card.json, null, 2), e.currentTarget));
	select.addEventListener('change', () => loadCard(select.value));
	skeletons($('#ac-render'), 1, 'skel-ac');
	try {
		const { agents = [] } = await getJson('/api/agents/public?avatar=1&sort=popular&limit=12');
		card.agents = agents.filter((a) => a?.id && a?.name);
		if (!card.agents.length) {
			select.disabled = true;
			$('#ac-render').replaceChildren(
				stateBox({ title: 'No public agents yet', body: 'Create an agent and its Glance card appears here.', action: el('a', { class: 'btn btn-sec', href: '/create', text: 'Create an agent' }) }),
			);
			return;
		}
		select.replaceChildren(...card.agents.map((a) => el('option', { value: a.id, text: a.name })));
		select.disabled = false;
		loadCard(card.agents[0].id);
	} catch (err) {
		$('#ac-render').replaceChildren(
			stateBox({
				tone: 'error',
				title: 'Agents did not load',
				body: `${err?.message || 'Network error'}. The card needs a real agent to bind to.`,
				action: el('button', { type: 'button', class: 'btn btn-sec', onclick: initCards, text: 'Try again' }),
			}),
		);
	}
}

/* ─── Surfaces ──────────────────────────────────────────────────────────── */

const STATUS_CLASS = { live: 'pill-live', 'pending review': 'pill-review', 'built, awaiting publish': 'pill-pending' };

function probeLine(text, tone) {
	return el('p', { class: `probe probe-${tone}` }, el('span', { class: 'probe-dot', 'aria-hidden': 'true' }), text);
}

async function runProbe(kind, slot) {
	slot.replaceChildren(el('span', { class: 'skel skel-line', 'aria-hidden': 'true' }));
	if (kind === 'marketplace') {
		const status = await getJson('/api/microsoft-marketplace/status').catch(() => null);
		const line = marketplaceLine(status);
		slot.replaceChildren(probeLine(`Live check: ${line.text}`, line.tone));
		return;
	}
	if (kind === 'mcp') {
		try {
			const j = await getJson('/api/mcp-studio', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
			const n = j?.result?.tools?.length || 0;
			slot.replaceChildren(probeLine(n ? `Live check: ${n} tools answering now, no key.` : 'Live check: the server answered with no tools.', n ? 'ok' : 'pending'));
		} catch {
			slot.replaceChildren(probeLine('Live check: the MCP server did not answer just now.', 'unknown'));
		}
	}
}

function surfaceCard(s) {
	const external = /^https:/.test(s.action.url);
	const probe = s.probe ? el('div', { class: 'probe-slot', 'aria-live': 'polite' }) : null;
	const copy = s.copy
		? el(
				'div',
				{ class: 'copy-row' },
				el('code', { text: s.copy }),
				el('button', { type: 'button', class: 'btn-copy', onclick: (e) => copyText(s.copy, e.currentTarget), 'aria-label': `Copy ${s.copy}`, text: 'Copy' }),
			)
		: null;
	const node = el(
		'article',
		{ class: 'surface', id: `surface-${s.id}` },
		el('div', { class: 'surface-head' }, el('span', { class: 'surface-kind', text: s.kind }), el('span', { class: `pill ${STATUS_CLASS[s.status]}`, text: s.status })),
		el('h3', { text: s.name }),
		el('p', { class: 'surface-today' }, el('strong', { text: 'Today: ' }), s.today),
		copy,
		probe,
		el('p', { class: 'surface-built', text: s.built }),
		el(
			'div',
			{ class: 'surface-links' },
			el('a', { class: 'btn btn-sec btn-sm', href: s.action.url, ...(external ? { target: '_blank', rel: 'noopener' } : {}), text: s.action.label }),
			el('a', { class: 'textlink', href: s.evidence.url, ...(/^https:/.test(s.evidence.url) ? { target: '_blank', rel: 'noopener' } : {}), text: s.evidence.label }),
		),
	);
	if (probe) runProbe(s.probe, probe);
	return node;
}

function initSurfaces() {
	const grid = $('#surfaces');
	grid.replaceChildren(...surfaceData.surfaces.map(surfaceCard));
	const live = surfaceData.surfaces.filter((s) => s.status === 'live').length;
	$('#surfaces-summary').textContent = `${live} of ${surfaceData.surfaces.length} live, the rest built and waiting on a store publish. Updated ${surfaceData.updated}.`;
}

/* ─── Boot ──────────────────────────────────────────────────────────────── */

function lazy(selector, start) {
	const target = $(selector);
	if (!('IntersectionObserver' in window)) return start();
	const io = new IntersectionObserver(
		(entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				io.disconnect();
				start();
			}
		},
		{ rootMargin: '400px 0px' },
	);
	io.observe(target);
}

initSurfaces();
initStt();
loadStrip();
lazy('#demo-cards', initCards);
new MutationObserver(renderCard).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
