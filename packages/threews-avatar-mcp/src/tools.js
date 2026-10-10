// Tool surface for the three.ws avatar MCP server.
//
// Three free, read-only tools over real three.ws endpoints:
//   - render_avatar     → live 3D avatar in chat (image + interactive HTML + embed)
//   - avatar_embed_code → ready-to-paste iframe to embed the avatar anywhere
//   - get_avatar        → avatar metadata (name, model url, owner, visibility)
//
// Handlers trust their inputs (the JSON-Schema is the boundary) and let
// ThreewsError propagate — the server turns those into MCP tool errors with the
// real upstream cause.

import {
	resolveAvatar,
	renderImage,
	embedUrl,
	viewerUrl,
	iframeSnippet,
	modelViewerHtml,
} from './threews.js';
import { UI_TOOL_META } from './ui.js';

// Every tool is a read of three.ws state over the network: no writes, no side
// effects, and the same avatar state always yields the same result.
const READ_ONLY_ANNOTATIONS = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: true,
	idempotentHint: true,
};

// One of these three selectors identifies an avatar across every tool.
const selectorProps = {
	id: { type: 'string', description: 'Avatar UUID (from a three.ws avatar URL or get_avatar).' },
	handle: { type: 'string', description: 'three.ws username/handle, e.g. "nirholas" or "@nirholas".' },
	model: { type: 'string', description: 'Direct GLB/GLTF model URL (skips lookup; used as-is).' },
};

// Shared output fields. The low-level Server only ADVERTISES outputSchema (it
// never validates structuredContent), so these mirror the exact shapes the
// handlers below build — every property listed is really emitted, nullables
// are fields the code can set to null, and additionalProperties stays open so
// future additive fields never break strict clients.
const outputProps = {
	id: {
		type: ['string', 'null'],
		description: 'Avatar UUID, or null when the avatar came from a raw model URL.',
	},
	name: { type: 'string', description: 'Avatar display name.' },
	model_url: { type: 'string', description: 'Direct GLB/GLTF model URL.' },
	embed_url: { type: 'string', description: 'Live avatar-embed page URL (iframe src).' },
	iframe: { type: 'string', description: 'Ready-to-paste <iframe> embed snippet.' },
};

function textBlock(text) {
	return { type: 'text', text };
}

