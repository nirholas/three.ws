import { pumpfunMcp, pumpfunBotEnabled } from '../../_lib/pumpfun-mcp.js';
import { env } from '../../_lib/env.js';
import { fetchModel, FetchModelError } from '../../_lib/fetch-model.js';
import {
	DEFAULT_CREATE_COST_SOL,
	DESCRIPTION_MAX,
	MAX_SOL_BUY_IN,
	NAME_MAX,
	SYMBOL_MAX,
	launchCost,
	normalizeSymbol,
	parseBuyIn,
} from '../../../src/launch/launch-model.js';

function clamp(n, lo, hi, fallback) {
	const x = Number(n);
	if (!Number.isFinite(x)) return fallback;
	return Math.max(lo, Math.min(hi, x));
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

// The launch page caps an image at 4 MB (src/launch/launch-page.js
// IMAGE_MAX_BYTES), the same cap /api/pump/build-metadata enforces server
// side on the data-URL path. Mirrored here rather than imported: neither of
// those modules exports the constant, and this is the third independent spot
// that needs it.
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

// FetchModelError codes that mean the URL itself is unsafe or unusable, not
// that the host happened to be unreachable right now. These fail the tool
// call outright. Everything else (timeouts, redirects, a host that blocks
// server fetches) degrades to image_checked: false per the "image hosts
// block server fetches" never-blocked row: the launch page fetches the image
// itself (via the browser, not this server) and will succeed or fail there.
const HARD_REJECT_IMAGE_CODES = new Set([
	'invalid_url',
	'scheme_not_allowed',
	'private_address',
	'host_pin_mismatch',
	'file_too_large',
]);

/** Fetch + sniff the coin image so a bad URL is caught before the human ever opens the launch page. */
async function checkLaunchImage(rawUrl) {
	try {
		const { contentType, bytes } = await fetchModel(rawUrl, {
			maxBytes: IMAGE_MAX_BYTES,
			timeoutMs: 10_000,
			headers: { accept: 'image/png, image/jpeg, image/webp, image/gif, image/*;q=0.8' },
		});
		if (!contentType.startsWith('image/')) {
			throw rpcError(-32602, `image_url did not return an image (content-type: ${contentType})`);
		}
		return { checked: true, contentType, bytes: bytes.byteLength };
	} catch (err) {
		if (err instanceof FetchModelError) {
			if (HARD_REJECT_IMAGE_CODES.has(err.code)) {
				throw rpcError(-32602, `image_url rejected: ${err.message}`);
			}
			return {
				checked: false,
				note: `could not pre-check the image (${err.message}); the launch page will fetch it directly in the browser`,
			};
		}
		throw err;
	}
}

// MCP tool annotations (2025-06-18 spec): every pump.fun intel tool is a
// read-only view of a live upstream feed, never idempotent (the market moves),
// never destructive. destructiveHint defaults to TRUE when omitted, so it is
// set explicitly.
const LIVE_FEED_ANNOTATIONS = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};

function pumpfunToolResult(r) {
	if (!pumpfunBotEnabled()) {
		return {
			content: [{ type: 'text', text: 'pump.fun feed is not configured on this server.' }],
			isError: true,
		};
	}
	if (!r.ok) {
		return {
			content: [{ type: 'text', text: `pump.fun upstream error: ${r.error}` }],
			isError: true,
		};
	}
	const payload = Array.isArray(r.data) ? { items: r.data } : r.data;
	return {
		content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload,
	};
}

