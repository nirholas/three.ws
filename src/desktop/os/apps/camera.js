// Camera: live getUserMedia preview, photo capture and MediaRecorder video, saved into the
// virtual file system (/Pictures and /Videos). Every track is stopped when the window closes.
import './camera.css';
import { captureName, pickRecorderType, extForRecorderType, classifyMediaError, elapsedLabel } from './camera-logic.js';

const K = { mirror: 'tws:camera:mirror', fmt: 'tws:camera:format', timer: 'tws:camera:timer', device: 'tws:camera:device' };
const svg = (b, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const ICO = {
	photo: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
	video: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
	mirror: svg('<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>'),
	timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 3h6"/>'),
	film: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>', 28),
};

export function mount(host, ctx) {
	const { h, esc, fs, store } = ctx;
	host.classList.add('napp-camera');
	host.innerHTML = '';
	const root = h('div', 'cam');
	host.append(root);

	let stream = null;
	let devices = [];
	let deviceId = store.get(K.device) || '';
	let mode = 'photo';
	let mirror = store.get(K.mirror) !== '0';
	let fmt = store.get(K.fmt) === 'jpeg' ? 'jpeg' : 'png';
	let delay = [0, 3, 10].includes(Number(store.get(K.timer))) ? Number(store.get(K.timer)) : 0;
	let recorder = null;
	let recStart = 0;
	let recTick = 0;
	let countdown = null;
	let disposed = false;
	let starting = 0;
	const urls = new Set();

	// ---- layout ----
	const stage = h('div', 'cam-stage');
	const video = h('video', 'cam-video');
	video.autoplay = true;
	video.playsInline = true;
	video.muted = true;
	video.setAttribute('aria-label', 'Camera preview');
	const flash = h('div', 'cam-flash');
	const count = h('div', 'cam-count');
	count.setAttribute('aria-live', 'assertive');
	const rec = h('div', 'cam-rec');
	rec.hidden = true;
	const state = h('div', 'cam-state');
	stage.append(video, flash, count, rec, state);

	const top = h('div', 'cam-top');
	const devSel = h('select', 'cam-sel');
	devSel.setAttribute('aria-label', 'Camera');
	const mirrorB = h('button', 'cam-tb', ICO.mirror);
	mirrorB.type = 'button';
	mirrorB.title = 'Mirror preview and photos';
	mirrorB.setAttribute('aria-label', 'Mirror');
	const timerB = h('button', 'cam-tb');
	timerB.type = 'button';
	const fmtB = h('button', 'cam-tb txt');
	fmtB.type = 'button';
	fmtB.title = 'Photo format';
	top.append(devSel, h('span', 'cam-grow'), timerB, mirrorB, fmtB);

	const bar = h('div', 'cam-bar');
	const modeSeg = h('div', 'cam-seg');
	modeSeg.setAttribute('role', 'group');
	modeSeg.setAttribute('aria-label', 'Capture mode');
	const photoB = h('button', '', `${ICO.photo}<span>Photo</span>`);
	const videoB = h('button', '', `${ICO.video}<span>Video</span>`);
	[photoB, videoB].forEach((b) => (b.type = 'button'));
	modeSeg.append(photoB, videoB);
	const shutter = h('button', 'cam-shutter');
	shutter.type = 'button';
	const strip = h('div', 'cam-strip');
	strip.setAttribute('aria-label', 'Recent captures');
	bar.append(modeSeg, shutter, strip);
	root.append(top, stage, bar);

	// ---- ui sync ----
	function sync() {
		mirrorB.classList.toggle('on', mirror);
		mirrorB.setAttribute('aria-pressed', String(mirror));
		video.classList.toggle('mirror', mirror);
		timerB.innerHTML = `${ICO.timer}<span>${delay ? `${delay}s` : 'Off'}</span>`;
		timerB.title = 'Countdown timer';
		timerB.setAttribute('aria-label', `Countdown ${delay ? `${delay} seconds` : 'off'}`);
		fmtB.textContent = fmt.toUpperCase();
		fmtB.hidden = mode !== 'photo';
		photoB.classList.toggle('on', mode === 'photo');
		videoB.classList.toggle('on', mode === 'video');
		photoB.setAttribute('aria-pressed', String(mode === 'photo'));
		videoB.setAttribute('aria-pressed', String(mode === 'video'));
		const live = !!stream;
		shutter.disabled = !live;
		shutter.className = `cam-shutter ${mode}${recorder ? ' recording' : ''}${countdown ? ' counting' : ''}`;
		shutter.setAttribute('aria-label', countdown ? 'Cancel countdown' : mode === 'photo' ? 'Take photo' : recorder ? 'Stop recording' : 'Start recording');
		shutter.title = shutter.getAttribute('aria-label');
		photoB.disabled = videoB.disabled = !!recorder;
	}

	// ---- stream ----
	const stopStream = () => {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		video.srcObject = null;
	};
	async function refreshDevices() {
		try {
			devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
		} catch {
			devices = [];
		}
		devSel.replaceChildren(
			...devices.map((d, i) => {
				const o = h('option');
				o.value = d.deviceId;
				o.textContent = d.label || `Camera ${i + 1}`;
				return o;
			}),
		);
		const active = stream?.getVideoTracks()[0]?.getSettings().deviceId;
		if (active) devSel.value = active;
		devSel.hidden = devices.length < 2;
	}
	function showState(info) {
		state.replaceChildren();
		if (!info) {
			state.classList.remove('on');
			return;
		}
		state.classList.add('on');
		const box = h('div', 'cam-msg');
		if (info.loading) {
			box.innerHTML = '<div class="cam-spin" aria-hidden="true"></div><b>Starting camera</b><p>If your browser asks, choose Allow to use your camera.</p>';
		} else {
			box.innerHTML = `<div class="cam-ico">${ICO.photo.replace('width="20" height="20"', 'width="40" height="40"')}</div><b>${esc(info.title)}</b><ol>${info.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
			const retry = h('button', 'cam-btn', 'Try again');
			retry.type = 'button';
			retry.addEventListener('click', () => start());
			box.append(retry);
		}
		state.append(box);
	}
	async function start(id = deviceId) {
		const mine = ++starting;
		stopStream();
		if (!window.isSecureContext) return showState(classifyMediaError(null, { secure: false })), sync();
		if (!navigator.mediaDevices?.getUserMedia) return showState(classifyMediaError(null, { hasMediaDevices: false })), sync();
		showState({ loading: true });
		sync();
		try {
			const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
			let s;
			try {
				s = await navigator.mediaDevices.getUserMedia({ video: id ? { ...base, deviceId: { exact: id } } : { ...base, facingMode: 'user' }, audio: false });
			} catch (err) {
				if (id && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) s = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
				else throw err;
			}
			if (mine !== starting || disposed) {
				s.getTracks().forEach((t) => t.stop());
				return;
			}
			stream = s;
			video.srcObject = s;
			await video.play().catch(() => {});
			deviceId = s.getVideoTracks()[0]?.getSettings().deviceId || id;
			if (deviceId) store.set(K.device, deviceId);
			s.getVideoTracks()[0]?.addEventListener('ended', () => {
				if (stream === s && !disposed) {
					stream = null;
					showState({ title: 'The camera was disconnected', steps: ['Reconnect the camera, or pick another one.', 'Choose Try again below.'] });
					sync();
				}
			});
			showState(null);
			await refreshDevices();
		} catch (err) {
			if (mine !== starting || disposed) return;
			showState(classifyMediaError(err));
		}
		sync();
	}

	// ---- capture ----
	async function saveBlob(dir, name, blob, mime) {
		const unique = await fs.uniqueName(dir, name);
		const path = fs.join(dir, unique);
		await fs.write(path, blob, { mime });
		return path;
	}
	function doFlash() {
		flash.classList.remove('go');
		void flash.offsetWidth;
		flash.classList.add('go');
	}
	async function takePhoto() {
		if (!stream || !video.videoWidth) return ctx.toast('The camera is not ready yet');
		const c = document.createElement('canvas');
		c.width = video.videoWidth;
		c.height = video.videoHeight;
		const g = c.getContext('2d');
		if (mirror) {
			g.translate(c.width, 0);
			g.scale(-1, 1);
		}
		g.drawImage(video, 0, 0);
		doFlash();
		const type = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
		const blob = await new Promise((res) => c.toBlob(res, type, 0.92));
		if (!blob) return ctx.toast('Could not encode the photo');
		try {
			const path = await saveBlob('/Pictures', captureName(new Date(), fmt === 'jpeg' ? 'jpg' : 'png'), blob, type);
			ctx.toast(`Saved ${fs.nameOf(path)} to Pictures`);
		} catch (err) {
			ctx.toast(`Could not save the photo: ${err.message}`);
		}
	}
	function runCountdown(done) {
		let n = delay;
		const tick = () => {
			if (!countdown) return;
			if (n <= 0) {
				count.textContent = '';
				countdown = null;
				sync();
				done();
				return;
			}
			count.textContent = String(n);
			count.classList.remove('pop');
			void count.offsetWidth;
			count.classList.add('pop');
			n--;
			countdown = setTimeout(tick, 1000);
		};
		countdown = true;
		sync();
		tick();
	}
	const cancelCountdown = () => {
		if (countdown && countdown !== true) clearTimeout(countdown);
		countdown = null;
		count.textContent = '';
		sync();
	};
	async function startRecording() {
		const type = pickRecorderType((t) => window.MediaRecorder?.isTypeSupported?.(t));
		if (!window.MediaRecorder || !type) return ctx.toast('This browser cannot record video');
		const tracks = [...stream.getVideoTracks()];
		let micOk = true;
		try {
			const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
			tracks.push(...mic.getAudioTracks());
		} catch {
			micOk = false;
		}
		const rs = new MediaRecorder(new MediaStream(tracks), { mimeType: type });
		const chunks = [];
		rs.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		rs.onstop = async () => {
			clearInterval(recTick);
			tracks.filter((t) => t.kind === 'audio').forEach((t) => t.stop());
			rec.hidden = true;
			recorder = null;
			sync();
			if (!chunks.length) return;
			const blob = new Blob(chunks, { type: type.split(';')[0] });
			try {
				const path = await saveBlob('/Videos', captureName(new Date(recStart), extForRecorderType(type)), blob, blob.type);
				ctx.toast(`Saved ${fs.nameOf(path)} to Videos`);
			} catch (err) {
				ctx.toast(`Could not save the video: ${err.message}`);
			}
		};
		rs.start(1000);
		recorder = rs;
		recStart = Date.now();
		rec.hidden = false;
		const draw = () => (rec.innerHTML = `<i></i>REC ${elapsedLabel(Date.now() - recStart)}${micOk ? '' : ' <small>no microphone</small>'}`);
		draw();
		recTick = setInterval(draw, 500);
		if (!micOk) ctx.toast('Microphone unavailable, recording video only');
		sync();
	}
	function stopRecording() {
		if (recorder && recorder.state !== 'inactive') recorder.stop();
	}
	function onShutter() {
		if (countdown) return cancelCountdown();
		if (mode === 'video') {
			if (recorder) return stopRecording();
			return delay ? runCountdown(startRecording) : startRecording();
		}
		return delay ? runCountdown(takePhoto) : takePhoto();
	}

	// ---- recents ----
	async function loadStrip() {
		const found = [];
		for (const dir of ['/Pictures', '/Videos']) {
			try {
				found.push(...(await fs.list(dir)).filter((n) => n.type === 'file' && n.name.startsWith('Camera ')));
			} catch {
				/* folder missing: nothing to show yet */
			}
		}
		if (disposed) return;
		found.sort((a, b) => b.mtime - a.mtime);
		urls.forEach((u) => URL.revokeObjectURL(u));
		urls.clear();
		const items = await Promise.all(
			found.slice(0, 12).map(async (n) => {
				const b = h('button', 'cam-thumb');
				b.type = 'button';
				b.title = n.name;
				b.setAttribute('aria-label', `Open ${n.name}`);
				if (fs.kindOf(n.name) === 'image') {
					const u = await fs.urlFor(n.path);
					if (u) {
						urls.add(u);
						b.innerHTML = `<img alt="" src="${u}">`;
					}
				} else b.innerHTML = ICO.film;
				b.addEventListener('click', () => ctx.openPath(n.path));
				return b;
			}),
		);
		if (disposed) return;
		strip.replaceChildren(...(items.length ? items : [h('span', 'cam-hint', 'Photos and videos you take appear here')]));
	}
	const offFs = fs.subscribe((paths) => {
		if (!paths || paths.some((p) => p === '/Pictures' || p === '/Videos')) loadStrip();
	});

	// ---- events ----
	devSel.addEventListener('change', () => {
		deviceId = devSel.value;
		start(deviceId);
	});
	mirrorB.addEventListener('click', () => {
		mirror = !mirror;
		store.set(K.mirror, mirror ? '1' : '0');
		sync();
	});
	timerB.addEventListener('click', () => {
		delay = delay === 0 ? 3 : delay === 3 ? 10 : 0;
		store.set(K.timer, String(delay));
		sync();
	});
	fmtB.addEventListener('click', () => {
		fmt = fmt === 'png' ? 'jpeg' : 'png';
		store.set(K.fmt, fmt);
		sync();
	});
	photoB.addEventListener('click', () => ((mode = 'photo'), sync()));
	videoB.addEventListener('click', () => ((mode = 'video'), sync()));
	shutter.addEventListener('click', onShutter);
	root.tabIndex = 0;
	root.addEventListener('keydown', (e) => {
		if (e.target.closest('select')) return;
		if (e.key === ' ' || e.key === 'Enter') {
			if (e.target.closest('button')) return;
			e.preventDefault();
			if (!shutter.disabled) onShutter();
		} else if (e.key === 'Escape') cancelCountdown();
	});
	const onDeviceChange = () => refreshDevices();
	navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

	sync();
	loadStrip();
	start();

	return () => {
		disposed = true;
		starting++;
		navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
		offFs();
		cancelCountdown();
		clearInterval(recTick);
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		stopStream();
		urls.forEach((u) => URL.revokeObjectURL(u));
		urls.clear();
	};
}
