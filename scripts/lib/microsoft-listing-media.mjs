/**
 * The Microsoft listing media kit: what each store requires, which captured
 * scene fills each slot, and the pure helpers the capture script and its tests
 * share (caption files, the dimension gate, the submission-file blocks).
 *
 * Every requirement carries the Microsoft page it was read from and the date it
 * was read, so a reviewer can re-check one number without re-reading the script.
 * When a store changes a size, change it here; the capture script, the manifest
 * and every submission file follow on the next `npm run media:microsoft`.
 */

/** The day the requirement pages below were last read. */
export const REQUIREMENTS_READ = '2026-11-11';

/**
 * One entry per store listing. `slots` are the image files the listing takes;
 * `video` describes what the listing accepts for video.
 */
export const STORES = {
	marketplace: {
		title: 'Microsoft Marketplace SaaS offer',
		source: 'https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing',
		verified: true,
		rules: [
			'Screenshots: 1 to 5, PNG, exactly 1280 x 720.',
			'Large logo: PNG, square, between 216 x 216 and 350 x 350 (Partner Center derives the 48 and 90 pixel logos).',
			'Videos: up to 4 YouTube or Vimeo links, each with a 1280 x 720 PNG thumbnail.',
		],
		video: { hosting: 'YouTube or Vimeo link', thumbnail: 'thumbnail-1280x720.png' },
	},
	teams: {
		title: 'Microsoft Teams Store app',
		source: 'https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/submission-checklist',
		verified: true,
		rules: [
			'Screenshots: up to 5, PNG, JPEG or GIF, 1366 x 768, 1,024 KB maximum each.',
			'Video: a YouTube or Vimeo link (a demo walkthrough is recommended).',
			'Icons come from the app package (color 192 x 192, outline 32 x 32), not from this kit.',
		],
		video: { hosting: 'YouTube or Vimeo link' },
	},
	msstore: {
		title: 'Microsoft Store (Windows app)',
		source: 'https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images',
		verified: true,
		rules: [
			'Desktop screenshots: 1 to 10, PNG, 1366 x 768 or larger, 4K (3840 x 2160) supported, 50 MB maximum each.',
			'1:1 app tile icon: 300 x 300 PNG.',
			'Trailers: MP4 (H.264, AAC) or MOV, exactly 1920 x 1080, under 2 GB, 60 seconds or less recommended; a 1920 x 1080 PNG thumbnail and an optional WebVTT caption file.',
		],
		video: { hosting: 'Uploaded MP4', thumbnail: 'thumbnail-1920x1080.png', captions: 'vtt' },
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
			'Icon: PNG, 128 x 128 or larger, never SVG (packages/vscode-3d/media/icon.png).',
			'README images: must resolve to https URLs and may not be SVG.',
		],
		video: null,
	},
};

/**
 * The scenes the script captures, each at a master resolution large enough to
 * downscale cleanly to every slot it feeds. `aspect` picks the master viewport.
 */
export const SCENES = {
	'forge-composer': { aspect: '16:9', caption: 'Describe an object in a sentence. Forge turns it into a textured 3D model on the free lane.' },
	'forge-result': { aspect: '16:9', caption: 'The finished model, generated from that one prompt, ready to view, download as GLB or place in a scene.' },
	viewer: { aspect: '16:9', caption: 'The three.ws viewer: inspect any GLB in the browser with lighting, animation and AR.' },
	agent: { aspect: '16:9', caption: 'Every agent has a public page: its 3D body, its skills, and a chat anyone can open.' },
	'teams-tab': { aspect: '16:9', caption: 'The three.ws tab in Microsoft Teams: browse agents and see what each one did today.' },
	'adaptive-card': { aspect: '16:9', caption: 'The agent card as an Adaptive Card, rendered by the Adaptive Cards SDK with the Teams host config.' },
	'vscode-viewer': { aspect: '16:10', caption: 'Preview GLB and glTF files inside VS Code, with a model report from the same inspector three.ws uses.' },
	'edge-walk-avatar': { aspect: '16:10', caption: 'three.ws Walk Avatar running on a real web page in the browser.' },
};

