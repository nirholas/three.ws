/**
 * The Microsoft listing media kit: what each store requires, which captured
 * scene fills each slot, and the pure helpers the capture script and its tests
 * share (caption files, the dimension gate, the visible-text gate, the
 * submission-file blocks).
 *
 * Every requirement carries the Microsoft page it was read from and the date it
 * was read, so a reviewer can re-check one number without re-reading the script.
 * When a store changes a size, change it here; the capture script, the manifest
 * and every submission file follow on the next `npm run media:microsoft`.
 */

import { spawnSync } from 'node:child_process';

/** The day the requirement pages below were last read. */
export const REQUIREMENTS_READ = '2026-11-14';

/**
 * One entry per store listing. `rules` are the requirements as published;
 * `video` describes what the listing accepts for video.
 */
export const STORES = {
	marketplace: {
		title: 'Microsoft Marketplace SaaS offer',
		source: 'https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing',
		verified: true,
		rules: [
			'Screenshots: 1 to 5, PNG, exactly 1280 x 720.',
			'Large logo: PNG, square, between 216 x 216 and 350 x 350.',
			'Videos: up to 4 YouTube or Vimeo links, each with a 1280 x 720 PNG thumbnail.',
		],
		video: { hosting: 'YouTube or Vimeo link', thumbnail: true },
	},
	teams: {
		title: 'Microsoft Teams Store app',
		source: 'https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/submission-checklist',
		verified: true,
		rules: [
			'Screenshots: up to 5, PNG, JPEG or GIF, 1366 x 768, 1,024 KB maximum each.',
			'Video: a YouTube or Vimeo link.',
			'Icons come from the app package (color 192 x 192, outline 32 x 32), not from this kit.',
		],
		video: { hosting: 'YouTube or Vimeo link' },
	},
	msstore: {
		title: 'Microsoft Store (Windows app)',
		source: 'https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images',
		verified: true,
		rules: [
			'Desktop screenshots: 1 to 10, PNG, 1366 x 768 or larger (up to 3840 x 2160), 50 MB maximum each. Keep key content in the top two thirds.',
			'1:1 app tile icon: 300 x 300 PNG.',
			'Trailers: MP4 (H.264, AAC) at 1920 x 1080, under 2 GB, 60 seconds or less recommended, with a 1920 x 1080 PNG thumbnail and optional WebVTT captions.',
		],
		video: { hosting: 'Uploaded MP4', thumbnail: true, captions: 'vtt' },
	},
	edge: {
		title: 'Microsoft Edge Add-ons (three.ws Walk Avatar)',
		source: 'https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension',
		verified: true,
		rules: [
			'Extension logo: 1:1, 300 x 300 recommended, 128 x 128 minimum.',
			'Small promotional tile: 440 x 280. Large promotional tile: 1400 x 560 PNG.',
			'Screenshots: up to 6, 640 x 480 or 1280 x 800.',
			'Video: an optional YouTube link.',
		],
		video: { hosting: 'YouTube link' },
	},
	vscode: {
		title: 'Visual Studio Marketplace (three.ws 3D extension)',
		source: 'https://code.visualstudio.com/api/working-with-extensions/publishing-extension',
		verified: true,
		rules: [
			'Icon: PNG, 128 x 128 or larger, never SVG.',
			'README images: must resolve to https URLs and may not be SVG.',
		],
		video: null,
	},
};

/**
 * Each scene is captured once as a master: a 1280 x 720 CSS viewport at device
 * scale 2 (2560 x 1440 pixels), large enough to downscale cleanly to every slot
 * it feeds. The value is the caption the stores show under the image.
 */
export const MASTER = { width: 1280, height: 720, scale: 2 };

export const SCENES = {
	'forge-composer': 'Describe an object in a sentence. Forge turns it into a textured 3D model on the free lane.',
	'forge-result': 'The finished model from that one prompt, ready to orbit, download as GLB or place in a scene.',
	viewer: 'The three.ws viewer: inspect any GLB or glTF in the browser, with lighting, animation and AR.',
	agent: 'Every agent has a public page with its 3D body, its skills and a chat anyone can open.',
	'teams-tab': 'The three.ws tab for Microsoft Teams: browse agents and see what each one did today.',
	'adaptive-card': 'The agent card as an Adaptive Card, rendered by the Adaptive Cards SDK with the Microsoft Teams host config.',
};

/**
 * Every image this kit writes. `from` is a scene id, or `logo`, `edge-logo`,
 * `tile-small`, `tile-large` or `video-thumbnail`. `maxBytes` is a hard cap
 * from the store's rules. Every kit image is opaque.
 */
