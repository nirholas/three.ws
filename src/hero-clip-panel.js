// "Make a hero clip": a short Grok Imagine Video clip of a 3D model, made from
// real renders of that model (docs/hero-clips.md). Mounted on the model page
// (src/model-page.js) and the forge result card (src/forge-hero-clip.js).
//
// Every state is driven by /api/v1/models/hero-clip:
//   loading     GET describe is in flight (skeleton)
//   signed-out  the describe answer says nobody is signed in
//   idle        preset cards, duration, the Make button
//   unavailable no xAI key on the service: the honest note, and the turntable
//               the repo's own encoder builds from real renders of the model
//   submitting  POST in flight: the server is rendering the first frame
//   generating  polling the signed job handle; the status text is the elapsed
//               time the server reports, never an invented percentage
//   done        the clip plays inline, with download, Share to X and its page
//   error       the server's reason, plus Retry when retrying can help
//
// A job handle is kept per model in localStorage, so leaving the page mid-render
// and coming back picks the same job up instead of paying for a second clip.

import { apiFetch } from './api.js';
import { xIntentUrl } from './shared/share-targets.js';
import './hero-clip.css';

const ENDPOINT = '/api/v1/models/hero-clip';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_FAST_MS = 4000;
const POLL_SLOW_MS = 8000;
const SLOW_AFTER_S = 60;
const MAX_POLL_FAILURES = 5;
const STORE_PREFIX = 'hero-clip:job:';

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function clock(seconds) {
	const s = Math.max(0, Math.floor(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function readStore(key) {
	try {
		const raw = localStorage.getItem(STORE_PREFIX + key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeStore(key, value) {
	try {
		if (value) localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
		else localStorage.removeItem(STORE_PREFIX + key);
	} catch {
		/* private mode: the job just will not survive a reload */
	}
}

async function readJson(res) {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

function failureFrom(res, body) {
	const message =
		body?.message ||
		body?.error_description ||
		(res?.status ? `The clip service answered ${res.status}. Try again.` : 'The clip service could not be reached. Check your connection and try again.');
	return {
		status: res?.status ?? 0,
		code: body?.error || 'network_error',
		message,
		retry: body?.retry ?? true,
		retryAfter: Number(body?.retry_after) || null,
	};
}

function loginHref() {
	return `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}

/**
 * Mount the hero clip panel into `host`.
 *
 * @param {HTMLElement} host
 * @param {object} source
 * @param {string} [source.modelId] a forge creation or avatar id
 * @param {string} [source.glbUrl] a public https GLB, when there is no id
 * @param {string} [source.title]
 * @param {string} [source.sourcePage] the page the clip links back to (/m/<id>)
 * @param {Record<string,string>} [source.headers] extra request headers (x-forge-client)
 * @returns {{ setSource(next: object): void, destroy(): void }}
 */
export function mountHeroClip(host, source) {
	const root = document.createElement('div');
	root.className = 'hc';
	root.setAttribute('aria-live', 'polite');
	host.replaceChildren(root);

	const s = {
		source: null,
		describe: null,
		preset: null,
		duration: null,
		tier: 'lite',
		job: null,
		elapsed: 0,
		elapsedAt: 0,
		pollTimer: 0,
		tickTimer: 0,
		pollFailures: 0,
		generation: 0,
	};

	function sourceKey() {
		return s.source?.modelId || s.source?.glbUrl || '';
	}

	function sourceBody() {
		if (s.source?.modelId) return { model_id: s.source.modelId };
		return { glb_url: s.source.glbUrl, title: s.source.title || '', source_page: s.source.sourcePage || '' };
	}

	function stopTimers() {
		clearTimeout(s.pollTimer);
		clearInterval(s.tickTimer);
		s.pollTimer = 0;
		s.tickTimer = 0;
	}

	function view(state, html) {
		root.dataset.state = state;
		root.innerHTML = html;
	}

	// ── states ─────────────────────────────────────────────────────────────

	function renderLoading() {
		view(
			'loading',
			`<div class="hc-skel" aria-hidden="true">
				<div class="hc-skel-line hc-skel-line--wide"></div>
				<div class="hc-skel-cards"><span></span><span></span><span></span><span></span></div>
				<div class="hc-skel-line"></div>
			</div>
			<p class="hc-sr">Loading hero clip options</p>`,
		);
	}

	function presetCards({ disabled = false } = {}) {
		const presets = s.describe?.presets || [];
		return `<fieldset class="hc-presets"${disabled ? ' disabled' : ''}>
			<legend class="hc-label">Style</legend>
			<div class="hc-preset-grid">
				${presets
					.map(
						(p) => `<label class="hc-preset">
							<input type="radio" name="hc-preset" value="${esc(p.id)}"${p.id === s.preset ? ' checked' : ''}>
							<span class="hc-preset-card">
								<span class="hc-preset-name">${esc(p.label)}${p.loop ? ' <em class="hc-badge">loops</em>' : ''}</span>
								<span class="hc-preset-desc">${esc(p.description)}</span>
							</span>
						</label>`,
					)
					.join('')}
			</div>
		</fieldset>`;
	}

	function durationControl({ disabled = false } = {}) {
		const durations = s.describe?.durations || [];
		return `<fieldset class="hc-durations"${disabled ? ' disabled' : ''}>
			<legend class="hc-label">Length</legend>
			<div class="hc-seg">
				${durations
					.map(
						(d) => `<label>
							<input type="radio" name="hc-duration" value="${d}"${d === s.duration ? ' checked' : ''}>
							<span>${d} s</span>
						</label>`,
					)
					.join('')}
			</div>
		</fieldset>`;
	}

	function bindPicker() {
		root.querySelectorAll('input[name="hc-preset"]').forEach((el) =>
			el.addEventListener('change', () => {
				s.preset = el.value;
			}),
		);
		root.querySelectorAll('input[name="hc-duration"]').forEach((el) =>
			el.addEventListener('change', () => {
				s.duration = Number(el.value);
			}),
		);
	}

	function renderSignedOut() {
		view(
			'signed-out',
			`<p class="hc-lede">Turn this model into a short video for a post or a profile. Every clip starts from real renders of the model itself.</p>
			${presetCards({ disabled: true })}
			<div class="hc-callout">
				<p><strong>Sign in to make a hero clip.</strong> A three.ws account is free.</p>
				<a class="hc-btn hc-btn--primary" href="${esc(loginHref())}">Sign in</a>
			</div>`,
		);
	}

	function renderIdle() {
		const d = s.describe;
		const available = Boolean(d?.available);
		const limit = d?.daily_cap;
		view(
			'idle',
			`<p class="hc-lede">Turn this model into a short video for a post or a profile. The first frame is a real render of this model, and the video model is told to keep it exactly as it is.</p>
			${available ? '' : `<div class="hc-callout hc-callout--muted" role="note">
				<p><strong>Hero clips are not available yet.</strong> Until they are, you can watch a turntable rendered from this model, frame by frame, on our own renderer.</p>
			</div>`}
			${presetCards({ disabled: !available })}
			${durationControl({ disabled: !available })}
			<div class="hc-actions">
				${available
					? `<button type="button" class="hc-btn hc-btn--primary" data-act="make">Make a hero clip</button>
						<span class="hc-hint">${limit ? `Up to ${esc(limit)} clips a day. ` : ''}Most clips finish in under two minutes.</span>`
					: `<button type="button" class="hc-btn hc-btn--primary" data-act="turntable">Show the turntable</button>`}
			</div>`,
		);
		bindPicker();
		root.querySelector('[data-act="make"]')?.addEventListener('click', submit);
		root.querySelector('[data-act="turntable"]')?.addEventListener('click', submit);
	}

	function renderSubmitting() {
		view(
			'submitting',
			`<div class="hc-stage">
				<div class="hc-frame hc-frame--loading" aria-hidden="true"></div>
				<p class="hc-status" role="status"><span class="hc-dot" aria-hidden="true"></span>Rendering this model for the first frame.</p>
			</div>`,
		);
	}

	function generatingStatus(elapsed) {
		if (elapsed < 20) return 'Sent to Grok Imagine Video. The first frame is a real render of this model.';
		if (elapsed < 120) return 'Grok Imagine Video is animating your model. Most clips finish in under two minutes.';
		return 'Still rendering. Busy periods can take a few minutes; this panel keeps checking.';
	}

	function renderGenerating() {
		const j = s.job;
		view(
			'generating',
			`<div class="hc-stage">
				<div class="hc-frame hc-frame--loading">
					${j?.poster ? `<img src="${esc(j.poster)}" alt="" decoding="async">` : ''}
				</div>
				<p class="hc-status" role="status"><span class="hc-dot" aria-hidden="true"></span><span data-el="status">${esc(generatingStatus(s.elapsed))}</span></p>
				<p class="hc-meta"><span data-el="clock">${clock(s.elapsed)}</span> elapsed. You can leave this page: the clip keeps rendering and this panel picks it up when you come back.</p>
			</div>`,
		);
		const img = root.querySelector('.hc-frame img');
		img?.addEventListener('error', () => img.remove());
		clearInterval(s.tickTimer);
		s.tickTimer = setInterval(() => {
			const now = s.elapsed + (Date.now() - s.elapsedAt) / 1000;
			const clockEl = root.querySelector('[data-el="clock"]');
			const statusEl = root.querySelector('[data-el="status"]');
			if (clockEl) clockEl.textContent = clock(now);
			if (statusEl) statusEl.textContent = generatingStatus(now);
		}, 1000);
	}

	function renderDone(d) {
		const shareHref = xIntentUrl({ text: d.share_text || 'A hero clip made from my 3D model on three.ws', url: d.share_url });
		view(
			'done',
			`<div class="hc-stage">
				<div class="hc-frame">
					<video src="${esc(d.clip_url)}"${d.poster ? ` poster="${esc(d.poster)}"` : ''} autoplay muted loop playsinline controls preload="metadata" aria-label="Hero clip of ${esc(s.source?.title || 'this model')}"></video>
				</div>
				<p class="hc-meta">${d.duration ? `${esc(d.duration)} second clip, ` : ''}made with Grok Imagine Video from real renders of this model.</p>
				<div class="hc-actions">
					<a class="hc-btn hc-btn--primary" href="${esc(shareHref)}" target="_blank" rel="noopener">Share to X</a>
					<a class="hc-btn" href="${esc(d.clip_url)}" download="hero-clip-${esc(d.request_id)}.mp4">Download MP4</a>
					<a class="hc-btn" href="${esc(d.page_url)}" target="_blank" rel="noopener">Open clip page</a>
					<button type="button" class="hc-btn hc-btn--ghost" data-act="again">Make another</button>
				</div>
			</div>`,
		);
		root.querySelector('[data-act="again"]').addEventListener('click', renderIdle);
	}

	function renderUnavailable(body) {
		const fb = body?.fallback;
		const title = body?.source?.title || s.source?.title || 'this model';
		view(
			'unavailable',
			`<div class="hc-callout hc-callout--muted" role="note">
				<p><strong>Hero clips are not available yet.</strong> ${esc(body?.message?.replace(/^Hero clips are not available yet\.\s*/, '') || 'The turntable below is built from real renders of your model.')}</p>
			</div>
			${fb?.turntable_url
				? `<figure class="hc-turntable">
					<div class="hc-frame hc-frame--square hc-frame--loading" data-el="tt">
						<img src="${esc(fb.turntable_url)}" alt="Turntable of ${esc(title)}, rendered from the model" decoding="async">
					</div>
					<figcaption class="hc-status" data-el="tt-status" role="status"><span class="hc-dot" aria-hidden="true"></span>Rendering 36 frames of the turntable from this model.</figcaption>
				</figure>`
				: ''}
			${fb?.refs?.length
				? `<p class="hc-label">The angles a clip starts from</p>
				<ul class="hc-strip">
					${fb.refs
						.map(
							(r) => `<li><img src="${esc(r.url)}" alt="${esc(title)} from ${esc(r.azimuth)} degrees" loading="lazy" decoding="async" width="96" height="96"></li>`,
						)
						.join('')}
				</ul>`
				: ''}
			<div class="hc-actions">
				${fb?.turntable_url ? `<a class="hc-btn" href="${esc(fb.turntable_url)}" target="_blank" rel="noopener">Open the turntable</a>` : ''}
				<button type="button" class="hc-btn hc-btn--ghost" data-act="back">Back</button>
			</div>`,
		);
		root.querySelector('[data-act="back"]').addEventListener('click', renderIdle);
		const frame = root.querySelector('[data-el="tt"]');
		const img = frame?.querySelector('img');
		const status = root.querySelector('[data-el="tt-status"]');
		img?.addEventListener('load', () => {
			frame.classList.remove('hc-frame--loading');
			status.textContent = 'Turntable rendered from this model by three.ws.';
			status.classList.add('hc-meta');
		});
		img?.addEventListener('error', () => {
			frame.classList.remove('hc-frame--loading');
			frame.classList.add('hc-frame--failed');
			status.innerHTML = 'The turntable could not be rendered right now. <button type="button" class="hc-link" data-act="tt-retry">Try again</button>';
			status.querySelector('[data-act="tt-retry"]').addEventListener('click', () => {
				frame.classList.remove('hc-frame--failed');
				frame.classList.add('hc-frame--loading');
				status.innerHTML = '<span class="hc-dot" aria-hidden="true"></span>Rendering 36 frames of the turntable from this model.';
				status.classList.remove('hc-meta');
				img.src = fb.turntable_url;
			});
		});
		root.querySelectorAll('.hc-strip img').forEach((el) => el.addEventListener('error', () => el.closest('li')?.remove()));
	}

	function renderError(f, { onRetry } = {}) {
		const wait = f.retryAfter ? ` You can try again in about ${clock(f.retryAfter)}.` : '';
		view(
			'error',
			`<div class="hc-callout hc-callout--error" role="alert">
				<p><strong>${esc(errorTitle(f))}</strong> ${esc(f.message)}${esc(wait)}</p>
			</div>
			<div class="hc-actions">
				${f.retry && onRetry ? '<button type="button" class="hc-btn hc-btn--primary" data-act="retry">Try again</button>' : ''}
				<button type="button" class="hc-btn${f.retry && onRetry ? ' hc-btn--ghost' : ''}" data-act="change">Change the style</button>
			</div>`,
		);
		root.querySelector('[data-act="retry"]')?.addEventListener('click', onRetry);
		root.querySelector('[data-act="change"]').addEventListener('click', () => (s.describe ? renderIdle() : start()));
	}

	function errorTitle(f) {
		if (f.status === 429) return 'Hold on a moment.';
		if (f.code === 'clip_refused') return 'This clip was declined.';
		if (f.code === 'render_failed') return 'This model could not be rendered.';
		if (f.code === 'network_error') return 'No connection to the clip service.';
		return 'The clip did not finish.';
	}

	function renderUnsupported() {
		view(
			'unsupported',
			`<div class="hc-callout hc-callout--muted" role="note">
				<p><strong>Save this model to make a hero clip.</strong> Clips are made from a model stored on three.ws, so a file opened only in this tab cannot be rendered yet.</p>
			</div>`,
		);
	}

	// ── network ────────────────────────────────────────────────────────────

	async function start() {
		const gen = ++s.generation;
		stopTimers();
		if (!s.source?.modelId && !s.source?.glbUrl) return renderUnsupported();
		renderLoading();
		let res;
		let body;
		try {
			res = await apiFetch(ENDPOINT, { allowAnonymous: true, headers: s.source.headers || {} });
			body = await readJson(res);
		} catch {
			if (gen !== s.generation) return;
			return renderError(failureFrom(null, null), { onRetry: start });
		}
		if (gen !== s.generation) return;
		if (!res.ok || !body?.data) return renderError(failureFrom(res, body), { onRetry: start });
		s.describe = body.data;
		s.preset ??= body.data.default_preset;
		s.duration ??= body.data.default_duration;
		s.tier = body.data.default_tier || 'lite';
		if (!body.data.signed_in) return renderSignedOut();
		const saved = readStore(sourceKey());
		if (saved?.poll_url) {
			s.job = saved;
			s.elapsed = (Date.now() - (saved.startedAt || Date.now())) / 1000;
			s.elapsedAt = Date.now();
			renderGenerating();
			return poll(gen);
		}
		renderIdle();
	}

	async function submit() {
		const gen = ++s.generation;
		stopTimers();
		renderSubmitting();
		let res;
		let body;
		try {
			res = await apiFetch(ENDPOINT, {
				method: 'POST',
				allowAnonymous: true,
				headers: { 'content-type': 'application/json', ...(s.source.headers || {}) },
				body: JSON.stringify({ ...sourceBody(), preset: s.preset, duration: s.duration, tier: s.tier }),
			});
			body = await readJson(res);
		} catch {
			if (gen !== s.generation) return;
			return renderError(failureFrom(null, null), { onRetry: submit });
		}
		if (gen !== s.generation) return;
		if (res.status === 401) {
			s.describe = { ...s.describe, signed_in: false };
			return renderSignedOut();
		}
		if (res.status === 503 && body?.error === 'clips_unavailable' && body?.available === false) {
			s.describe = { ...s.describe, available: false };
			return renderUnavailable(body);
		}
		if (res.status !== 202 || !body?.data?.poll_url) return renderError(failureFrom(res, body), { onRetry: submit });
		s.job = { job: body.data.job, poll_url: body.data.poll_url, poster: body.data.poster, preset: body.data.preset, startedAt: Date.now() };
		writeStore(sourceKey(), s.job);
		s.elapsed = 0;
		s.elapsedAt = Date.now();
		s.pollFailures = 0;
		renderGenerating();
		poll(gen);
	}

	function schedulePoll(gen) {
		const delay = s.elapsed > SLOW_AFTER_S ? POLL_SLOW_MS : POLL_FAST_MS;
		s.pollTimer = setTimeout(() => poll(gen), delay * (1 + s.pollFailures));
	}

	async function poll(gen) {
		if (gen !== s.generation || !s.job) return;
		let res;
		let body;
		try {
			res = await apiFetch(s.job.poll_url, { allowAnonymous: true, headers: s.source.headers || {} });
			body = await readJson(res);
		} catch {
			res = null;
		}
		if (gen !== s.generation) return;

		if (!res || body?.status === 'unknown') {
			// A dropped connection, a busy provider or a storage hiccup is not a
			// failed clip: the server marks those `unknown`, so back off and ask again.
			s.pollFailures += 1;
			if (s.pollFailures < MAX_POLL_FAILURES) return schedulePoll(gen);
			stopTimers();
			return renderError(failureFrom(res, body), { onRetry: resume });
		}
		s.pollFailures = 0;

		if (res.status === 401) {
			stopTimers();
			return renderSignedOut();
		}
		const data = body?.data;
		if (res.ok && data?.status === 'generating') {
			s.elapsed = Number(data.elapsed_s) || s.elapsed;
			s.elapsedAt = Date.now();
			if (data.poster && !s.job.poster) s.job.poster = data.poster;
			return schedulePoll(gen);
		}
		stopTimers();
		writeStore(sourceKey(), null);
		const finished = s.job;
		s.job = null;
		if (res.ok && data?.status === 'done') return renderDone(data);
		const failure = failureFrom(res, body);
		// A 404 here means the handle belongs to another session or account.
		if (res.status === 404) failure.message = 'This clip job is not on your account any more. Start a new one.';
		renderError(failure, {
			onRetry: () => {
				s.preset = finished?.preset || s.preset;
				submit();
			},
		});
	}

	function resume() {
		const saved = readStore(sourceKey());
		if (!saved) return start();
		const gen = ++s.generation;
		s.job = saved;
		s.pollFailures = 0;
		s.elapsed = (Date.now() - (saved.startedAt || Date.now())) / 1000;
		s.elapsedAt = Date.now();
		renderGenerating();
		poll(gen);
	}

	function setSource(next) {
		const modelId = typeof next?.modelId === 'string' && UUID_RE.test(next.modelId) ? next.modelId : null;
		const glbUrl = !modelId && typeof next?.glbUrl === 'string' && /^https:\/\//i.test(next.glbUrl) ? next.glbUrl : null;
		s.source = { modelId, glbUrl, title: next?.title || '', sourcePage: next?.sourcePage || '', headers: next?.headers || {} };
		s.job = null;
		start();
	}

	setSource(source);

	return {
		setSource,
		destroy() {
			s.generation += 1;
			stopTimers();
			root.remove();
		},
	};
}
