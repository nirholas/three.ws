// /video-to-motion: turn any video into a downloadable animation file.
//
// Reuses the production model-video2motion worker (the same one /motion-swap
// drives) for pose capture, but this page is aimed at the clip itself rather
// than a composited video: preview the motion on a default avatar or one the
// user uploads, trim it, then download GLB (retargeted onto the previewed
// avatar), BVH (on the platform's canonical skeleton), and FBX (server-side
// conversion that preserves the rig, via /api/forge-remesh).

const STOCK_AVATARS = [
	{ id: 'default', name: 'Standard', url: '/avatars/default.glb' },
	{ id: 'michelle', name: 'Michelle', url: '/avatars/michelle.glb' },
	{ id: 'mannequin', name: 'Mannequin', url: '/avatars/mannequin.glb' },
	{ id: 'realistic-female', name: 'Realistic', url: '/avatars/realistic-female.glb' },
];

const POLL_MS = 3000;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const CONVERT_POLL_MS = 2_500;
const CONVERT_TIMEOUT_MS = 180_000;

const $ = (id) => document.getElementById(id);

const state = {
	three: null, // { THREE, GLTFLoader, renderer, scene, camera, mixer, action, clock }
	job: null,
	artifacts: null, // { clip_url }
	clipJSON: null,
	sourceClip: null, // AnimationClip, canonical skeleton, untrimmed
	trimStart: 0,
	trimEnd: 0,
	avatar: null, // { root, group, retargetMod }
	avatarUrl: STOCK_AVATARS[0].url,
	boundClip: null, // AnimationClip retargeted + trimmed, bound to the current avatar
	session: false,
	agents: [],
};

function setStatus(text, kind = 'info') {
	const el = $('vtm-status');
	if (!el) return;
	el.textContent = text;
	el.dataset.kind = kind;
	el.hidden = !text;
}

function showStage(stage) {
	for (const s of ['empty', 'processing', 'failed', 'limit']) {
		const el = $(`vtm-stage-${s}`);
		if (el) el.hidden = s !== stage;
	}
	const ready = $('vtm-stage-ready');
	if (ready) ready.hidden = stage !== 'ready';
	const trimRow = $('vtm-trim-row');
	if (trimRow) trimRow.hidden = stage !== 'ready';
	for (const id of ['vtm-export-glb', 'vtm-export-bvh', 'vtm-export-fbx']) {
		const btn = $(id);
		if (btn) btn.disabled = stage !== 'ready';
	}
}

// ---------------------------------------------------------------------------
// Upload + job lifecycle (same /api/motion-swap worker /motion-swap uses)
// ---------------------------------------------------------------------------

async function uploadVideo(file) {
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new Error('Video is over 256 MB. Trim it down (90 seconds is the processing cap anyway).');
	}
	const type = file.type || 'video/mp4';
	setStatus('Requesting upload slot…');
	const presign = await fetch('/api/motion-swap', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action: 'upload', content_type: type, size_bytes: file.size }),
	});
	const slot = await presign.json();
	if (!presign.ok) throw new Error(slot?.message || 'Upload is unavailable right now.');

	setStatus('Uploading video…');
	const put = await fetch(slot.upload_url, {
		method: slot.method || 'PUT',
		headers: slot.headers || { 'content-type': type },
		body: file,
	});
	if (!put.ok) throw new Error(`Upload failed (${put.status}). Try again.`);
	return slot.public_url;
}

async function submitJob(videoUrl) {
	setStatus('Starting capture…');
	const res = await fetch('/api/motion-swap', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ video_url: videoUrl }),
	});
	const data = await res.json();
	if (res.status === 429) {
		const err = new Error(data?.message || 'Too many captures from this connection. Try again later.');
		err.limited = true;
		throw err;
	}
	if (!res.ok) throw new Error(data?.message || 'Capture could not start.');
	return data;
}

