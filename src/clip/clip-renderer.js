// Offline, frame-stepped talking-avatar renderer and MP4 encoder.
//
// Given an avatar GLB, a speech clip and its NVIDIA Audio2Face-3D blendshape
// track, this renders every video frame at an exact presentation time (never a
// real-time screen capture), so the output is frame-accurate regardless of how
// fast the device draws. Frames are encoded with WebCodecs and muxed with the
// audio into MP4 by mediabunny (https://mediabunny.dev, MPL-2.0), which
// drives VideoEncoder/AudioEncoder for us.
//
// Sync model (pure math in ./clip-math.js, covered by tests/clip-math.test.js):
//   video frame i  -> presentation time i / fps
//   face pose      -> A2F track sampled at i / fps - leadIn
//   speech audio   -> starts at leadIn in the output audio track
// so frame i and the audio at i / fps describe the same instant of speech.

import {
	ACESFilmicToneMapping,
	AmbientLight,
	Box3,
	CanvasTexture,
	CircleGeometry,
	Color,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	PerspectiveCamera,
	PMREMGenerator,
	Scene,
	ShadowMaterial,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	getFirstEncodableAudioCodec,
	getFirstEncodableVideoCodec,
} from 'mediabunny';
import { gltfLoader, disposeGltfLoader } from '../loaders/gltf.js';
import { A2FPlayer } from '../voice/a2f-player.js';
import { AnimationManager } from '../animation-manager.js';
import { canonicalizeBoneName } from '../glb-canonicalize.js';
import {
	ASPECTS,
	FRAMINGS,
	audioLengthSamples,
	cameraDistanceForHeight,
	captionCues,
	clipTimeline,
	cueAt,
	frameDuration,
	frameTime,
	framingSpan,
	speechTimeForFrame,
	voicedSpan,
} from './clip-math.js';

export const OUTPUT_SAMPLE_RATE = 48000;
const CAMERA_FOV = 24;

export class ClipError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * Whether this browser can encode a clip, and with which codecs. Decided by
 * capability, not user agent: WebCodecs must exist and an MP4-compatible video
 * and audio codec must actually be encodable at the requested size.
 * @returns {Promise<{ ok:boolean, video?:string, audio?:string, reason?:string }>}
 */
export async function clipSupport({ width = 1080, height = 1920 } = {}) {
	if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
		return { ok: false, reason: 'webcodecs' };
	}
	const format = new Mp4OutputFormat();
	const video = await getFirstEncodableVideoCodec(
		format.getSupportedVideoCodecs().filter((c) => ['avc', 'hevc', 'vp9', 'av1'].includes(c)),
		{ width, height },
	);
	if (!video) return { ok: false, reason: 'video-codec' };
	const audio = await getFirstEncodableAudioCodec(
		format.getSupportedAudioCodecs().filter((c) => ['aac', 'opus'].includes(c)),
		{ numberOfChannels: 1, sampleRate: OUTPUT_SAMPLE_RATE },
	);
	if (!audio) return { ok: false, reason: 'audio-codec' };
	return { ok: true, video, audio };
}

/**
 * Decode any audio file the browser understands (WAV, MP3, M4A, Ogg, WebM).
 * Decoding through an OfflineAudioContext needs no user gesture and never
 * touches the output device.
 * @param {ArrayBuffer} bytes
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudio(bytes) {
	const ctx = new OfflineAudioContext(1, 1, OUTPUT_SAMPLE_RATE);
	try {
		return await ctx.decodeAudioData(bytes.slice(0));
	} catch {
		throw new ClipError('audio', 'This browser could not read that audio file. Try a WAV, MP3 or M4A recording.');
	}
}

/**
 * Render an AudioBuffer to mono samples at `toRate` through an
 * OfflineAudioContext: the browser's band-limited resampler converts the
 * rate, the 1-channel destination downmixes, and `offsetSec` places the audio
 * inside a buffer of `lengthSamples` (default: just long enough).
 * @returns {Promise<Float32Array>}
 */
export async function toMono(buffer, toRate, offsetSec = 0, lengthSamples = 0) {
	const length = lengthSamples || Math.ceil((offsetSec + buffer.duration) * toRate);
	const ctx = new OfflineAudioContext(1, length, toRate);
	const node = ctx.createBufferSource();
	node.buffer = buffer;
	node.connect(ctx.destination);
	node.start(offsetSec);
	const rendered = await ctx.startRendering();
	return rendered.getChannelData(0);
}

