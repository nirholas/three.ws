// /grok: three.ws for Grok Bot, Grok connectors and the xAI API.
//
// The demo on this page is a real MCP client for /api/mcp-grok, the surface
// Grok connects to. It runs the same sequence Grok does: initialize (which
// issues the Mcp-Session-Id the server keys its quota on), tools/call, then
// check_job until the model lands. Every request and answer goes into the
// visible transcript, so what you watch is what Grok sees.

const ENDPOINT = '/api/mcp-grok';
const POLL_MIN_S = 5;
const POLL_MAX_S = 30;
const POLL_DEFAULT_S = 15;

const $ = (id) => document.getElementById(id);

// ── copy buttons ─────────────────────────────────────────────────────────

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
	flashCopied(btn);
}

function flashCopied(btn) {
	const label = btn.querySelector('.gk-ask-kind span:last-child') || btn.querySelector('span') || btn;
	const before = label.textContent;
	btn.dataset.copied = 'true';
	label.textContent = 'Copied';
	clearTimeout(btn._copyTimer);
	btn._copyTimer = setTimeout(() => {
		btn.dataset.copied = 'false';
		label.textContent = before;
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

// ── setup tabs (WAI-ARIA tabs pattern, roving tabindex) ──────────────────

function wireTabs() {
	const tabs = [...document.querySelectorAll('.gk-tab')];
	const select = (tab, focus) => {
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			$(t.getAttribute('aria-controls')).hidden = !on;
		}
		if (focus) tab.focus();
	};
	tabs.forEach((tab, i) => {
		tab.addEventListener('click', () => select(tab, false));
		tab.addEventListener('keydown', (e) => {
			const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
			if (step) {
				e.preventDefault();
				select(tabs[(i + step + tabs.length) % tabs.length], true);
			} else if (e.key === 'Home' || e.key === 'End') {
				e.preventDefault();
				select(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
			}
		});
	});
}

// ── the MCP client ───────────────────────────────────────────────────────

class RpcError extends Error {
	constructor(message, { status = 0, retryAfter = 0 } = {}) {
		super(message);
		this.status = status;
		this.retryAfter = retryAfter;
	}
}

function createClient() {
	let sessionId = null;
	let nextId = 0;
	return {
		get sessionId() {
			return sessionId;
		},
		async call(method, params, signal) {
			const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
			if (sessionId) headers['mcp-session-id'] = sessionId;
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers,
				body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
				signal,
			});
			const issued = res.headers.get('mcp-session-id');
			if (issued) sessionId = issued;
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				const message = body?.error_description || body?.error?.message || `The server answered ${res.status}.`;
				throw new RpcError(message, { status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0 });
			}
			if (body?.error) throw new RpcError(body.error.message || 'The server rejected the request.');
			return body?.result;
		},
	};
}

// ── transcript ───────────────────────────────────────────────────────────

function createLog(el) {
	let t0 = 0;
	return {
		reset() {
			el.replaceChildren();
			t0 = performance.now();
		},
		add(dir, text, tone) {
			const li = document.createElement('li');
			li.dataset.dir = dir;
			if (tone) li.dataset.tone = tone;
			const t = document.createElement('span');
			t.className = 't';
			t.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
			const d = document.createElement('span');
			d.className = 'd';
			d.textContent = dir === 'out' ? '→' : '←';
			d.setAttribute('aria-label', dir === 'out' ? 'sent' : 'received');
			const m = document.createElement('span');
			m.className = 'm';
			m.textContent = text;
			li.append(t, d, m);
			el.append(li);
			el.scrollTop = el.scrollHeight;
		},
	};
}

// ── stage (empty / waiting / error / model) ──────────────────────────────

function createStage() {
	const panes = { empty: $('gk-empty'), wait: $('gk-wait'), error: $('gk-error'), model: $('gk-mv') };
	const show = (name) => {
		for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
		$('gk-bar-actions').hidden = name !== 'model';
	};
	return {
		empty: () => show('empty'),
		wait(title, detail, fraction) {
			$('gk-wait-h').textContent = title;
			$('gk-wait-p').textContent = detail;
			const pct = Math.max(4, Math.min(96, Math.round((fraction ?? 0) * 100)));
			$('gk-bar').style.width = `${pct}%`;
			$('gk-bar').parentElement.setAttribute('aria-valuenow', String(pct));
			show('wait');
		},
		error(title, detail) {
			$('gk-error-h').textContent = title;
			$('gk-error-p').textContent = detail;
			show('error');
		},
		model(sc, seconds) {
			const glb = sc.glb_url || sc.glbUrl;
			panes.model.setAttribute('src', glb);
			const posterUrl = sc.poster_png_url;
			if (posterUrl) panes.model.setAttribute('poster', posterUrl);
			$('gk-open').href = sc.viewer_url || sc.viewerUrl;
			$('gk-dl').href = glb;
			const embed = $('gk-embed');
			embed.hidden = !sc.embed_html;
			embed.dataset.embed = sc.embed_html || '';
			$('gk-took').textContent = `Landed in ${seconds}s`;
			show('model');
		},
	};
}

