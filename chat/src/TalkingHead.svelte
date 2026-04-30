<!--
  TalkingHead.svelte — embed met4citizen/TalkingHead in the chat sidebar.

  Usage:
    <TalkingHead bind:this={head} avatarUrl={...} ttsEndpoint={...} />
    head.speak({ text: 'hi', mood: 'neutral' });

  TalkingHead is loaded from a CDN as ES modules, mirroring the upstream
  README. Avoids vendoring three.js + RPM loaders — they already use
  importmaps. We bridge the chat reply pipeline → head.speakText() so a new
  assistant message produces lipsynced speech.

  Repo: https://github.com/met4citizen/TalkingHead  (MIT)
-->
<script>
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';

	export let avatarUrl =
		'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png';
	export let avatarBody = 'F';
	export let ttsEndpoint = '/api/tts/google';
	export let ttsApikey = '';
	export let lipsyncModules = ['en'];

	const CDN_URL =
		'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs';

	const dispatch = createEventDispatcher();

	let container;
	let head = null;
	let loadError = null;

	function importWithTimeout(url, ms) {
		return Promise.race([
			import(/* @vite-ignore */ url),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('CDN load timed out')), ms)
			),
		]);
	}

	async function loadAvatar() {
		loadError = null;
		if (head?.stop) head.stop();
		head = null;

		try {
			let mod;
			try {
				mod = await importWithTimeout(CDN_URL, 15000);
			} catch {
				await new Promise((r) => setTimeout(r, 2000));
				mod = await importWithTimeout(CDN_URL, 15000);
			}

			const { TalkingHead } = mod;
			head = new TalkingHead(container, {
				ttsEndpoint,
				ttsApikey,
				lipsyncModules,
				cameraView: 'upper',
			});

			await Promise.race([
				head.showAvatar({
					url: avatarUrl,
					body: avatarBody,
					avatarMood: 'neutral',
					lipsyncLang: 'en',
				}),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Avatar model load timed out')), 20000)
				),
			]);

			dispatch('ready');
		} catch (err) {
			loadError = err?.message || String(err);
			console.warn('[TalkingHead] failed to load', err);
		}
	}

	export function retry() {
		loadAvatar();
	}

	onMount(() => {
		loadAvatar();
	});

	onDestroy(() => {
		if (head?.stop) head.stop();
		head = null;
	});

	export function speak({ text, mood = 'neutral', lang = 'en' }) {
		if (!head) return Promise.resolve();
		return head.speakText(text, { avatarMood: mood, lipsyncLang: lang });
	}

	export function setMood(mood) {
		head?.setMood?.(mood);
	}

	export function playGesture(name, duration = 3) {
		head?.playGesture?.(name, duration);
	}
</script>

<div class="talking-head" bind:this={container}>
	{#if loadError}
		<div class="error">
			<p>Avatar failed to load</p>
			<p class="detail">{loadError}</p>
			<button on:click={retry}>Retry</button>
		</div>
	{/if}
</div>

<style>
	.talking-head {
		position: relative;
		width: 100%;
		aspect-ratio: 3 / 4;
		background: #000;
		border-radius: 12px;
		overflow: hidden;
	}
	.error {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 16px;
	}
	.error p {
		color: #f88;
		font-size: 12px;
		text-align: center;
		margin: 0;
	}
	.error .detail {
		color: #aaa;
		font-size: 11px;
	}
	.error button {
		background: #333;
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 4px 12px;
		font-size: 12px;
		cursor: pointer;
	}
</style>
