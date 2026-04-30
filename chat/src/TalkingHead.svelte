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

	const dispatch = createEventDispatcher();

	let container;
	let head = null;
	let loadError = null;

	onMount(async () => {
		try {
			const mod = await import(
				/* @vite-ignore */ 'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.4/modules/talkinghead.mjs'
			);
			const { TalkingHead } = mod;
			head = new TalkingHead(container, {
				ttsEndpoint,
				ttsApikey,
				lipsyncModules,
				cameraView: 'upper',
			});
			await head.showAvatar({
				url: avatarUrl,
				body: avatarBody,
				avatarMood: 'neutral',
				lipsyncLang: 'en',
			});
			dispatch('ready');
		} catch (err) {
			loadError = err?.message || String(err);
			console.warn('[TalkingHead] failed to load', err);
		}
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
		<div class="error">avatar failed to load: {loadError}</div>
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
		display: grid;
		place-items: center;
		color: #f88;
		font: 12px/1.4 system-ui, sans-serif;
		padding: 12px;
		text-align: center;
	}
</style>
