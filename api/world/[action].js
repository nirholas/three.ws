// api/world/[action]: the generic per-world persistence service (T3).
//
//   GET  /api/world/load?worldId=<id>
//     Public for a public world. Returns the world's current document +
//     concurrency metadata, or { doc: null } if it has never been saved. Builds
//     are shared, visible places, so reads are open (rate-limited by IP). A
//     PRIVATE world (Silver `worlds.private` perk) answers 404 to everyone but its
//     owner, its invitees and the game server, so its existence never leaks.
//
//   POST /api/world/save   { worldId, doc, ifMatch?, owner? }
//     Authenticated. The authoritative multiplayer server writes with a service
//     token (Authorization: Bearer <world-service-token>); a browser session may
//     write subject to the per-world permission model (world-store.canWriteWorld,
//     the hook T16 tightens). `ifMatch` carries the etag the caller last read for
//     optimistic concurrency, so a stale etag returns 409. A body `visibility`
//     of 'private' is gated on the Silver hold; omitting it preserves the stored
//     value.
//
//   POST /api/world/visibility { worldId, visibility }       owner only
//   POST /api/world/invite     { worldId, invitee }          owner only
//   POST /api/world/uninvite   { worldId, invitee }          owner only
//     Access changes that do not rewrite the document. `invitee` is a username.
//
//   GET  /api/world/load?worldId=<id>&fields=access
//     The same read rule, but only { visibility, ownerId, invitees? } from the
//     index row, never the document. The game server re-checks a live room's
//     access with it without downloading the build.
//
//   POST /api/world/access-pass { worldId }
//     A private world's realtime room admits only its owner and invitees, but
//     the room knows players by wallet, not by account. This mints the signed,
//     10-minute world-access pass the room verifies in onAuth
//     (api/_lib/world-access-pass.js). Public worlds need none ({ pass: null });
//     anyone not allowed in gets the same 404 as /load.
//
// Storage lives in api/_lib/world-store.js (Postgres index + R2 blob offload).

import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { extractBearer } from '../_lib/auth.js';
import { resolveAccount } from '../_lib/account-auth.js';
import { requireFeatureAccess } from '../_lib/require-three.js';
import { resolveInvitee, describeInvitees } from '../_lib/world-invites.js';
import { verifyWorldServiceToken } from '../_lib/world-service-auth.js';
import { signWorldAccessPass } from '../_lib/world-access-pass.js';
import {
	loadWorld,
	loadWorldMeta,
	saveWorld,
	setWorldAccess,
	canWriteWorld,
	canReadWorld,
	isValidVisibility,
	isValidWorldId,
	MAX_INVITEES,
	ConflictError,
	TooLargeError,
	PermissionError,
	MAX_DOC_BYTES,
} from '../_lib/world-store.js';

const BODY_ERROR_CODES = { 413: 'payload_too_large', 415: 'unsupported_media_type' };

function actionOf(req) {
	return (req.query?.action || new URL(req.url, 'http://x').pathname.split('/').pop() || '').toLowerCase();
}

export default wrap(async (req, res) => {
	// Public reads + server-to-server writes use a wildcard origin. Browser saves
	// are same-origin (three.ws → three.ws), so the session cookie rides along
	// without needing credentialed CORS.
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;

	const action = actionOf(req);
	if (action === 'load') return handleLoad(req, res);
	if (action === 'save') return handleSave(req, res);
	if (action === 'visibility') return handleVisibility(req, res);
	if (action === 'invite') return handleInvite(req, res, true);
	if (action === 'uninvite') return handleInvite(req, res, false);
	if (action === 'access-pass') return handleAccessPass(req, res);
	return error(res, 404, 'not_found', 'unknown world action');
});

// Who is reading a private world, and may they? Identity is resolved only for a
// private world, so a public read stays one indexed lookup with no session work.
async function readerOf(req, res, world) {
	if (world.visibility !== 'private') return { readable: true, isService: false, account: null };
	const isService = Boolean(await verifyWorldServiceToken(extractBearer(req)));
	const account = isService ? null : (await resolveAccount(req, res))?.userId ?? null;
	const readable = canReadWorld({
		isService,
		account,
		ownerId: world.ownerId,
		visibility: world.visibility,
		invitees: world.invitees,
	});
	return { readable, isService, account };
}

async function handleLoad(req, res) {
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const worldId = params.get('worldId') || '';
	if (!isValidWorldId(worldId)) return error(res, 400, 'validation_error', 'invalid or missing worldId');

	if (params.get('fields') === 'access') return loadAccessOnly(req, res, worldId);

	const world = await loadWorld(worldId);
	if (!world) return json(res, 200, { worldId, doc: null, version: 0, etag: null, visibility: 'public' });

	const { readable, isService, account } = await readerOf(req, res, world);
	if (!readable) return error(res, 404, 'not_found', 'world not found');

	const isOwner = Boolean(account && world.ownerId && account === world.ownerId);
	return json(res, 200, {
		worldId: world.worldId,
		doc: world.doc,
		version: world.version,
		etag: world.etag,
		schemaVersion: world.schemaVersion,
		ownerId: world.ownerId,
		visibility: world.visibility,
		// Who a private world is shared with is the owner's business alone.
		...(isOwner || isService ? { invitees: await describeInvitees(world.invitees) } : {}),
		updatedAt: world.updatedAt,
	});
}

