// The tools the MCP server exposes.
//
// Each one is a plain async function over the same modules the browser studio
// uses, so an agent and a person are driving identical code paths: the same
// generation pipeline, the same catalogue reader, the same scene encoder, the
// same AR link builder. Nothing here is a separate "agent version" that can
// drift from what the page does.
//
// Everything is free and keyless. No tool takes a credential, and none is
// required for the studio itself to work.

import { z } from 'zod';

import { createForgeClient } from '../src/forge/client.js';
import { validatePrompt } from '../src/forge/safety.js';
import { promptTitle } from '../src/forge/narration.js';
import { normalizeCatalogue } from '../src/sources/manifest.js';
import { cdnUrl } from '../src/sources/three-ws.js';
import { THREE_WS } from '../src/config.js';
import {
	assertArAssetUrl, buildArLaunchUrl, buildSceneViewerUrl, buildViewerUrl, detectArTarget,
} from '../src/ar-launch.js';
import { sceneToHashParam, studioShareUrl, normalizeGlbUrl } from '../src/studio/scene-math.js';

/** Everything the tools read from the environment, resolved once. */
export function readEnv(env = process.env) {
	return {
		pageUrl: env.AR_STUDIO_PAGE_URL || 'https://nirholas.github.io/3D-AR-Studio/studio.html',
		assets: env.AR_STUDIO_ASSETS || THREE_WS.objectsManifest,
		endpoint: env.AR_STUDIO_MCP_ENDPOINT || THREE_WS.studioMcp,
		origin: (env.AR_STUDIO_ORIGIN || THREE_WS.origin).replace(/\/$/, ''),
	};
}

const MODEL_SHAPE = z.object({
	src: z.string().describe('https URL of a .glb model.'),
	title: z.string().max(120).optional().describe('Label shown for this model.'),
	x: z.number().optional().describe('Metres right of the viewer. Default 0.'),
	z: z.number().optional().describe('Metres in front of the viewer, negative is further away. Default -1.6.'),
	yaw: z.number().optional().describe('Rotation in radians about the vertical axis.'),
	scale: z.number().min(0.25).max(4).optional().describe('Uniform scale, 0.25 to 4.'),
});

/**
 * Build the tool table.
 * @param {object} [opts]
 * @param {ReturnType<typeof readEnv>} [opts.env]
 * @param {ReturnType<typeof createForgeClient>} [opts.forge] Injectable for tests.
 */
