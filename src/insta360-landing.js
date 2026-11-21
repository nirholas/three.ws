// insta360-landing.js: the "Check your file" tool on /insta360.
//
// A visitor drops or picks one file. We read its name, pixel size and (for
// video) duration locally with the browser's own decoders, then show which
// 360 lane fits it and why. The file never leaves the device: no fetch, no
// upload, and every object URL is revoked once its metadata is read.

import { assessFile, kindOf } from './insta360-file-check.js';

const $ = (id) => document.getElementById(id);

function readImageSize(file) {
	if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('no decoder'));
	return createImageBitmap(file).then((bmp) => {
		const size = { width: bmp.width, height: bmp.height };
		bmp.close?.();
		return size;
	});
}

function readVideoMeta(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		let settled = false;
		const done = (fn, value) => {
			if (settled) return;
			settled = true;
			video.removeAttribute('src');
			video.load();
			URL.revokeObjectURL(url);
			fn(value);
		};
		video.preload = 'metadata';
		video.muted = true;
		video.addEventListener(
			'loadedmetadata',
			() =>
				done(resolve, {
					width: video.videoWidth,
					height: video.videoHeight,
					durationS: Number.isFinite(video.duration) ? video.duration : 0,
				}),
			{ once: true },
		);
		video.addEventListener('error', () => done(reject, new Error('undecodable')), { once: true });
		video.src = url;
	});
}

async function measure(file) {
	const kind = kindOf(file.name, file.type);
	const base = { name: file.name, mime: file.type };
	try {
		if (kind === 'image') return { ...base, ...(await readImageSize(file)) };
		if (kind === 'video') return { ...base, ...(await readVideoMeta(file)) };
	} catch {
		return { ...base, readError: true };
	}
	return base;
}

function formatBytes(n) {
	if (!(n > 0)) return '';
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i += 1;
	}
	return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

function renderLane(lane) {
	const link = el('a', 'i360-result-lane');
	link.href = lane.path;
	const title = el('span', 'i360-result-lane-title', lane.title);
	if (lane.status === 'rolling-out') title.append(' ', el('span', 'i360-badge', 'Rolling out'));
	link.append(title, el('span', 'i360-result-lane-action', `${lane.action} →`));
	return link;
}

function renderResult(file, result) {
	const out = $('i360-check-result');
	out.replaceChildren();
	out.dataset.verdict = result.verdict;

	const head = el('div', 'i360-result-head');
	head.append(el('p', 'i360-result-file', [file.name, formatBytes(file.size)].filter(Boolean).join(' · ')));
	head.append(el('h3', 'i360-result-title', result.title));
	out.append(head, el('p', 'i360-result-summary', result.summary));

	if (result.notes.length) {
		const list = el('ul', 'i360-result-notes');
		for (const note of result.notes) list.append(el('li', null, note));
		out.append(list);
	}
	if (result.lanes.length) {
		const lanes = el('div', 'i360-result-lanes');
		for (const lane of result.lanes) lanes.append(renderLane(lane));
		out.append(lanes);
	}
	out.hidden = false;
	$('i360-check-empty').hidden = true;
	$('i360-check-busy').hidden = true;
	$('i360-check-again').hidden = false;
}

async function check(file) {
	$('i360-check-empty').hidden = true;
	$('i360-check-result').hidden = true;
	$('i360-check-busy').hidden = false;
	$('i360-check-status').textContent = `Reading ${file.name}`;
	const measured = await measure(file);
	const result = assessFile(measured);
	renderResult(file, result);
	$('i360-check-status').textContent = `${result.title}. ${result.summary}`;
}

function reset() {
	$('i360-check-result').hidden = true;
	$('i360-check-busy').hidden = true;
	$('i360-check-empty').hidden = false;
	$('i360-check-again').hidden = true;
	$('i360-check-input').value = '';
	$('i360-check-status').textContent = '';
	$('i360-check-drop').focus();
}

function wire() {
	const drop = $('i360-check-drop');
	const input = $('i360-check-input');
	if (!drop || !input) return;

	drop.addEventListener('click', () => input.click());
	input.addEventListener('change', () => {
		const file = input.files?.[0];
		if (file) check(file);
	});
	$('i360-check-again').addEventListener('click', reset);

	const zone = $('i360-check');
	let depth = 0;
	zone.addEventListener('dragenter', (e) => {
		if (!e.dataTransfer?.types?.includes('Files')) return;
		e.preventDefault();
		depth += 1;
		zone.classList.add('is-dragover');
	});
	zone.addEventListener('dragover', (e) => {
		if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
	});
	zone.addEventListener('dragleave', () => {
		depth = Math.max(0, depth - 1);
		if (!depth) zone.classList.remove('is-dragover');
	});
	zone.addEventListener('drop', (e) => {
		e.preventDefault();
		depth = 0;
		zone.classList.remove('is-dragover');
		const file = e.dataTransfer?.files?.[0];
		if (file) check(file);
	});
}

wire();
