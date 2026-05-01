<script context="module">
	// Shared across all instances — render each avatar URL once per session
	const cache = new Map();
	const inflight = new Map();
</script>

<script>
	import { onMount } from 'svelte';
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
	} from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

	export let avatarUrl = '';

	let dataUrl = cache.get(avatarUrl) ?? null;
	let state = dataUrl ? 'done' : avatarUrl ? 'loading' : 'error';

	onMount(() => {
		if (state !== 'loading') return;
		renderAvatar();
	});

	async function renderAvatar() {
		if (cache.has(avatarUrl)) {
			dataUrl = cache.get(avatarUrl);
			state = 'done';
			return;
		}

		// Deduplicate concurrent renders of the same URL
		if (inflight.has(avatarUrl)) {
			try {
				dataUrl = await inflight.get(avatarUrl);
				state = 'done';
			} catch {
				state = 'error';
			}
			return;
		}

		const promise = doRender(avatarUrl);
		inflight.set(avatarUrl, promise);

		try {
			dataUrl = await promise;
			state = 'done';
		} catch {
			state = 'error';
		} finally {
			inflight.delete(avatarUrl);
		}
	}

	async function doRender(url) {
		const resp = await fetch(url, { mode: 'cors' });
		if (!resp.ok) throw new Error(resp.status);
		const buffer = await resp.arrayBuffer();

		const loader = new GLTFLoader();
		const gltf = await new Promise((resolve, reject) =>
			loader.parse(buffer, '', resolve, reject),
		);

		const scene = new Scene();
		scene.add(gltf.scene);

		const box = new Box3().setFromObject(gltf.scene);
		const center = box.getCenter(new Vector3());
		const boxSize = box.getSize(new Vector3());

		// Frame the face — upper ~35% of the avatar's bounding box
		const faceY = center.y + boxSize.y * 0.32;
		const faceHeight = boxSize.y * 0.28;
		const fov = 22;
		const dist = faceHeight / (2 * Math.tan(((Math.PI / 180) * fov) / 2));

		const camera = new PerspectiveCamera(fov, 1, 0.01, 1000);
		camera.position.set(center.x, faceY, center.z + dist * 1.2);
		camera.lookAt(center.x, faceY, center.z);

		scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));
		const dir = new DirectionalLight(0xffffff, 2.5);
		dir.position.set(3, 10, 7);
		scene.add(dir);

		const offscreen = document.createElement('canvas');
		offscreen.width = 128;
		offscreen.height = 128;
		const renderer = new WebGLRenderer({ canvas: offscreen, antialias: true, alpha: true });
		renderer.setPixelRatio(1);
		renderer.setSize(128, 128, false);
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
		renderer.render(scene, camera);

		const result = offscreen.toDataURL('image/png');
		cache.set(url, result);

		renderer.dispose();
		scene.traverse((obj) => {
			obj.geometry?.dispose();
			const mats = Array.isArray(obj.material)
				? obj.material
				: obj.material
					? [obj.material]
					: [];
			for (const m of mats) m.dispose();
		});

		return result;
	}
</script>

{#if state === 'done' && dataUrl}
	<img src={dataUrl} alt="" class="h-full w-full object-cover" />
{:else if state === 'loading'}
	<div class="h-full w-full animate-pulse bg-teal-100" />
{/if}