/** Mono samples to a 1-channel AudioBuffer. */
export function samplesToBuffer(samples, sampleRate) {
	const buf = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
	buf.copyToChannel(samples, 0);
	return buf;
}

function findHeadBone(root) {
	let head = null;
	let jaw = null;
	root.traverse((n) => {
		if (!head && canonicalizeBoneName(n.name || '') === 'Head') head = n;
		if (!jaw && n.isBone && /jaw/i.test(n.name || '')) jaw = n;
	});
	return { head, jaw };
}

function makeGroundAndSky(scene, renderer) {
	const sky = document.createElement('canvas');
	sky.width = 4;
	sky.height = 256;
	const g = sky.getContext('2d');
	const grad = g.createLinearGradient(0, 0, 0, 256);
	grad.addColorStop(0, '#1d2433');
	grad.addColorStop(0.6, '#2c3546');
	grad.addColorStop(1, '#3a4152');
	g.fillStyle = grad;
	g.fillRect(0, 0, 4, 256);
	const tex = new CanvasTexture(sky);
	tex.colorSpace = SRGBColorSpace;
	scene.background = tex;
	const ground = new Mesh(new CircleGeometry(6, 64), new ShadowMaterial({ opacity: 0.35 }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);
	renderer.shadowMap.enabled = true;
	return ground;
}

function drawCover(ctx, img, w, h) {
	const iw = img.width;
	const ih = img.height;
	const s = Math.max(w / iw, h / ih);
	const dw = iw * s;
	const dh = ih * s;
	ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function wrapLines(ctx, text, maxWidth) {
	const words = text.split(' ');
	const lines = [];
	let cur = '';
	for (const w of words) {
		const next = cur ? `${cur} ${w}` : w;
		if (cur && ctx.measureText(next).width > maxWidth) {
			lines.push(cur);
			cur = w;
		} else {
			cur = next;
		}
	}
	if (cur) lines.push(cur);
	return lines;
}

function drawCaption(ctx, text, w, h, portrait) {
	const size = Math.round((portrait ? 0.052 : 0.04) * Math.min(w, h) * (portrait ? 1.2 : 1.35));
	ctx.font = `700 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const lines = wrapLines(ctx, text, w * 0.82);
	const lineH = size * 1.22;
	const blockH = lines.length * lineH;
	const cy = h * (portrait ? 0.8 : 0.84);
	const padX = size * 0.6;
	const padY = size * 0.35;
	const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
	const x0 = w / 2 - widest / 2 - padX;
	const y0 = cy - blockH / 2 - padY;
	ctx.fillStyle = 'rgba(8, 10, 14, 0.62)';
	ctx.beginPath();
	ctx.roundRect(x0, y0, widest + padX * 2, blockH + padY * 2, size * 0.4);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	lines.forEach((l, k) => ctx.fillText(l, w / 2, cy - blockH / 2 + lineH * (k + 0.5)));
}

function drawMark(ctx, w, h) {
	const size = Math.round(Math.min(w, h) * 0.03);
	const pad = Math.round(Math.min(w, h) * 0.04);
	ctx.font = `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
	ctx.textAlign = 'right';
	ctx.textBaseline = 'alphabetic';
	ctx.shadowColor = 'rgba(0,0,0,0.45)';
	ctx.shadowBlur = size * 0.4;
	ctx.fillStyle = 'rgba(255,255,255,0.86)';
	ctx.fillText('three.ws', w - pad, pad + size);
	ctx.shadowBlur = 0;
	ctx.shadowColor = 'transparent';
}

/**
 * Render and encode a talking-avatar clip.
 *
 * @param {object} opts
 * @param {string} opts.glbUrl
 * @param {AudioBuffer} opts.speech      decoded speech audio (any rate/channels)
 * @param {{ fps:number, blendShapeNames:string[], frames:Array<{t:number,w:number[]}> }} opts.track
 * @param {'portrait'|'landscape'} [opts.aspect]
 * @param {'face'|'bust'|'full'} [opts.framing]
 * @param {{ type:'scene'|'color'|'image', color?:string, image?:ImageBitmap }} [opts.background]
 * @param {string|null} [opts.captionText]
 * @param {boolean} [opts.mark]
 * @param {(p:{ stage:string, done?:number, total?:number }) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function renderClip({
	glbUrl,
	speech,
	track,
	aspect = 'portrait',
	framing = 'bust',
	background = { type: 'scene' },
	captionText = null,
	mark = true,
	onProgress = () => {},
	signal,
}) {
	const size = ASPECTS[aspect] || ASPECTS.portrait;
	const frame = FRAMINGS[framing] || FRAMINGS.bust;
	const { width, height } = size;
	const portrait = height > width;

	const support = await clipSupport({ width, height });
	if (!support.ok) throw new ClipError('unsupported', support.reason);

	const timeline = clipTimeline(speech.duration);
	const throwIfAborted = () => {
		if (signal?.aborted) throw new ClipError('aborted', 'Clip render cancelled.');
	};

	// ── Audio: speech placed at the lead-in inside a clip-length mono track ──
	onProgress({ stage: 'audio' });
	const clipAudio = await toMono(
		speech,
		OUTPUT_SAMPLE_RATE,
		timeline.leadIn,
		audioLengthSamples(timeline, OUTPUT_SAMPLE_RATE),
	);
	const speechMono = await toMono(speech, OUTPUT_SAMPLE_RATE);
	const cues = captionText ? captionCues(captionText, voicedSpan(speechMono, OUTPUT_SAMPLE_RATE)) : [];
	throwIfAborted();

	// ── Scene ────────────────────────────────────────────────────────────────
	onProgress({ stage: 'avatar' });
	const glCanvas = document.createElement('canvas');
	glCanvas.width = width;
	glCanvas.height = height;
	const renderer = new WebGLRenderer({
		canvas: glCanvas,
		antialias: true,
		alpha: true,
		preserveDrawingBuffer: true,
		powerPreference: 'high-performance',
	});
	renderer.setPixelRatio(1);
	renderer.setSize(width, height, false);
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.setClearColor(0x000000, 0);

	const scene = new Scene();
	const pmrem = new PMREMGenerator(renderer);
	const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environment = envTex;
	scene.add(new HemisphereLight(0xffffff, 0x404858, 0.6));
	scene.add(new AmbientLight(0xffffff, 0.15));
	const key = new DirectionalLight(0xffffff, 1.6);
	key.position.set(1.4, 2.6, 2.4);
	key.castShadow = background.type === 'scene';
	key.shadow.mapSize.set(2048, 2048);
	scene.add(key);
	const rim = new DirectionalLight(0xb8c8ff, 0.8);
	rim.position.set(-2, 2.2, -2);
	scene.add(rim);

	let model;
	const mgr = new AnimationManager();
	const face = new A2FPlayer();
	const out = { faceCoverage: 0, jawFallback: false };
	try {
		let gltf;
		try {
			gltf = await gltfLoader(renderer).loadAsync(glbUrl);
		} catch (e) {
			throw new ClipError('avatar', `Could not load this avatar's 3D model (${e?.message || 'network error'}).`);
		}
		throwIfAborted();
		model = gltf.scene || gltf.scenes?.[0];
		if (!model) throw new ClipError('avatar', 'This avatar file has no scene to render.');
		model.traverse((n) => {
			if (n.isMesh) {
				n.castShadow = true;
				n.frustumCulled = false;
			}
		});
		scene.add(model);

		// Idle body motion from the platform clip library, retargeted onto any
		// humanoid rig. A rig it cannot drive simply stays in its bind pose.
		mgr.attach(model, { avatarUrl: glbUrl });
		try {
			const manifest = await fetch('/animations/manifest.json').then((r) => (r.ok ? r.json() : []));
			mgr.setAnimationDefs(Array.isArray(manifest) ? manifest : manifest.animations || []);
			await mgr.play('idle');
		} catch {
			// Clip library unreachable: render in the bind pose.
		}
		mgr.update(0);
		model.updateMatrixWorld(true);

		face.attach(model);
		face.setTrack(track);
		const coverage = face.describe();
		out.faceCoverage = coverage.direct.length + coverage.expression.length;
		const { head, jaw } = findHeadBone(model);
		const jawRest = jaw ? jaw.rotation.x : 0;
		out.jawFallback = out.faceCoverage === 0 && Boolean(jaw);

		// ── Camera framing from the posed bounds ─────────────────────────────
		const box = new Box3().setFromObject(model, true);
		const headPos = head ? head.getWorldPosition(new Vector3()) : null;
		const floorY = box.min.y;
		const topY = box.max.y;
		const headY = headPos ? headPos.y : topY - (topY - floorY) * 0.09;
		const span = framingSpan(frame.id, { floorY, topY, headY });
		const camera = new PerspectiveCamera(CAMERA_FOV, width / height, 0.01, 200);
		const spanH = span.high - span.low;
		// A landscape frame is short: fit the span to the height. A portrait frame
		// is narrow: also make sure the shoulders fit the width.
		const bodyW = Math.max(0.1, box.max.x - box.min.x);
		const widthNeed = frame.id === 'full' ? bodyW : Math.min(bodyW, spanH * 1.3);
		const hFov = 2 * Math.atan(Math.tan((CAMERA_FOV * Math.PI) / 360) * (width / height));
		const distH = cameraDistanceForHeight(spanH, CAMERA_FOV, frame.fill);
		const distW = widthNeed / frame.fill / (2 * Math.tan(hFov / 2));
		const dist = Math.max(distH, distW);
		const cx = (box.min.x + box.max.x) / 2;
		const cz = headPos ? headPos.z : (box.min.z + box.max.z) / 2;
		const cy = (span.low + span.high) / 2;
		camera.position.set(cx, cy + spanH * 0.02, cz + dist);
		camera.lookAt(cx, cy, cz);
		key.target.position.set(cx, cy, cz);
		scene.add(key.target);
		if (background.type === 'scene') {
			const ground = makeGroundAndSky(scene, renderer);
			ground.position.set(cx, floorY + 0.001, cz);
		}

		// ── Compositor ──────────────────────────────────────────────────────
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { alpha: false });
		const paintBackground = () => {
			if (background.type === 'image' && background.image) {
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, width, height);
				drawCover(ctx, background.image, width, height);
			} else if (background.type === 'color') {
				ctx.fillStyle = new Color(background.color || '#00b140').getStyle();
				ctx.fillRect(0, 0, width, height);
			} else {
				ctx.clearRect(0, 0, width, height);
			}
		};

		// ── Encoder ─────────────────────────────────────────────────────────
		const output = new Output({
			format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
			target: new BufferTarget(),
		});
		const videoSource = new CanvasSource(canvas, {
			codec: support.video,
			bitrate: QUALITY_HIGH,
			keyFrameInterval: 2,
			latencyMode: 'quality',
		});
		const audioSource = new AudioBufferSource({ codec: support.audio, bitrate: 160_000 });
		output.addVideoTrack(videoSource, { frameRate: timeline.fps });
		output.addAudioTrack(audioSource);
		await output.start();

		// Audio goes in one-second chunks interleaved with the video so the muxer
		// never has to buffer one track far ahead of the other.
		const chunk = OUTPUT_SAMPLE_RATE;
		let audioCursor = 0;
		const feedAudioUntil = async (sec) => {
			const until = Math.min(clipAudio.length, Math.ceil(sec * OUTPUT_SAMPLE_RATE));
			while (audioCursor < until) {
				const end = Math.min(clipAudio.length, audioCursor + chunk);
				await audioSource.add(samplesToBuffer(clipAudio.subarray(audioCursor, end), OUTPUT_SAMPLE_RATE));
				audioCursor = end;
			}
		};

		const dt = frameDuration(timeline.fps);
		const total = timeline.frameCount;
		try {
			for (let i = 0; i < total; i++) {
				throwIfAborted();
				if (i > 0) mgr.update(dt);
				const st = speechTimeForFrame(i, timeline);
				face.update(st);
				if (out.jawFallback) jaw.rotation.x = jawRest + face.currentWeight('jawOpen') * 0.3;
				renderer.render(scene, camera);
				paintBackground();
				ctx.drawImage(glCanvas, 0, 0);
				const cue = cues.length ? cueAt(cues, st) : null;
				if (cue) drawCaption(ctx, cue.text, width, height, portrait);
				if (mark) drawMark(ctx, width, height);
				await videoSource.add(frameTime(i, timeline.fps), dt);
				await feedAudioUntil(frameTime(i + 1, timeline.fps) + 1);
				if (i % 3 === 0 || i === total - 1) onProgress({ stage: 'frames', done: i + 1, total });
			}
			await feedAudioUntil(timeline.durationSec + 1);
			onProgress({ stage: 'finalize' });
			await output.finalize();
		} catch (e) {
			await output.cancel().catch(() => {});
			throw e;
		}

		const mimeType = await output.getMimeType();
		const blob = new Blob([output.target.buffer], { type: mimeType });
		return {
			blob,
			mimeType,
			width,
			height,
			fps: timeline.fps,
			frameCount: total,
			durationSec: timeline.durationSec,
			leadInSec: timeline.leadIn,
			videoCodec: support.video,
			audioCodec: support.audio,
			...out,
		};
	} finally {
		face.dispose();
		mgr.dispose?.();
		if (model) scene.remove(model);
		envTex.dispose();
		pmrem.dispose();
		disposeGltfLoader(renderer);
		renderer.dispose();
		renderer.forceContextLoss?.();
	}
}
