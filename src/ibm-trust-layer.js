// ── ibm-trust-layer.js ──────────────────────────────────────────────────────
// IBM Granite Guardian "Trust Layer" — governance console for an autonomous,
// wallet-holding 3D AI agent.
//
// Architecture:
//   - Pure logic (HTML builders, decision helpers, scenario data) lives in
//     ibm-trust-layer-logic.js and is unit-tested independently of the DOM.
//   - This file owns: Three.js scene, DOM wiring, fetch, ledger state, events.
//   - No mock data anywhere. When watsonx is unconfigured the page shows an
//     honest error state instead of a fabricated verdict.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { applyStudioLook, createRenderLoop } from './render/index.js';
import {
	RISKS,
	SCENARIOS,
	DECISION,
	SHOWCASE_RISKS,
	buildVerdictHtml,
	buildRiskRowsHtml,
	buildLedgerRowHtml,
	buildAssessBody,
	ledgerTitle,
	verdictTagCopy,
	levelColorHex,
	escapeHtml,
} from './ibm-trust-layer-logic.js';

// ── 3D sentinel ring config ───────────────────────────────────────────────────
const SENTINELS = SHOWCASE_RISKS.map((key) => ({
	key,
	short: RISKS[key]?.label || key,
}));

const GENESIS = '0'.repeat(64);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
	scene:        $('scene'),
	nodeLabels:   $('nodeLabels'),
	hero:         $('hero'),
	verdictTag:   $('verdictTag'),
	vtWord:       $('vtWord'),
	vtSub:        $('vtSub'),
	scenarios:    $('scenarios'),
	msg:          $('msg'),
	sendToggle:   $('sendToggle'),
	amountWrap:   $('amountWrap'),
	amount:       $('amount'),
	runBtn:       $('runBtn'),
	runLabel:     null,  // set in wire()
	modelPill:    $('modelPill'),
	kbdHint:      $('kbdHint'),
	verdict:      $('verdict'),
	verdictInner: $('verdictInner'),
	risks:        $('risks'),
	riskRows:     $('riskRows'),
	ledgerBody:   $('ledgerBody'),
	ledgerCnt:    $('ledgerCnt'),
	verifyBtn:    $('verifyBtn'),
	verifyLabel:  null,  // set in wire()
	exportBtn:    $('exportBtn'),
	loading:      $('loadingState'),
	unavailable:  $('unavailableState'),
	error:        $('errorState'),
	errorMsg:     $('errorMsg'),
	retryBtn:     $('retryBtn'),
	toast:        $('toast'),
};

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
	chain:    [],     // [{ record, title, decision }]
	busy:     false,
	firstRun: true,
};

// ── 3D scene ──────────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, core, shield, ring, nodes = [], starfield, clock;
let sceneOk = false;

const C_LOW  = new THREE.Color(0x2bb673);
const C_MID  = new THREE.Color(0xf1c21b);
const C_HIGH = new THREE.Color(0xfa4d56);
const C_IDLE = new THREE.Color(0x3a4664);
const C_IBM  = new THREE.Color(0x0f62fe);

function lerpColor(a, b, t) { return a.clone().lerp(b, t); }

function levelColorThree(t) {
	if (t <= 0) return C_IDLE.clone();
	return t < 0.5
		? lerpColor(C_LOW, C_MID, t / 0.5)
		: lerpColor(C_MID, C_HIGH, (t - 0.5) / 0.5);
}

