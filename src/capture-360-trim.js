// Trim timeline for the /capture 360 mode: in and out handles over a strip of
// thumbnails, a playhead, and a readout. Trim is only recorded here; the worker
// cuts the footage (contract C4 `trim`), so the file is never re-encoded in the
// browser.

import { moveHandle, nudgeStep, formatClock, MIN_TRIM_SECONDS } from './capture-360-core.js';

const THUMBS = 12;

/**
 * @param {HTMLElement} root
 * @param {{ duration: number, onChange?: (t: {start:number,end:number}) => void, onSeek?: (t: number) => void }} opts
 */
export function createTrimTimeline(root, { duration, onChange = () => {}, onSeek = () => {} }) {
	let dur = duration;
	let trim = { start: 0, end: duration };

	root.innerHTML = `
		<div class="c3-trim-track" data-track>
			<div class="c3-trim-thumbs" data-thumbs aria-hidden="true"></div>
			<div class="c3-trim-dim c3-trim-dim--l" data-dim-l></div>
			<div class="c3-trim-dim c3-trim-dim--r" data-dim-r></div>
			<div class="c3-trim-range" data-range></div>
			<div class="c3-trim-playhead" data-playhead></div>
			<button type="button" class="c3-trim-handle c3-trim-handle--start" data-which="start" role="slider" aria-label="Trim start"></button>
			<button type="button" class="c3-trim-handle c3-trim-handle--end" data-which="end" role="slider" aria-label="Trim end"></button>
		</div>
		<div class="c3-trim-readout" aria-live="polite">
			<span>In <strong data-in></strong></span>
			<span>Out <strong data-out></strong></span>
			<span>Keeping <strong data-keep></strong></span>
			<button type="button" class="c3-link" data-reset>Reset</button>
		</div>
		<p class="c3-trim-help">Arrow keys nudge a handle by a tenth of a second. Shift moves a full second, Page Up and Page Down ten.</p>
	`;

	const q = (s) => root.querySelector(s);
	const track = q('[data-track]');
	const handles = { start: q('[data-which="start"]'), end: q('[data-which="end"]') };
	const pct = (t) => (dur > 0 ? (t / dur) * 100 : 0);

	for (let i = 0; i < THUMBS; i++) {
		const slot = document.createElement('div');
		slot.className = 'c3-trim-thumb';
		q('[data-thumbs]').appendChild(slot);
	}

	function render() {
		const a = pct(trim.start);
		const b = pct(trim.end);
		q('[data-dim-l]').style.width = `${a}%`;
		q('[data-dim-r]').style.width = `${100 - b}%`;
		const range = q('[data-range]');
		range.style.left = `${a}%`;
		range.style.width = `${b - a}%`;
		handles.start.style.left = `${a}%`;
		handles.end.style.left = `${b}%`;
		for (const which of ['start', 'end']) {
			const h = handles[which];
			const value = trim[which];
			const lo = which === 'start' ? 0 : trim.start + MIN_TRIM_SECONDS;
			const hi = which === 'start' ? trim.end - MIN_TRIM_SECONDS : dur;
			h.setAttribute('aria-valuemin', lo.toFixed(2));
			h.setAttribute('aria-valuemax', Math.max(lo, hi).toFixed(2));
			h.setAttribute('aria-valuenow', value.toFixed(2));
			h.setAttribute('aria-valuetext', `${formatClock(value)} of ${formatClock(dur)}`);
		}
		q('[data-in]').textContent = formatClock(trim.start);
		q('[data-out]').textContent = formatClock(trim.end);
		q('[data-keep]').textContent = formatClock(trim.end - trim.start);
		q('[data-reset]').hidden = trim.start === 0 && trim.end === dur;
	}

	function set(next, seekTo) {
		if (next.start === trim.start && next.end === trim.end) return;
		trim = next;
		render();
		onChange({ ...trim });
		if (seekTo != null) onSeek(seekTo);
	}

	const timeAt = (clientX) => {
		const r = track.getBoundingClientRect();
		return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
	};

	for (const which of ['start', 'end']) {
		const h = handles[which];
		h.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			h.setPointerCapture(e.pointerId);
			h.classList.add('is-dragging');
		});
		h.addEventListener('pointermove', (e) => {
			if (!h.hasPointerCapture(e.pointerId)) return;
			const t = timeAt(e.clientX);
			const next = moveHandle({ ...trim, duration: dur }, which, t);
			set({ start: next.start, end: next.end }, which === 'start' ? next.start : Math.max(0, next.end - 1));
		});
		const release = (e) => {
			if (h.hasPointerCapture(e.pointerId)) h.releasePointerCapture(e.pointerId);
			h.classList.remove('is-dragging');
		};
		h.addEventListener('pointerup', release);
		h.addEventListener('pointercancel', release);
		h.addEventListener('keydown', (e) => {
			let target = null;
			if (e.key === 'Home') target = which === 'start' ? 0 : trim.start + MIN_TRIM_SECONDS;
			else if (e.key === 'End') target = which === 'start' ? trim.end - MIN_TRIM_SECONDS : dur;
			else {
				const step = nudgeStep(e.key, e.shiftKey);
				if (step) target = trim[which] + step;
			}
			if (target == null) return;
			e.preventDefault();
			const next = moveHandle({ ...trim, duration: dur }, which, target);
			set({ start: next.start, end: next.end }, which === 'start' ? next.start : Math.max(0, next.end - 1));
		});
	}

	track.addEventListener('pointerdown', (e) => {
		if (e.target.closest('.c3-trim-handle')) return;
		onSeek(timeAt(e.clientX));
	});
	q('[data-reset]').addEventListener('click', () => set({ start: 0, end: dur }, 0));

	render();

	return {
		get trim() { return { ...trim, duration: dur }; },
		setThumb(i, canvas) {
			const slot = q('[data-thumbs]').children[i];
			if (!slot) return;
			slot.replaceChildren(canvas);
			slot.classList.add('is-loaded');
		},
		setPlayhead(t) {
			q('[data-playhead]').style.left = `${pct(Math.min(dur, Math.max(0, t)))}%`;
		},
		setDuration(d) {
			dur = d;
			trim = { start: 0, end: d };
			render();
		},
		destroy() {
			root.innerHTML = '';
		},
	};
}