async function pollJob(jobId, etaSeconds) {
	const started = Date.now();
	for (;;) {
		await new Promise((r) => setTimeout(r, POLL_MS));
		const res = await fetch(`/api/motion-swap?job=${encodeURIComponent(jobId)}`);
		const data = await res.json().catch(() => ({}));
		if (res.status >= 400) {
			throw new Error(data?.message || `Capture status unavailable (${res.status}).`);
		}
		if (data.status === 'done' && data.clip_url) return data;
		if (data.status === 'failed') {
			throw new Error(data.error || 'Capture failed. Make sure one person is clearly visible.');
		}
		const elapsed = Math.round((Date.now() - started) / 1000);
		const pct = etaSeconds ? Math.min(95, Math.round((elapsed / etaSeconds) * 100)) : null;
		const bar = $('vtm-progress-bar');
		if (bar && pct !== null) bar.style.width = `${pct}%`;
		const note = $('vtm-processing-note');
		if (note) {
			note.textContent =
				pct !== null
					? `Tracking motion… ${pct}% (about ${Math.max(1, etaSeconds - elapsed)}s left)`
					: `Tracking motion… ${elapsed}s`;
		}
	}
}

async function handleFile(file) {
	try {
		showStage('processing');
		const bar = $('vtm-progress-bar');
		if (bar) bar.style.width = '0%';
		const videoUrl = await uploadVideo(file);
		const job = await submitJob(videoUrl);
		state.job = job.job_id;
		const done = await pollJob(job.job_id, job.eta_seconds);
		state.artifacts = done;
		setStatus('Loading motion…');
		await loadClip(done);
		showStage('ready');
		setStatus('');
	} catch (err) {
		if (err?.limited) {
			showStage('limit');
		} else {
			showStage('failed');
			const reason = $('vtm-fail-reason');
			if (reason) reason.textContent = err?.message || 'Make sure one person is clearly visible and well lit.';
		}
		setStatus('');
	}
}

// ---------------------------------------------------------------------------
// three.js preview
// ---------------------------------------------------------------------------

async function bootThree() {
	if (state.three) return state.three;
	const [THREE, { GLTFLoader }] = await Promise.all([
		import('three'),
		import('three/addons/loaders/GLTFLoader.js'),
	]);
	const canvas = $('vtm-canvas');
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b0b0b);
	const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 50);
	camera.position.set(0, 1.2, 3.4);
	camera.lookAt(0, 1, 0);

	scene.add(new THREE.HemisphereLight(0xffffff, 0x303033, 2.4));
	const key = new THREE.DirectionalLight(0xffffff, 1.8);
	key.position.set(1.5, 3, 4);
	scene.add(key);
	const grid = new THREE.GridHelper(6, 24, 0x2a2a2a, 0x1a1a1a);
	scene.add(grid);

	state.three = {
		THREE,
		GLTFLoader,
		renderer,
		scene,
		camera,
		mixer: null,
		action: null,
		clock: new THREE.Clock(),
		playing: true,
	};
	return state.three;
}

function layout(t) {
	const holder = $('vtm-canvas-wrap');
	const w = holder.clientWidth || 960;
	const h = Math.max(240, Math.round(w * 9 / 16));
	t.renderer.setSize(w, h, false);
	t.camera.aspect = w / h;
	t.camera.updateProjectionMatrix();
}

