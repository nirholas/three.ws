import { sql } from '../../_lib/db.js';
import {
	listAvatars,
	getAvatar,
	getAvatarBySlug,
	searchPublicAvatars,
	resolveAvatarUrl,
	deleteAvatar,
} from '../../_lib/avatars.js';

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

function _mcpDefaultPolicy() {
	return {
		version: 1,
		origins: { mode: 'allowlist', hosts: [] },
		surfaces: { script: true, iframe: true, widget: true, mcp: true },
	};
}

function _mcpParsePolicy(p) {
	if (!p) return null;
	if (!('version' in p) && ('mode' in p || 'hosts' in p)) {
		// Old flat shape — only origins were configured; all surfaces (incl. mcp) allowed.
		return {
			..._mcpDefaultPolicy(),
			origins: { mode: p.mode || 'allowlist', hosts: p.hosts ?? [] },
		};
	}
	return { ..._mcpDefaultPolicy(), ...p };
}

async function _readMcpPolicyByAvatar(avatarId) {
	try {
		const [row] = await sql`
			SELECT embed_policy FROM agent_identities
			WHERE avatar_id = ${avatarId} AND deleted_at IS NULL
			LIMIT 1
		`;
		if (!row) return null;
		return _mcpParsePolicy(row.embed_policy);
	} catch (err) {
		if (/column .* does not exist/i.test(String(err?.message))) return null;
		throw err;
	}
}

function esc(s) {
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

function attr(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);
}

// CSS inputs land inside a <style> declaration (`background: <value>`), where
// HTML attribute-escaping does not defend against `;}body{…}` breakouts. Only
// allow a strict character class that cannot terminate the declaration/rule.
function safeCssValue(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[a-zA-Z0-9 .,%#()\-_/+]+$/.test(str)) return fallback;
	if (str.length > 120) return fallback;
	return str;
}

function safeCssLength(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|vh|vw|%)$|^auto$|^100%$/.test(str)) return fallback;
	return str;
}

// Posters are rendered as an attribute value that the browser fetches; restrict
// to https(:) to block `javascript:` and `data:` URLs that could execute code.
function safeHttpsUrl(s) {
	if (!s) return undefined;
	try {
		const u = new URL(String(s));
		return u.protocol === 'https:' ? u.toString() : undefined;
	} catch {
		return undefined;
	}
}

function renderModelViewerHtml({ src, name, poster, background, height, width, autoRotate, ar, cameraOrbit }) {
	const attrs = [
		`src="${attr(src)}"`,
		'camera-controls',
		'shadow-intensity="1"',
		'exposure="1"',
		'tone-mapping="aces"',
		autoRotate ? 'auto-rotate' : '',
		ar ? 'ar ar-modes="webxr scene-viewer quick-look"' : '',
		poster ? `poster="${attr(poster)}"` : '',
		cameraOrbit ? `camera-orbit="${attr(cameraOrbit)}"` : '',
		`alt="${attr(name || 'Avatar')}"`,
	]
		.filter(Boolean)
		.join(' ');
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8"><title>' + esc(name || 'Avatar') + '</title>',
		'<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>',
		'<style>html,body{margin:0;height:100%;background:' + attr(background) + '}',
		'model-viewer{width:' + attr(width) + ';height:' + attr(height) + ';--progress-bar-color:#6a5cff}</style>',
		'</head><body>',
		'<model-viewer ' + attrs + '></model-viewer>',
		'</body></html>',
	].join('\n');
}

function formatAvatarList(avatars, { public: isPublic = false } = {}) {
	if (!avatars.length) return 'No avatars found.';
	return avatars
		.map((a) => {
			const url = a.model_url ? ` — ${a.model_url}` : '';
			const vis = isPublic ? '' : ` [${a.visibility}]`;
			return `• ${a.name} (slug: ${a.slug}, id: ${a.id})${vis}${url}`;
		})
		.join('\n');
}

