// /api/home/:id/areas: make a room in the user's own Home Assistant.
//
//   POST { name }   creates the area, or returns the one that already has it
//
// This is the way out of the most common real house we see: one where nothing
// has ever been assigned to an area. Home Assistant knows the devices and has
// no rooms to put them in, so every room-shaped surface we build (the 3D scene,
// the floorplan, room-scoped grants) has nothing to show. Telling that person
// to go and make areas in Home Assistant's settings first is how the feature
// dies; they leave to do a chore and do not come back. So the floorplan editor
// makes the room here, in their registry, and the work is theirs to keep.
//
// Like /assign, it is not a guarded action: nothing moves, nothing opens, and
// an empty area is deleted in two clicks in their own UI. It is still a write
// to their house, so it needs the `layout` capability, a CSRF token, and a row
// in the action log.

import { logAudit } from '../../_lib/audit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { resolveHomeAccess } from '../../_lib/home/access.js';
import { homeError } from '../../_lib/home/errors.js';
import { withHome } from '../../_lib/home/runtime.js';
import { logHomeAction } from '../../_lib/home/store.js';
import { cors, error, json, method, rateLimited, readJson, wrap } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';

/** Long enough for "Upstairs bathroom", short enough that nobody pastes a novel. */
const MAX_NAME = 64;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const access = await resolveHomeAccess(req, res, req.query?.id, 'layout');
	if (!access.ok) return error(res, access.status, access.code, access.message);
	const { caller, home, scoped } = access;

	if (!requireCsrf(req, res)) return;

	// A scoped member sees part of the house. A brand new room belongs to no
	// scope by definition, so they would create something they could not then
	// see, place or file into: a control that only produces confusion. The
	// owner and admins make rooms.
	if (scoped) {
		return error(res, 403, 'scope_forbidden', 'Making a new room needs the owner or an admin.');
	}

	const rl = await limits.homeAct(caller.userId);
	if (!rl.success) return rateLimited(res, rl, 'too many home writes, slow down');

	const body = await readJson(req, res);
	if (body === undefined) return;

	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) return error(res, 400, 'name_required', 'Give the room a name, like Kitchen.');
	if (name.length > MAX_NAME) {
		return error(res, 400, 'name_too_long', `Keep the room name under ${MAX_NAME + 1} characters.`);
	}

	try {
		const area = await withHome(home.id, caller.userId, (bridge) => bridge.createArea(name));
		logHomeAction({
			homeId: home.id,
			userId: caller.userId,
			actor: 'user',
			channel: 'websocket',
			action: 'area_registry.create',
			entityIds: [],
			guarded: false,
			outcome: 'ok',
			detail: { areaId: area.id, created: area.created },
		});
		logAudit({ userId: caller.userId, action: 'create_home_area', resourceId: home.id, meta: { areaId: area.id, created: area.created }, req });
		return json(res, area.created ? 201 : 200, { ok: true, area });
	} catch (err) {
		logHomeAction({
			homeId: home.id,
			userId: caller.userId,
			actor: 'user',
			channel: 'websocket',
			action: 'area_registry.create',
			entityIds: [],
			guarded: false,
			outcome: 'failed',
			detail: { name, reason: err?.code || 'error' },
		});
		return homeError(res, err);
	}
});
