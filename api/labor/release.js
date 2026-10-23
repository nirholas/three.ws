// POST /api/labor/release: a platform moderator force-resolves a bounty's
// on-chain escrow WITHOUT ever holding or seeing the escrow private key.
//
// The escrow secret lives only on the server (LABOR_ESCROW_SECRET_BASE58). A
// moderator never owns it, never sees it, and never signs an escrow transaction
// themselves: they authorize the move through their authenticated admin session
// and the server signs. This is the human-override lane on top of the autonomous
// verifier-gated settlement: use it to resolve a stuck or disputed bounty.
//
//   action: 'release' → pay the awarded worker (+ skill royalty + poster surplus)
//   action: 'refund'  → return the full reward to the poster (no worker blame)
//
// Both are an override transition on the bounty's escrow case (so they appear in
// its audit trail) and pay out through the same once-only settlement path as the
// autonomous flow: every payout leg, the settle_key idempotency guard (a retry
// never double-pays) and the on-chain invocation receipt are identical. An open
// bounty with no awarded worker can only be refunded.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireAdmin, isAdminRequest } from '../_lib/admin.js';
import { requireUuid } from '../_lib/labor-auth.js';
import { getBounty, getJobByBounty } from '../_lib/agent-labor.js';
import { EscrowError } from '../_lib/labor-escrow-machine.js';
import { moderatorOverride, caseView } from '../_lib/labor-evaluation.js';

const TERMINAL = new Set(['settled', 'failed', 'refunded', 'cancelled']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	// Read-only probe: does the caller have moderator (admin) rights? The UI uses
	// this to decide whether to reveal the release/refund controls. Never mutates.
	if (req.method === 'GET') {
		return json(res, 200, { data: { moderator: await isAdminRequest(req) } });
	}

	if (!method(req, res, ['GET', 'POST'])) return;

	// Moderator gate. requireAdmin writes the 401/403 itself; the escrow key is
	// never returned to or touched by the caller.
	const admin = await requireAdmin(req, res);
	if (!admin) return;
	if (!(await requireCsrf(req, res, admin.id))) return;

	const body = (await readJson(req)) || {};
	const bountyId = body.bountyId;
	const action = body.action === 'refund' ? 'refund' : body.action === 'release' ? 'release' : null;
	if (!bountyId) return error(res, 400, 'validation_error', 'bountyId is required');
	if (!requireUuid(res, bountyId, 'bountyId')) return;
	if (!action) return error(res, 400, 'validation_error', "action must be 'release' or 'refund'");

	const bounty = await getBounty(bountyId);
	if (!bounty) return error(res, 404, 'not_found', 'bounty not found');
	if (TERMINAL.has(bounty.status)) return error(res, 409, 'already_resolved', `bounty is already ${bounty.status}`);
	if (!bounty.escrow_fund_sig) return error(res, 409, 'no_escrow', 'this bounty has no funded escrow to move');

	const moderator = { admin_id: admin.id, wallet: admin.wallet_address || null, reason: typeof body.reason === 'string' ? body.reason.slice(0, 280) : null };
	if (action === 'release' && !(await getJobByBounty(bountyId))) {
		return error(res, 409, 'no_worker', 'no worker has been awarded, so only refund is available');
	}

	// The override is a transition on the bounty's escrow case, so it lands in the
	// same audit trail as every other decision, and the payout runs through the same
	// once-only settlement path.
	let result;
	try {
		result = await moderatorOverride({ bountyId, adminId: admin.id, action, reason: moderator.reason });
	} catch (e) {
		if (e instanceof EscrowError) return error(res, e.status, e.code, e.message);
		throw e;
	}
	const view = await caseView(bountyId, admin.id);
	return json(res, 200, {
		ok: true, action, moderator, status: view?.state, settled: action === 'release' && !!view?.paid_at,
		paid: !!result?.paid_at, settle_sig: view?.settle_sig || null,
		explorer: view?.settle_sig ? `https://solscan.io/tx/${view.settle_sig}` : null,
		escrow: view,
	});
});