export const ASSETS = [
	...['forge-result', 'agent', 'teams-tab', 'adaptive-card', 'viewer'].map((scene, i) => ({
		store: 'marketplace', file: `screenshot-${i + 1}-${scene}-1280x720.png`, from: scene, width: 1280, height: 720,
	})),
	{ store: 'marketplace', file: 'logo-300x300.png', from: 'logo', width: 300, height: 300 },
	{ store: 'marketplace', file: 'video-thumbnail-1280x720.png', from: 'video-thumbnail', width: 1280, height: 720 },

	...['teams-tab', 'adaptive-card', 'agent', 'forge-result', 'viewer'].map((scene, i) => ({
		store: 'teams', file: `screenshot-${i + 1}-${scene}-1366x768.png`, from: scene, width: 1366, height: 768, maxBytes: 1024 * 1024,
	})),

	...['forge-composer', 'forge-result', 'viewer', 'agent'].map((scene, i) => ({
		store: 'msstore', file: `screenshot-${i + 1}-${scene}-2560x1440.png`, from: scene, width: 2560, height: 1440, maxBytes: 50 * 1024 * 1024,
	})),
	{ store: 'msstore', file: 'tile-icon-300x300.png', from: 'logo', width: 300, height: 300 },
	{ store: 'msstore', file: 'trailer-thumbnail-1920x1080.png', from: 'video-thumbnail', width: 1920, height: 1080 },

	{ store: 'edge', file: 'logo-300x300.png', from: 'edge-logo', width: 300, height: 300 },
	{ store: 'edge', file: 'tile-small-440x280.png', from: 'tile-small', width: 440, height: 280 },
	{ store: 'edge', file: 'tile-large-1400x560.png', from: 'tile-large', width: 1400, height: 560 },
].map((a) => ({ ...a, format: 'png', opaque: true }));

/**
 * Listing images another pipeline already captures from the real product. The
 * kit does not re-shoot them; it checks each one against its slot and lists it
 * in the manifest. `minWidth`/`minHeight` apply where the slot is a minimum.
 */
export const REFERENCED = [
	{
		store: 'edge',
		dir: 'extensions/walk-avatar/store-assets',
		match: /^screenshot-\d+\.png$/,
		width: 1280,
		height: 800,
		format: 'png',
		origin: 'scripts/extension-screenshots.mjs (the real extension on live sites)',
	},
	{
		store: 'vscode',
		dir: 'packages/vscode-3d/media',
		match: /^icon\.png$/,
		minWidth: 128,
		minHeight: 128,
		square: true,
		format: 'png',
		origin: 'the extension icon named in packages/vscode-3d/package.json',
	},
	{
		store: 'vscode',
		dir: 'packages/vscode-3d/images',
		match: /\.png$/,
		minWidth: 640,
		minHeight: 400,
		format: 'png',
		origin: 'packages/vscode-3d/scripts/screenshots.mjs (a real VS Code running the extension)',
	},
];

/** The listing files each store's assets are referenced from. */
export const SUBMISSION_FILES = {
	'marketing/growth/submissions/programs/microsoft-listing-media.md': ['marketplace', 'teams', 'msstore', 'edge', 'vscode'],
	'marketing/growth/submissions/programs/microsoft-edge-and-store.md': ['edge', 'msstore'],
	'marketing/growth/submissions/programs/microsoft-marketplace-professional-services.md': ['marketplace'],
	'marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md': ['teams'],
};

export const BLOCK_START = '<!-- media:microsoft:start (generated by npm run media:microsoft; edits inside are overwritten) -->';
export const BLOCK_END = '<!-- media:microsoft:end -->';

/**
 * Words that must never be visible in a Microsoft listing image: the token and
 * crypto vocabulary the listing rules keep out, and transient UI (onboarding,
 * sign-in prompts, dev servers) that would date or clutter a store screenshot.
 */
export const BANNED_VISIBLE_TEXT = [
	/\$THREE/i,
	/\bcrypto/i,
	/\bsolana\b/i,
	/\bwallet\b/i,
	/\btokens?\b/i,
	/\bcoins?\b/i,
	/\bpump[\s.-]?fun\b/i,
	/\bmemecoin/i,
	/\bon-chain\b/i,
	/\bairdrop/i,
	/\bliquidat/i,
	/\bfunding rates?\b/i,
	/\btrad(?:e|er|ers|ing)\b/i,
	/getting started\s*\d/i,
	/sign in to save/i,
	/localhost|127\.0\.0\.1/i,
];

