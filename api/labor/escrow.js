// /api/labor/escrow: the independent-evaluation layer of a labor-market bounty.
//
//   GET  ?bountyId=…   the escrow case: state, signed attestation, dispute, the
//                      hash-chained transition trail, and what the viewer may do.
//                      Public read; the viewer block fills in for a signed-in user.
//   POST action=attest    the named evaluator's owner submits pass/fail with a reason
//                         code and evidence URL (optionally self-signed).
//   POST action=dispute   the losing side disputes inside the dispute window.
//   POST action=cancel    the poster withdraws a bounty nobody was awarded.
//   POST action=arbitrate a platform arbiter (admin) rules on a disputed case.
//
// No funds move here directly. A decision is recorded on the case and the sweep
// (api/cron/labor-escrow-sweep.js) or the arbiter's ruling pays it out through the
// settlement path, exactly once.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireAdmin } from '../_lib/admin.js';
import { authWrite, requireUuid } from '../_lib/labor-auth.js';
import { EscrowError } from '../_lib/labor-escrow-machine.js';
import {
	caseView, submitAttestation, openDispute, cancelBounty, arbitrate,
} from '../_lib/labor-evaluation.js';

function escrowError(res, e) {
	if (e instanceof EscrowError) return error(res, e.status, e.code, e.message);
	throw e;
}

async function viewerId(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req));
	return bearer?.userId || null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') {
		const bountyId = new URL(req.url, 'http://localhost').searchParams.get('bountyId');
		if (!bountyId) return error(res, 400, 'validation_error', 'bountyId is required');
		if (!requireUuid(res, bountyId, 'bountyId')) return;
		const view = await caseView(bountyId, await viewerId(req));
		if (!view) return error(res, 404, 'not_found', 'this bounty has no escrow case yet');
		return json(res, 200, { data: view });
	}

	const body = (await readJson(req)) || {};
	const { bountyId, action } = body;
	if (!bountyId) return error(res, 400, 'validation_error', 'bountyId is required');
	if (!requireUuid(res, bountyId, 'bountyId')) return;

	try {
		if (action === 'arbitrate') {
			const admin = await requireAdmin(req, res);
			if (!admin) return;
			if (!(await requireCsrf(req, res, admin.id))) return;
			await arbitrate({
				bountyId, adminId: admin.id,
				input: { verdict: body.verdict, reasonCode: body.reasonCode, reasonDetail: body.reasonDetail, evidenceUrl: body.evidenceUrl },
			});
			return json(res, 200, { ok: true, data: await caseView(bountyId, admin.id) });
		}

		const auth = await authWrite(req, res);
		if (!auth) return;

		if (action === 'attest') {
			await submitAttestation({
				bountyId, userId: auth.userId,
				input: { verdict: body.verdict, reasonCode: body.reasonCode, reasonDetail: body.reasonDetail, evidenceUrl: body.evidenceUrl },
				signature: body.signature || null, signer: body.signer || null, issuedAt: body.issuedAt || null,
			});
		} else if (action === 'dispute') {
			await openDispute({ bountyId, userId: auth.userId, reason: body.reason, evidenceUrl: body.evidenceUrl });
		} else if (action === 'cancel') {
			await cancelBounty({ bountyId, userId: auth.userId });
		} else {
			return error(res, 400, 'validation_error', "action must be 'attest', 'dispute', 'cancel' or 'arbitrate'");
		}
		return json(res, 200, { ok: true, data: await caseView(bountyId, auth.userId) });
	} catch (e) {
		return escrowError(res, e);
	}
});