export function createTools({ env = readEnv(), forge } = {}) {
	const client = forge || createForgeClient({ endpoint: env.endpoint });

	/** Every link that matters for one finished model. */
	const linksFor = (glbUrl, title, live = false) => ({
		glbUrl,
		arLaunchUrl: buildArLaunchUrl(env.origin, glbUrl, title, { live }),
		viewerUrl: buildViewerUrl(env.origin, glbUrl, title),
		sceneViewerUrl: buildSceneViewerUrl(glbUrl, { title, fallbackUrl: buildViewerUrl(env.origin, glbUrl, title) }),
		studioUrl: sceneUrl([{ src: glbUrl, title }], env.pageUrl),
	});

	return [
		{
			name: 'generate_3d_model',
			title: 'Generate a 3D model from text',
			description:
				'Turn a text prompt into a textured, downloadable 3D model (GLB). Free and keyless. Describe a '
				+ 'SINGLE object, character, or creature: "a brass mid-century desk lamp", not a whole scene. '
				+ 'Returns the model URL plus links that open it in the viewer, in the user\'s room through their '
				+ 'phone camera, and in the AR studio. Use kind:"avatar" for a character: it comes back rigged, so '
				+ 'it idles and animates instead of standing in a T-pose.',
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
			schema: {
				prompt: z.string().min(3).max(600).describe('The single object or character to model.'),
				kind: z.enum(['model', 'avatar', 'mesh']).optional()
					.describe('model (a prop, default), avatar (a rigged character), or mesh (art-directed, prompt refined first).'),
				tier: z.enum(['draft', 'standard', 'high']).optional().describe('Detail level. Higher is slower.'),
			},
			async run({ prompt, kind = 'model', tier }) {
				const check = validatePrompt(prompt);
				if (!check.ok) return fail(check.reason);
				const model = await client.generate(check.prompt, { kind, tier });
				const live = kind === 'avatar' || model.rigged;
				const links = linksFor(model.src, model.title, live);
				return ok(
					`Generated "${model.title}".\n`
					+ `Open it in your room (a phone routes itself to Quick Look or Scene Viewer): ${links.arLaunchUrl}\n`
					+ `Place it in the AR studio with other models: ${links.studioUrl}\n`
					+ `Model file: ${links.glbUrl}`,
					{ ...links, prompt: model.prompt, kind, format: 'glb', ...(live ? { rigged: true } : {}) },
				);
			},
		},

		{
			name: 'check_generation',
			title: 'Collect a generation that was still rendering',
			description:
				'Collect a 3D generation that was still rendering when generate_3d_model returned. Pass the job_id '
				+ 'from that result. While it is still working you get updated timing; when it is done you get the model.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
			schema: { job_id: z.string().min(1).describe('The job_id from a pending generation.') },
			async run({ job_id: jobId }) {
				const result = await client.mcp.callTool('check_job', { job_id: jobId });
				const data = result?.structuredContent || {};
				const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
				if (result?.isError) return fail(data.message || text || 'That job could not be collected.');
				const src = data.glbUrl || data.glb_url;
				if (!src) return ok(text || 'Still rendering. Try again shortly.', { status: 'pending', jobId, ...data });
				const links = linksFor(src, data.prompt ? promptTitle(data.prompt) : '');
				return ok(`Ready.\nOpen it in your room: ${links.arLaunchUrl}\nModel file: ${links.glbUrl}`, {
					status: 'done', ...links, ...(data.prompt ? { prompt: data.prompt } : {}),
				});
			},
		},

		{
			name: 'search_models',
			title: 'Search the ready-made model library',
			description:
				'Search the ready-made 3D model catalogue by name, category and tag. The default catalogue is a few '
				+ 'hundred public-domain (CC0) props, free to use commercially. Faster and more predictable than '
				+ 'generating when a common object will do: search first, generate what you cannot find.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
			schema: {
				query: z.string().max(120).optional().describe('Words to match against names, categories and tags. Omit to browse.'),
				limit: z.number().int().min(1).max(50).optional().describe('How many results to return. Default 12.'),
				catalogue: z.string().url().optional().describe('A different catalogue URL to search instead of the default.'),
			},
			async run({ query = '', limit = 12, catalogue }) {
				const url = catalogue || env.assets;
				const res = await fetch(url);
				if (!res.ok) return fail(`The catalogue at ${url} answered ${res.status}.`);
				const items = normalizeCatalogue(await res.json(), { rewriteUrl: (u) => cdnUrl(u, env.origin) });
				const q = query.trim().toLowerCase();
				const terms = q ? q.split(/\s+/) : [];
				const matches = terms.length
					? items.filter((it) => terms.every((t) => (it.keywords || it.title).includes(t)))
					: items;
				const page = matches.slice(0, limit).map((it) => ({
					src: it.src,
					title: it.title,
					poster: it.poster || undefined,
					arLaunchUrl: buildArLaunchUrl(env.origin, it.src, it.title),
				}));
				if (!page.length) {
					return ok(
						`Nothing in the catalogue matches "${query}". ${items.length} models are available: `
						+ 'try a broader word, or generate one with generate_3d_model.',
						{ total: items.length, matched: 0, models: [] },
					);
				}
				return ok(
					`${matches.length} of ${items.length} models match "${query || 'anything'}". Showing ${page.length}:\n`
					+ page.map((m) => `· ${m.title}: ${m.src}`).join('\n'),
					{ total: items.length, matched: matches.length, models: page },
				);
			},
		},

		{
			name: 'compose_ar_scene',
			title: 'Arrange models into one AR scene and get a link',
			description:
				'Arrange several models into a single scene and get one link that reopens it exactly: same models, '
				+ 'same positions, rotations and scales. Open that link on a phone and the whole arrangement stands in '
				+ 'the real room. Coordinates are metres on the floor: x is right, z is forward with negative values '
				+ 'further away, so { x: 0, z: -2 } is two metres in front of the viewer. This is the tool to reach for '
				+ 'when someone wants to see more than one thing at once.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			schema: {
				models: z.array(MODEL_SHAPE).min(1).max(20).describe('The models to arrange, in placement order.'),
				page_url: z.string().url().optional().describe('The page hosting the studio. Defaults to the hosted demo.'),
				title: z.string().max(120).optional().describe('A name for the scene, used in the summary.'),
			},
			async run({ models, page_url: pageUrl, title }) {
				const placements = [];
				const rejected = [];
				for (const [i, m] of models.entries()) {
					const src = normalizeGlbUrl(m.src);
					if (!src) { rejected.push(m.src); continue; }
					placements.push({
						src,
						title: m.title || `Model ${i + 1}`,
						x: Number.isFinite(m.x) ? m.x : 0,
						z: Number.isFinite(m.z) ? m.z : -1.6 - i * 0.1,
						yaw: Number.isFinite(m.yaw) ? m.yaw : 0,
						scale: Number.isFinite(m.scale) ? m.scale : 1,
					});
				}
				if (!placements.length) {
					return fail('None of those models are loadable https .glb URLs, so there is no scene to build.');
				}
				const base = pageUrl || env.pageUrl;
				const url = sceneUrl(placements, base);
				const short = studioShareUrl(base, placements);
				const note = rejected.length ? `\n${rejected.length} entr${rejected.length === 1 ? 'y was' : 'ies were'} skipped: only https .glb URLs can be placed.` : '';
				return ok(
					`${title ? `"${title}": ` : ''}${placements.length} model${placements.length === 1 ? '' : 's'} arranged.\n`
					+ `Open on a phone and tap Camera to see it in the room: ${url}${note}`,
					{ sceneUrl: url, modelsOnlyUrl: short, models: placements, skipped: rejected },
				);
			},
		},

		{
			name: 'export_ar',
			title: 'Turn a model into a "View in your space" link',
			description:
				'Turn any public GLB URL into a one-tap "View in your space" experience. The returned link routes '
				+ 'itself by device: Apple Quick Look on iPhone and iPad, Google Scene Viewer on Android, an '
				+ 'interactive WebGL viewer on desktop. Use it right after generating or finding a model so the '
				+ 'person can put it on their actual desk.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			schema: {
				glb_url: z.string().url().describe('Public https URL of a .glb or .gltf model.'),
				title: z.string().max(120).optional().describe('Name shown in the AR experience.'),
				kind: z.enum(['model', 'avatar']).optional().describe('avatar marks a rigged character, which stays animated.'),
				user_agent: z.string().optional().describe('If you know the viewer\'s User-Agent, the response names the viewer they will get.'),
			},
			async run({ glb_url: glbUrl, title = '', kind = 'model', user_agent: userAgent }) {
				let asset;
				try {
					asset = assertArAssetUrl(glbUrl);
				} catch (err) {
					return fail(err.message);
				}
				const links = linksFor(asset, title, kind === 'avatar');
				const target = userAgent ? detectArTarget(userAgent) : null;
				const viewerName = target === 'ios' ? 'Apple Quick Look' : target === 'android' ? 'Google Scene Viewer' : target === 'desktop' ? 'the WebGL viewer' : null;
				return ok(
					`Ready for AR. Open on a phone to place it in your space: ${links.arLaunchUrl}\n`
					+ (viewerName ? `That device will open ${viewerName}.\n` : '')
					+ `Interactive viewer: ${links.viewerUrl}`,
					{ ...links, format: 'glb', ...(target ? { target } : {}) },
				);
			},
		},

		{
			name: 'create_ar_page',
			title: 'Generate a deployable AR page',
			description:
				'Return a complete, self-contained HTML page that embeds the AR studio, configured for the caller\'s '
				+ 'models. Write it to a file, commit it, and it works on GitHub Pages, Netlify, Vercel, or any static '
				+ 'host: no build step and no API key. Use it when someone asks to "add AR to my site" rather than '
				+ 'just to see a model.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			schema: {
				title: z.string().max(80).optional().describe('Page and studio title.'),
				assets: z.string().optional().describe('Catalogue URL for the model tray. Defaults to the free CC0 library.'),
				accent: z.string().max(24).optional().describe('Accent colour, any CSS colour.'),
				models: z.array(MODEL_SHAPE).max(20).optional().describe('Models pre-loaded into the scene on open.'),
				generate: z.boolean().optional().describe('Show the text-to-3D prompt box. Default true.'),
			},
			async run(args) {
				const html = renderPage(args);
				return ok(
					`Here is a complete AR page (${(html.length / 1024).toFixed(1)} kB). Save it as index.html and publish it: `
					+ 'no build step, no key, nothing else to install.\n\n'
					+ html,
					{ html, filename: 'index.html', bytes: html.length },
				);
			},
		},
	];
}

