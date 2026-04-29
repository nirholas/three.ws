/**
 * playFirstMeet — first-encounter celebration sequence for a newly generated avatar.
 *
 * @param {object} opts
 * @param {object} opts.viewer    — SceneController / AgentAvatar (duck-typed: .playClip(name) OR .mixer + .animations)
 * @param {{ id: string, name: string, slug: string }} opts.agent
 * @param {() => void} opts.onShare    — called when user clicks "Share"
 * @param {() => void} opts.onContinue — called when user clicks "Continue"
 * @returns {Promise<void>} resolves when user clicks either button
 */
export async function playFirstMeet({ viewer, agent, onShare, onContinue }) {
	const reducedMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	// Inject stylesheet once
	if (!document.querySelector('link[data-fm-css]')) {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = new URL('./first-meet.css', import.meta.url).href;
		link.dataset.fmCss = '1';
		document.head.appendChild(link);
	}

	// Build root overlay
	const root = document.createElement('div');
	root.className = 'first-meet-root';

	// Fade overlay (black → transparent)
	const overlay = document.createElement('div');
	overlay.className = 'fm-fade-overlay';

	// Subtitle
	const subtitle = document.createElement('div');
	subtitle.className = 'fm-subtitle';
	subtitle.textContent = `Hello, I'm ${agent?.name ?? 'your agent'}.`;

	// Action buttons
	const actions = document.createElement('div');
	actions.className = 'fm-actions';

	const btnShare = document.createElement('button');
	btnShare.className = 'fm-btn fm-btn-share';
	btnShare.textContent = 'Share';

	const btnContinue = document.createElement('button');
	btnContinue.className = 'fm-btn fm-btn-continue';
	btnContinue.textContent = 'Continue';

	actions.appendChild(btnShare);
	actions.appendChild(btnContinue);
	root.appendChild(overlay);
	root.appendChild(subtitle);
	root.appendChild(actions);
	document.body.appendChild(root);

	// ── Helpers ───────────────────────────────────────────────────────────────

	function delay(ms) {
		return new Promise((res) => setTimeout(res, ms));
	}

	// Try to play a wave gesture on the viewer (duck-typed).
	// Order probed:
	//   1. viewer.playClip('Wave') — exact name
	//   2. viewer.playClip('wave') — lowercase
	//   3. viewer.playAnimationByHint?.('wave') — partial name search (SceneController)
	//   4. Scripted bone tilt via viewer.mixer + content skeleton
	//      — bones probed: 'mixamorigRightHand', 'RightHand', 'mixamorigRightArm', 'RightArm'
	function tryWave() {
		if (reducedMotion) return;

		// Method 1 & 2: direct clip by name
		if (typeof viewer?.playClip === 'function') {
			if (viewer.playClip('Wave')) return;
			if (viewer.playClip('wave')) return;
		}

		// Method 3: SceneController hint search
		if (typeof viewer?.playAnimationByHint === 'function') {
			if (viewer.playAnimationByHint('wave')) return;
			if (viewer.playAnimationByHint('Wave')) return;
		}

		// Method 4: scripted bone animation if mixer exists
		const mixer = viewer?.mixer;
		const root3d = viewer?.content ?? viewer?.scene;
		if (!mixer || !root3d) return;

		const BONE_NAMES = ['mixamorigRightHand', 'RightHand', 'mixamorigRightArm', 'RightArm'];
		let targetBone = null;
		root3d.traverse?.((obj) => {
			if (targetBone) return;
			if (obj.isBone && BONE_NAMES.includes(obj.name)) targetBone = obj;
		});
		if (!targetBone) return;

		// Simple scripted tilt: raise then return over 1.2s using rAF
		const origZ = targetBone.rotation.z;
		const origX = targetBone.rotation.x;
		const RAISE_Z = 1.2; // radians
		const RAISE_X = -0.5;
		const DURATION = 1200; // ms
		let start = null;

		function animateBone(ts) {
			if (!start) start = ts;
			const t = Math.min((ts - start) / DURATION, 1);
			// Ease in-out cubic
			const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			const wave = Math.sin(t * Math.PI); // arc: 0 → 1 → 0
			targetBone.rotation.z = origZ + RAISE_Z * wave * ease;
			targetBone.rotation.x = origX + RAISE_X * wave * ease;
			if (t < 1) requestAnimationFrame(animateBone);
			else {
				targetBone.rotation.z = origZ;
				targetBone.rotation.x = origX;
			}
		}
		requestAnimationFrame(animateBone);
	}

	// Spawn CSS confetti: 40–60 spans, random hue/size/rotation/position/duration
	function spawnConfetti() {
		if (reducedMotion) return;
		const count = 40 + Math.floor(Math.random() * 21);
		const pieces = [];
		for (let i = 0; i < count; i++) {
			const span = document.createElement('span');
			span.className = 'fm-confetti-piece';
			const hue = Math.floor(Math.random() * 360);
			const w = 6 + Math.random() * 8;
			const h = 10 + Math.random() * 10;
			const left = Math.random() * 100;
			const duration = 1.4 + Math.random() * 0.8;
			const delay_ = Math.random() * 0.4;
			const rot = Math.floor(Math.random() * 360);
			span.style.cssText = `
				left: ${left}%;
				width: ${w}px;
				height: ${h}px;
				background: hsl(${hue},80%,60%);
				transform: rotate(${rot}deg);
				animation-duration: ${duration}s;
				animation-delay: ${delay_}s;
			`.replace(/\s+/g, ' ');
			root.appendChild(span);
			pieces.push(span);
		}
		// Clean up after 2s
		setTimeout(() => pieces.forEach((p) => p.remove()), 2000);
	}

	// ── Sequence ──────────────────────────────────────────────────────────────

	// t=0.0 — fade overlay out (scene reveal)
	await delay(0);
	requestAnimationFrame(() => overlay.classList.add('fm-faded'));

	// t=0.2 — wave
	await delay(200);
	tryWave();

	// t=0.6 — subtitle fades in
	await delay(400);
	subtitle.classList.add('fm-visible');

	// t=1.4 — confetti burst
	await delay(800);
	spawnConfetti();

	// t=2.2 — buttons fade in
	await delay(800);
	actions.classList.add('fm-visible');

	// ── Wait for user ─────────────────────────────────────────────────────────

	await new Promise((resolve) => {
		function cleanup() {
			root.remove();
		}

		btnShare.addEventListener('click', () => {
			cleanup();
			onShare?.();
			resolve();
		});

		btnContinue.addEventListener('click', () => {
			cleanup();
			onContinue?.();
			resolve();
		});
	});
}
