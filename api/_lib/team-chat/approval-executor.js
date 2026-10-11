// EXECUTORS.team_chat for the approval inbox (api/_lib/approvals.js).
//
// A live coordinator trade or standing order is mirrored into the inbox, so the
// owner can approve it from /approvals, a push action, Telegram or email. When
// they do, the inbox claims the row and calls this with it. We execute the
// matching chat step (the runner re-checks that the row's payload hash equals
// the step's and that the plan is unchanged), then resume the run so the next
// specialist moves. The resume is awaited, not fired and forgotten: Cloud Run
// throttles CPU once the response is sent.

import { createRunner } from './runner.js';
import { createSqlStore } from './store.js';
import { createApprovalsBridge } from './approvals-bridge.js';
import { resolveSquad } from './squad.js';
import { loadPrefs } from './prefs.js';
import * as specialists from './specialists.js';

export async function executeTeamChatApproval(row) {
	const runner = createRunner({
		store: createSqlStore(),
		specialists,
		bridge: createApprovalsBridge(),
		resolveSquad,
		loadPrefs,
		userId: row.user_id,
	});
	const outcome = await runner.executeApprovedStep(row.source_ref, { inboxRow: row });
	const step = await createSqlStore().getStep(row.source_ref);
	if (step) {
		try {
			await runner.advance(step.run_id);
		} catch (e) {
			console.warn('[team-chat] resume after inbox approval failed; the chat resumes on its next refresh', e?.message);
		}
	}
	return outcome;
}