// GET /api/world/load?fields=access: the index row's access fields only.
async function loadAccessOnly(req, res, worldId) {
	const meta = await loadWorldMeta(worldId);
	if (!meta) return json(res, 200, { worldId, visibility: 'public', ownerId: null });
	const { readable, isService, account } = await readerOf(req, res, meta);
	if (!readable) return error(res, 404, 'not_found', 'world not found');
	const isOwner = Boolean(account && meta.ownerId && account === meta.ownerId);
	return json(res, 200, {
		worldId,
		visibility: meta.visibility,
		ownerId: meta.ownerId,
		// Raw ids: the room matches them against the account in a world-access pass.
		...(meta.visibility === 'private' && (isOwner || isService) ? { invitees: meta.invitees } : {}),
	});
}

// POST /api/world/access-pass: the signed ticket a private world's room checks.
async function handleAccessPass(req, res) {
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readBody(req, res);
	if (!body) return;
	const { worldId } = body;
	if (!isValidWorldId(worldId)) return error(res, 400, 'validation_error', 'invalid or missing worldId');

	const meta = await loadWorldMeta(worldId);
	if (!meta || meta.visibility !== 'private') return json(res, 200, { worldId, visibility: 'public', pass: null });

	// The room needs an account to match against the owner and invitee list, so
	// the service token (which has none) is not a reason to mint one.
	const account = (await resolveAccount(req, res))?.userId ?? null;
	const readable = canReadWorld({ account, ownerId: meta.ownerId, visibility: meta.visibility, invitees: meta.invitees });
	if (!account || !readable) return error(res, 404, 'not_found', 'world not found');

	const { pass, expiresAt } = await signWorldAccessPass({ worldId, account });
	return json(res, 200, { worldId, visibility: 'private', pass, expiresAt });
}

// Resolve who is calling a world-access endpoint. Service tokens are authoritative;
// a browser must be signed in. Writes the 401/429 itself and returns null.
async function principalFor(req, res) {
	if (await verifyWorldServiceToken(extractBearer(req))) return { service: true, account: null, writer: 'service' };
	const account = await resolveAccount(req, res);
	if (!account) {
		error(res, 401, 'unauthorized', 'authentication required to change a world');
		return null;
	}
	const rl = await limits.prefsWrite(account.userId);
	if (!rl.success) {
		rateLimited(res, rl, 'too many world changes');
		return null;
	}
	return { service: false, account: account.userId, writer: account.userId };
}

// Best-effort body read for an unauthenticated request, where a parse failure is
// simply "no body" and the caller answers 401 either way.
async function peekBody(req) {
	try {
		return (await readJson(req, 4096)) || null;
	} catch {
		return null;
	}
}

async function readBody(req, res) {
	try {
		return (await readJson(req, MAX_DOC_BYTES + 1024)) || {};
	} catch (err) {
		// readJson signals an over-cap body as 413 and a non-JSON content-type as
		// 415. Labelling either one `validation_error` left a client unable to tell
		// "your build is too big" from "your JSON is malformed", so each status
		// keeps the house error code its own status already implies.
		const status = err.status || 400;
		const code = BODY_ERROR_CODES[status] || 'validation_error';
		error(res, status, code, err.message || 'invalid body');
		return null;
	}
}

// Making a world private is the Silver hold-only perk. Going public never needs a
// tier, and re-asserting 'private' on a world that already is private is not a
// new private world, so a holder who lapsed below Silver keeps their world and
// can keep saving it. Returns false after writing the 402.
async function gatePrivate(req, res, body, requested, currentVisibility, service) {
	if (requested !== 'private' || currentVisibility === 'private' || service) return true;
	const gate = await requireFeatureAccess(req, res, 'worlds.private', { body });
	return gate.ok;
}

// POST /api/world/visibility: flip a saved world public or private.
async function handleVisibility(req, res) {
	if (!method(req, res, ['POST'])) return;
	const principal = await principalFor(req, res);
	if (!principal) return;
	const body = await readBody(req, res);
	if (!body) return;

	const { worldId, visibility } = body;
	if (!isValidWorldId(worldId)) return error(res, 400, 'validation_error', 'invalid or missing worldId');
	if (!isValidVisibility(visibility)) return error(res, 400, 'validation_error', 'visibility must be "public" or "private"');

	const existing = await loadWorldMeta(worldId);
	if (!existing) return error(res, 404, 'not_found', 'save this world before changing who can see it');
	if (!principal.service && principal.account !== existing.ownerId) {
		return error(res, 403, 'forbidden', 'only the world owner can change its visibility');
	}
	if (!(await gatePrivate(req, res, body, visibility, existing.visibility, principal.service))) return;

	const access = await setWorldAccess({ worldId, visibility });
	return json(res, 200, { worldId, visibility: access.visibility, invitees: await describeInvitees(access.invitees) });
}