async function loadAvatar(t, url) {
	setStatus('Loading avatar…');
	const [buf, canonMod, retargetMod, { getMeshoptDecoder }] = await Promise.all([
		fetch(url).then((r) => {
			if (!r.ok) throw new Error(`Avatar fetch failed (${r.status}).`);
			return r.arrayBuffer();
		}),
		import('./glb-canonicalize.js'),
		import('./animation-retarget.js'),
		import('./viewer/internal.js'),
	]);
	let glb = buf;
	try {
		const canon = canonMod.canonicalizeGLBBones(buf);
		if (canon?.buffer) glb = canon.buffer;
		else if (canon instanceof ArrayBuffer) glb = canon;
	} catch {
		// Not canonicalizable (already canonical or unusual container): retarget
		// still resolves bone names through the same mapping at clip-bind time.
	}
	const loader = new t.GLTFLoader();
	loader.setMeshoptDecoder(await getMeshoptDecoder());
	const gltf = await loader.parseAsync(glb, '');
	const root = gltf.scene;

	if (state.avatar?.group) t.scene.remove(state.avatar.group);
	if (t.mixer) {
		t.mixer.stopAllAction();
		t.mixer = null;
		t.action = null;
	}

	const group = new t.THREE.Group();
	group.add(root);
	t.scene.add(group);
	root.updateMatrixWorld(true);

	const bbox = new t.THREE.Box3().setFromObject(root);
	// Floor the avatar at the scene origin regardless of its own rest pose.
	group.position.y = -bbox.min.y;

	state.avatar = { root, group, retargetMod, sourceUrl: url };
	if (state.clipJSON) bindClip(t);
	setStatus('');
}

function bindClip(t) {
	const { retargetMod } = state.avatar;
	const clip = retargetMod.parseClipJSON(state.clipJSON, 'video-to-motion');
	const result = retargetMod.retargetClipToObject(clip, state.avatar.root, { minCoverage: 0.3 });
	const bound = result?.clip;
	if (!bound) {
		throw new Error(
			'That model has no compatible humanoid skeleton. Load a rigged avatar GLB (generate one at /create).',
		);
	}
	state.sourceClip = clip;
	if (!state.trimEnd) state.trimEnd = clip.duration;
	const trimmed = retargetMod.trimClip(bound, state.trimStart, state.trimEnd);
	state.boundClip = trimmed;

	t.mixer = new t.THREE.AnimationMixer(state.avatar.root);
	t.action = t.mixer.clipAction(trimmed);
	t.action.play();
	t.mixer.setTime(0);
}

async function loadClip(artifacts) {
	const t = await bootThree();
	const clipJSON = await fetch(artifacts.clip_url).then((r) => r.json());
	state.clipJSON = clipJSON;
	state.trimStart = 0;
	state.trimEnd = clipJSON.duration ?? 0;

	layout(t);
	await loadAvatar(t, state.avatarUrl);
	wireTrimRange(clipJSON.duration ?? 0);

	cancelAnimationFrame(state._raf);
	const tick = () => {
		state._raf = requestAnimationFrame(tick);
		if (t.mixer && t.playing) t.mixer.update(t.clock.getDelta());
		else t.clock.getDelta();
		t.renderer.render(t.scene, t.camera);
	};
	tick();
}

function wireTrimRange(duration) {
	const startRange = $('vtm-trim-start');
	const endRange = $('vtm-trim-end');
	const startOut = $('vtm-trim-start-out');
	const endOut = $('vtm-trim-end-out');
	if (!startRange || !endRange) return;
	startRange.min = '0';
	startRange.max = String(duration);
	startRange.step = '0.1';
	startRange.value = '0';
	endRange.min = '0';
	endRange.max = String(duration);
	endRange.step = '0.1';
	endRange.value = String(duration);
	if (startOut) startOut.textContent = '0.0s';
	if (endOut) endOut.textContent = `${duration.toFixed(1)}s`;
}

function applyTrim() {
	const t = state.three;
	if (!t || !state.avatar) return;
	try {
		bindClip(t);
	} catch (err) {
		setStatus(err?.message || 'Could not retarget that trim range.', 'error');
	}
}

// ---------------------------------------------------------------------------
// Exports: a retargeted GLB, a canonical-skeleton BVH, and a rig-preserving
// FBX converted server-side.
// ---------------------------------------------------------------------------

function downloadBlob(blob, filename) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