export function buildTools() {
	return [
		{
			definition: {
				name: 'render_avatar',
				title: 'Render 3D avatar',
				annotations: READ_ONLY_ANNOTATIONS,
				description:
					'Render a three.ws 3D avatar inline: shows an interactive (rotatable) 3D model ' +
					'in the chat, plus a preview image and a ready-to-embed live URL. Identify the ' +
					'avatar by id, @handle, or a raw GLB url. Use this when the user wants to see the avatar ' +
					'in the conversation; for an iframe to paste into a website, call avatar_embed_code instead.',
				// MCP Apps (SEP-1865): links this tool to its interactive UI resource so
				// supporting hosts (Claude, etc.) render the live model-viewer in a
				// sandboxed iframe. Hosts without app support use the content blocks below.
				_meta: UI_TOOL_META,
				inputSchema: {
					type: 'object',
					properties: {
						...selectorProps,
						background: {
							type: 'string',
							enum: ['transparent', 'dark', 'light'],
							default: 'transparent',
							description: 'Backdrop for the preview/embed.',
						},
						scene: {
							type: 'string',
							enum: ['portrait', 'headshot', 'upper-body', 'full-body'],
							default: 'portrait',
							description: 'Framing for the rendered preview image.',
						},
						auto_rotate: { type: 'boolean', default: true, description: 'Spin the model in the interactive view.' },
						height: { type: 'integer', minimum: 160, maximum: 1080, default: 480 },
					},
					anyOf: [{ required: ['id'] }, { required: ['handle'] }, { required: ['model'] }],
				},
				outputSchema: {
					type: 'object',
					properties: {
						...outputProps,
						background: { type: 'string', description: 'Backdrop applied to the preview/embed.' },
						viewer_url: {
							type: 'string',
							description: 'Standalone full-page interactive viewer URL.',
						},
					},
					required: ['id', 'name', 'model_url', 'background', 'embed_url', 'viewer_url', 'iframe'],
					additionalProperties: true,
				},
			},
			handler: async (args) => {
				const avatar = await resolveAvatar(args);
				const background = args.background || 'transparent';
				const height = args.height || 480;
				const autoRotate = args.auto_rotate !== false;

				const embed = embedUrl(
					{ id: avatar.id, handle: args.handle, model: args.model, background },
				);
				const viewer = viewerUrl({ model_url: avatar.model_url, background, autoRotate });
				const iframe = iframeSnippet(embed, { height });
				const html = modelViewerHtml({
					model_url: avatar.model_url,
					name: avatar.name,
					background,
					height,
					autoRotate,
				});

				const content = [];

				// Best-effort PNG preview (renders inline in every client). Only the
				// server-side renderer (needs an avatar id) can produce this; a raw
				// model url or a render failure simply omits the image.
				if (avatar.id) {
					try {
						const img = await renderImage({ id: avatar.id, scene: args.scene || 'portrait', background });
						content.push({ type: 'image', data: img.base64, mimeType: img.mimeType });
					} catch {
						/* preview is optional — fall through to the interactive + embed views */
					}
				}

				// Interactive, rotatable 3D for clients that render HTML resources.
				content.push({
					type: 'resource',
					resource: {
						uri: `avatar://${avatar.id || 'external'}`,
						mimeType: 'text/html',
						text: html,
					},
				});

				content.push(
					textBlock(
						`${avatar.name} — live 3D avatar from three.ws.\n\n` +
							`Interactive view: ${viewer}\n` +
							`Embed (live, like a YouTube video):\n${iframe}\n\n` +
							`Embed URL: ${embed}`,
					),
				);

				return {
					content,
					structuredContent: {
						id: avatar.id,
						name: avatar.name,
						model_url: avatar.model_url,
						background,
						embed_url: embed,
						viewer_url: viewer,
						iframe,
					},
				};
			},
		},

		{
			definition: {
				name: 'avatar_embed_code',
				title: 'Get avatar embed code',
				annotations: READ_ONLY_ANNOTATIONS,
				description:
					'Get a ready-to-paste iframe that embeds a live, interactive three.ws 3D avatar ' +
					'into any website or app, as easy as embedding a YouTube video. Use this when the avatar ' +
					'has to live on a page outside this chat; to show it here, call render_avatar instead.',
				inputSchema: {
					type: 'object',
					properties: {
						...selectorProps,
						background: { type: 'string', enum: ['transparent', 'dark', 'light'], default: 'transparent' },
						width: { type: 'string', default: '100%', description: 'CSS width, e.g. "100%" or "480px".' },
						height: { type: 'integer', minimum: 160, maximum: 1080, default: 480 },
						idle: { type: 'boolean', default: true, description: 'Play the idle animation loop.' },
						overlay: { type: 'boolean', default: false, description: 'Chrome-free mode (good for OBS/overlays).' },
					},
					anyOf: [{ required: ['id'] }, { required: ['handle'] }, { required: ['model'] }],
				},
				outputSchema: {
					type: 'object',
					properties: {
						embed_url: outputProps.embed_url,
						iframe: outputProps.iframe,
						name: outputProps.name,
						id: outputProps.id,
					},
					required: ['embed_url', 'iframe', 'name', 'id'],
					additionalProperties: true,
				},
			},
			handler: async (args) => {
				// Validate the avatar exists (and surface a clear error if not) before
				// handing back embed code that would otherwise 404 for the user.
				const avatar = await resolveAvatar(args);
				const embed = embedUrl({
					id: avatar.id,
					handle: args.handle,
					model: args.model,
					background: args.background || 'transparent',
					idle: args.idle !== false,
					overlay: Boolean(args.overlay),
				});
				const iframe = iframeSnippet(embed, { width: args.width || '100%', height: args.height || 480 });
				return {
					content: [textBlock(`Embed code for ${avatar.name}:\n\n${iframe}\n\nEmbed URL: ${embed}`)],
					structuredContent: { embed_url: embed, iframe, name: avatar.name, id: avatar.id },
				};
			},
		},

		{
			definition: {
				name: 'get_avatar',
				title: 'Get avatar metadata',
				annotations: READ_ONLY_ANNOTATIONS,
				description:
					'Fetch metadata for a three.ws avatar (name, GLB model url, owner, visibility) by id or @handle. ' +
					'Use this to resolve a handle to its avatar id and GLB url before rendering, embedding, or downloading it.',
				inputSchema: {
					type: 'object',
					properties: { id: selectorProps.id, handle: selectorProps.handle },
					anyOf: [{ required: ['id'] }, { required: ['handle'] }],
				},
				// Mirrors the normalized avatar record from resolveAvatar: nullable
				// fields are always present (as null when unknown); `owner` is omitted
				// entirely when the API response carries no user.
				outputSchema: {
					type: 'object',
					properties: {
						id: outputProps.id,
						name: outputProps.name,
						slug: { type: ['string', 'null'], description: 'URL slug, or null if the avatar has none.' },
						model_url: outputProps.model_url,
						thumbnail: {
							type: ['string', 'null'],
							description: 'Preview/poster image URL, or null if none is published.',
						},
						visibility: {
							type: ['string', 'null'],
							description: 'Avatar visibility (e.g. "public", "unlisted"), or null if unreported.',
						},
						owner: {
							type: 'object',
							description: 'Owning user; omitted when the API response has no user record.',
							properties: {
								username: { type: 'string' },
								display_name: { type: 'string' },
							},
							additionalProperties: true,
						},
					},
					required: ['id', 'name', 'slug', 'model_url', 'thumbnail', 'visibility'],
					additionalProperties: true,
				},
			},
			handler: async (args) => {
				const avatar = await resolveAvatar(args);
				return {
					content: [textBlock(JSON.stringify(avatar, null, 2))],
					structuredContent: avatar,
				};
			},
		},
	];
}