// POST /api/world/invite and /api/world/uninvite: owner-only invitee list.
async function handleInvite(req, res, adding) {
	if (!method(req, res, ['POST'])) return;
	const principal = await principalFor(req, res);
	if (!principal) return;
	const body = await readBody(req, res);
	if (!body) return;

	const { worldId, invitee } = body;
	if (!isValidWorldId(worldId)) return error(res, 400, 'validation_error', 'invalid or missing worldId');
	if (typeof invitee !== 'string' || !invitee.trim()) {
		return error(res, 400, 'validation_error', 'invitee must be a username');
	}

	const existing = await loadWorldMeta(worldId);
	if (!existing) return error(res, 404, 'not_found', 'save this world before inviting anyone');
	if (!principal.service && principal.account !== existing.ownerId) {
		return error(res, 403, 'forbidden', 'only the world owner can change who it is shared with');
	}

	const target = await resolveInvitee(invitee);
	if (!target) return error(res, 404, 'invitee_not_found', 'no account with that username');
	if (adding && target.id === existing.ownerId) {
		return error(res, 400, 'validation_error', 'the owner already has access');
	}

	try {
		const access = await setWorldAccess({
			worldId,
			invite: adding ? [target.id] : [],
			uninvite: adding ? [] : [target.id],
		});
		return json(res, 200, {
			worldId,
			visibility: access.visibility,
			invitees: await describeInvitees(access.invitees),
			max: MAX_INVITEES,
		});
	} catch (err) {
		if (err.code === 'invitee_limit') return error(res, 409, err.code, err.message);
		throw err;
	}
}

async function handleSave(req, res) {
	if (!method(req, res, ['POST'])) return;

	// Principal resolution: a valid service token outranks a session and marks the
	// write as authoritative (the game server). Otherwise fall back to the caller's
	// browser session / bearer identity.
	const service = await verifyWorldServiceToken(extractBearer(req));
	let writer = null;
	let account = null;
	if (service) {
		writer = 'service';
	} else {
		account = await resolveAccount(req, res);
		if (!account) {
			// An anonymous request to make a world private gets the hold-or-sign-in 402
			// (with the acquire block) instead of a bare 401, so the upsell can render
			// from the very first attempt. Any other anonymous write is a plain 401.
			const peek = await peekBody(req);
			if (peek?.visibility === 'private') {
				const gate = await requireFeatureAccess(req, res, 'worlds.private', { body: peek });
				if (!gate.ok) return;
			}
			return error(res, 401, 'unauthorized', 'authentication required to write a world');
		}
		writer = account.userId;
		const rl = await limits.prefsWrite(account.userId);
		if (!rl.success) return rateLimited(res, rl, 'too many world saves');
	}

	const body = await readBody(req, res);
	if (!body) return;

	const { worldId, doc, ifMatch, owner, visibility } = body;
	if (!isValidWorldId(worldId)) return error(res, 400, 'validation_error', 'invalid or missing worldId');
	if (doc === undefined || doc === null || typeof doc !== 'object') {
		return error(res, 400, 'validation_error', 'doc must be a JSON object or array');
	}
	if (ifMatch != null && ifMatch !== '*' && typeof ifMatch !== 'string') {
		return error(res, 400, 'validation_error', 'ifMatch must be an etag string, "*", or null');
	}
	if (visibility != null && !isValidVisibility(visibility)) {
		return error(res, 400, 'validation_error', 'visibility must be "public" or "private"');
	}

	// Permission gate. Service writes are always allowed; user writes depend on the
	// world's current owner, so peek at the index row first. loadWorldMeta reads
	// only the index columns (never the body), which keeps a builder's autosave to
	// one cheap lookup instead of re-downloading and re-parsing the whole prior
	// document. It returns null for a brand-new world (unowned, first writer allowed).
	if (!service) {
		const existing = await loadWorldMeta(worldId);
		const allowed = canWriteWorld({
			isService: false,
			account: account.userId,
			currentOwner: existing?.ownerId ?? null,
			exists: Boolean(existing),
		});
		if (!allowed) return error(res, 403, 'forbidden', 'not permitted to build in this world');
		// A write that makes the world private is the Silver perk (hold-only).
		if (!(await gatePrivate(req, res, body, visibility, existing?.visibility ?? 'public', false))) return;
	}

	// On first save by a user, stamp them as the owner so they keep edit rights.
	const ownerToSet = service ? (typeof owner === 'string' ? owner : null) : account.userId;

	try {
		const result = await saveWorld({ worldId, doc, ifMatch: ifMatch ?? null, writer, owner: ownerToSet, visibility: visibility ?? null });
		return json(res, 200, result);
	} catch (err) {
		if (err instanceof ConflictError) {
			return error(res, 409, err.code, err.message, { etagMismatch: true });
		}
		if (err instanceof TooLargeError) {
			return error(res, 413, err.code, err.message);
		}
		if (err instanceof PermissionError) {
			return error(res, 403, err.code, err.message);
		}
		throw err;
	}
}