// ── Result envelopes ────────────────────────────────────────────────────────

function ok(text, structuredContent) {
	return { content: [{ type: 'text', text }], ...(structuredContent ? { structuredContent } : {}) };
}

function fail(message) {
	return { content: [{ type: 'text', text: message }], structuredContent: { error: true, message }, isError: true };
}

/** A studio link carrying both the model list and the full arrangement hash. */
export function sceneUrl(placements, pageUrl) {
	const base = studioShareUrl(pageUrl, placements);
	const hash = sceneToHashParam(placements);
	return hash ? `${base}#s=${hash}` : base;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Render a standalone page that embeds the studio. Exported so the CLI reuses it. */
export function renderPage({ title = 'AR Studio', assets, accent = '#8b7cf8', models = [], generate = true } = {}) {
	const config = {
		branding: { title, accent },
		...(assets ? { assets } : {}),
		...(generate === false ? { generate: { enabled: false } } : {}),
		fullscreen: false,
	};
	const preload = (models || [])
		.map((m) => ({ src: normalizeGlbUrl(m.src), title: m.title || '' }))
		.filter((m) => m.src);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="Place 3D models in your real room, straight from the browser." />
<style>
	html, body { margin: 0; height: 100%; background: #06070a; color: #ecedf2;
		font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
	#stage { position: fixed; inset: 0; }
	noscript { display: block; padding: 32px; text-align: center; color: #9aa0af; }
</style>
</head>
<body>
<div id="stage"></div>
<noscript>This page needs JavaScript to render 3D models in your space.</noscript>
<script type="module">
import { createArStudio } from 'https://unpkg.com/3d-ar-studio/dist/ar-studio.min.js';

const studio = createArStudio('#stage', ${JSON.stringify(config, null, 2).replace(/\n/g, '\n')});
${preload.length ? `\nfor (const model of ${JSON.stringify(preload, null, 2)}) {\n\tawait studio.addModel(model, { announce: false });\n}\n` : ''}</script>
</body>
</html>
`;
}