export const toolDefs = [
	{
		name: 'list_my_avatars',
		title: 'List my avatars',
		description:
			"List the authenticated user's avatars. Returns id, name, slug, size, visibility, and direct model_url (when visibility permits).",
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				cursor: {
					type: 'string',
					description: 'Opaque pagination cursor from previous response.',
				},
				visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
			},
			additionalProperties: false,
		},
		scope: 'avatars:read',
		async handler(args, auth) {
			const result = await listAvatars({
				userId: auth.userId,
				limit: args.limit || 25,
				cursor: args.cursor,
				visibility: args.visibility,
			});
			return {
				content: [{ type: 'text', text: formatAvatarList(result.avatars) }],
				structuredContent: result,
			};
		},
	},
	{
		name: 'get_avatar',
		title: 'Get avatar',
		description:
			'Fetch a single avatar by id or by owner+slug. Returns metadata and a model_url (public/unlisted) or short-lived signed URL (private).',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				slug: { type: 'string' },
			},
			additionalProperties: false,
		},
		scope: 'avatars:read',
		async handler(args, auth) {
			const avatar = args.id
				? await getAvatar({ id: args.id, requesterId: auth.userId })
				: args.slug
					? await getAvatarBySlug({
							ownerId: auth.userId,
							slug: args.slug,
							requesterId: auth.userId,
						})
					: null;
			if (!avatar) throw new Error('avatar not found');
			const urlInfo = await resolveAvatarUrl(avatar);
			const merged = { ...avatar, ...urlInfo };
			return {
				content: [{ type: 'text', text: JSON.stringify(merged, null, 2) }],
				structuredContent: merged,
			};
		},
	},
	{
		name: 'search_public_avatars',
		title: 'Search public avatars',
		description:
			'Search the public avatar gallery. Useful for finding characters to render without prior knowledge of an id.',
		inputSchema: {
			type: 'object',
			properties: {
				q: { type: 'string', description: 'Free-text search over name and description.' },
				tag: { type: 'string', description: 'Filter to one tag.' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
			},
			additionalProperties: false,
		},
		async handler(args, auth) {
			// Unauthenticated callers (x402/anonymous) are capped at 10 to prevent bulk enumeration.
			const maxLimit = auth.userId ? 50 : 10;
			const result = await searchPublicAvatars({
				q: args.q,
				tag: args.tag,
				limit: Math.min(args.limit || 12, maxLimit),
			});
			return {
				content: [
					{ type: 'text', text: formatAvatarList(result.avatars, { public: true }) },
				],
				structuredContent: result,
			};
		},
	},
	{
		name: 'render_avatar',
		title: 'Render avatar',
		description:
			'Produce an HTML <model-viewer> snippet that renders the given avatar. ' +
			'Return this text as an inline HTML artifact to display an interactive 3D avatar.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				slug: { type: 'string' },
				auto_rotate: { type: 'boolean', default: true },
				background: {
					type: 'string',
					description: 'CSS background color or gradient.',
					default: 'transparent',
				},
				height: { type: 'string', default: '480px' },
				width: { type: 'string', default: '100%' },
				camera_orbit: {
					type: 'string',
					description: 'model-viewer camera-orbit value, e.g. "0deg 80deg 2m".',
				},
				poster: {
					type: 'string',
					description: 'Optional poster image URL shown while loading.',
				},
				ar: {
					type: 'boolean',
					default: true,
					description: 'Include AR button for mobile.',
				},
			},
			additionalProperties: false,
		},
		scope: 'avatars:read',
		async handler(args, auth) {
			const avatar = args.id
				? await getAvatar({ id: args.id, requesterId: auth.userId })
				: args.slug
					? await getAvatarBySlug({
							ownerId: auth.userId,
							slug: args.slug,
							requesterId: auth.userId,
						})
					: null;
			if (!avatar) throw new Error('avatar not found');
			// surfaces.mcp gate — check if a registered agent owns this avatar
			const _mcpPolicy = await _readMcpPolicyByAvatar(avatar.id);
			if (_mcpPolicy && _mcpPolicy.surfaces?.mcp === false) {
				throw rpcError(
					-32000,
					'embed_denied_surface',
					'This agent disallows the MCP surface.',
				);
			}
			const urlInfo = await resolveAvatarUrl(avatar, { expiresIn: 3600 });
			const html = renderModelViewerHtml({
				src: urlInfo.url,
				name: avatar.name,
				poster: safeHttpsUrl(args.poster),
				background: safeCssValue(args.background, 'transparent'),
				height: safeCssLength(args.height, '480px'),
				width: safeCssLength(args.width, '100%'),
				autoRotate: args.auto_rotate !== false,
				ar: args.ar !== false,
				cameraOrbit: safeCssValue(args.camera_orbit, ''),
			});
			// Keep chat text short so claude.ai doesn't dump the full HTML into the
			// transcript. The HTML goes in the resource entry, which clients render
			// as an inline artifact when mimeType is text/html.
			const summary = `Rendered avatar "${avatar.name}". Display the attached text/html resource as an inline HTML artifact.`;
			return {
				content: [
					{ type: 'text', text: summary },
					{
						type: 'resource',
						resource: {
							uri: `avatar://${avatar.id}`,
							mimeType: 'text/html',
							text: html,
						},
					},
				],
				structuredContent: { html, avatar: { ...avatar, ...urlInfo } },
			};
		},
	},
	{
		name: 'delete_avatar',
		title: 'Delete avatar',
		description: 'Soft-delete an avatar you own. Requires avatars:delete scope.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				confirm: {
					type: 'boolean',
					description: 'Must be true to confirm permanent deletion.',
				},
			},
			required: ['id'],
			additionalProperties: false,
		},
		scope: 'avatars:delete',
		async handler(args, auth) {
			if (!args.confirm) {
				return {
					content: [
						{
							type: 'text',
							text: 'Set confirm: true to permanently delete this avatar.',
						},
					],
					isError: true,
				};
			}
			const result = await deleteAvatar({ id: args.id, userId: auth.userId });
			if (!result) throw new Error('avatar not found or not yours');
			// TODO: audit_log table needed — INSERT (user_id, action='delete_avatar', resource_id, created_at)
			return { content: [{ type: 'text', text: `Deleted avatar ${args.id}.` }] };
		},
	},
];