async function exportGlbBlob() {
	const t = state.three;
	if (!t || !state.avatar || !state.boundClip) throw new Error('Load a capture first.');
	const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
	const buffer = await new Promise((resolve, reject) => {
		new GLTFExporter().parse(
			state.avatar.root,
			(glb) => resolve(glb),
			(err) => reject(new Error(`GLTFExporter error: ${err?.message || err}`)),
			{ binary: true, animations: [state.boundClip] },
		);
	});
	return new Blob([buffer], { type: 'model/gltf-binary' });
}

async function exportGlb() {
	const btn = $('vtm-export-glb');
	btn.disabled = true;
	try {
		const blob = await exportGlbBlob();
		downloadBlob(blob, 'motion.glb');
	} catch (err) {
		setStatus(err?.message || 'GLB export failed.', 'error');
	} finally {
		btn.disabled = false;
	}
}

async function exportBvh() {
	const btn = $('vtm-export-bvh');
	btn.disabled = true;
	try {
		if (!state.clipJSON) throw new Error('Load a capture first.');
		// Trim at the clip.json level too, on the untrimmed clip's own time base,
		// so the BVH (canonical skeleton, not the previewed avatar) matches the
		// same trim window the GLB preview uses.
		const [{ AnimationClip }, { trimClip }, { clipToBVH }] = await Promise.all([
			import('three'),
			import('./animation-retarget.js'),
			import('./animation-bvh-export.js'),
		]);
		const full = AnimationClip.parse(state.clipJSON);
		const trimmed = trimClip(full, state.trimStart, state.trimEnd);
		const bvhText = clipToBVH(trimmed, { fps: 30 });
		downloadBlob(new Blob([bvhText], { type: 'text/plain' }), 'motion.bvh');
	} catch (err) {
		setStatus(err?.message || 'BVH export failed.', 'error');
	} finally {
		btn.disabled = false;
	}
}

async function exportFbx() {
	const btn = $('vtm-export-fbx');
	const original = btn.textContent;
	btn.disabled = true;
	btn.textContent = 'Converting…';
	try {
		const glbBlob = await exportGlbBlob();
		setStatus('Hosting GLB for conversion…');
		const presign = await fetch('/api/avatar/presign-glb', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content_type: 'model/gltf-binary', bytes: glbBlob.size }),
		});
		const slot = await presign.json();
		if (!presign.ok) throw new Error(slot?.message || 'Could not prepare FBX conversion.');
		const put = await fetch(slot.upload_url, {
			method: 'PUT',
			headers: { 'content-type': 'model/gltf-binary' },
			body: glbBlob,
		});
		if (!put.ok) throw new Error(`Upload for conversion failed (${put.status}).`);

		setStatus('Converting to FBX…');
		const res = await fetch('/api/forge-remesh', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mesh_url: slot.public_url, operation: 'convert', output_format: 'fbx' }),
		});
		const started = await res.json().catch(() => ({}));
		if (!res.ok || !started.job_id) {
			throw new Error(started.message || started.error || `FBX conversion returned ${res.status}`);
		}
		const deadline = Date.now() + CONVERT_TIMEOUT_MS;
		let resultUrl = null;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, CONVERT_POLL_MS));
			const pollRes = await fetch(`/api/forge-remesh?job=${encodeURIComponent(started.job_id)}`, {
				headers: { accept: 'application/json' },
			});
			const data = await pollRes.json().catch(() => ({}));
			if (!pollRes.ok) throw new Error(data.message || `FBX conversion returned ${pollRes.status}`);
			if (data.status === 'done' && data.result_url) {
				resultUrl = data.result_url;
				break;
			}
			if (data.status === 'failed') throw new Error(data.error || 'FBX conversion failed.');
			setStatus(data.status === 'running' ? 'Converting to FBX…' : 'Queued for conversion…');
		}
		if (!resultUrl) throw new Error('FBX conversion timed out.');
		const fbxRes = await fetch(resultUrl);
		if (!fbxRes.ok) throw new Error(`Could not fetch the converted FBX (${fbxRes.status}).`);
		const fbxBlob = await fbxRes.blob();
		downloadBlob(fbxBlob, 'motion.fbx');
		setStatus('');
	} catch (err) {
		setStatus(err?.message || 'FBX export failed.', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = original;
	}
}

