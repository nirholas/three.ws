<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		Scene,
		PerspectiveCamera,
		WebGLRenderer,
		HemisphereLight,
		DirectionalLight,
		Color,
		Box3,
		Vector3,
		SRGBColorSpace,
		ACESFilmicToneMapping,
	} from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

	let {
		thumbnail_url = null,
		model_url = null,
		alt = '',
		size = 128,
		class_name = 'h-16 w-full rounded-sm object-cover',
		bg_color = '#e8e8e8',
	} = $props();

	let canvas = $state();
	let loadState = $state(thumbnail_url ? 'done' : model_url ? 'idle' : 'none');
	let observer;

	onMount(() => {
		if (loadState !== 'idle') return;
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					observer.disconnect();
					renderPreview();
				}
			},
			{ rootMargin: '100px' },
		);
		observer.observe(canvas);
	});

	onDestroy(() => {
		observer?.disconnect();
	});

	async function renderPreview() {
		loadState = 'loading';
		try {
			const resp = await fetch(model_url, { mode: 'cors' });
			if (!resp.ok) throw new Error(resp.status);
			const buffer = await resp.arrayBuffer();

			const loader = new GLTFLoader();
			const gltf = await new Promise((resolve, reject) =>
				loader.parse(buffer, '', resolve, reject),
			);

			const scene = new Scene();
			scene.background = new Color(bg_color);
			scene.add(gltf.scene);

			const box = new Box3().setFromObject(gltf.scene);
			const center = box.getCenter(new Vector3());
			const boxSize = box.getSize(new Vector3());
			const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;

			const fov = 35;
			const camera = new PerspectiveCamera(fov, 1, 0.01, 1000);
			const dist = maxDim / (2 * Math.tan((Math.PI * fov) / 360));
			camera.position.set(center.x, center.y + boxSize.y * 0.05, center.z + dist * 1.8);
			camera.lookAt(center.x, center.y, center.z);

			scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));
			const dir = new DirectionalLight(0xffffff, 2.5);
			dir.position.set(3, 10, 7);
			scene.add(dir);

			const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
			renderer.setPixelRatio(1);
			renderer.setSize(size, size, false);
			renderer.outputColorSpace = SRGBColorSpace;
			renderer.toneMapping = ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.0;
			renderer.render(scene, camera);
			renderer.dispose();

			scene.traverse((obj) => {
				obj.geometry?.dispose();
				const mats = obj.material
					? Array.isArray(obj.material)
						? obj.material
						: [obj.material]
					: [];
				for (const m of mats) m.dispose();
			});

			loadState = 'done';
		} catch {
			loadState = 'error';
		}
	}
</script>

{#if thumbnail_url}
	<img src={thumbnail_url} {alt} class={class_name} loading="lazy" />
{:else if loadState === 'none'}
	<div class="{class_name} flex items-center justify-center bg-slate-100 text-[10px] text-slate-400">
		No preview
	</div>
{:else}
	<canvas
		bind:this={canvas}
		width={size}
		height={size}
		class="{class_name} {loadState === 'loading' ? 'animate-pulse bg-slate-100' : ''} {loadState === 'error' ? 'hidden' : ''}"
	></canvas>
	{#if loadState === 'error'}
		<div class="{class_name} flex items-center justify-center bg-slate-100 text-[10px] text-slate-400">
			No preview
		</div>
	{/if}
{/if}