/** Master viewport per aspect: CSS size and device scale factor. */
export const MASTERS = {
	'16:9': { width: 1280, height: 720, scale: 3 },
	'16:10': { width: 1280, height: 800, scale: 2 },
};

/**
 * Every image file the kit writes. `from` is a scene id, or `logo` / `tile`
 * for the artwork rendered from the brand icon and real captures.
 * `maxBytes` is a hard cap from the store's rules.
 */
export const ASSETS = [
	// Marketplace SaaS offer: five 1280 x 720 PNG screenshots, the large logo, the video thumbnail.
	...['forge-result', 'agent', 'teams-tab', 'adaptive-card', 'viewer'].map((scene, i) => ({
		store: 'marketplace', file: `screenshot-${i + 1}-${scene}.png`, from: scene, width: 1280, height: 720, format: 'png',
	})),
	{ store: 'marketplace', file: 'logo-300x300.png', from: 'logo', width: 300, height: 300, format: 'png' },
	{ store: 'marketplace', file: 'thumbnail-1280x720.png', from: 'video-thumbnail', width: 1280, height: 720, format: 'png' },

	// Teams Store: five 1366 x 768 screenshots under 1,024 KB.
	...['teams-tab', 'adaptive-card', 'agent', 'forge-result', 'viewer'].map((scene, i) => ({
		store: 'teams', file: `screenshot-${i + 1}-${scene}.png`, from: scene, width: 1366, height: 768, format: 'png', maxBytes: 1024 * 1024,
	})),

	// Microsoft Store: 4K desktop screenshots of the app itself, the tile icon, the trailer thumbnail.
	...['forge-composer', 'forge-result', 'viewer', 'agent'].map((scene, i) => ({
		store: 'msstore', file: `screenshot-${i + 1}-${scene}-3840x2160.png`, from: scene, width: 3840, height: 2160, format: 'png', maxBytes: 50 * 1024 * 1024,
	})),
	{ store: 'msstore', file: 'tile-icon-300x300.png', from: 'logo', width: 300, height: 300, format: 'png' },
	{ store: 'msstore', file: 'thumbnail-1920x1080.png', from: 'video-thumbnail', width: 1920, height: 1080, format: 'png' },

	// Edge Add-ons, Walk Avatar: screenshot, logo, both promotional tiles.
	{ store: 'edge', file: 'screenshot-1-walk-avatar-1280x800.png', from: 'edge-walk-avatar', width: 1280, height: 800, format: 'png' },
	{ store: 'edge', file: 'logo-300x300.png', from: 'logo', width: 300, height: 300, format: 'png' },
	{ store: 'edge', file: 'tile-small-440x280.png', from: 'tile', width: 440, height: 280, format: 'png' },
	{ store: 'edge', file: 'tile-large-1400x560.png', from: 'tile', width: 1400, height: 560, format: 'png' },

	// Visual Studio Marketplace: README images (2x for high-density screens).
	{ store: 'vscode', file: 'readme-viewer-1600x1000.png', from: 'vscode-viewer', width: 1600, height: 1000, format: 'png' },
	{ store: 'vscode', file: 'readme-forge-1600x900.png', from: 'forge-result', width: 1600, height: 900, format: 'png' },
];

/** The listing files each store's assets are referenced from. */
export const SUBMISSION_FILES = {
	'marketing/growth/submissions/programs/microsoft-listing-media.md': ['marketplace', 'teams', 'msstore', 'edge', 'vscode'],
	'marketing/growth/submissions/programs/microsoft-edge-and-store.md': ['edge', 'msstore'],
	'marketing/growth/submissions/programs/microsoft-marketplace-professional-services.md': ['marketplace'],
};

export const BLOCK_START = '<!-- media:microsoft:start (generated by npm run media:microsoft; edits inside are overwritten) -->';
export const BLOCK_END = '<!-- media:microsoft:end -->';

/**
 * Compare a written file against its slot. Returns a list of human-readable
 * problems; empty means the file fits.
 */
