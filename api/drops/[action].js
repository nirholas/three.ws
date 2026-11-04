// api/drops/[action]: generative 3D drops.
//
//   GET  /api/drops/list?limit=&before=&mine=1
//   GET  /api/drops/get?slug=<slug>
//   GET  /api/drops/items?slug=<slug>&limit=&offset=&tier=&status=&sort=
//   GET  /api/drops/verify?slug=<slug>&index=
//   POST /api/drops/create   { name, symbol, style, supply, layers[], description?, seed?, visibility? }
//   POST /api/drops/publish  { slug }
//   POST /api/drops/reveal   { slug, index }
//   GET  /api/drops/reveal?slug=<slug>&index=<n>     (poll an in-flight reveal)
//   POST /api/drops/mint-collection { slug, network?, confirm_mainnet? }   (create the Core collection)
//   POST /api/drops/mint    { slug, index | all:true, owner_wallet?, network?, confirm_mainnet? }
//   GET  /api/drops/mint?slug=<slug>[&index=<n>]     (on-chain state of a drop or one item)
//
// The split that shapes this file: rolling a supply is pure and instant, so
// create does the whole collection in one request. Forging the art is neither,
// so reveal is a claim-then-poll job per item and never blocks a request on a
// GPU. See api/_lib/drops.js for the engine and api/_lib/drop-store.js for the
// persistence invariants.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { originFromReq, startForge } from '../_mcp-studio/forge-client.js';
import { getUserSolanaWallets } from '../_lib/nft-gate.js';
import { DropMintError, createDropCollection, mintDropItem } from '../_lib/drop-mint.js';
import { resolveNetwork, assetExplorerUrl } from '../_lib/tokenize-3d.js';
import { requireFeatureAccess } from '../_lib/require-three.js';
import { clampEarlyMinutes, dropEarlyWindowOpen } from '../_lib/early-window.js';
import {
	DropSpecError,
	itemPrompt,
	normalizeLayers,
	provenanceHash,
	verifyItem,
} from '../_lib/drops.js';
import {
	attachForgeJob,
	claimForReveal,
	countItems,
	createDrop,
	dropStats,
	dropsConfigured,
	getDropBySlug,
	getItem,
	getItemMintState,
	itemDistribution,
	listDrops,
	listItems,
	listMintableIndexes,
	markRevealFailed,
	markRevealed,
	publishDrop,
	releaseClaim,
} from '../_lib/drop-store.js';