/** Every banned word found in a block of visible text. */
export function bannedTextIn(text) {
	const found = [];
	for (const re of BANNED_VISIBLE_TEXT) {
		const m = String(text || '').match(re);
		if (m) found.push(m[0]);
	}
	return found;
}

/** Placeholder names and probes that make a store screenshot look unfinished. */
const UNFINISHED_NAME = /^(agent|my first agent|unnamed\b.*|test\b.*|.*probe[0-9a-f]*)$/i;
const CRYPTO_SKILL = /pump|swap|coin|defi|nft|token|wallet|trade|sniper|bridge|solana/i;
// Agents styled on someone else's film, show or game character: not ours to put in a store listing.
const BORROWED_CHARACTER = /\bfrom[\s-]+the[\s-]+(?:movie|film|show|series|game|anime|cartoon)\b/i;

/**
 * Whether an agent from /api/agents/public can appear in a Microsoft listing
 * image: it has a 3D body and a real name, and nothing it shows (name,
 * description, skills) is crypto vocabulary.
 */
export function listingSafeAgent(agent) {
	if (!agent || !agent.id) return false;
	const name = String(agent.name || '').trim();
	if (!name || UNFINISHED_NAME.test(name)) return false;
	if (!agent.avatar_thumbnail && !agent.avatar_model_url) return false;
	const skills = Array.isArray(agent.skills) ? agent.skills : [];
	if (CRYPTO_SKILL.test(name) || skills.some((s) => CRYPTO_SKILL.test(String(s)))) return false;
	const text = `${name} ${agent.description || ''}`;
	if (BORROWED_CHARACTER.test(text)) return false;
	return bannedTextIn(text).length === 0;
}

/** The listing-safe agent with the most chats: the one the agent scenes show. */
export function pickShowcaseAgent(agents) {
	return [...(agents || [])]
		.filter(listingSafeAgent)
		.sort((a, b) => (b.chat_count || 0) - (a.chat_count || 0))[0] || null;
}

/**
 * Compare an image against its slot. Returns human-readable problems; an empty
 * list means the file fits.
 */
export function dimensionProblems(slot, meta, bytes) {
	const label = `${slot.store}/${slot.file}`;
	const problems = [];
	if (slot.width && (meta.width !== slot.width || meta.height !== slot.height)) {
		problems.push(`${label} is ${meta.width}x${meta.height}, the slot requires ${slot.width}x${slot.height}`);
	}
	if (slot.minWidth && (meta.width < slot.minWidth || meta.height < slot.minHeight)) {
		problems.push(`${label} is ${meta.width}x${meta.height}, the slot requires at least ${slot.minWidth}x${slot.minHeight}`);
	}
	if (slot.square && meta.width !== meta.height) {
		problems.push(`${label} is ${meta.width}x${meta.height}, the slot requires a square image`);
	}
	if (meta.format !== slot.format) {
		problems.push(`${label} is ${meta.format}, the slot requires ${slot.format}`);
	}
	if (slot.maxBytes && bytes > slot.maxBytes) {
		problems.push(`${label} is ${bytes} bytes, the slot allows at most ${slot.maxBytes}`);
	}
	if (slot.opaque && meta.hasAlpha) {
		problems.push(`${label} carries an alpha channel; listing slots take opaque images`);
	}
	return problems;
}

/**
 * Turn the recorded segment timeline into caption cues. Each segment starts at
 * `start` seconds in the final cut and lasts `duration`; its lines share that
 * window evenly, with a short gap between cues so players never merge two.
 */
export function cuesFor(segments) {
	const cues = [];
	for (const seg of segments) {
		const lines = seg.lines || [];
		if (!lines.length || seg.duration <= 0) continue;
		const slice = seg.duration / lines.length;
		lines.forEach((text, i) => {
			const start = seg.start + i * slice;
			const end = seg.start + (i + 1) * slice - 0.1;
			cues.push({ start: round3(start), end: round3(Math.max(start + 0.5, end)), text });
		});
	}
	return cues;
}