// ── demo flow ────────────────────────────────────────────────────────────

const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new DOMException('stopped', 'AbortError'));
			},
			{ once: true },
		);
	});

// How long to wait before the next check_job, from the numbers the server put
// on the pending result: the boot time left on a cold worker, else the render
// ETA, else a steady default.
function nextWaitSeconds(sc) {
	const hint = Number(sc?.cold?.remainingSeconds) || Number(sc?.etaRemainingSeconds) || POLL_DEFAULT_S;
	return Math.max(POLL_MIN_S, Math.min(POLL_MAX_S, Math.round(hint)));
}

function pendingCopy(sc) {
	if (sc?.cold) {
		const left = Number(sc.cold.remainingSeconds);
		return {
			title: 'Waking a GPU',
			detail: left > 0
				? `The job is accepted. The GPU worker is booting, about ${left}s left, and rendering starts the moment it answers.`
				: 'The job is accepted. The GPU worker is booting and rendering starts the moment it answers.',
		};
	}
	const eta = Number(sc?.etaRemainingSeconds);
	return {
		title: 'Rendering your model',
		detail: eta > 0 ? `Roughly ${eta}s to go. The page collects it with check_job, exactly like Grok.` : 'Still rendering. The page collects it with check_job, exactly like Grok.',
	};
}

function describeFailure(err) {
	if (err?.status === 429) {
		const wait = err.retryAfter ? ` Try again in about ${Math.ceil(err.retryAfter / 60)} min.` : '';
		return { title: 'Free quota reached for now', detail: `${err.message}.${wait}` };
	}
	if (err instanceof TypeError) return { title: 'Could not reach three.ws', detail: 'Check your connection, then try again.' };
	return { title: 'That did not work', detail: err?.message || 'The studio could not finish this one. Try again, or reword the prompt.' };
}

function brief(sc) {
	if (sc?.glb_url || sc?.glbUrl) return 'done, glbUrl ready';
	if (sc?.status === 'pending') {
		const wait = nextWaitSeconds(sc);
		return `pending (${sc.cold ? 'GPU booting' : 'rendering'}), check_job again in ~${wait}s`;
	}
	return 'result received';
}

function startDemo() {
	const form = $('gk-form');
	const prompt = $('gk-prompt');
	const go = $('gk-go');
	const stop = $('gk-stop');
	const log = createLog($('gk-log'));
	const stage = createStage();
	let controller = null;

	const setBusy = (busy) => {
		go.disabled = busy;
		go.textContent = busy ? 'Generating…' : 'Generate in 3D';
		stop.hidden = !busy;
		prompt.readOnly = busy;
	};

	async function run(text) {
		controller = new AbortController();
		const { signal } = controller;
		const client = createClient();
		const started = performance.now();
		const elapsed = () => Math.round((performance.now() - started) / 1000);
		setBusy(true);
		log.reset();
		stage.wait('Submitting the job', 'Opening an MCP session with the studio.', 0.04);
		try {
			log.add('out', 'initialize');
			const init = await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'three.ws/grok demo', version: '1' } }, signal);
			log.add('in', `${init?.serverInfo?.name || 'server'} ready${client.sessionId ? `, session ${client.sessionId.slice(0, 12)}…` : ''}`);

			log.add('out', `tools/call forge_free { prompt: "${text.length > 60 ? `${text.slice(0, 60)}…` : text}" }`);
			stage.wait('Submitting the job', 'The studio paints a concept, then sculpts it into a mesh.', 0.08);
			let result = await client.call('tools/call', { name: 'forge_free', arguments: { prompt: text } }, signal);
			let sc = result?.structuredContent || {};
			if (result?.isError) throw new Error(sc.message || result?.content?.[0]?.text || 'The studio could not start this one.');
			log.add('in', brief(sc), sc.glbUrl ? 'ok' : undefined);

			let firstEta = null;
			while (sc.status === 'pending' && sc.jobId) {
				const wait = nextWaitSeconds(sc);
				firstEta ??= elapsed() + wait;
				const copy = pendingCopy(sc);
				stage.wait(copy.title, copy.detail, elapsed() / Math.max(firstEta, elapsed() + wait));
				await sleep(wait * 1000, signal);
				log.add('out', `tools/call check_job { job_id: "${sc.jobId.slice(0, 10)}…" }`);
				result = await client.call('tools/call', { name: 'check_job', arguments: { job_id: sc.jobId } }, signal);
				sc = result?.structuredContent || {};
				if (result?.isError) throw new Error(sc.message || result?.content?.[0]?.text || 'The job failed.');
				log.add('in', brief(sc), sc.glbUrl || sc.glb_url ? 'ok' : undefined);
			}

			if (!(sc.glbUrl || sc.glb_url)) throw new Error('The studio answered without a model. Try again.');
			stage.model(sc, elapsed());
		} catch (err) {
			if (err?.name === 'AbortError') {
				log.add('in', 'stopped collecting; the job keeps running on the server');
				stage.empty();
			} else {
				log.add('in', err?.message || 'failed', 'error');
				const f = describeFailure(err);
				stage.error(f.title, f.detail);
			}
		} finally {
			controller = null;
			setBusy(false);
		}
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = prompt.value.trim() || prompt.placeholder;
		if (!controller) run(text);
	});
	prompt.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
	});
	stop.addEventListener('click', () => controller?.abort());
	$('gk-retry').addEventListener('click', () => form.requestSubmit());
	$('gk-embed').addEventListener('click', (e) => copyText(e.currentTarget.dataset.embed, e.currentTarget));
}