// A reveal that has been claimed but whose forge job never came back leaves the
// row in `revealing` forever. Any poll arriving after this window releases the
// claim so the item can be revealed again, which is the self-healing the
// alternative (a cron just for stuck drops) would otherwise need.
const REVEAL_STALL_MS = 15 * 60 * 1000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (!dropsConfigured()) {
		return error(res, 503, 'not_configured', 'drops need a database; none is configured here');
	}

	const action = actionOf(req);
	try {
		switch (action) {
			case 'list':
				return await handleList(req, res);
			case 'get':
				return await handleGet(req, res);
			case 'items':
				return await handleItems(req, res);
			case 'verify':
				return await handleVerify(req, res);
			case 'create':
				return await handleCreate(req, res);
			case 'publish':
				return await handlePublish(req, res);
			case 'reveal':
				return req.method === 'POST' ? await handleReveal(req, res) : await handleRevealStatus(req, res);
			case 'mint-collection':
				return await handleMintCollection(req, res);
			case 'mint':
				return req.method === 'POST' ? await handleMint(req, res) : await handleMintState(req, res);
			default:
				return error(res, 404, 'not_found', `unknown drops action "${action}"`);
		}
	} catch (err) {
		if (err instanceof DropSpecError) return error(res, 400, err.code, err.message);
		if (err instanceof DropMintError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

function actionOf(req) {
	const fromQuery = req.query?.action;
	if (fromQuery && fromQuery !== '[action]') return String(fromQuery).toLowerCase();
	return (new URL(req.url, 'http://x').pathname.split('/').pop() || '').toLowerCase();
}

function queryOf(req) {
	return new URL(req.url, 'http://x').searchParams;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Reads
 * ────────────────────────────────────────────────────────────────────────── */

async function handleList(req, res) {
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const q = queryOf(req);
	const mine = q.get('mine') === '1';
	let ownerId = null;
	if (mine) {
		const auth = await resolveAuth(req, 'avatars:read');
		if (!auth) return error(res, 401, 'unauthorized', 'sign in to list your own drops');
		ownerId = auth.userId;
	}

	const drops = await listDrops({
		limit: Number(q.get('limit')) || 24,
		before: q.get('before') || null,
		ownerId,
	});
	return json(res, 200, { drops, next: drops.length ? drops[drops.length - 1].created_at : null });
}

async function handleGet(req, res) {
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const viewer = await resolveAuth(req, 'avatars:read');
	const drop = await loadDrop(req, viewer?.userId || null);
	if (!drop) return error(res, 404, 'not_found', 'no such drop');

	const [stats, distribution, preview] = await Promise.all([
		dropStats(drop.id),
		itemDistribution(drop.id, drop.layers),
		listItems(drop.id, { limit: 24, sort: 'rank' }),
	]);

	return json(res, 200, { drop, stats, distribution, items: preview });
}

async function handleItems(req, res) {
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const viewer = await resolveAuth(req, 'avatars:read');
	const drop = await loadDrop(req, viewer?.userId || null);
	if (!drop) return error(res, 404, 'not_found', 'no such drop');

	const q = queryOf(req);
	const tier = normalizeEnum(q.get('tier'), ['common', 'rare', 'epic', 'legendary']);
	const status = normalizeEnum(q.get('status'), ['sealed', 'revealing', 'revealed', 'failed']);
	const offset = Math.max(Number(q.get('offset')) || 0, 0);
	const limit = Number(q.get('limit')) || 48;

	const [items, total] = await Promise.all([
		listItems(drop.id, { limit, offset, tier, status, sort: q.get('sort') === 'index' ? 'index' : 'rank' }),
		countItems(drop.id, { tier, status }),
	]);

	return json(res, 200, { items, total, offset, limit: items.length });
}

/**
 * Recompute the published commitment, and optionally one item's traits, from
 * the drop's own spec. This is the endpoint that makes "the roll was not
 * rigged" checkable rather than asserted: it re-derives the hash from the
 * stored layers and re-rolls the requested index through the same pure
 * function a third party would.
 */
async function handleVerify(req, res) {
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const viewer = await resolveAuth(req, 'avatars:read');
	const drop = await loadDrop(req, viewer?.userId || null);
	if (!drop) return error(res, 404, 'not_found', 'no such drop');
	if (!drop.seed) {
		return error(res, 409, 'not_revealed', 'this drop has not published its seed yet');
	}

	const layers = normalizeLayers(drop.layers);
	const recomputed = provenanceHash({
		seed: drop.seed,
		supply: drop.supply,
		style: drop.style,
		layers,
	});

	const body = {
		slug: drop.slug,
		seed: drop.seed,
		supply: drop.supply,
		published_hash: drop.provenance_hash,
		recomputed_hash: recomputed,
		hash_matches: recomputed === drop.provenance_hash,
	};

	const rawIndex = queryOf(req).get('index');
	if (rawIndex !== null && rawIndex !== '') {
		const index = Number(rawIndex);
		if (!Number.isInteger(index) || index < 0 || index >= drop.supply) {
			return error(res, 400, 'validation_error', `index must be between 0 and ${drop.supply - 1}`);
		}
		const stored = await getItem(drop.id, index);
		if (!stored) return error(res, 404, 'not_found', 'no such item');
		const check = verifyItem({ seed: drop.seed, index, layers, traits: stored.traits });
		body.item = {
			index,
			served_traits: stored.traits,
			recomputed_traits: check.expected,
			traits_match: check.ok,
		};
	}

	return json(res, 200, body);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Writes
 * ────────────────────────────────────────────────────────────────────────── */

async function handleCreate(req, res) {
	if (!method(req, res, ['POST'])) return;
	const auth = await resolveAuth(req, 'avatars:write');
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to create a drop');

	const rl = await limits.agentCreateIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many drops created; slow down');

	const body = await readJson(req);
	const name = String(body?.name ?? '').trim();
	const symbol = String(body?.symbol ?? '').trim().toUpperCase();
	const style = String(body?.style ?? '').trim();

	if (name.length < 2 || name.length > 60) {
		return error(res, 400, 'validation_error', 'name must be 2 to 60 characters');
	}
	if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
		return error(res, 400, 'validation_error', 'symbol must be 2 to 10 letters or digits');
	}
	if (style.length < 3 || style.length > 400) {
		return error(res, 400, 'validation_error', 'style must be 3 to 400 characters');
	}
	const visibility = normalizeEnum(body?.visibility, ['public', 'unlisted', 'private']) || 'public';

	const drop = await createDrop({
		ownerId: auth.userId,
		name,
		symbol,
		description: String(body?.description ?? '').trim().slice(0, 2000) || null,
		style,
		supply: body?.supply,
		layers: body?.layers,
		seed: typeof body?.seed === 'string' ? body.seed.trim() : null,
		visibility,
		earlyMinutes: body?.early_minutes === undefined ? undefined : clampEarlyMinutes(body.early_minutes),
	});

	return json(res, 201, { drop });
}

async function handlePublish(req, res) {
	if (!method(req, res, ['POST'])) return;
	const auth = await resolveAuth(req, 'avatars:write');
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to publish a drop');

	const body = await readJson(req);
	const slug = String(body?.slug ?? '').trim();
	const existing = await getDropBySlug(slug, { viewerId: auth.userId });
	if (!existing) return error(res, 404, 'not_found', 'no such drop');
	if (!existing.is_owner) return error(res, 403, 'forbidden', 'only the creator can publish this drop');

	const drop = await publishDrop(existing.id, auth.userId);
	if (!drop) {
		return error(res, 409, 'already_published', 'this drop has already been published');
	}
	return json(res, 200, { drop });
}

/**
 * Start the reveal of one item.
 *
 * Claiming happens before any generation is started, and the claim is a
 * conditional UPDATE, so two concurrent reveals of the same index cannot both
 * reach the forge. If the submit then fails we hand the claim straight back
 * rather than leaving the item stuck in `revealing`.
 */
async function handleReveal(req, res) {
	const auth = await resolveAuth(req, 'avatars:write');
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to reveal an item');

	const rl = await limits.mcp3dGenerateFree(`drop-reveal:${auth.userId}`);
	if (!rl.success) {
		return error(res, 429, 'rate_limited', 'reveal limit reached; try again shortly');
	}

	const body = await readJson(req);
	const { drop, index, failure } = await resolveTarget(body?.slug, body?.index, auth.userId);
	if (failure) return error(res, failure.status, failure.code, failure.message);

	if (drop.status === 'draft') {
		return error(res, 409, 'not_published', 'publish the drop before revealing items');
	}

	// Inside the creator's early window only Gold+ $THREE holders may reveal.
	// The creator is never locked out of their own drop.
	if (dropEarlyWindowOpen(drop) && !drop.is_owner) {
		const gate = await requireFeatureAccess(req, res, 'drops.early', { body });
		if (!gate.ok) return;
	}

	const claimed = await claimForReveal(drop.id, index);
	if (!claimed) {
		const current = await getItem(drop.id, index);
		if (current?.status === 'revealed') return json(res, 200, { item: current, already: true });
		return error(res, 409, 'already_revealing', 'this item is already being revealed');
	}

	const layers = normalizeLayers(drop.layers);
	const prompt = itemPrompt({ style: drop.style, traits: claimed.traits, layers });

	let job;
	try {
		job = await startForge(originFromReq(req), {
			prompt,
			tier: 'standard',
			// One client key per drop keeps a collection's generations attributable
			// to the drop rather than to whichever visitor happened to trigger them.
			clientKey: `drop-${drop.id}`,
		});
	} catch (err) {
		await markRevealFailed(drop.id, index, err?.message || 'the 3D generator refused the job');
		return error(res, 502, err?.code || 'provider_error', err?.message || 'could not start generation');
	}

	if (job.status === 'done' && job.glb_url) {
		const item = await markRevealed(drop.id, index, {
			glbUrl: job.glb_url,
			thumbnailUrl: job.preview_image_url || null,
			creationId: job.creation_id || null,
		});
		return json(res, 200, { item, prompt });
	}

	await attachForgeJob(drop.id, index, job.job_id);
	return json(res, 202, {
		item: { ...claimed, status: 'revealing' },
		job_id: job.job_id,
		prompt,
		poll: `/api/drops/reveal?slug=${encodeURIComponent(drop.slug)}&index=${index}`,
	});
}

/**
 * Poll an in-flight reveal. One upstream check per call, never a blocking loop,
 * so this stays a cheap endpoint a grid of sealed cards can hit.
 */
async function handleRevealStatus(req, res) {
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const q = queryOf(req);
	const viewer = await resolveAuth(req, 'avatars:read');
	const { drop, index, failure } = await resolveTarget(q.get('slug'), q.get('index'), viewer?.userId || null);
	if (failure) return error(res, failure.status, failure.code, failure.message);

	const item = await getItem(drop.id, index);
	if (!item) return error(res, 404, 'not_found', 'no such item');
	if (item.status !== 'revealing') return json(res, 200, { item });

	const claim = await revealClaimRow(drop.id, index);
	if (!claim?.forge_job_id) {
		await releaseClaim(drop.id, index);
		return json(res, 200, { item: { ...item, status: 'sealed' } });
	}
	const jobId = claim.forge_job_id;

	let data;
	try {
		const upstream = await fetch(
			`${originFromReq(req)}/api/forge?job=${encodeURIComponent(jobId)}`,
			{ headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
		);
		data = await upstream.json().catch(() => ({}));
	} catch {
		// A transient poll failure is not a failed generation. Report the item as
		// still revealing and let the client come back.
		return json(res, 200, { item, pending: true });
	}

	if (data?.status === 'done' && data.glb_url) {
		const revealed = await markRevealed(drop.id, index, {
			glbUrl: data.glb_url,
			thumbnailUrl: data.preview_image_url || null,
			creationId: data.creation_id || null,
		});
		return json(res, 200, { item: revealed });
	}

	if (data?.status === 'failed' || data?.status === 'error') {
		const failed = await markRevealFailed(drop.id, index, data.error || 'generation failed');
		return json(res, 200, { item: failed });
	}

	// Stuck claims self-heal rather than needing a dedicated sweeper cron.
	if (isStalled(claim.updated_at)) {
		await releaseClaim(drop.id, index);
		return json(res, 200, { item: { ...item, status: 'sealed' } });
	}

	return json(res, 200, { item, pending: true });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * On-chain mint
 *
 * Devnet is the default and costs nothing. Mainnet is a real, irreversible
 * on-chain write paid for in SOL rent by the three.ws collection authority, so
 * it needs an explicit confirm_mainnet:true on every call and a per-account
 * daily budget. Only the drop's creator mints.
 * ────────────────────────────────────────────────────────────────────────── */

// Items minted per "mint all" request. Each is a confirmed transaction, so the
// batch is bounded to stay inside a request and the client loops until done.
const MINT_BATCH = 3;

async function resolveMintContext(req, res, body) {
	const auth = await resolveAuth(req, 'avatars:write');
	if (!auth) {
		error(res, 401, 'unauthorized', 'sign in to put a drop on Solana');
		return null;
	}
	const { drop, failure } = await resolveSlugOnly(body?.slug, auth.userId);
	if (failure) {
		error(res, failure.status, failure.code, failure.message);
		return null;
	}
	if (!drop.is_owner) {
		error(res, 403, 'forbidden', 'only the creator can put this drop on Solana');
		return null;
	}
	const network = resolveNetwork(body?.network);
	if (network === 'mainnet' && body?.confirm_mainnet !== true) {
		error(
			res,
			400,
			'mainnet_confirmation_required',
			'mainnet is a real on-chain write that spends SOL rent and cannot be undone; send confirm_mainnet:true to proceed',
		);
		return null;
	}
	return { auth, drop: { ...drop, owner_id: auth.userId }, network };
}

async function resolveSlugOnly(rawSlug, viewerId) {
	const slug = String(rawSlug ?? '').trim();
	if (!slug) return { failure: { status: 400, code: 'validation_error', message: 'slug is required' } };
	const drop = await getDropBySlug(slug, { viewerId });
	if (!drop) return { failure: { status: 404, code: 'not_found', message: 'no such drop' } };
	return { drop };
}

async function mintBudget(res, network, userId) {
	const limiter = network === 'mainnet' ? limits.dropMintMainnet : limits.dropMintDevnet;
	const rl = await limiter(`drop-mint:${userId}`);
	if (rl.success) return true;
	const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
	error(res, 429, 'rate_limited', `mint budget reached for ${network}; retry in ${retryAfter}s`);
	return false;
}

async function handleMintCollection(req, res) {
	if (!method(req, res, ['POST'])) return;
	const body = await readJson(req);
	const ctx = await resolveMintContext(req, res, body);
	if (!ctx) return;
	if (!(await mintBudget(res, ctx.network, ctx.auth.userId))) return;

	const result = await createDropCollection({ drop: ctx.drop, network: ctx.network });
	return json(res, result.created ? 201 : 200, {
		...result,
		explorer_url: assetExplorerUrl(result.collection_address, result.network),
		real_onchain_write: result.network === 'mainnet',
	});
}

async function handleMint(req, res) {
	const body = await readJson(req);
	const ctx = await resolveMintContext(req, res, body);
	if (!ctx) return;
	const { auth, drop, network } = ctx;

	let ownerWallet = typeof body?.owner_wallet === 'string' ? body.owner_wallet.trim() : '';
	const linked = await getUserSolanaWallets(auth.userId);
	if (!ownerWallet) ownerWallet = linked[0] || '';
	if (!ownerWallet) {
		return error(res, 400, 'validation_error', 'owner_wallet is required: link a Solana wallet or pass one');
	}
	const royaltyRecipient = linked[0] || ownerWallet;

	if (body?.all === true) {
		const indexes = await listMintableIndexes(drop.id, MINT_BATCH);
		const minted = [];
		const failed = [];
		for (const index of indexes) {
			if (!(await mintBudget(res, network, auth.userId))) return;
			try {
				minted.push(await mintDropItem({ drop, index, ownerWallet, royaltyRecipient, network }));
			} catch (err) {
				if (!err?.code) throw err;
				failed.push({ index, code: err.code, message: err.message });
			}
		}
		const remaining = (await listMintableIndexes(drop.id, 25)).length;
		return json(res, 200, { minted, failed, remaining, done: remaining === 0 && failed.length === 0 });
	}

	const index = Number(body?.index);
	if (!Number.isInteger(index) || index < 0 || index >= drop.supply) {
		return error(res, 400, 'validation_error', `index must be a whole number between 0 and ${drop.supply - 1}`);
	}
	const existing = await getItemMintState(drop.id, index);
	if (!existing?.mint_address && !(await mintBudget(res, network, auth.userId))) return;

	const result = await mintDropItem({ drop, index, ownerWallet, royaltyRecipient, network });
	return json(res, result.idempotent ? 200 : 201, {
		...result,
		explorer_url: assetExplorerUrl(result.mint_address, drop.collection_network || network),
		real_onchain_write: (drop.collection_network || network) === 'mainnet',
	});
}

async function handleMintState(req, res) {
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const q = queryOf(req);
	const viewer = await resolveAuth(req, 'avatars:read');
	const { drop, failure } = await resolveSlugOnly(q.get('slug'), viewer?.userId || null);
	if (failure) return error(res, failure.status, failure.code, failure.message);

	const network = drop.collection_network || null;
	const rawIndex = q.get('index');
	if (rawIndex === null || rawIndex === '') {
		return json(res, 200, {
			collection_address: drop.collection_address,
			network,
			explorer_url: drop.collection_address ? assetExplorerUrl(drop.collection_address, network || 'devnet') : null,
			minted_count: drop.minted_count,
			revealed_count: drop.revealed_count,
			mintable_count: Math.max(drop.revealed_count - drop.minted_count, 0),
		});
	}
	const index = Number(rawIndex);
	if (!Number.isInteger(index) || index < 0 || index >= drop.supply) {
		return error(res, 400, 'validation_error', `index must be between 0 and ${drop.supply - 1}`);
	}
	const item = await getItemMintState(drop.id, index);
	if (!item) return error(res, 404, 'not_found', 'no such item');
	const state = item.mint_address
		? 'minted'
		: item.claimed
			? 'minting'
			: item.mint_error
				? 'failed'
				: item.status === 'revealed'
					? 'revealed'
					: 'sealed';
	return json(res, 200, {
		index,
		state,
		mint_address: item.mint_address,
		owner_wallet: item.owner_wallet,
		minted_at: item.minted_at,
		mint_error: item.mint_error,
		collection_address: drop.collection_address,
		network,
		explorer_url: item.mint_address ? assetExplorerUrl(item.mint_address, network || 'devnet') : null,
	});
}

function isStalled(updatedAt) {
	const started = updatedAt ? Date.parse(updatedAt) : NaN;
	return Number.isFinite(started) && Date.now() - started > REVEAL_STALL_MS;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Shared resolution
 * ────────────────────────────────────────────────────────────────────────── */

async function loadDrop(req, viewerId) {
	const slug = queryOf(req).get('slug');
	if (!slug) return null;
	return getDropBySlug(String(slug).trim(), { viewerId });
}

async function resolveTarget(rawSlug, rawIndex, viewerId) {
	const slug = String(rawSlug ?? '').trim();
	if (!slug) {
		return { failure: { status: 400, code: 'validation_error', message: 'slug is required' } };
	}
	const drop = await getDropBySlug(slug, { viewerId });
	if (!drop) {
		return { failure: { status: 404, code: 'not_found', message: 'no such drop' } };
	}
	const index = Number(rawIndex);
	if (!Number.isInteger(index) || index < 0 || index >= drop.supply) {
		return {
			failure: {
				status: 400,
				code: 'validation_error',
				message: `index must be a whole number between 0 and ${drop.supply - 1}`,
			},
		};
	}
	return { drop, index };
}

// The forge handle and the claim's age live on the item row; publicItem
// deliberately omits both (a job id is an internal handle, not collection
// metadata), so the poll path reads them directly.
async function revealClaimRow(dropId, index) {
	const rows = await sql`
		select forge_job_id, updated_at from drop_items where drop_id = ${dropId} and idx = ${index} limit 1
	`;
	return rows[0] || null;
}

function normalizeEnum(value, allowed) {
	const v = String(value ?? '').trim().toLowerCase();
	return allowed.includes(v) ? v : null;
}

async function resolveAuth(req, requiredScope) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	if (!hasScope(bearer.scope, requiredScope)) return null;
	return bearer;
}