function initScene() {
	try {
		renderer = new THREE.WebGLRenderer({ canvas: els.scene, antialias: true, alpha: true });
	} catch {
		els.scene.style.display = 'none';
		els.nodeLabels.style.display = 'none';
		return false;
	}
	renderer.setSize(window.innerWidth, window.innerHeight);

	scene  = new THREE.Scene();
	// toneMapping 'none' keeps the hand-picked IBM blue palette; the low environment
	// adds gloss to the metallic core and sentinel nodes without lifting it.
	applyStudioLook(renderer, scene, { toneMapping: 'none', environmentIntensity: 0.3 });
	camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
	camera.position.set(0, 0.6, 8.4);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping  = true;
	controls.dampingFactor  = 0.08;
	controls.enablePan      = false;
	controls.minDistance    = 5.5;
	controls.maxDistance    = 13;
	controls.autoRotate     = true;
	controls.autoRotateSpeed = 0.55;

	scene.add(new THREE.AmbientLight(0x6b7a9c, 0.7));
	const key = new THREE.PointLight(0x9bb8ff, 1.5, 40);
	key.position.set(6, 7, 9);
	scene.add(key);
	const rim = new THREE.PointLight(0x0f62fe, 1.1, 40);
	rim.position.set(-8, -3, -6);
	scene.add(rim);

	core = new THREE.Mesh(
		new THREE.IcosahedronGeometry(0.9, 2),
		new THREE.MeshStandardMaterial({
			color: 0x0b1a3a, emissive: 0x0f62fe, emissiveIntensity: 0.6,
			metalness: 0.5, roughness: 0.3, flatShading: true,
		}),
	);
	scene.add(core);
	const coreGlow = new THREE.Mesh(
		new THREE.IcosahedronGeometry(0.94, 2),
		new THREE.MeshBasicMaterial({ color: 0x78a9ff, wireframe: true, transparent: true, opacity: 0.25 }),
	);
	core.add(coreGlow);

	shield = new THREE.Mesh(
		new THREE.SphereGeometry(1.55, 32, 24),
		new THREE.MeshBasicMaterial({ color: 0x42be65, wireframe: true, transparent: true, opacity: 0 }),
	);
	shield.userData = { color: new THREE.Color(0x42be65), opacity: 0 };
	scene.add(shield);

	ring = new THREE.Mesh(
		new THREE.TorusGeometry(3.0, 0.012, 8, 120),
		new THREE.MeshBasicMaterial({ color: 0x2a3550, transparent: true, opacity: 0.7 }),
	);
	ring.rotation.x = Math.PI / 2.2;
	scene.add(ring);

	const R = 3.0;
	nodes = SENTINELS.map((s, i) => {
		const a   = (i / SENTINELS.length) * Math.PI * 2 - Math.PI / 2;
		const pos = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R * 0.42, Math.sin(a) * R * 0.5);
		const mesh = new THREE.Mesh(
			new THREE.SphereGeometry(0.17, 24, 24),
			new THREE.MeshStandardMaterial({ color: 0x3a4664, emissive: 0x3a4664, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.5 }),
		);
		mesh.position.copy(pos);
		scene.add(mesh);

		const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), pos.clone()]);
		const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x2a3550, transparent: true, opacity: 0.4 }));
		scene.add(line);

		const label = document.createElement('div');
		label.className = 'nlabel';
		label.textContent = s.short;
		els.nodeLabels.appendChild(label);

		return { ...s, mesh, line, label, basePos: pos.clone(), level: 0, target: 0, flagged: false, active: true };
	});

	const starGeo = new THREE.BufferGeometry();
	const N = 380, arr = new Float32Array(N * 3);
	for (let i = 0; i < N; i++) {
		const r  = 14 + Math.random() * 24;
		const th = Math.random() * Math.PI * 2;
		const ph = Math.acos(2 * Math.random() - 1);
		arr[i * 3]     = r * Math.sin(ph) * Math.cos(th);
		arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
		arr[i * 3 + 2] = r * Math.cos(ph);
	}
	starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
	starfield = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x4a5677, size: 0.06, transparent: true, opacity: 0.7 }));
	scene.add(starfield);

	clock = new THREE.Timer();
	window.addEventListener('resize', onResize);
	sceneOk = true;
	return true;
}