export function dimensionProblems(asset, meta, bytes) {
	const problems = [];
	if (meta.width !== asset.width || meta.height !== asset.height) {
		problems.push(`${asset.store}/${asset.file} is ${meta.width}x${meta.height}, the slot requires ${asset.width}x${asset.height}`);
	}
	if (meta.format !== asset.format) {
		problems.push(`${asset.store}/${asset.file} is ${meta.format}, the slot requires ${asset.format}`);
	}
	if (asset.maxBytes && bytes > asset.maxBytes) {
		problems.push(`${asset.store}/${asset.file} is ${bytes} bytes, the slot allows at most ${asset.maxBytes}`);
	}
	if (meta.hasAlpha) {
		problems.push(`${asset.store}/${asset.file} carries an alpha channel; listing slots take opaque images`);
	}
	return problems;
}

/**
 * Turn the recorded scene timeline into caption cues. Each segment starts at
 * `start` seconds in the final cut and lasts `duration`; its lines share that
 * window evenly, so a two-line segment shows each line for half of it.
 */
export function cuesFor(segments) {
	const cues = [];
	for (const seg of segments) {
		const lines = seg.lines || [];
		if (!lines.length || seg.duration <= 0) continue;
		const slice = seg.duration / lines.length;
		lines.forEach((text, i) => {
			const start = seg.start + i * slice;
			// A small gap between cues keeps players from merging two of them.
			const end = seg.start + (i + 1) * slice - (i === lines.length - 1 ? 0 : 0.05);
			cues.push({ start: round3(start), end: round3(end), text });
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
	return cues
		.map((c, i) => `${i + 1}\n${timestamp(c.start, ',')} --> ${timestamp(c.end, ',')}\n${c.text}\n`)
		.join('\n');
}

export function toVtt(cues) {
	return `WEBVTT\n\n${cues.map((c) => `${timestamp(c.start, '.')} --> ${timestamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;
}

/** The narration script for a voice-over, one timed line per cue. */
export function toNarration(cues, title) {
	const lines = cues.map((c) => `[${timestamp(c.start, '.').slice(3, 8)}] ${c.text}`);
	return `${title}\n\nRead each line when its timestamp comes up. The captions in the video use the same words.\n\n${lines.join('\n')}\n`;
}

function sizeLabel(bytes) {
	return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * The block a submission file carries, rendered from the manifest. `relRoot`
 * is the path from the submission file to the repo root, so links resolve in
 * the editor and on GitHub.
 */
export function submissionBlock(manifest, stores, relRoot) {
	const out = [BLOCK_START, '', `### Listing media (captured ${manifest.capturedAt.slice(0, 10)} from ${manifest.base})`, ''];
	out.push(`Regenerate with \`npm run media:microsoft\`. How it works and when to refresh: [marketing/microsoft/media/README.md](${relRoot}marketing/microsoft/media/README.md).`);
	for (const store of stores) {
		const spec = STORES[store];
		const files = manifest.assets.filter((a) => a.store === store);
		out.push('', `**${spec.title}** (requirements: <${spec.source}>${spec.verified ? '' : ', unverified'})`, '');
		for (const a of files) {
			const caption = a.caption ? `: ${a.caption}` : '';
			out.push(`- [\`${a.file}\`](${relRoot}${a.path}) ${a.width} x ${a.height}, ${sizeLabel(a.bytes)}${caption}`);
		}
		if (spec.video && manifest.video) {
			const v = manifest.video;
			if (store === 'msstore') {
				out.push(`- Trailer: <${v.url}> (${v.width} x ${v.height} H.264 MP4, ${v.durationSeconds} s, ${sizeLabel(v.bytes)}, sha256 \`${v.sha256}\`). Download it and upload the file; captions: [\`${v.vtt.split('/').pop()}\`](${relRoot}${v.vtt}).`);
			} else {
				out.push(`- Video: upload <${v.url}> to the three.ws YouTube channel${spec.video.hosting.includes('Vimeo') ? ' (or Vimeo)' : ''} with the captions in [\`${v.srt.split('/').pop()}\`](${relRoot}${v.srt}), then paste the YouTube link into the listing. The listing does not accept a direct file URL.`);
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