// ---------------------------------------------------------------------------
// Save to library (signed-in only)
// ---------------------------------------------------------------------------

async function checkSession() {
	try {
		const res = await fetch('/api/auth/me', { credentials: 'include' });
		const data = await res.json().catch(() => ({}));
		state.session = Boolean(data?.user);
	} catch {
		state.session = false;
	}
	const { noteSession } = await import('./api.js');
	noteSession(state.session);
	$('vtm-save-signed-out').hidden = state.session;
	$('vtm-save-signed-in').hidden = !state.session;
	if (state.session) await loadAgents();
}

async function loadAgents() {
	try {
		const res = await fetch('/api/agents', { credentials: 'include' });
		const data = await res.json().catch(() => ({}));
		state.agents = Array.isArray(data?.agents) ? data.agents : Array.isArray(data) ? data : [];
	} catch {
		state.agents = [];
	}
	const select = $('vtm-save-agent');
	if (!select) return;
	select.innerHTML = '';
	if (!state.agents.length) {
		const opt = document.createElement('option');
		opt.value = '';
		opt.textContent = 'No agents yet';
		select.appendChild(opt);
		return;
	}
	for (const agent of state.agents) {
		const opt = document.createElement('option');
		opt.value = agent.id;
		opt.textContent = agent.name || 'Agent';
		select.appendChild(opt);
	}
}