function onResize() {
	if (!sceneOk) return;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

const _v = new THREE.Vector3();
function animate() {
	if (!sceneOk) return;
	clock.update();
	const dt = clock.getDelta();
	const t  = clock.getElapsed();
	controls.update();
	core.rotation.y += dt * 0.25;
	core.rotation.x += dt * 0.08;
	if (starfield) starfield.rotation.y += dt * 0.01;

	core.material.emissiveIntensity = 0.5 + Math.sin(t * 1.6) * 0.08;

	const sd = shield.userData;
	shield.material.color.lerp(sd.color, 0.08);
	shield.material.opacity += (sd.opacity - shield.material.opacity) * 0.08;
	shield.rotation.y -= dt * 0.18;
	shield.rotation.z += dt * 0.05;
	const jitter = sd.opacity > 0.3 && sd.color.r > 0.9 ? (Math.random() - 0.5) * 0.02 : 0;
	shield.scale.setScalar(1 + Math.sin(t * 2.2) * 0.012 + jitter);

	const w = window.innerWidth, h = window.innerHeight;
	for (const n of nodes) {
		n.level += (n.target - n.level) * 0.09;
		const col = n.active ? levelColorThree(n.level) : C_IDLE;
		n.mesh.material.color.lerp(col, 0.12);
		n.mesh.material.emissive.lerp(col, 0.12);
		const pulse = n.flagged ? 1 + Math.sin(t * 5 + n.basePos.x) * 0.18 : 1 + n.level * 0.25;
		n.mesh.scale.setScalar(pulse);
		n.mesh.material.emissiveIntensity = 0.4 + n.level * 1.1;
		const pull = n.flagged ? 0.82 : 1;
		n.mesh.position.copy(n.basePos).multiplyScalar(pull);
		n.line.geometry.attributes.position.setXYZ(1, n.mesh.position.x, n.mesh.position.y, n.mesh.position.z);
		n.line.geometry.attributes.position.needsUpdate = true;
		n.line.material.color.lerp(col, 0.12);
		n.line.material.opacity = 0.25 + n.level * 0.6;

		n.mesh.getWorldPosition(_v).project(camera);
		const vis = _v.z < 1;
		n.label.style.opacity = vis ? String(n.active ? 1 : 0.35) : '0';
		if (vis) {
			n.label.style.transform = `translate(-50%,-50%) translate(${(_v.x * 0.5 + 0.5) * w}px,${(-_v.y * 0.5 + 0.5) * h}px)`;
			const hex = '#' + col.getHexString();
			n.label.style.color       = n.flagged ? hex : (n.active ? 'var(--muted)' : 'var(--faint)');
			n.label.style.borderColor = n.flagged ? hex : 'var(--border)';
		}
	}
	renderer.render(scene, camera);
}

function applyToScene(result) {
	if (!sceneOk) return;
	const byKey = new Map((result.risks || []).map((r) => [r.risk, r]));
	for (const n of nodes) {
		const r = byKey.get(n.key);
		if (r) { n.active = true; n.target = r.probability; n.flagged = r.flagged; }
		else    { n.active = false; n.target = 0; n.flagged = false; }
	}
	const dec = DECISION[result.decision] || DECISION.review;
	shield.userData.color   = new THREE.Color(dec.hex);
	shield.userData.opacity = result.decision === 'allow' ? 0.14 : result.decision === 'review' ? 0.32 : 0.58;
	core.material.emissive  = result.decision === 'block' ? new THREE.Color(dec.hex) : C_IBM.clone();
}

// ── Governance request ────────────────────────────────────────────────────────
async function assess() {
	if (state.busy) return;
	const text = els.msg.value.trim();
	if (!text) { toast('Type a request for the agent first.'); els.msg.focus(); return; }

	const isSend = els.sendToggle.checked;
	const usd    = Math.max(1, Math.round(Number(els.amount.value) || 0));
	const prev   = state.chain.length ? state.chain[state.chain.length - 1].record.hash : GENESIS;
	const body   = buildAssessBody({ text, isSend, usd, prevHash: prev });

	setBusy(true);
	showRiskSkeleton();

	let res;
	try {
		res = await fetch('/api/guardian/assess', {
			method:  'POST',
			headers: { 'content-type': 'application/json' },
			body:    JSON.stringify(body),
		});
	} catch {
		setBusy(false);
		hideRiskSkeleton();
		return showError('Network error reaching the governance service. Check your connection and try again.');
	}

	let data = null;
	if ((res.headers.get('content-type') || '').includes('application/json')) {
		try { data = await res.json(); } catch { /* fall through */ }
	}
	setBusy(false);
	hideRiskSkeleton();

	if (res.status === 503 && data?.error === 'guardian_unconfigured') {
		return showOverlay(els.unavailable);
	}
	if (res.status === 429) {
		return toast('Rate limited — Granite Guardian is catching its breath.', true);
	}
	if (!res.ok || !data || !data.record) {
		return showError(
			data?.error_description ||
			`Governance service returned ${res.status}. The /api/guardian/assess endpoint may not be deployed yet.`,
		);
	}

	renderResult(data, { text, isSend, usd });
	if (data.model) els.modelPill.textContent = data.model.split('/').pop();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderResult(data, ctx) {
	if (state.firstRun) {
		els.hero.classList.add('dim');
		state.firstRun = false;
	}
	applyToScene(data);
	renderVerdict(data);
	renderRisks(data);
	pushLedger(data, ctx);
	renderVerdictTag(data);
}

function renderVerdict(data) {
	const dec = DECISION[data.decision] || DECISION.review;
	// Swap out border colour to match the decision.
	els.verdict.style.setProperty('--vborder', dec.hex + '55');
	els.verdictInner.innerHTML = buildVerdictHtml(data);
	els.verdict.className = `verdict show ${dec.cls}`;
}

function renderRisks(data) {
	els.riskRows.innerHTML = buildRiskRowsHtml(data.risks);
	// Animate the bars: first frame they're at 0 (CSS transition handles travel).
	// The CSS variable --pct is set in the HTML; the transition fires on paint.
	els.riskRows.querySelectorAll('.rbar-fill').forEach((fill) => {
		const target = fill.style.getPropertyValue('--pct');
		fill.style.setProperty('--pct', '0%');
		requestAnimationFrame(() => {
			requestAnimationFrame(() => fill.style.setProperty('--pct', target));
		});
	});
	els.risks.classList.add('show');
}

function renderVerdictTag(data) {
	const { word, hex, sub } = verdictTagCopy(data);
	els.vtWord.textContent  = word;
	els.vtWord.style.color  = hex;
	els.vtSub.textContent   = sub;
	els.verdictTag.classList.add('show');
}

// ── Skeleton shimmer while waiting ───────────────────────────────────────────
function showRiskSkeleton() {
	els.riskRows.innerHTML = SHOWCASE_RISKS.map((r) =>
		`<div class="rrow skeleton" aria-hidden="true">` +
		`<span class="rn sk-line sk-name"></span>` +
		`<span class="rbar"><i class="rbar-fill" style="--pct:0%;--col:#2a3550"></i></span>` +
		`<span class="rv sk-line sk-pct"></span>` +
		`</div>`,
	).join('');
	els.risks.classList.add('show');
}

function hideRiskSkeleton() {
	// Actual content comes in via renderRisks(); nothing to do here.
}

// ── Audit ledger ──────────────────────────────────────────────────────────────
function pushLedger(data, ctx) {
	const title = ledgerTitle(ctx.isSend, ctx.usd, ctx.text);
	state.chain.push({ record: data.record, title, decision: data.decision });
	resetVerifyButton();
	renderLedger();
}

function renderLedger() {
	els.ledgerCnt.textContent  = `· ${state.chain.length}`;
	els.exportBtn.disabled     = state.chain.length === 0;
	if (!state.chain.length) return;
	// Newest first.
	els.ledgerBody.innerHTML = [...state.chain]
		.reverse()
		.map((e, rIdx) => buildLedgerRowHtml(e, state.chain.length - 1 - rIdx))
		.join('');
}

function resetVerifyButton() {
	els.verifyBtn.className    = 'l-verify';
	els.verifyLabel.textContent = 'Verify chain';
}

async function exportLedger() {
	if (!state.chain.length) return;
	const json = JSON.stringify(state.chain.map((e) => e.record), null, 2);
	try {
		await navigator.clipboard.writeText(json);
		toast(`Ledger copied — ${state.chain.length} record(s). Re-verify offline anywhere.`);
	} catch {
		const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
		const a   = document.createElement('a');
		a.href = url; a.download = 'granite-guardian-ledger.json'; a.click();
		URL.revokeObjectURL(url);
		toast(`Ledger downloaded — ${state.chain.length} record(s).`);
	}
}

async function sha256Hex(str) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyChain() {
	if (!state.chain.length) { toast('No records yet.'); return; }
	let prev = GENESIS, allOk = true;
	const statuses = [];
	for (const e of state.chain) {
		const { hash, ...rest } = e.record;
		const recomputed = await sha256Hex(JSON.stringify(rest));
		const ok = recomputed === hash && rest.prev === prev;
		statuses.push(ok);
		if (!ok) allOk = false;
		prev = hash;
	}
	// Rows are rendered newest-first, so index mapping is reversed.
	statuses.forEach((ok, i) => {
		const cell = els.ledgerBody.querySelector(`[data-status="${i}"]`);
		if (!cell) return;
		cell.className = `lc ${ok ? 'ok' : 'bad'}`;
		cell.innerHTML = ok
			? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
			: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
	});
	els.verifyBtn.className      = `l-verify ${allOk ? 'ok' : 'bad'}`;
	els.verifyLabel.textContent  = allOk ? `Chain intact · ${state.chain.length}` : 'Tamper detected';
	toast(
		allOk ? `Hash chain verified — ${state.chain.length} record(s) intact.` : 'Chain verification failed.',
		!allOk,
	);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setBusy(b) {
	state.busy = b;
	els.runBtn.classList.toggle('busy', b);
	els.runBtn.disabled = b;
	els.runLabel.textContent = b ? 'Assessing…' : 'Assess with Granite Guardian';
}

function showOverlay(el) { el.classList.add('show'); }
function hideOverlay(el) { el.classList.remove('show'); }
function showError(msg)  { els.errorMsg.textContent = msg; showOverlay(els.error); }

let toastT;
function toast(msg, isErr) {
	els.toast.textContent = msg;
	els.toast.className   = `toast show${isErr ? ' err' : ''}`;
	clearTimeout(toastT);
	toastT = setTimeout(() => { els.toast.className = 'toast'; }, 3500);
}

function applyScenario(s) {
	els.msg.value          = s.text;
	els.sendToggle.checked = !!s.send;
	if (s.send) els.amount.value = s.usd;
	syncSendUI();
	els.msg.focus();
}

function syncSendUI() {
	els.amountWrap.classList.toggle('show', els.sendToggle.checked);
}

function buildScenarios() {
	els.scenarios.innerHTML = '';
	for (const s of SCENARIOS) {
		const b        = document.createElement('button');
		b.type         = 'button';
		b.className    = 'chip';
		b.dataset.tone = s.tone;
		b.setAttribute('aria-label', `Load scenario: ${s.label}`);
		b.innerHTML    = `<span class="ci" aria-hidden="true"></span>${escapeHtml(s.label)}`;
		b.addEventListener('click', () => applyScenario(s));
		els.scenarios.appendChild(b);
	}
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function wire() {
	els.runLabel  = els.runBtn.querySelector('.lbl');
	els.verifyLabel = els.verifyBtn.querySelector('.vb-label');

	buildScenarios();
	els.runBtn.addEventListener('click', assess);
	els.verifyBtn.addEventListener('click', verifyChain);
	els.exportBtn.addEventListener('click', exportLedger);
	els.sendToggle.addEventListener('change', syncSendUI);
	els.retryBtn.addEventListener('click', () => hideOverlay(els.error));
	els.msg.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); assess(); }
	});
	// Show keyboard hint on first focus
	els.msg.addEventListener('focus', () => {
		if (els.kbdHint) els.kbdHint.style.opacity = '1';
	}, { once: true });
	syncSendUI();
}

function boot() {
	wire();
	const ok = initScene();
	if (ok) createRenderLoop({ renderer, frame: animate }).start();
	requestAnimationFrame(() => requestAnimationFrame(() => hideOverlay(els.loading)));
}

boot();
