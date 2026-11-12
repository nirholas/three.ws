// /api/gateway/slack: the Slack app endpoint for the agent chat gateway.
//
//   POST                      Events API (url_verification, DMs, mentions, file
//                             shares, app_uninstalled), slash commands and
//                             interactivity (the Approve / Cancel buttons). Every
//                             delivery carries Slack's v0 signature; one older
//                             than five minutes is refused, so a captured request
//                             cannot be replayed. Verified deliveries are queued
//                             in gateway_inbox and answered 200 inside Slack's
//                             three-second window; the gateway worker
//                             (workers/agent-gateway src/adapters/slack.js) runs
//                             the turn and replies.
//   GET ?leg=install          signed-in owner: redirect to Slack's Add to Slack
//                             consent screen with a signed state.
//   GET ?leg=oauth            Slack's OAuth redirect: verify the state, trade the
//                             code for the workspace bot token, store it sealed
//                             (api/_lib/gateway/slack-installs.js), and return to
//                             /settings/connections.
//
// docs/gateways.md has the app manifest and env vars.

import { cors, json, method, error, readBody, redirect, text } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { verifySlackSignature, classifySlackDelivery } from '../_lib/gateway/webhooks.js';
import { enqueueInbox } from '../_lib/gateway/store.js';
import {
	slackOAuthConfigured, slackInstallUrl, verifyInstallState, exchangeSlackCode, saveSlackInstall, revokeSlackInstall,
} from '../_lib/gateway/slack-installs.js';

const BACK = '/settings/connections';

async function oauthLeg(req, res, q) {
	if (!slackOAuthConfigured()) return redirect(res, `${BACK}?slack=not_configured#tab-connections`);
	if (q.get('error')) return redirect(res, `${BACK}?slack=cancelled#tab-connections`);
	const userId = verifyInstallState(q.get('state'));
	if (!userId) return redirect(res, `${BACK}?slack=expired#tab-connections`);
	const code = q.get('code');
	if (!code || code.length > 256) return redirect(res, `${BACK}?slack=failed#tab-connections`);
	try {
		const install = await exchangeSlackCode(code);
		await saveSlackInstall({ ...install, userId });
	} catch (e) {
		console.warn('[slack] oauth exchange failed', e?.code || e?.message);
		return redirect(res, `${BACK}?slack=failed#tab-connections`);
	}
	return redirect(res, `${BACK}?slack=installed#tab-connections`);
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const q = new URL(req.url, 'http://x').searchParams;

	if (req.method === 'GET') {
		const leg = q.get('leg');
		if (leg === 'oauth') return oauthLeg(req, res, q);
		if (leg === 'install') {
			if (!slackOAuthConfigured()) return error(res, 503, 'not_configured', 'Slack installs are not configured on this deployment');
			const user = await getSessionUser(req, res);
			if (!user) return redirect(res, `/login?next=${encodeURIComponent(`${BACK}#tab-connections`)}`);
			return redirect(res, slackInstallUrl(user.id));
		}
		return error(res, 400, 'bad_request', 'unknown leg');
	}

	const signingSecret = process.env.SLACK_SIGNING_SECRET;
	if (!signingSecret) return error(res, 503, 'not_configured', 'the Slack gateway is not configured');
	let raw;
	try {
		raw = await readBody(req, 1_000_000);
	} catch (e) {
		return error(res, e?.status || 400, 'bad_request', e?.message || 'invalid body');
	}
	const ok = verifySlackSignature({
		rawBody: raw,
		signature: req.headers['x-slack-signature'],
		timestamp: req.headers['x-slack-request-timestamp'],
		signingSecret,
	});
	if (!ok) return error(res, 401, 'unauthorized', 'invalid or stale request signature');

	const verdict = classifySlackDelivery({ contentType: req.headers['content-type'], rawBody: raw });
	if (verdict.type === 'challenge') return text(res, 200, verdict.challenge, { 'content-type': 'text/plain' });
	if (verdict.type === 'uninstall') {
		if (verdict.teamId) await revokeSlackInstall(verdict.teamId);
		return json(res, 200, { ok: true });
	}
	if (verdict.type === 'enqueue') {
		await enqueueInbox({ platform: 'slack', dedupeKey: verdict.dedupeKey, chatKey: verdict.chatKey, payload: verdict.payload });
	}
	// A slash command answered with an empty 200 shows nothing; the worker
	// replies through the command's response_url a moment later.
	res.statusCode = 200;
	return res.end();
}