async function saveToLibrary() {
	const btn = $('vtm-save-go');
	const agentId = $('vtm-save-agent')?.value;
	if (!agentId) {
		setStatus('No agent selected to save this clip to.', 'error');
		return;
	}
	btn.disabled = true;
	btn.textContent = 'Saving…';
	try {
		const glbBlob = await exportGlbBlob();
		const presignRes = await fetch('/api/animations/presign', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ size_bytes: glbBlob.size, content_type: 'model/gltf-binary', slug: 'video-to-motion' }),
		});
		const presign = await presignRes.json();
		if (!presignRes.ok) throw new Error(presign?.message || 'Could not prepare the save.');

		const put = await fetch(presign.upload_url, {
			method: presign.method || 'PUT',
			headers: presign.headers || { 'content-type': 'model/gltf-binary' },
			body: glbBlob,
		});
		if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

		const { apiFetch } = await import('./api.js');
		const agentRes = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { credentials: 'include' }).then((r) =>
			r.json(),
		);
		const current = Array.isArray(agentRes?.meta?.animations) ? agentRes.meta.animations : [];
		const entry = {
			name: `Video capture ${new Date().toLocaleDateString()}`,
			url: presign.storage_key,
			loop: true,
			source: 'custom',
			addedAt: new Date().toISOString(),
		};
		const putRes = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/animations`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ animations: [...current, entry] }),
		});
		const putData = await putRes.json().catch(() => ({}));
		if (!putRes.ok) throw new Error(putData?.message || 'Could not save the clip.');
		setStatus('Saved to your animation library.', 'success');
	} catch (err) {
		setStatus(err?.message || 'Save failed.', 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save clip';
	}
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function wireUI() {
	const drop = $('vtm-drop');
	const input = $('vtm-file');

	drop.addEventListener('click', () => input.click());
	drop.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			input.click();
		}
	});
	input.addEventListener('change', () => {
		if (input.files?.[0]) handleFile(input.files[0]);
		input.value = '';
	});
	for (const evt of ['dragover', 'dragenter']) {
		drop.addEventListener(evt, (e) => {
			e.preventDefault();
			drop.classList.add('is-drag');
		});
	}
	for (const evt of ['dragleave', 'drop']) {
		drop.addEventListener(evt, (e) => {
			e.preventDefault();
			drop.classList.remove('is-drag');
		});
	}
	drop.addEventListener('drop', (e) => {
		const file = e.dataTransfer?.files?.[0];
		if (file && file.type.startsWith('video/')) handleFile(file);
		else if (file) setStatus('That is not a video file.', 'error');
	});

	$('vtm-retry').addEventListener('click', () => {
		showStage('empty');
		setStatus('');
	});
	$('vtm-new').addEventListener('click', () => {
		const t = state.three;
		if (t) t.playing = false;
		showStage('empty');
		setStatus('');
		history.replaceState(null, '', '/video-to-motion');
	});
	$('vtm-play').addEventListener('click', () => {
		if (state.three) state.three.playing = !state.three.playing;
	});
	$('vtm-restart').addEventListener('click', () => {
		if (state.three?.mixer) state.three.mixer.setTime(0);
	});

	// Avatar picker: stock avatars + URL + file upload.
	const picker = $('vtm-avatars');
	for (const av of STOCK_AVATARS) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'vtm-avatar-chip';
		b.textContent = av.name;
		if (av.url === state.avatarUrl) b.setAttribute('aria-pressed', 'true');
		b.addEventListener('click', async () => {
			picker.querySelectorAll('[aria-pressed]').forEach((x) => x.removeAttribute('aria-pressed'));
			b.setAttribute('aria-pressed', 'true');
			state.avatarUrl = av.url;
			if (state.three && state.clipJSON) {
				try {
					await loadAvatar(state.three, av.url);
				} catch (err) {
					setStatus(err?.message || 'Avatar failed to load.', 'error');
				}
			}
		});
		picker.appendChild(b);
	}
	$('vtm-avatar-url-go').addEventListener('click', async () => {
		const url = $('vtm-avatar-url').value.trim();
		if (!url) return;
		picker.querySelectorAll('[aria-pressed]').forEach((x) => x.removeAttribute('aria-pressed'));
		state.avatarUrl = url;
		if (state.three && state.clipJSON) {
			try {
				await loadAvatar(state.three, url);
			} catch (err) {
				setStatus(err?.message || 'Avatar failed to load. Is it a rigged humanoid GLB?', 'error');
			}
		}
	});
	$('vtm-avatar-file').addEventListener('change', async (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const url = URL.createObjectURL(file);
		picker.querySelectorAll('[aria-pressed]').forEach((x) => x.removeAttribute('aria-pressed'));
		state.avatarUrl = url;
		if (state.three && state.clipJSON) {
			try {
				await loadAvatar(state.three, url);
			} catch (err) {
				setStatus(err?.message || 'Avatar failed to load. Is it a rigged humanoid GLB?', 'error');
			}
		}
	});

	// Trim.
	const startRange = $('vtm-trim-start');
	const endRange = $('vtm-trim-end');
	const applyIfSettled = (() => {
		let timer = null;
		return () => {
			clearTimeout(timer);
			timer = setTimeout(applyTrim, 200);
		};
	})();
	startRange.addEventListener('input', () => {
		const v = Number(startRange.value);
		state.trimStart = Math.min(v, state.trimEnd - 0.1);
		startRange.value = String(state.trimStart);
		$('vtm-trim-start-out').textContent = `${state.trimStart.toFixed(1)}s`;
		applyIfSettled();
	});
	endRange.addEventListener('input', () => {
		const v = Number(endRange.value);
		state.trimEnd = Math.max(v, state.trimStart + 0.1);
		endRange.value = String(state.trimEnd);
		$('vtm-trim-end-out').textContent = `${state.trimEnd.toFixed(1)}s`;
		applyIfSettled();
	});

	// Exports + save.
	$('vtm-export-glb').addEventListener('click', exportGlb);
	$('vtm-export-bvh').addEventListener('click', exportBvh);
	$('vtm-export-fbx').addEventListener('click', exportFbx);
	$('vtm-save-go').addEventListener('click', saveToLibrary);

	window.addEventListener('resize', () => {
		if (state.three) layout(state.three);
	});
}

wireUI();
showStage('empty');
checkSession();
