// "Make a clip": one dialog that turns an avatar plus a line of text (or a
// recording) into a shareable MP4, voiced by NVIDIA Magpie and animated by
// NVIDIA Audio2Face-3D. Mounted from the entity page (src/avatar-page.js,
// agents and avatars) and the Avatar Studio (src/avatar-studio.js), both of
// which call openClipDialog with the avatar's name and GLB URL.
//
// Server: /api/clips/voice (voice + face, quota and duration cap).
// Browser: src/clip/clip-renderer.js (offline frame-stepped render, WebCodecs
// encode, MP4 mux). A finished voice/face result is cached for the session, so
// exporting the same line in the other aspect ratio costs no quota.

import './clip-dialog.css';
import { ASPECTS, FRAMINGS, clipFileName, floatToPcm16 } from './clip-math.js';

const COLOR_SWATCHES = [
	{ id: 'green', label: 'Chroma green', value: '#00b140' },
	{ id: 'studio', label: 'Studio slate', value: '#252a33' },
	{ id: 'white', label: 'Paper white', value: '#f4f4f5' },
	{ id: 'violet', label: 'Violet', value: '#4c1d95' },
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const STAGE_LABELS = {
	voice: 'Voicing with NVIDIA Magpie and animating with NVIDIA Audio2Face-3D',
	audio: 'Preparing the soundtrack',
	avatar: 'Loading the avatar',
	frames: 'Rendering frames',
	finalize: 'Writing the MP4',
};

let open = null;
const voiceCache = new Map();
const loadRenderer = () => import('./clip-renderer.js');

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtBytes(n) {
	return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtReset(iso) {
	if (!iso) return 'tomorrow';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? 'tomorrow' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function b64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

function bytesToB64(bytes) {
	let bin = '';
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
	return btoa(bin);
}

async function fetchLimits() {
	const r = await fetch('/api/clips/voice', { credentials: 'include', signal: AbortSignal.timeout(10_000) });
	if (!r.ok) throw new Error(`limits ${r.status}`);
	return r.json();
}

class ClipApiError extends Error {
	constructor(status, body) {
		super(body?.error_description || `Request failed (${status})`);
		this.status = status;
		this.code = body?.code === 'clip_quota' ? 'clip_quota' : body?.error || 'error';
		this.body = body || {};
	}
}

async function requestVoice(payload, signal) {
	const r = await fetch('/api/clips/voice', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal,
	});
	const body = await r.json().catch(() => null);
	if (!r.ok || !body?.ok) throw new ClipApiError(r.status, body);
	return body;
}

/**
 * Open the clip dialog for an avatar.
 * @param {{ name:string, glbUrl:string, defaultText?:string }} opts
 */
export function openClipDialog({ name, glbUrl, defaultText = '' }) {
	if (!glbUrl) return;
	if (open) open.close();

	const state = {
		limits: null,
		source: 'text',
		text: defaultText || `Hi, I'm ${name}. Come say hello on three.ws.`,
		voice: 'nova',
		recording: null, // { buffer: AudioBuffer, fileName, seconds }
		aspect: 'portrait',
		framing: 'bust',
		bgType: 'scene',
		bgColor: COLOR_SWATCHES[0].value,
		bgImage: null, // ImageBitmap
		bgImageName: '',
		captions: true,
		mark: true,
		quota: null,
		result: null,
		resultUrl: null,
		abort: null,
		lastFocus: document.activeElement,
	};

	const dlg = document.createElement('dialog');
	dlg.className = 'clip-dlg';
	dlg.setAttribute('aria-labelledby', 'clip-dlg-title');
	dlg.innerHTML = `
		<div class="clip-dlg-head">
			<div>
				<h2 id="clip-dlg-title">Make a clip</h2>
				<p class="clip-dlg-sub">${esc(name)} says your line. Voice by NVIDIA Magpie, face by NVIDIA Audio2Face-3D, rendered frame by frame in your browser.</p>
			</div>
			<button type="button" class="clip-x" data-act="close" aria-label="Close">&times;</button>
		</div>
		<div class="clip-dlg-body" data-slot="body"></div>`;
	document.body.appendChild(dlg);
	const body = dlg.querySelector('[data-slot="body"]');

	const close = () => {
		state.abort?.abort();
		if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
		state.bgImage?.close?.();
		dlg.close();
		dlg.remove();
		open = null;
		state.lastFocus?.focus?.();
	};
	open = { close };
	dlg.addEventListener('cancel', (e) => {
		e.preventDefault();
		close();
	});
	dlg.addEventListener('click', (e) => {
		if (e.target === dlg) close();
		if (e.target.closest('[data-act="close"]')) close();
	});
	dlg.showModal();

	// ── Views ────────────────────────────────────────────────────────────────
	const renderSkeleton = () => {
		body.innerHTML = `
			<div class="clip-skel" aria-busy="true" aria-label="Loading clip options">
				<div class="clip-skel-bar w60"></div>
				<div class="clip-skel-box"></div>
				<div class="clip-skel-row"><div class="clip-skel-bar"></div><div class="clip-skel-bar"></div></div>
				<div class="clip-skel-row"><div class="clip-skel-bar"></div><div class="clip-skel-bar"></div><div class="clip-skel-bar"></div></div>
			</div>`;
	};

	const renderMessage = ({ tone = 'error', title, text, actions = [] }) => {
		body.innerHTML = `
			<div class="clip-msg clip-msg-${tone}" role="${tone === 'error' ? 'alert' : 'status'}">
				<h3>${esc(title)}</h3>
				<p>${text}</p>
				<div class="clip-actions">${actions.map((a) => `<${a.href ? `a href="${esc(a.href)}"` : 'button type="button"'} class="clip-btn ${a.primary ? 'clip-btn-primary' : ''}" data-msg-act="${esc(a.id)}">${esc(a.label)}</${a.href ? 'a' : 'button'}>`).join('')}</div>
			</div>`;
		body.querySelectorAll('[data-msg-act]').forEach((el) => {
			const a = actions.find((x) => x.id === el.dataset.msgAct);
			if (a?.onClick) el.addEventListener('click', a.onClick);
		});
		body.querySelector('.clip-btn')?.focus();
	};

	const seg = (group, options, current) => `
		<div class="clip-seg" role="radiogroup" aria-label="${esc(group)}">
			${options.map((o) => `<button type="button" role="radio" aria-checked="${o.id === current}" class="clip-seg-btn" data-${esc(group.toLowerCase())}="${esc(o.id)}">${esc(o.label)}</button>`).join('')}
		</div>`;

	const renderForm = (notice = '') => {
		const L = state.limits;
		const voices = (L.voices || []).map((v) => `<option value="${esc(v.id)}"${v.id === state.voice ? ' selected' : ''}>${esc(v.name)}: ${esc(v.description)}</option>`).join('');
		const quotaLine = state.quota
			? `${state.quota.remaining} of ${state.quota.perDay} clips left today`
			: `${L.perDay} clips a day on ${L.signedIn ? `the ${esc(L.plan)} plan` : 'a visitor pass'}`;
		body.innerHTML = `
			${notice ? `<div class="clip-notice" role="alert">${notice}</div>` : ''}
			<form class="clip-form" novalidate>
				<fieldset class="clip-field">
					<legend>What should ${esc(name)} say?</legend>
					${seg('Source', [{ id: 'text', label: 'Type a line' }, { id: 'recording', label: 'Use a recording' }], state.source)}
					<div class="clip-src" data-src="text"${state.source === 'text' ? '' : ' hidden'}>
						<textarea class="clip-text" rows="3" maxlength="${L.maxChars}" aria-label="Line to speak" placeholder="Type what the avatar should say">${esc(state.text)}</textarea>
						<div class="clip-row-between">
							<label class="clip-inline">Voice
								<select class="clip-voice">${voices}</select>
							</label>
							<span class="clip-count" aria-live="polite"></span>
						</div>
					</div>
					<div class="clip-src" data-src="recording"${state.source === 'recording' ? '' : ' hidden'}>
						<label class="clip-drop">
							<input type="file" class="clip-file" accept="audio/*" />
							<span class="clip-drop-text">${state.recording ? `${esc(state.recording.fileName)} (${state.recording.seconds.toFixed(1)}s)` : `Choose an audio file (WAV, MP3, M4A), up to ${L.maxSeconds}s`}</span>
						</label>
						<p class="clip-hint">Audio2Face-3D animates the face from your own voice. Captions need typed text, so they are off for recordings.</p>
					</div>
				</fieldset>
				<div class="clip-grid">
					<fieldset class="clip-field"><legend>Format</legend>${seg('Aspect', Object.values(ASPECTS), state.aspect)}</fieldset>
					<fieldset class="clip-field"><legend>Framing</legend>${seg('Framing', Object.values(FRAMINGS), state.framing)}</fieldset>
				</div>
				<fieldset class="clip-field">
					<legend>Background</legend>
					${seg('Background', [{ id: 'scene', label: 'Studio scene' }, { id: 'color', label: 'Solid colour' }, { id: 'image', label: 'Your image' }], state.bgType)}
					<div class="clip-bg-opts" data-bg="color"${state.bgType === 'color' ? '' : ' hidden'}>
						${COLOR_SWATCHES.map((c) => `<button type="button" class="clip-swatch" style="--sw:${c.value}" aria-label="${esc(c.label)}" aria-pressed="${c.value === state.bgColor}" data-color="${c.value}"></button>`).join('')}
						<label class="clip-inline">Custom <input type="color" class="clip-color" value="${esc(state.bgColor)}" /></label>
					</div>
					<div class="clip-bg-opts" data-bg="image"${state.bgType === 'image' ? '' : ' hidden'}>
						<label class="clip-drop clip-drop-sm">
							<input type="file" class="clip-bgfile" accept="image/*" />
							<span>${state.bgImageName ? esc(state.bgImageName) : 'Choose a background image'}</span>
						</label>
					</div>
				</fieldset>
				<div class="clip-toggles">
					<label class="clip-toggle"><input type="checkbox" class="clip-captions"${state.captions && state.source === 'text' ? ' checked' : ''}${state.source === 'text' ? '' : ' disabled'} /> Burn in captions</label>
					<label class="clip-toggle"><input type="checkbox" class="clip-mark"${state.mark ? ' checked' : ''} /> three.ws mark</label>
				</div>
				<div class="clip-foot">
					<span class="clip-quota">${quotaLine}. Up to ${L.maxSeconds}s per clip.${L.signedIn ? '' : ' <a href="/login?next=' + encodeURIComponent(location.pathname) + '">Sign in</a> for more.'}</span>
					<button type="submit" class="clip-btn clip-btn-primary clip-go">Make clip</button>
				</div>
			</form>`;
		wireForm();
	};

	const wireForm = () => {
		const form = body.querySelector('form');
		const text = form.querySelector('.clip-text');
		const count = form.querySelector('.clip-count');
		const go = form.querySelector('.clip-go');
		const updateCount = () => {
			const n = text.value.trim().length;
			count.textContent = `${n} / ${state.limits.maxChars}`;
			count.classList.toggle('clip-count-warn', n > state.limits.maxChars * 0.9);
			go.disabled = state.source === 'text' ? n === 0 : !state.recording;
		};
		text.addEventListener('input', () => {
			state.text = text.value;
			updateCount();
		});
		form.querySelector('.clip-voice').addEventListener('change', (e) => (state.voice = e.target.value));
		form.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => {
			state.source = b.dataset.source;
			renderForm();
		}));
		form.querySelectorAll('[data-aspect]').forEach((b) => b.addEventListener('click', () => {
			state.aspect = b.dataset.aspect;
			renderForm();
		}));
		form.querySelectorAll('[data-framing]').forEach((b) => b.addEventListener('click', () => {
			state.framing = b.dataset.framing;
			renderForm();
		}));
		form.querySelectorAll('[data-background]').forEach((b) => b.addEventListener('click', () => {
			state.bgType = b.dataset.background;
			renderForm();
		}));
		form.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
			state.bgColor = b.dataset.color;
			renderForm();
		}));
		form.querySelector('.clip-color').addEventListener('change', (e) => {
			state.bgColor = e.target.value;
			renderForm();
		});
		form.querySelector('.clip-captions').addEventListener('change', (e) => (state.captions = e.target.checked));
		form.querySelector('.clip-mark').addEventListener('change', (e) => (state.mark = e.target.checked));
		form.querySelector('.clip-file').addEventListener('change', async (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			if (file.size > MAX_UPLOAD_BYTES) return renderForm('That file is larger than 25 MB. Trim it to the line you want animated.');
			try {
				const { decodeAudio } = await loadRenderer();
				const buffer = await decodeAudio(await file.arrayBuffer());
				if (buffer.duration > state.limits.maxSeconds) {
					return renderForm(`That recording is ${buffer.duration.toFixed(1)}s. Your plan allows clips up to ${state.limits.maxSeconds}s.`);
				}
				state.recording = { buffer, fileName: file.name, seconds: buffer.duration };
				renderForm();
			} catch (err) {
				renderForm(esc(err.message));
			}
		});
		form.querySelector('.clip-bgfile').addEventListener('change', async (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			try {
				state.bgImage?.close?.();
				state.bgImage = await createImageBitmap(file);
				state.bgImageName = file.name;
				renderForm();
			} catch {
				renderForm('That image could not be read. Try a PNG or JPEG.');
			}
		});
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (state.bgType === 'image' && !state.bgImage) return renderForm('Choose a background image first, or pick another background.');
			make();
		});
		updateCount();
		if (state.source === 'text') text.focus();
	};

	const renderProgress = (p) => {
		let bar = body.querySelector('.clip-progress');
		if (!bar) {
			body.innerHTML = `
				<div class="clip-progress" role="status" aria-live="polite">
					<div class="clip-stage"></div>
					<div class="clip-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="clip-fill"></div></div>
					<div class="clip-detail"></div>
					<button type="button" class="clip-btn clip-cancel">Cancel</button>
				</div>`;
			body.querySelector('.clip-cancel').addEventListener('click', () => state.abort?.abort());
			bar = body.querySelector('.clip-progress');
		}
		const track = bar.querySelector('.clip-track');
		const fill = bar.querySelector('.clip-fill');
		bar.querySelector('.clip-stage').textContent = STAGE_LABELS[p.stage] || 'Working';
		if (p.stage === 'frames' && p.total) {
			const pct = Math.round((p.done / p.total) * 100);
			track.classList.remove('clip-indeterminate');
			track.setAttribute('aria-valuenow', String(pct));
			fill.style.transform = `scaleX(${p.done / p.total})`;
			bar.querySelector('.clip-detail').textContent = `Frame ${p.done} of ${p.total}`;
		} else {
			track.classList.add('clip-indeterminate');
			track.removeAttribute('aria-valuenow');
			fill.style.transform = '';
			bar.querySelector('.clip-detail').textContent = p.stage === 'voice' ? 'This takes a few seconds per sentence.' : '';
		}
	};

	const renderResult = () => {
		const r = state.result;
		const other = state.aspect === 'portrait' ? 'landscape' : 'portrait';
		const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([r.blob], 'clip.mp4', { type: r.mimeType })] });
		body.innerHTML = `
			<div class="clip-result">
				<video class="clip-video clip-video-${state.aspect}" src="${state.resultUrl}" controls playsinline autoplay></video>
				<div class="clip-meta">
					<span>${r.width} x ${r.height}</span><span>${r.durationSec.toFixed(1)}s at ${r.fps} fps</span><span>${fmtBytes(r.blob.size)}</span><span>${esc(r.videoCodec.toUpperCase())} + ${esc(r.audioCodec.toUpperCase())}</span>
				</div>
				${r.faceCoverage === 0 ? `<p class="clip-notice">${r.jawFallback ? 'This avatar has no face shapes, so Audio2Face-3D drives its jaw bone instead of full lip shapes.' : 'This avatar has no face shapes or jaw bone, so its lips cannot move. Try an avatar with ARKit, VRM or viseme blendshapes.'}</p>` : ''}
				<div class="clip-actions">
					<a class="clip-btn clip-btn-primary" href="${state.resultUrl}" download="${esc(clipFileName(name, state.aspect))}">Download MP4</a>
					${canShare ? '<button type="button" class="clip-btn" data-r="share">Share</button>' : ''}
					<button type="button" class="clip-btn" data-r="other">Also make ${esc(ASPECTS[other].label)}</button>
					<button type="button" class="clip-btn" data-r="again">Make another</button>
				</div>
				${state.quota ? `<p class="clip-quota">${state.quota.remaining} of ${state.quota.perDay} clips left today. Re-exporting this line in another format is free.</p>` : ''}
			</div>`;
		body.querySelector('[data-r="share"]')?.addEventListener('click', async () => {
			try {
				await navigator.share({
					files: [new File([r.blob], clipFileName(name, state.aspect), { type: r.mimeType })],
					title: `${name} on three.ws`,
					text: state.source === 'text' ? state.text : `${name} on three.ws`,
				});
			} catch (err) {
				if (err?.name !== 'AbortError') renderResult();
			}
		});
		body.querySelector('[data-r="other"]').addEventListener('click', () => {
			state.aspect = other;
			make();
		});
		body.querySelector('[data-r="again"]').addEventListener('click', () => renderForm());
	};

	// ── Flow ─────────────────────────────────────────────────────────────────
	const voiceKey = () => (state.source === 'text' ? `t|${state.voice}|${state.text.trim()}` : `r|${state.recording.fileName}|${state.recording.seconds}`);

	const getVoice = async (signal) => {
		const key = voiceKey();
		if (voiceCache.has(key)) return voiceCache.get(key);
		const { decodeAudio, toMono } = await loadRenderer();
		let speech;
		let resp;
		if (state.source === 'text') {
			resp = await requestVoice({ text: state.text.trim(), voice: state.voice }, signal);
			speech = await decodeAudio(b64ToBytes(resp.audio.base64));
		} else {
			speech = state.recording.buffer;
			const pcm16k = await toMono(speech, 16000);
			resp = await requestVoice({ audio: bytesToB64(floatToPcm16(pcm16k)), sampleRate: 16000 }, signal);
		}
		const entry = { speech, track: resp.animation, quota: resp.quota };
		voiceCache.set(key, entry);
		return entry;
	};

	const make = async () => {
		state.abort = new AbortController();
		const { signal } = state.abort;
		try {
			const key = voiceKey();
			if (!voiceCache.has(key)) renderProgress({ stage: 'voice' });
			const v = await getVoice(signal);
			if (v.quota) state.quota = v.quota;
			const { renderClip } = await loadRenderer();
			const result = await renderClip({
				glbUrl,
				speech: v.speech,
				track: v.track,
				aspect: state.aspect,
				framing: state.framing,
				background: { type: state.bgType, color: state.bgColor, image: state.bgImage },
				captionText: state.source === 'text' && state.captions ? state.text.trim() : null,
				mark: state.mark,
				onProgress: renderProgress,
				signal,
			});
			if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
			state.result = result;
			state.resultUrl = URL.createObjectURL(result.blob);
			renderResult();
		} catch (err) {
			handleError(err);
		} finally {
			state.abort = null;
		}
	};

	const handleError = (err) => {
		if (err?.name === 'AbortError' || err?.code === 'aborted') return renderForm('Cancelled. Nothing was saved.');
		if (err instanceof ClipApiError) {
			if (err.body?.quota) state.quota = err.body.quota;
			if (err.code === 'clip_quota') {
				return renderMessage({
					tone: 'warn',
					title: 'Daily clip limit reached',
					text: `${esc(err.message)} Your allowance refills ${esc(fmtReset(err.body.quota?.resetAt))}. Clips you already made can still be re-exported in either format.`,
					actions: state.limits.signedIn
						? [{ id: 'back', label: 'Back', onClick: () => renderForm() }]
						: [{ id: 'login', label: 'Sign in for more', primary: true, href: `/login?next=${encodeURIComponent(location.pathname)}` }, { id: 'back', label: 'Back', onClick: () => renderForm() }],
				});
			}
			if (err.code === 'too_long' || err.code === 'too_short' || err.code === 'bad_request' || err.code === 'payload_too_large') return renderForm(esc(err.message));
			const which = err.body?.stage === 'voice' ? 'NVIDIA Magpie (voice)' : err.body?.stage === 'face' ? 'NVIDIA Audio2Face-3D (face)' : 'The clip service';
			return renderMessage({
				title: `${which} is not answering`,
				text: `${esc(err.message)} This is usually brief. Try again in a minute.`,
				actions: [{ id: 'retry', label: 'Try again', primary: true, onClick: () => make() }, { id: 'back', label: 'Edit line', onClick: () => renderForm() }],
			});
		}
		if (err?.code === 'unsupported') return renderUnsupported(err.message);
		return renderMessage({
			title: 'The clip could not be rendered',
			text: `${esc(err?.message || 'Unknown error')}. Your voice track is kept, so trying again does not use another clip.`,
			actions: [{ id: 'retry', label: 'Try again', primary: true, onClick: () => make() }, { id: 'back', label: 'Back', onClick: () => renderForm() }],
		});
	};

	const renderUnsupported = (reason) => {
		const why = reason === 'webcodecs'
			? 'This browser does not have WebCodecs, the video encoder clips are made with.'
			: reason === 'video-codec'
				? 'This browser cannot encode H.264, HEVC, VP9 or AV1 video at clip resolution.'
				: 'This browser cannot encode AAC or Opus audio.';
		renderMessage({
			tone: 'warn',
			title: 'This browser cannot make clips',
			text: `${why} Clips render on your device, so open this page in a current Chrome, Edge, Firefox or Safari (version 26 or later) on desktop or Android.`,
			actions: [{ id: 'close', label: 'Close', onClick: close }],
		});
	};

	// ── Boot ─────────────────────────────────────────────────────────────────
	renderSkeleton();
	(async () => {
		try {
			const [limits, { clipSupport }] = await Promise.all([fetchLimits(), loadRenderer()]);
			state.limits = limits;
			state.voice = limits.defaultVoice || 'nova';
			if (!limits.configured) {
				return renderMessage({
					title: 'Clips are unavailable right now',
					text: 'The NVIDIA voice and face service is not configured on this server. Try again later.',
					actions: [{ id: 'close', label: 'Close', onClick: close }],
				});
			}
			const support = await clipSupport();
			if (!support.ok) return renderUnsupported(support.reason);
			renderForm();
		} catch {
			renderMessage({
				title: 'Could not load clip options',
				text: 'Check your connection and try again.',
				actions: [{ id: 'retry', label: 'Try again', primary: true, onClick: () => { close(); openClipDialog({ name, glbUrl, defaultText }); } }],
			});
		}
	})();
}