function round3(n) {
	return Math.round(n * 1000) / 1000;
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT). */
export function timestamp(seconds, separator = ',') {
	const ms = Math.max(0, Math.round(seconds * 1000));
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	const rest = ms % 1000;
	const pad = (n, w = 2) => String(n).padStart(w, '0');
	return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(rest, 3)}`;
}

export function toSrt(cues) {
	return cues.map((c, i) => `${i + 1}\n${timestamp(c.start, ',')} --> ${timestamp(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function toVtt(cues) {
	return `WEBVTT\n\n${cues.map((c) => `${timestamp(c.start, '.')} --> ${timestamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;
}

/** The voice-over script: one timed line per cue, the same words as the captions. */
export function toNarration(cues, title) {
	const lines = cues.map((c) => `[${timestamp(c.start, '.').slice(3, 8)}] ${c.text}`);
	return `${title}\n\nRead each line when its timestamp comes up. The captions in the video use the same words.\n\n${lines.join('\n')}\n`;
}

export function sizeLabel(bytes) {
	return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * The block a submission file carries, rendered from the manifest. `relRoot`
 * is the path from the submission file to the repo root, so every link
 * resolves in the editor and on GitHub.
 */
export function submissionBlock(manifest, stores, relRoot) {
	const out = [BLOCK_START, '', `### Listing media (captured ${manifest.capturedAt.slice(0, 10)} from ${manifest.base})`, ''];
	out.push(`Regenerate with \`npm run media:microsoft\`. How it works and when to refresh: [marketing/microsoft/media/README.md](${relRoot}marketing/microsoft/media/README.md). Exact sizes and checksums: [manifest.json](${relRoot}marketing/microsoft/media/manifest.json).`);
	for (const store of stores) {
		const spec = STORES[store];
		const files = manifest.assets.filter((a) => a.store === store);
		out.push('', `**${spec.title}** (requirements read ${manifest.requirementsRead}: <${spec.source}>)`, '');
		for (const a of files) {
			const caption = a.caption ? `. Caption: "${a.caption}"` : '';
			out.push(`- [\`${a.path.split('/').pop()}\`](${relRoot}${a.path}): ${a.width} x ${a.height}, ${sizeLabel(a.bytes)}${caption}`);
		}
		const v = manifest.video;
		if (spec.video && v) {
			if (spec.video.hosting === 'Uploaded MP4') {
				out.push(`- Trailer: download <${v.url}> (${v.width} x ${v.height} H.264 with AAC, ${v.durationSeconds} s, ${sizeLabel(v.bytes)}, sha256 \`${v.sha256}\`) and upload the file. Captions: [\`${v.vtt.split('/').pop()}\`](${relRoot}${v.vtt}).`);
			} else {
				out.push(`- Video: the listing takes a ${spec.video.hosting}, not a file. Upload <${v.url}> with the captions in [\`${v.srt.split('/').pop()}\`](${relRoot}${v.srt}), then paste that link.`);
			}
		}
	}
	out.push('', BLOCK_END);
	return out.join('\n');
}

/** Replace the generated block in a file, or append it when absent. */
export function upsertBlock(text, block) {
	const start = text.indexOf(BLOCK_START);
	const end = text.indexOf(BLOCK_END);
	if (start !== -1 && end > start) {
		return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
	}
	return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}

/**
 * The first runnable candidate for a tool: its env override, extra paths, then
 * PATH. `probe` is the argument the tool answers with exit 0 (ffmpeg takes
 * `-version`, gcloud only `--version`).
 */
export function findBinary(name, { extra = [], probe = ['--version'], hint = '' } = {}) {
	const env = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
	for (const candidate of [process.env[env], ...extra, name].filter(Boolean)) {
		const r = spawnSync(candidate, probe, { stdio: 'ignore' });
		if (r.status === 0) return candidate;
	}
	throw new Error(`${name} not found. ${hint ? `${hint} ` : ''}Or set ${env} to its path.`);
}

/**
 * The demo video's encoding, from the Microsoft Store trailer requirements
 * (STORES.msstore.source, "Trailer requirements" and its MP4 section): 1920 x
 * 1080, H.264 High, progressive, CABAC, 2 consecutive B-frames, a closed GOP of
 * half the frame rate, 4:2:0, AAC-LC stereo at 48 kHz and 384 kbps, faststart,
 * and 60 seconds or less. The same cut serves the YouTube and Vimeo listings,
 * and 60 seconds also meets the work order's 60 to 90 second floor.
 */
export const TRAILER = {
	width: 1920,
	height: 1080,
	fps: 30,
	seconds: 60,
	gop: 15,
	bFrames: 2,
	audio: { profile: 'LC', sampleRate: 48000, channels: 2, bitrate: '384k' },
	source: STORES.msstore.source,
};

/** ffmpeg output arguments that produce a TRAILER-conformant stream. */
export function trailerEncodeArgs() {
	return {
		video: [
			'-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'slow', '-crf', '18',
			'-pix_fmt', 'yuv420p', '-r', String(TRAILER.fps),
			// A fixed GOP: no scene-cut keyframes, every GOP closed, always 2 B-frames.
			'-g', String(TRAILER.gop), '-keyint_min', String(TRAILER.gop), '-sc_threshold', '0',
			'-bf', String(TRAILER.bFrames), '-b_strategy', '0', '-flags', '+cgop', '-coder', 'cabac',
		],
		audio: [
			'-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', TRAILER.audio.bitrate,
			'-ar', String(TRAILER.audio.sampleRate), '-ac', String(TRAILER.audio.channels),
		],
	};
}

/**
 * The settings x264 records in its SEI message ("x264 - core ... options: a=1
 * b=2"), read from the file's bytes. Returns null when no x264 string is present.
 */
export function x264Options(bytes) {
	const text = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('latin1');
	const match = /x264 - core [^\0]*? options: ([^\0]+)/.exec(text);
	if (!match) return null;
	const options = {};
	for (const pair of match[1].trim().split(/\s+/)) {
		const eq = pair.indexOf('=');
		if (eq > 0) options[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	return options;
}

/**
 * Check a cut against TRAILER. `probe` is ffprobe JSON (streams and format),
 * `x264` the parsed encoder options, `keyframes` the indices of key frames and
 * `frames` the frame count. Returns one sentence per problem.
 */
export function trailerProblems({ probe, x264, keyframes, frames }) {
	const problems = [];
	const v = probe.streams.find((s) => s.codec_type === 'video');
	const a = probe.streams.find((s) => s.codec_type === 'audio');
	const duration = Number(probe.format.duration);
	if (!v) return ['the video has no video stream'];
	if (v.width !== TRAILER.width || v.height !== TRAILER.height) problems.push(`video is ${v.width}x${v.height}, the Store requires ${TRAILER.width}x${TRAILER.height}`);
	if (v.codec_name !== 'h264' || v.profile !== 'High') problems.push(`video is ${v.codec_name} ${v.profile}, the Store requires H.264 High`);
	if (v.pix_fmt !== 'yuv420p') problems.push(`video is ${v.pix_fmt}, the Store requires 4:2:0`);
	if (v.field_order && v.field_order !== 'progressive') problems.push(`video is ${v.field_order}, the Store requires progressive scan`);
	if (v.r_frame_rate !== `${TRAILER.fps}/1`) problems.push(`video runs at ${v.r_frame_rate} fps, not ${TRAILER.fps}`);
	if (Math.abs(duration - TRAILER.seconds) > 0.05) problems.push(`video runs ${duration.toFixed(1)} s; the cut is ${TRAILER.seconds} s (the Store recommends 60 s or less)`);
	if (!x264) {
		problems.push('no x264 settings string in the stream, so B-frames, GOP and CABAC cannot be confirmed');
	} else {
		if (x264.cabac !== '1') problems.push('CABAC is off; the Store requires CABAC');
		if (x264.bframes !== String(TRAILER.bFrames) || x264.b_adapt !== '0') problems.push(`B-frames are bframes=${x264.bframes} b_adapt=${x264.b_adapt}; the Store requires 2 consecutive B-frames (bframes=2 b_adapt=0)`);
		if (x264.keyint !== String(TRAILER.gop)) problems.push(`keyint=${x264.keyint}; the Store requires a GOP of ${TRAILER.gop} frames (half the frame rate)`);
		if (x264.scenecut !== '0') problems.push(`scenecut=${x264.scenecut} lets scene-cut keyframes break the fixed GOP`);
		if (x264.open_gop !== '0') problems.push('open_gop is on; the Store requires a closed GOP');
	}
	for (let i = 0; i < keyframes.length; i++) {
		if (keyframes[i] !== i * TRAILER.gop) {
			problems.push(`keyframe at frame ${keyframes[i]}, expected one every ${TRAILER.gop} frames`);
			break;
		}
	}
	if (keyframes.length && keyframes.length !== Math.ceil(frames / TRAILER.gop)) problems.push(`${keyframes.length} keyframes in ${frames} frames, expected one every ${TRAILER.gop}`);
	if (!a) {
		problems.push('the video has no audio stream; the Store requires AAC-LC stereo');
	} else {
		if (a.codec_name !== 'aac' || a.profile !== TRAILER.audio.profile) problems.push(`audio is ${a.codec_name} ${a.profile}, the Store requires AAC-LC`);
		if (Number(a.sample_rate) !== TRAILER.audio.sampleRate) problems.push(`audio is ${a.sample_rate} Hz, the Store requires 48 kHz`);
		if (a.channels !== TRAILER.audio.channels) problems.push(`audio has ${a.channels} channel(s), the Store requires stereo`);
	}
	return problems;
}
