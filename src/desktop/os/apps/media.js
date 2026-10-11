// Media Player: audio and video from the virtual file system or the computer,
// a queue built from /Music and /Videos, a WebAudio visualizer for audio, and
// Media Session hardware-key support.
import './media.css';
import {
	mediaKind, titleFromName, formatTime, SPEEDS, clamp, buildOrder, nextIndex, prevIndex, buildLibrary, updateResume,
} from './playlist-logic.js';

const POS_KEY = 'tws:media:pos';
const PREF_KEY = 'tws:media:prefs';

export function mount(host, ctx) {
	const { h, esc, fs } = ctx;
	ctx.registerGlyph('m-shuffle', '<path d="M3 7h3c3 0 4 2 6 5s3 5 6 5h3M3 17h3c1.5 0 2.5-.6 3.4-1.6M14.6 8.6C15.5 7.6 16.5 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>');
	ctx.registerGlyph('m-repeat', '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/>');
	ctx.registerGlyph('m-mute', '<path d="M4 9h3.5L12 5v14l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/>');
	ctx.registerGlyph('m-pip', '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/>');

	let prefs = { volume: 0.8, muted: false, speed: 1, repeat: 'off', shuffle: false, list: true };
	try {
		prefs = { ...prefs, ...JSON.parse(ctx.store.get(PREF_KEY) || '{}') };
	} catch {
		/* defaults */
	}
	const savePrefs = () => ctx.store.set(PREF_KEY, JSON.stringify(prefs));
	let resume = {};
	try {
		resume = JSON.parse(ctx.store.get(POS_KEY) || '{}') || {};
	} catch {
		resume = {};
	}

	const root = h('div', 'md');
	root.tabIndex = 0;
	root.innerHTML = `
		<div class="md-body">
			<div class="md-stage" data-kind="none">
				<video class="md-video" playsinline preload="metadata"></video>
				<canvas class="md-vis"></canvas>
				<div class="md-empty">
					<div class="md-empty-ico">${ctx.icon('music', 40)}</div>
					<h3>Nothing playing</h3>
					<p>Add music or video to your Music and Videos folders in File Explorer (upload or drag files in), or use <b>Add</b> to play files from your computer. You can also drop files here.</p>
					<button class="md-btn pri" data-a="add">Add files</button>
				</div>
				<div class="md-drop">Drop to play</div>
			</div>
			<aside class="md-list" aria-label="Play queue"></aside>
		</div>
		<div class="md-bar">
			<div class="md-seekrow"><span class="md-t" data-t="cur">0:00</span><input class="md-seek" type="range" min="0" max="1000" value="0" aria-label="Seek" disabled><span class="md-t" data-t="dur">0:00</span></div>
			<div class="md-ctl">
				<div class="md-now"><b data-now="title">-</b><small data-now="sub"></small></div>
				<div class="md-main">
					<button class="md-ib" data-a="shuffle" title="Shuffle" aria-pressed="false">${ctx.icon('m-shuffle', 18)}</button>
					<button class="md-ib" data-a="prev" title="Previous (Shift+P)">${ctx.icon('prev', 20)}</button>
					<button class="md-ib md-play" data-a="play" title="Play (Space)">${ctx.icon('play', 22)}</button>
					<button class="md-ib" data-a="next" title="Next (Shift+N)">${ctx.icon('next', 20)}</button>
					<button class="md-ib" data-a="repeat" title="Repeat: off">${ctx.icon('m-repeat', 18)}<i class="md-one" hidden>1</i></button>
				</div>
				<div class="md-side">
					<select class="md-speed" aria-label="Playback speed">${SPEEDS.map((s) => `<option value="${s}">${s}x</option>`).join('')}</select>
					<button class="md-ib" data-a="mute" title="Mute (M)">${ctx.icon('volume', 18)}</button>
					<input class="md-vol" type="range" min="0" max="100" aria-label="Volume">
					<button class="md-ib" data-a="pip" title="Picture in picture" hidden>${ctx.icon('m-pip', 18)}</button>
					<button class="md-ib" data-a="fs" title="Fullscreen (F)">${ctx.icon('fullscreen', 18)}</button>
					<button class="md-ib" data-a="add" title="Add files">${ctx.icon('plus', 18)}</button>
					<button class="md-ib" data-a="list" title="Queue">${ctx.icon('list', 18)}</button>
				</div>
			</div>
		</div>
		<input type="file" accept="audio/*,video/*,.mp3,.wav,.ogg,.m4a,.flac,.mp4,.webm,.mov,.mkv" multiple hidden>`;
	host.append(root);
	const $ = (s) => root.querySelector(s);
	const stage = $('.md-stage');
	const video = $('.md-video');
	const vis = $('.md-vis');
	const listEl = $('.md-list');
	const seek = $('.md-seek');
	const vol = $('.md-vol');
	const fileIn = $('input[type=file]');
	const playBtn = $('[data-a=play]');

	let library = [];
	let extras = []; // opened by path from elsewhere, or picked from the computer
	let queue = [];
	let order = [];
	let cur = -1;
	let objUrl = null;
	let disposed = false;
	let seeking = false;
	let lastSave = 0;

	const setIcon = (btn, name, size) => {
		const old = btn.querySelector('svg');
		const tmp = h('span', null, ctx.icon(name, size));
		old ? old.replaceWith(tmp.firstElementChild) : btn.prepend(tmp.firstElementChild);
	};

	/* ---------------- queue ---------------- */
	function rebuildQueue() {
		const playing = queue[cur]?.id;
		queue = [...library, ...extras.filter((e) => !library.some((l) => l.path && l.path === e.path))];
		cur = playing ? queue.findIndex((q) => q.id === playing) : -1;
		order = buildOrder(queue.length, { shuffle: prefs.shuffle, current: cur });
		renderList();
	}
	async function loadLibrary() {
		try {
			const [m, v] = await Promise.all([fs.list('/Music'), fs.list('/Videos')]);
			library = buildLibrary([...m, ...v]);
		} catch {
			library = [];
		}
		if (!disposed) rebuildQueue();
	}
	function renderList() {
		const items = queue.map((q, i) => `
			<button class="md-item${i === cur ? ' on' : ''}" data-i="${i}">
				<span class="md-ii">${ctx.icon(q.kind === 'video' ? 'video' : 'music', 16)}</span>
				<span class="md-in"><b>${esc(titleFromName(q.name))}</b><small>${q.file ? 'From your computer' : esc(q.path.replace(/\/[^/]*$/, '') || '/')}</small></span>
				${resume[q.path] ? `<em title="Resumes at ${formatTime(resume[q.path])}">${formatTime(resume[q.path])}</em>` : ''}
			</button>`);
		listEl.innerHTML = `<div class="md-lh"><b>Queue</b><span>${queue.length}</span></div>${
			queue.length ? `<div class="md-items">${items.join('')}</div>` : '<p class="md-lempty">Your Music and Videos folders are empty. Upload files in File Explorer or press Add.</p>'
		}`;
	}
	listEl.addEventListener('click', (e) => {
		const b = e.target.closest('[data-i]');
		if (b) playIndex(+b.dataset.i);
	});

	/* ---------------- playback ---------------- */
	let audioCtx = null;
	let analyser = null;
	function ensureAudioGraph() {
		if (audioCtx) return;
		try {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			const src = audioCtx.createMediaElementSource(video);
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0.8;
			src.connect(analyser);
			analyser.connect(audioCtx.destination);
		} catch {
			audioCtx = null;
			analyser = null;
		}
	}

	async function blobFor(item) {
		if (item.file) return item.file;
		const f = await fs.read(item.path);
		if (!f) throw new Error(`${item.name} no longer exists`);
		return f.blob;
	}

	async function playIndex(i, { startAt } = {}) {
		const item = queue[i];
		if (!item) return;
		cur = i;
		if (prefs.shuffle) order = buildOrder(queue.length, { shuffle: true, current: i });
		renderList();
		stage.dataset.kind = item.kind;
		ctx.setTitle(`${titleFromName(item.name)} - Media Player`);
		try {
			const blob = await blobFor(item);
			if (disposed || queue[cur] !== item) return;
			const url = URL.createObjectURL(blob);
			const prev = objUrl;
			objUrl = url;
			video.src = url;
			if (prev) URL.revokeObjectURL(prev);
			const at = startAt ?? resume[item.path] ?? 0;
			video.addEventListener('loadedmetadata', () => {
				if (at && at < video.duration - 5) video.currentTime = at;
			}, { once: true });
			ensureAudioGraph();
			await audioCtx?.resume?.();
			await video.play();
		} catch (err) {
			if (err?.name === 'NotAllowedError') return;
			ctx.toast(`Could not play ${item.name}: ${err.message || 'unsupported format'}`);
		}
		setSession(item);
		syncUi();
		updateImportBar();
	}

	function playNext(auto = false) {
		const n = nextIndex(order, cur, { repeat: prefs.repeat, auto });
		if (n == null) return;
		if (n === cur) {
			video.currentTime = 0;
			video.play().catch(() => {});
		} else playIndex(n, { startAt: 0 });
	}
	function playPrev() {
		if (video.currentTime > 3) {
			video.currentTime = 0;
			return;
		}
		const p = prevIndex(order, cur, { repeat: prefs.repeat });
		if (p != null) playIndex(p, { startAt: 0 });
	}
	const toggle = () => {
		if (cur < 0) {
			if (queue.length) playIndex(0);
			else fileIn.click();
			return;
		}
		video.paused ? (audioCtx?.resume?.(), video.play().catch(() => {})) : video.pause();
	};

	function saveResume(force) {
		const item = queue[cur];
		if (!item?.path || !video.duration) return;
		const now = Date.now();
		if (!force && now - lastSave < 3000) return;
		lastSave = now;
		resume = updateResume(resume, item.path, video.currentTime, video.duration);
		ctx.store.set(POS_KEY, JSON.stringify(resume));
	}

	/* ---------------- UI sync ---------------- */
	function syncUi() {
		const item = queue[cur];
		setIcon(playBtn, video.paused ? 'play' : 'pause', 22);
		playBtn.title = video.paused ? 'Play (Space)' : 'Pause (Space)';
		$('[data-now=title]').textContent = item ? titleFromName(item.name) : '-';
		$('[data-now=sub]').textContent = item ? (item.file ? 'From your computer' : item.path) : '';
		$('[data-a=shuffle]').setAttribute('aria-pressed', String(prefs.shuffle));
		$('[data-a=shuffle]').classList.toggle('on', prefs.shuffle);
		const rep = $('[data-a=repeat]');
		rep.classList.toggle('on', prefs.repeat !== 'off');
		rep.title = `Repeat: ${prefs.repeat}`;
		$('.md-one').hidden = prefs.repeat !== 'one';
		const muted = video.muted || video.volume === 0;
		setIcon($('[data-a=mute]'), muted ? 'm-mute' : 'volume', 18);
		$('[data-a=pip]').hidden = !(document.pictureInPictureEnabled && item?.kind === 'video');
		root.classList.toggle('no-list', !prefs.list);
		seek.disabled = !item;
	}
	function syncTime() {
		const d = video.duration;
		$('[data-t=cur]').textContent = formatTime(video.currentTime);
		$('[data-t=dur]').textContent = formatTime(d);
		if (!seeking && Number.isFinite(d) && d > 0) seek.value = String((video.currentTime / d) * 1000);
		seek.style.setProperty('--p', `${(Number(seek.value) / 10).toFixed(1)}%`);
		if ('mediaSession' in navigator && Number.isFinite(d) && d > 0) {
			try {
				navigator.mediaSession.setPositionState({ duration: d, position: clamp(video.currentTime, 0, d), playbackRate: video.playbackRate });
			} catch {
				/* position state is optional */
			}
		}
	}

	video.addEventListener('timeupdate', () => {
		syncTime();
		saveResume(false);
	});
	video.addEventListener('durationchange', syncTime);
	video.addEventListener('play', () => {
		syncUi();
		startVis();
		if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
	});
	video.addEventListener('pause', () => {
		syncUi();
		saveResume(true);
		if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
	});
	video.addEventListener('ended', () => {
		const item = queue[cur];
		if (item?.path) {
			resume = updateResume(resume, item.path, 0, video.duration);
			ctx.store.set(POS_KEY, JSON.stringify(resume));
		}
		renderList();
		playNext(true);
	});
	video.addEventListener('error', () => {
		if (!video.src) return;
		const item = queue[cur];
		ctx.toast(`${item ? item.name : 'This file'} could not be played. The format may not be supported by this browser.`);
	});
	video.addEventListener('dblclick', () => toggleFs());
	video.addEventListener('click', toggle);

	seek.addEventListener('input', () => {
		seeking = true;
		if (Number.isFinite(video.duration)) $('[data-t=cur]').textContent = formatTime((seek.value / 1000) * video.duration);
		seek.style.setProperty('--p', `${(seek.value / 10).toFixed(1)}%`);
	});
	seek.addEventListener('change', () => {
		if (Number.isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration;
		seeking = false;
	});
	vol.value = String(Math.round(prefs.volume * 100));
	video.volume = prefs.volume;
	video.muted = prefs.muted;
	video.playbackRate = prefs.speed;
	$('.md-speed').value = String(prefs.speed);
	vol.addEventListener('input', () => {
		video.volume = vol.value / 100;
		video.muted = false;
		prefs.volume = video.volume;
		prefs.muted = false;
		savePrefs();
		syncUi();
	});
	$('.md-speed').addEventListener('change', (e) => {
		prefs.speed = +e.target.value;
		video.playbackRate = prefs.speed;
		savePrefs();
	});

	function toggleFs() {
		if (document.fullscreenElement) document.exitFullscreen?.();
		else (queue[cur]?.kind === 'video' ? stage : root).requestFullscreen?.().catch(() => ctx.toast('Fullscreen is not available here'));
	}
	root.addEventListener('click', (e) => {
		const a = e.target.closest('[data-a]')?.dataset.a;
		if (!a) return;
		if (a === 'play') toggle();
		else if (a === 'next') playNext(false);
		else if (a === 'prev') playPrev();
		else if (a === 'shuffle') {
			prefs.shuffle = !prefs.shuffle;
			order = buildOrder(queue.length, { shuffle: prefs.shuffle, current: cur });
			savePrefs();
			syncUi();
		} else if (a === 'repeat') {
			prefs.repeat = { off: 'all', all: 'one', one: 'off' }[prefs.repeat];
			savePrefs();
			syncUi();
		} else if (a === 'mute') {
			video.muted = !video.muted;
			prefs.muted = video.muted;
			savePrefs();
			syncUi();
		} else if (a === 'pip') {
			if (document.pictureInPictureElement) document.exitPictureInPicture();
			else video.requestPictureInPicture?.().catch(() => ctx.toast('Picture in picture is not available for this file'));
		} else if (a === 'fs') toggleFs();
		else if (a === 'add') fileIn.click();
		else if (a === 'list') {
			prefs.list = !prefs.list;
			savePrefs();
			syncUi();
		} else if (a === 'import') importCurrent();
	});

	root.addEventListener('keydown', (e) => {
		if (e.target.matches('select') || e.ctrlKey || e.metaKey || e.altKey) return;
		const onRange = e.target.matches('input[type=range]');
		const k = e.key;
		if (k === ' ' && !e.target.matches('button')) {
			e.preventDefault();
			toggle();
		} else if (k === 'ArrowLeft' && !onRange) {
			e.preventDefault();
			video.currentTime = Math.max(0, video.currentTime - 5);
		} else if (k === 'ArrowRight' && !onRange) {
			e.preventDefault();
			if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 5);
		} else if ((k === 'ArrowUp' || k === 'ArrowDown') && !onRange) {
			e.preventDefault();
			vol.value = String(clamp(+vol.value + (k === 'ArrowUp' ? 5 : -5), 0, 100));
			vol.dispatchEvent(new Event('input'));
		} else if (k.toLowerCase() === 'm') {
			video.muted = !video.muted;
			prefs.muted = video.muted;
			savePrefs();
			syncUi();
		} else if (k.toLowerCase() === 'f') toggleFs();
		else if (k === 'N') playNext(false);
		else if (k === 'P') playPrev();
	});

	/* ---------------- adding media ---------------- */
	function addFiles(files, { play = true } = {}) {
		const ok = [...files].filter((f) => mediaKind(f.name, f.type));
		if (!ok.length) {
			if (files.length) ctx.toast('Those files are not audio or video that the player understands');
			return;
		}
		const first = extras.length;
		for (const f of ok) extras.push({ id: `local:${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2, 6)}`, file: f, name: f.name, kind: mediaKind(f.name, f.type), path: null });
		const firstId = extras[first].id;
		rebuildQueue();
		if (play) playIndex(queue.findIndex((q) => q.id === firstId));
	}
	fileIn.addEventListener('change', () => {
		addFiles(fileIn.files);
		fileIn.value = '';
	});
	['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => {
		if (!e.dataTransfer?.types?.includes('Files')) return;
		e.preventDefault();
		stage.classList.add('drop');
	}));
	['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, () => stage.classList.remove('drop')));
	stage.addEventListener('drop', (e) => {
		if (!e.dataTransfer?.files?.length) return;
		e.preventDefault();
		addFiles(e.dataTransfer.files);
	});

	const importBar = h('div', 'md-import', '');
	importBar.hidden = true;
	stage.append(importBar);
	function updateImportBar() {
		const item = queue[cur];
		importBar.hidden = !item?.file;
		if (item?.file) importBar.innerHTML = `<span>Playing from your computer</span><button class="md-btn pri" data-a="import">Add to library</button>`;
	}
	async function importCurrent() {
		const item = queue[cur];
		if (!item?.file) return;
		try {
			const dir = item.kind === 'video' ? '/Videos' : '/Music';
			const path = await fs.importFile(item.file, dir);
			extras = extras.filter((e) => e !== item);
			ctx.toast(`Added to ${dir}`);
			await loadLibrary();
			cur = queue.findIndex((q) => q.path === path);
			renderList();
			syncUi();
			updateImportBar();
			root.focus();
		} catch (err) {
			ctx.toast(`Could not add to library: ${err.message}`);
		}
	}

	async function openPath(path) {
		if (typeof path !== 'string' || !path) return;
		const st = await fs.stat(path);
		if (!st || st.type !== 'file') {
			ctx.toast(`${path} was not found`);
			return;
		}
		const kind = mediaKind(st.name, st.mime);
		if (!kind) {
			ctx.toast(`${st.name} is not an audio or video file`);
			return;
		}
		if (!library.some((l) => l.path === st.path) && !extras.some((e) => e.path === st.path)) {
			extras.push({ id: st.path, path: st.path, name: st.name, kind, size: st.size });
			rebuildQueue();
		}
		await playIndex(queue.findIndex((q) => q.path === st.path));
	}

	/* ---------------- Media Session ---------------- */
	function setSession(item) {
		if (!('mediaSession' in navigator) || !item) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({ title: titleFromName(item.name), artist: 'three.ws Media Player', album: item.file ? 'Your computer' : item.path.replace(/\/[^/]*$/, '') || '/' });
		} catch {
			/* metadata is optional */
		}
	}
	const sessionHandlers = {
		play: () => toggle(),
		pause: () => video.pause(),
		previoustrack: () => playPrev(),
		nexttrack: () => playNext(false),
		seekbackward: (d) => (video.currentTime = Math.max(0, video.currentTime - (d?.seekOffset || 10))),
		seekforward: (d) => (video.currentTime = Math.min(video.duration || 0, video.currentTime + (d?.seekOffset || 10))),
		seekto: (d) => (video.currentTime = d.seekTime),
		stop: () => {
			video.pause();
			video.currentTime = 0;
		},
	};
	if ('mediaSession' in navigator) {
		for (const [k, fn] of Object.entries(sessionHandlers)) {
			try {
				navigator.mediaSession.setActionHandler(k, fn);
			} catch {
				/* action not supported here */
			}
		}
	}

	/* ---------------- visualizer ---------------- */
	let raf = 0;
	function startVis() {
		if (raf || !analyser) return;
		raf = requestAnimationFrame(drawVis);
	}
	const bins = { f: null, t: null };
	function drawVis() {
		raf = 0;
		if (disposed) return;
		const item = queue[cur];
		if (!analyser || item?.kind !== 'audio' || (video.paused && !video.seeking && lastDrawIdle > 20)) return;
		raf = requestAnimationFrame(drawVis);
		if (document.visibilityState !== 'visible' || root.offsetParent === null) return;
		lastDrawIdle = video.paused ? lastDrawIdle + 1 : 0;
		const dpr = window.devicePixelRatio || 1;
		const w = vis.clientWidth;
		const hgt = vis.clientHeight;
		if (!w || !hgt) return;
		if (vis.width !== Math.round(w * dpr) || vis.height !== Math.round(hgt * dpr)) {
			vis.width = Math.round(w * dpr);
			vis.height = Math.round(hgt * dpr);
		}
		bins.f ||= new Uint8Array(analyser.frequencyBinCount);
		bins.t ||= new Uint8Array(analyser.fftSize);
		analyser.getByteFrequencyData(bins.f);
		analyser.getByteTimeDomainData(bins.t);
		const g = vis.getContext('2d');
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, hgt);
		const cs = getComputedStyle(root);
		const c1 = cs.getPropertyValue('--accent').trim() || '#4cc2ff';
		const c2 = cs.getPropertyValue('--accent-2').trim() || '#ad6eca';
		const n = Math.min(64, Math.floor(w / 10));
		const bw = w / n;
		const gr = g.createLinearGradient(0, hgt, 0, 0);
		gr.addColorStop(0, c1);
		gr.addColorStop(1, c2);
		g.fillStyle = gr;
		const usable = Math.floor(bins.f.length * 0.7);
		for (let i = 0; i < n; i++) {
			const lo = Math.floor(Math.pow(i / n, 1.8) * usable);
			const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.8) * usable));
			let m = 0;
			for (let j = lo; j < hi; j++) m = Math.max(m, bins.f[j]);
			const bh = (m / 255) * hgt * 0.62;
			g.globalAlpha = 0.9;
			g.fillRect(i * bw + 1, hgt * 0.72 - bh, bw - 2, bh);
		}
		g.globalAlpha = 1;
		g.strokeStyle = c1;
		g.lineWidth = 2;
		g.beginPath();
		const wy = hgt * 0.86;
		for (let i = 0; i < bins.t.length; i += 4) {
			const x = (i / bins.t.length) * w;
			const y = wy + ((bins.t[i] - 128) / 128) * hgt * 0.1;
			i ? g.lineTo(x, y) : g.moveTo(x, y);
		}
		g.stroke();
	}
	let lastDrawIdle = 0;
	video.addEventListener('play', () => (lastDrawIdle = 0));

	/* ---------------- start ---------------- */
	const unsub = fs.subscribe((paths) => {
		if (paths.some((p) => p === '/Music' || p === '/Videos' || p === '/')) loadLibrary();
	});
	ctx.onArg((a) => openPath(a));
	document.addEventListener('fullscreenchange', syncUi);

	syncUi();
	renderList();
	requestAnimationFrame(() => root.focus({ preventScroll: true }));
	loadLibrary().then(() => {
		if (typeof ctx.arg === 'string' && ctx.arg) openPath(ctx.arg);
	});

	return () => {
		disposed = true;
		saveResume(true);
		unsub();
		document.removeEventListener('fullscreenchange', syncUi);
		cancelAnimationFrame(raf);
		video.pause();
		video.removeAttribute('src');
		video.load();
		if (objUrl) URL.revokeObjectURL(objUrl);
		objUrl = null;
		audioCtx?.close?.().catch(() => {});
		if ('mediaSession' in navigator) {
			for (const k of Object.keys(sessionHandlers)) {
				try {
					navigator.mediaSession.setActionHandler(k, null);
				} catch {
					/* unsupported action */
				}
			}
			navigator.mediaSession.metadata = null;
		}
	};
}
