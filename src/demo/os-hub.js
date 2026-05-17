/**
 * Hub status checks for /demo/avatar-os.
 * Probes each dependency the demos rely on and reports whether it's reachable.
 */

const set = (id, msg, kind) => {
	const el = document.getElementById(id);
	if (!el) return;
	el.textContent = msg;
	el.classList.remove('ok', 'err');
	if (kind === 'ok') el.classList.add('ok');
	if (kind === 'err') el.classList.add('err');
};

async function probeMediapipe() {
	try {
		const mod = await import('@mediapipe/tasks-vision');
		if (!mod.FaceLandmarker || !mod.FilesetResolver) {
			throw new Error('FaceLandmarker not exported');
		}
		set('mp-status', `loaded · FaceLandmarker available`, 'ok');
	} catch (err) {
		set('mp-status', `failed: ${err.message}`, 'err');
	}
}

async function probeTriangulation() {
	try {
		const mod = await import('./triangulation.js');
		const arr = mod.TRIANGULATION;
		if (!Array.isArray(arr)) throw new Error('TRIANGULATION not an array');
		set('tri-status', `${arr.length} indices · ${arr.length / 3} triangles`, 'ok');
	} catch (err) {
		set('tri-status', `failed: ${err.message}`, 'err');
	}
}

async function probeBaseGlb() {
	try {
		const res = await fetch('/avatars/default.glb', { method: 'HEAD' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const size = res.headers.get('content-length');
		set('glb-status', `/avatars/default.glb · ${size ? `${(size / 1024).toFixed(0)} KB` : 'ok'}`, 'ok');
	} catch (err) {
		set('glb-status', `failed: ${err.message}`, 'err');
	}
}

async function probeCharacterStudio() {
	const url = 'http://localhost:5173';
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 1500);
		const res = await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
		clearTimeout(timer);
		set('cs-status', `reachable · ${url}`, 'ok');
	} catch (err) {
		set(
			'cs-status',
			`not running · start with: npm --prefix character-studio run dev`,
			'err',
		);
	}
}

probeMediapipe();
probeTriangulation();
probeBaseGlb();
probeCharacterStudio();