export const toolDefs = [
	{
		name: 'pumpfun_recent_claims',
		title: 'Recent pump.fun claims',
		annotations: LIVE_FEED_ANNOTATIONS,
		description:
			"Fetch the most recent pump.fun GitHub social-fee claim events with full enrichment: GitHub profile, X/Twitter follower data, influencer tier, first-time-claim flag, fake-claim detection, and AI summary. Use to answer 'what's happening on pump.fun right now?'.",
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			additionalProperties: false,
		},
		async handler(args) {
			return pumpfunToolResult(
				await pumpfunMcp.recentClaims({ limit: clamp(args?.limit, 1, 50, 10) }),
			);
		},
	},
	{
		name: 'pumpfun_token_intel',
		title: 'Pump.fun token intel',
		annotations: LIVE_FEED_ANNOTATIONS,
		description:
			'Full intel on a pump.fun token: graduation status, bonding-curve progress, creator profile, top holders, volume, bundle detection, and trust signals. Use this before buying or discussing one pump.fun token; to vet the wallet that launched it call pumpfun_creator_intel.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string', description: 'SPL mint pubkey (base58).' },
			},
			required: ['mint'],
			additionalProperties: false,
		},
		async handler(args) {
			if (!args?.mint) throw Object.assign(new Error('mint required'), { status: 400 });
			return pumpfunToolResult(await pumpfunMcp.tokenIntel({ mint: args.mint }));
		},
	},
	{
		name: 'pumpfun_creator_intel',
		title: 'Pump.fun creator intel',
		annotations: LIVE_FEED_ANNOTATIONS,
		description:
			'Reputation profile for a pump.fun creator wallet: prior launches, graduation rate, claim activity, and behavioural trust signals. Use this to judge whether a launcher has a track record of real launches before trusting a new coin from that wallet.',
		inputSchema: {
			type: 'object',
			properties: {
				wallet: { type: 'string', description: 'Solana wallet pubkey (base58).' },
			},
			required: ['wallet'],
			additionalProperties: false,
		},
		async handler(args) {
			if (!args?.wallet) throw Object.assign(new Error('wallet required'), { status: 400 });
			return pumpfunToolResult(await pumpfunMcp.creatorIntel({ wallet: args.wallet }));
		},
	},
	{
		name: 'pumpfun_recent_graduations',
		title: 'Recent pump.fun graduations',
		annotations: LIVE_FEED_ANNOTATIONS,
		description:
			'Tokens that recently graduated from the bonding curve to PumpAMM, with creator + holder analysis. Use this to see which pump.fun coins just left the bonding curve; for a deep read on one of them call pumpfun_token_intel.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			additionalProperties: false,
		},
		async handler(args) {
			return pumpfunToolResult(
				await pumpfunMcp.graduations({ limit: clamp(args?.limit, 1, 50, 10) }),
			);
		},
	},
	{
		name: 'pumpfun_prepare_launch',
		title: 'Prepare a pump.fun launch for a human to sign',
		// Read-only from the server's point of view: it validates input and
		// fetches the image to check it, but writes nothing and moves no funds.
		// Nothing is launched until the human opens the returned URL and signs
		// the transaction themselves on /launch.
		annotations: LIVE_FEED_ANNOTATIONS,
		description:
			"Prepare a pump.fun coin launch and return a /launch URL with every field pre-filled, so a human can review and sign it in their own wallet. This tool NEVER launches a coin, signs a transaction, or moves funds: it only validates the name, ticker and image, then hands back a link. Use after the human has agreed on a name, ticker, description and image for their agent's coin.",
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: `Coin name, ${NAME_MAX} characters or fewer.` },
				symbol: {
					type: 'string',
					description: `Ticker. Normalized to uppercase letters and digits only, capped at ${SYMBOL_MAX} characters; must leave at least 2.`,
				},
				description: { type: 'string', description: `Coin description, ${DESCRIPTION_MAX} characters or fewer. May be empty.` },
				image_url: {
					type: 'string',
					description: 'Public HTTPS URL of the coin image (PNG/JPEG/WebP/GIF). Fetched and type/size-checked before the link is returned.',
				},
				initial_buy_sol: {
					type: 'number',
					minimum: 0,
					maximum: MAX_SOL_BUY_IN,
					description: `Optional dev buy in SOL, 0 to ${MAX_SOL_BUY_IN}. Omit or 0 for no dev buy.`,
				},
				agent_id: {
					type: 'string',
					description: "Optional three.ws agent id or slug to link the coin to. If omitted, the human picks an agent on the launch page.",
				},
			},
			required: ['name', 'symbol', 'description', 'image_url'],
			additionalProperties: false,
		},
		async handler(args) {
			const name = String(args?.name || '').trim();
			if (!name) throw rpcError(-32602, 'name is required');
			if ([...name].length > NAME_MAX) throw rpcError(-32602, `name must be ${NAME_MAX} characters or fewer`);

			const symbol = normalizeSymbol(args?.symbol);
			if (symbol.length < 2) {
				throw rpcError(-32602, 'symbol must normalize to at least two letters or digits (A-Z, 0-9)');
			}

			const description = String(args?.description ?? '');
			if (description.length > DESCRIPTION_MAX) {
				throw rpcError(-32602, `description must be ${DESCRIPTION_MAX} characters or fewer`);
			}

			const imageUrl = String(args?.image_url || '').trim();
			if (!imageUrl) throw rpcError(-32602, 'image_url is required');

			const buyIn = parseBuyIn(args?.initial_buy_sol);
			if (Number.isNaN(buyIn)) throw rpcError(-32602, 'initial_buy_sol must be a number');
			if (buyIn > MAX_SOL_BUY_IN) throw rpcError(-32602, `initial_buy_sol is capped at ${MAX_SOL_BUY_IN} SOL`);

			const agentId = args?.agent_id ? String(args.agent_id).trim() : '';

			const image = await checkLaunchImage(imageUrl);

			const url = new URL('/launch', env.APP_ORIGIN);
			url.searchParams.set('name', name);
			url.searchParams.set('symbol', symbol);
			if (description) url.searchParams.set('description', description);
			url.searchParams.set('image', imageUrl);
			if (buyIn > 0) url.searchParams.set('initialBuy', String(buyIn));
			if (agentId) url.searchParams.set('avatar', agentId);
			url.searchParams.set('prepared', 'assistant');

			const cost = launchCost({ buyIn, quote: 'sol', feeBps: 0, createCostSol: DEFAULT_CREATE_COST_SOL });

			const summary = [
				`Prepared a pump.fun launch: "${name}" ($${symbol}).`,
				description ? `Description: ${description}` : 'No description set.',
				image.checked
					? `Image checked: ${image.contentType}, ${Math.round(image.bytes / 1024)} KB.`
					: `Image not pre-checked (${image.note}).`,
				buyIn > 0
					? `Dev buy: ${buyIn} SOL (plus the ~${DEFAULT_CREATE_COST_SOL} SOL create cost; the launch page shows the exact total with the live fee before signing).`
					: `No dev buy; only the ~${DEFAULT_CREATE_COST_SOL} SOL create cost applies, shown exactly on the launch page.`,
				agentId ? `Linked agent: ${agentId}.` : 'No agent linked yet; the human picks one on the launch page.',
				'Nothing is launched yet. The human opens the link below, reviews every field, and signs the transaction in their own wallet.',
				url.toString(),
			].join('\n');

			return {
				content: [{ type: 'text', text: summary }],
				structuredContent: {
					launch_url: url.toString(),
					name,
					symbol,
					description,
					image_url: imageUrl,
					image_checked: image.checked,
					image_content_type: image.checked ? image.contentType : null,
					initial_buy_sol: buyIn,
					agent_id: agentId || null,
					estimated_total_sol: cost.totalSol,
					requires_human_signature: true,
				},
			};
		},
	},
];
