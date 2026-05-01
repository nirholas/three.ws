<script context="module">
	import {
		Scene,
		PerspectiveCamera,
		WebGLRenderer,
		HemisphereLight,
		DirectionalLight,
		Box3,
		Vector3,
		SRGBColorSpace,
		ACESFilmicToneMapping,
		AnimationMixer,
		AnimationClip,
		LoopRepeat,
		Clock,
	} from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

	const gltfCache = new Map(); // url -> Promise<gltf>
	let walkClipPromise = null;
	let idleClipPromise = null;

	function loadGLTF(url) {
		if (!gltfCache.has(url)) {
			const p = fetch(url, { mode: 'cors' })
				.then((r) => {
					if (!r.ok) throw new Error(r.status);
					return r.arrayBuffer();
				})
				.then(
					(buf) =>
						new Promise((resolve, reject) =>
							new GLTFLoader().parse(buf, '', resolve, reject),
						),
				);
			gltfCache.set(url, p);
		}
		return gltfCache.get(url);
	}

	async function loadClip(url) {
		const r = await fetch(url);
		if (!r.ok) throw new Error(r.status);
		const json = await r.json();
		const clip = AnimationClip.parse(json);
		// Strip root translation so the avatar walks in place (camera stays framed).
		clip.tracks = clip.tracks.filter((t) => !/Hips\.position/i.test(t.name));
		return clip;
	}

	function getWalkClip() {
		if (!walkClipPromise) walkClipPromise = loadClip('/animations/clips/walk.json');
		return walkClipPromise;
	}
	function getIdleClip() {
		if (!idleClipPromise) idleClipPromise = loadClip('/animations/clips/idle.json');
		return idleClipPromise;
	}
</script>

<script>
	import { onMount, onDestroy } from 'svelte';
	import { generating } from './stores.js';

	export let avatarUrl = '';
	/** When true (default), avatar plays walking while $generating, idle otherwise.
	 *  When false, renders a single still frame (cheap for dense lists). */
	export let live = true;

	let canvas;
	let state = avatarUrl ? 'loading' : 'error';
	let mixer = null;
	let walkAction = null;
	let idleAction = null;
	let renderer = null;
	let scene = null;
	let camera = null;
	let clock = null;
	let rafId = 0;
	let visible = false;
	let observer;
	let docVisible = typeof document === 'undefined' || !document.hidden;

	function onDocVis() {
		docVisible = !document.hidden;
		tickPlayState();
	}

	onMount(async () => {
		if (!avatarUrl) return;
		try {
			const gltf = await loadGLTF(avatarUrl);
			const root = cloneSkeleton(gltf.scene);
			scene = new Scene();
			scene.add(root);
			scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));
			const dir = new DirectionalLight(0xffffff, 2.5);
			dir.position.set(3, 10, 7);
			scene.add(dir);

			const box = new Box3().setFromObject(root);
			const center = box.getCenter(new Vector3());
			const sz = box.getSize(new Vector3());
			const faceY = center.y + sz.y * 0.32;
			const faceHeight = sz.y * 0.32;
			const fov = 24;
			const dist = faceHeight / (2 * Math.tan(((Math.PI / 180) * fov) / 2));
			camera = new PerspectiveCamera(fov, 1, 0.01, 1000);
			camera.position.set(center.x, faceY, center.z + dist * 1.25);
			camera.lookAt(center.x, faceY, center.z);

			renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(128, 128, false);
			renderer.outputColorSpace = SRGBColorSpace;
			renderer.toneMapping = ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.0;

			if (live) {
				clock = new Clock();
				mixer = new AnimationMixer(root);
				const [walkClip, idleClip] = await Promise.all([getWalkClip(), getIdleClip()]).catch(
					() => [null, null],
				);
				if (walkClip) {
					walkAction = mixer.clipAction(walkClip);
					walkAction.setLoop(LoopRepeat).play();
					walkAction.weight = 0;
				}
				if (idleClip) {
					idleAction = mixer.clipAction(idleClip);
					idleAction.setLoop(LoopRepeat).play();
					idleAction.weight = 1;
				}

				observer = new IntersectionObserver(
					(entries) => {
						visible = entries[0].isIntersecting;
						tickPlayState();
					},
					{ rootMargin: '50px' },
				);
				observer.observe(canvas);
				document.addEventListener('visibilitychange', onDocVis);
			}

			renderer.render(scene, camera);
			state = 'done';
		} catch {
			state = 'error';
		}
	});

	function tickPlayState() {
		const shouldRun = live && visible && docVisible;
		if (shouldRun && !rafId) loop();
		if (!shouldRun && rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	function loop() {
		rafId = requestAnimationFrame(loop);
		const dt = clock?.getDelta() || 0;
		if (mixer) {
			// Crossfade between idle and walk based on $generating
			const targetWalk = $generating ? 1 : 0;
			if (walkAction) walkAction.weight += (targetWalk - walkAction.weight) * Math.min(1, dt * 6);
			if (idleAction)
				idleAction.weight += (1 - targetWalk - idleAction.weight) * Math.min(1, dt * 6);
			mixer.update(dt);
		}
		renderer?.render(scene, camera);
	}

	$: if (live && mixer) tickPlayState();

	onDestroy(() => {
		observer?.disconnect();
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onDocVis);
		if (rafId) cancelAnimationFrame(rafId);
		renderer?.dispose();
		scene?.traverse((obj) => {
			obj.geometry?.dispose();
			const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
			for (const m of mats) m.dispose();
		});
	});
</script>

<span class="h-full w-full block {state === 'done' ? 'avatar-fall-in' : 'invisible'}">
	<canvas
		bind:this={canvas}
		width="128"
		height="128"
		class="h-full w-full object-cover {$generating && live ? 'avatar-bob' : ''}"
	/>
</span>

<style>
	@keyframes avatar-bob {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-2px); }
	}
	.avatar-bob {
		animation: avatar-bob 0.7s ease-in-out infinite;
	}
	@keyframes avatar-fall-in {
		0% { transform: translateY(-120%); opacity: 0; }
		70% { transform: translateY(8%); opacity: 1; }
		100% { transform: translateY(0); opacity: 1; }
	}
	.avatar-fall-in {
		animation: avatar-fall-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	@media (prefers-reduced-motion: reduce) {
		.avatar-bob { animation: none; }
		.avatar-fall-in { animation: none; }
	}
</style>
