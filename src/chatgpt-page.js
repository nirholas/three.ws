// /chatgpt: add the three.ws 3D Studio to your own ChatGPT.
//
// The page hands the reader one URL (/api/mcp-chatgpt, the ChatGPT surface of
// the shared studio handler, see api/_mcp-studio/dispatch.js SURFACES) and
// proves it from their browser: initialize + tools/list drive the status line
// and the tool grid, so the page never claims a server or a tool that is not
// answering right now. The "made just now" strip reads the same public gallery
// /grok shows.

const ENDPOINT = '/api/mcp-chatgpt';
const TIMEOUT_MS = 12000;
const STRIP_COUNT = 6;

const $ = (id) => document.getElementById(id);

// ── copy ─────────────────────────────────────────────────────────────────

async function copyText(text, btn) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		document.execCommand('copy');
		ta.remove();
	}
	const label = btn.querySelector('.cg-ask-kind span:last-child') || btn.querySelector('span') || btn;
	if (!btn._label) btn._label = label.textContent;
	btn.dataset.copied = 'true';
	label.textContent = 'Copied';
	clearTimeout(btn._copyTimer);
	btn._copyTimer = setTimeout(() => {
		btn.dataset.copied = 'false';
		label.textContent = btn._label;
	}, 1600);
}

function wireCopy() {
	for (const btn of document.querySelectorAll('[data-copy-target]')) {
		btn.addEventListener('click', () => copyText($(btn.dataset.copyTarget).textContent.trim(), btn));
	}
	for (const btn of document.querySelectorAll('[data-ask]')) {
		btn.addEventListener('click', () => copyText(btn.dataset.ask, btn));
	}
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────

let nextId = 1;

async function rpc(method, params = {}) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error(`server answered ${res.status}`);
		const json = await res.json();
		if (json?.error) throw new Error(json.error.message || 'JSON-RPC error');
		return json?.result;
	} catch (err) {
		if (err?.name === 'AbortError') throw new Error('no answer within 12 seconds');
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

// ── status + tools ───────────────────────────────────────────────────────

function setStatus(state, text) {
	const strip = $('cg-status');
	strip.dataset.state = state;
	$('cg-status-text').textContent = text;
	$('cg-status-retry').hidden = state !== 'down';
}

function firstSentence(text) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	const end = s.search(/[.!?](\s|$)/);
	return end > 0 ? s.slice(0, end + 1) : s;
}

function renderTools(tools) {
	const grid = $('cg-tools');
	grid.replaceChildren(
		...tools.map((t) => {
			const card = document.createElement('div');
			card.className = 'cg-tool';
			const name = document.createElement('code');
			name.textContent = t.name;
			const desc = document.createElement('p');
			desc.textContent = firstSentence(t.description);
			card.append(name, desc);
			return card;
		}),
	);
}

async function check() {
	const grid = $('cg-tools');
	const note = $('cg-tools-note');
	setStatus('checking', 'Checking the server from your browser.');
	grid.setAttribute('aria-busy', 'true');
	note.hidden = true;
	const started = performance.now();
	try {
		const init = await rpc('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'three.ws/chatgpt page', version: '1.0.0' },
		});
		const listed = await rpc('tools/list');
		const tools = listed?.tools || [];
		const ms = Math.round(performance.now() - started);
		if (!tools.length) throw new Error('the server listed no tools');
		setStatus('up', `Online. ${tools.length} free tools, MCP ${init?.protocolVersion || '2025-06-18'}, answered in ${ms} ms.`);
		renderTools(tools);
		note.hidden = false;
		note.removeAttribute('data-tone');
		note.textContent = `${tools.length} tools, all free. ChatGPT picks the right one from what you ask.`;
	} catch (err) {
		setStatus('down', `The server did not answer from this browser (${err?.message || 'network error'}). ChatGPT may still reach it; try again in a moment.`);
		grid.replaceChildren();
		note.hidden = false;
		note.dataset.tone = 'error';
		note.textContent = 'The live tool list could not load. Use Check again at the top of the page.';
	} finally {
		grid.setAttribute('aria-busy', 'false');
	}
}

// ── recent creations ─────────────────────────────────────────────────────

// The render endpoint fetches the GLB itself, so it can only draw a public
// https one. Anything else falls back to the concept image.
function posterFor(item) {
	const glb = new URL(item.web_glb_url || item.glb_url, location.href);
	if (glb.protocol === 'https:') return `/api/render/glb?glbUrl=${encodeURIComponent(glb.href)}`;
	return item.preview_image_url || '';
}

async function loadStrip() {
	const strip = $('cg-strip');
	const note = $('cg-strip-note');
	strip.setAttribute('aria-busy', 'true');
	note.hidden = true;
	try {
		const res = await fetch(`/api/forge-gallery?limit=${STRIP_COUNT}`);
		if (!res.ok) throw new Error(`gallery answered ${res.status}`);
		const data = await res.json();
		if (data?.enabled === false) {
			strip.closest('section').hidden = true;
			return;
		}
		const items = (data?.creations || []).filter((c) => c.id && (c.web_glb_url || c.glb_url));
		if (!items.length) {
			strip.replaceChildren();
			note.hidden = false;
			note.removeAttribute('data-tone');
			note.textContent = 'Nothing has been generated in a while. Add the app and be the first.';
			return;
		}
		strip.replaceChildren(
			...items.map((item) => {
				const a = document.createElement('a');
				a.className = 'cg-made';
				a.href = `/m/${encodeURIComponent(item.id)}`;
				const img = document.createElement('img');
				img.loading = 'lazy';
				img.decoding = 'async';
				img.width = 240;
				img.height = 240;
				img.alt = item.prompt ? `3D model: ${item.prompt}` : 'A 3D model made on three.ws';
				const poster = posterFor(item);
				if (poster) img.src = poster;
				img.addEventListener('error', () => {
					if (item.preview_image_url && img.src !== item.preview_image_url) img.src = item.preview_image_url;
				}, { once: true });
				const label = document.createElement('span');
				label.textContent = item.prompt || 'Untitled model';
				a.append(img, label);
				return a;
			}),
		);
	} catch (err) {
		strip.replaceChildren();
		note.hidden = false;
		note.dataset.tone = 'error';
		note.textContent = `Could not load recent models (${err?.message || 'network error'}). Reload the page to try again.`;
	} finally {
		strip.setAttribute('aria-busy', 'false');
	}
}

wireCopy();
$('cg-status-retry').addEventListener('click', check);
check();
loadStrip();
