// POST /api/microsoft-teams/agent-reply: internal. Writes and posts one reply
// from the agent a Teams chat is bound to (`chat <agent>`, see
// api/_lib/teams-agent-chat.js runTeamsAgentReply): knowledge search, the
// streamed answer in personal chat, citations, the AI label and feedback.
//
// The messaging endpoint has to answer Teams within seconds, and Cloud Run
// throttles the CPU of work left running after a response is sent, so the bot
// dispatches each reply here with the scheduler's bearer (CRON_SECRET). This
// handler sends its 202 headers at once, which is all the dispatcher waits
// for, and holds the request open while the answer streams.

import { wrap, method, error, readJson } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { isSnapshot, runTeamsAgentReply } from '../_lib/teams-agent-chat.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	if (!requireCron(req, res)) return;
	const snapshot = await readJson(req);
	if (!isSnapshot(snapshot)) return error(res, 400, 'validation_error', 'a teams agent reply snapshot is required');
	res.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.flushHeaders?.();
	try {
		const posted = await runTeamsAgentReply(snapshot);
		return res.end(JSON.stringify({ ok: true, id: posted?.id || null, streamed: Boolean(posted?.streamed), labelled: Boolean(posted?.labelled) }));
	} catch (err) {
		console.error(`[teams-agent-chat] reply for ${snapshot.agentId} threw: ${err?.message || err}`);
		return res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
	}
});
