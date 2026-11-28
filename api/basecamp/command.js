// POST /api/basecamp/command/<token>: the command URL of a three.ws chatbot in
// Basecamp. Routed here as ?token=<token> (vercel.json).
//
// Basecamp POSTs { command, creator, callback_url } when someone types
// `!threews ...` in a Campfire or a Ping, and posts whatever text/html this
// returns in that room. Basecamp signs nothing, so the token is the credential
// (api/_lib/basecamp-chatbots.js) and the callback URL is only used on
// Basecamp's own hosts (api/_lib/basecamp-forge.js callbackTarget).
//
// Every answer is a 200 with a line for the room, including a wrong or revoked
// token: a status code would only show the person a generic chatbot error,
// while the line tells them what to do. A model command answers "making it"
// at once and dispatches the generation to /api/basecamp/forge-run, which
// posts the finished model through the callback URL.
//
// GET answers a short page, so an admin who opens the URL in a browser sees
// what it is for instead of an error.

import { wrap, method, text, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { resolveToken, recordCommand } from '../_lib/basecamp-chatbots.js';
import {
	parseCommand,
	callbackTarget,
	creatorOf,
	jobKey,
	claimJob,
	dispatchRun,
	helpHtml,
	tooShortHtml,
	startedHtml,
	duplicateHtml,
	revokedHtml,
	unknownTokenHtml,
	rateLimitedHtml,
	noCallbackHtml,
} from '../_lib/basecamp-forge.js';
import { originFromReq } from '../_mcp-studio/gpt-forge-client.js';
import { selfOrigin } from '../_lib/self-origin.js';

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };

function line(res, html) {
	return text(res, 200, html, HTML);
}

function browserPage(res, known) {
	const status = known ? 'This command URL is active.' : 'This command URL is not active.';
	return text(
		res,
		200,
		`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>three.ws Basecamp chatbot</title>` +
			`<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px">` +
			`<h1 style="font-size:22px">three.ws chatbot command URL</h1><p>${status} Basecamp sends chatbot commands here; it is not a page to visit.</p>` +
			`<p>Keep it private: anyone who has it can make 3D models on the account that created it. Setup steps: <a href="/integrations/basecamp">three.ws/integrations/basecamp</a>.</p></body>`,
		{ ...HTML, 'x-robots-tag': 'noindex' },
	);
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST', 'GET'])) return;
	const ipLimit = await limits.widgetRead(clientIp(req));
	if (!ipLimit.success) return line(res, rateLimitedHtml());

	const connection = await resolveToken(String(req.query?.token || ''));
	if (req.method === 'GET') return browserPage(res, Boolean(connection && !connection.revoked));
	if (!connection) return line(res, unknownTokenHtml());
	if (connection.revoked) return line(res, revokedHtml());

	const body = (await readJson(req, 64_000).catch(() => null)) || {};
	const command = parseCommand(body.command);
	if (command.kind === 'help') return line(res, helpHtml());
	if (command.kind === 'too_short') return line(res, tooShortHtml());

	const target = callbackTarget(body.callback_url);
	if (!target) return line(res, noCallbackHtml());

	const rl = await limits.basecampCommand(connection.id);
	if (!rl.success) return line(res, rateLimitedHtml());

	const by = creatorOf(body.creator);
	const key = jobKey({ connectionId: connection.id, callbackUrl: target.url, creatorId: by?.id, prompt: command.prompt, tier: command.tier });
	const { record, created } = await claimJob({
		key,
		prompt: command.prompt,
		tier: command.tier,
		connectionId: connection.id,
		userId: connection.userId,
		by,
		callbackUrl: target.url,
		origin: originFromReq(req),
		selfBase: selfOrigin(req),
	});
	if (!created) return line(res, duplicateHtml(record));

	await recordCommand(connection.id, { basecampAccount: target.account }).catch((err) =>
		console.warn(`[basecamp] could not record a command for ${connection.id}: ${err?.message || err}`),
	);
	await dispatchRun(key, record.selfBase);
	return line(res, startedHtml(record));
});