// ── live tool catalog ────────────────────────────────────────────────────

function firstSentence(text) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	const end = s.search(/[.!?](\s|$)/);
	return end > 0 ? s.slice(0, end + 1) : s;
}

async function loadTools() {
	const grid = $('gk-tools');
	const note = $('gk-tools-note');
	grid.setAttribute('aria-busy', 'true');
	note.hidden = true;
	try {
		const result = await createClient().call('tools/list', {});
		const tools = result?.tools || [];
		if (!tools.length) {
			grid.replaceChildren();
			note.hidden = false;
			note.removeAttribute('data-tone');
			note.textContent = 'The server listed no tools right now. Reload in a minute.';
			return;
		}
		grid.replaceChildren(
			...tools.map((t) => {
				const card = document.createElement('div');
				card.className = 'gk-tool';
				const name = document.createElement('code');
				name.textContent = t.name;
				const desc = document.createElement('p');
				desc.textContent = firstSentence(t.description);
				card.append(name, desc);
				return card;
			}),
		);
		note.hidden = false;
		note.removeAttribute('data-tone');
		note.textContent = `${tools.length} tools, all free. Grok picks the right one from your request.`;
	} catch (err) {
		grid.replaceChildren();
		note.hidden = false;
		note.dataset.tone = 'error';
		note.textContent = `Could not load the tool list (${err?.message || 'network error'}). `;
		const retry = document.createElement('button');
		retry.type = 'button';
		retry.textContent = 'Try again';
		retry.addEventListener('click', loadTools, { once: true });
		note.append(retry);
	} finally {
		grid.setAttribute('aria-busy', 'false');
	}
}

// ── live strip of real creations ─────────────────────────────────────────

const STRIP_COUNT = 6;

function posterFor(item) {
	const glb = item.web_glb_url || item.glb_url;
	return `/api/render/glb?glbUrl=${encodeURIComponent(glb)}`;
}

async function loadStrip() {
	const strip = $('gk-strip');
	const note = $('gk-strip-note');
	strip.setAttribute('aria-busy', 'true');
	note.hidden = true;
	try {
		const res = await fetch(`/api/forge-gallery?limit=${STRIP_COUNT}`);
		if (!res.ok) throw new Error(`gallery answered ${res.status}`);
		const data = await res.json();
		// The store is switched off on this deployment: there is no gallery to show,
		// so the section goes rather than claiming nobody made anything.
		if (data?.enabled === false) {
			strip.closest('section').hidden = true;
			return;
		}
		const items = (data?.creations || []).filter((c) => c.id && (c.web_glb_url || c.glb_url));
		if (!items.length) {
			strip.replaceChildren();
			note.hidden = false;
			note.removeAttribute('data-tone');
			note.textContent = 'Nothing has been generated in a while. Be the first: try the demo above.';
			return;
		}
		strip.replaceChildren(
			...items.map((item) => {
				const a = document.createElement('a');
				a.className = 'gk-made';
				a.href = `/m/${encodeURIComponent(item.id)}`;
				const img = document.createElement('img');
				img.loading = 'lazy';
				img.decoding = 'async';
				img.width = 240;
				img.height = 240;
				img.alt = item.prompt ? `3D model: ${item.prompt}` : 'A 3D model made on three.ws';
				img.src = posterFor(item);
				// The render endpoint draws the GLB itself; if it cannot, the concept
				// image the model was sculpted from is the next best picture of it.
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
		note.textContent = `Could not load recent models (${err?.message || 'network error'}). `;
		const retry = document.createElement('button');
		retry.type = 'button';
		retry.textContent = 'Try again';
		retry.addEventListener('click', loadStrip, { once: true });
		note.append(retry);
	} finally {
		strip.setAttribute('aria-busy', 'false');
	}
}

wireCopy();
wireTabs();
loadStrip();
startDemo();
loadTools();
