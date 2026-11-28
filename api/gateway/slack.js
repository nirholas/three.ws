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
//   GET ?leg=install          Add to Slack, from Connections, the public /slack
//                             page, or the Slack Marketplace's direct install
//                             link. No sign-in is required: a signed state names
//                             the account when there is one, and a nonce in that
//                             state is also set as an HttpOnly cookie.
//   GET ?leg=status           Public: whether Add to Slack works right now, so the
//                             /slack page never offers a button that dead-ends.
//   GET ?leg=oauth            Slack's OAuth redirect: verify the state and that
//                             this browser holds its nonce, trade the code for the
//                             workspace bot token, store it sealed
//                             (api/_lib/gateway/slack-installs.js), and return to
//                             /settings/connections (signed in) or /slack.
//
// docs/gateways.md has the env vars; integrations/slack/manifest.json is the app.

import { cors, json, method, error, readBody, redirect, text } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { verifySlackSignature, classifySlackDelivery } from '../_lib/gateway/webhooks.js';
import { enqueueInbox } from '../_lib/gateway/store.js';
import {
	slackOAuthConfigured, slackInstallUrl, verifyInstallState, installNonceMatches, installCookie, newInstallNonce,
	exchangeSlackCode, saveSlackInstall, revokeSlackInstall, INSTALL_COOKIE,
} from '../_lib/gateway/slack-installs.js';
import { readCookie } from '../_lib/acquisition.js';

const BACK = '/settings/connections';
const SLACK_ID = /^[A-Z0-9]{2,32}$/;

// A signed-in owner started from Connections and goes back there; anyone else
// (the Marketplace, the /slack page) lands on /slack, which explains the outcome.
function outcome(res, signedIn, status, { team = null, app = null } = {}) {
	if (signedIn) return redirect(res, `${BACK}?slack=${status}#tab-connections`);
	if (status !== 'installed') return redirect(res, `/slack?install=${status}`);
	const q = new URLSearchParams({ installed: '1' });
	if (team && SLACK_ID.test(team)) q.set('team', team);
	if (app && SLACK_ID.test(app)) q.set('app', app);
	return redirect(res, `/slack?${q.toString()}`);
}

async function oauthLeg(req, res, q) {
	const verified = verifyInstallState(q.get('state'));
	const signedIn = Boolean(verified?.userId);
	if (!slackOAuthConfigured()) return outcome(res, signedIn, 'not_configured');
	if (!installNonceMatches(verified, readCookie(req.headers.cookie, INSTALL_COOKIE))) return outcome(res, signedIn, 'expired');
	res.setHeader('set-cookie', installCookie('', { clear: true }));
	if (q.get('error')) return outcome(res, signedIn, 'cancelled');
	const code = q.get('code');
	if (!code || code.length > 256) return outcome(res, signedIn, 'failed');
	let install;
	try {
		install = await exchangeSlackCode(code);
		await saveSlackInstall({ ...install, userId: verified.userId });
	} catch (e) {
		console.warn('[slack] oauth exchange failed', e?.code || e?.message);
		return outcome(res, signedIn, 'failed');
	}
	return outcome(res, signedIn, 'installed', { team: install.teamId, app: install.appId });
}

async function installLeg(req, res) {
	if (!slackOAuthConfigured()) return redirect(res, '/slack?install=not_configured');
	const user = await getSessionUser(req, res).catch(() => null);
	const nonce = newInstallNonce();
	res.setHeader('set-cookie', installCookie(nonce));
	return redirect(res, slackInstallUrl({ userId: user?.id || null, nonce }));
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const q = new URL(req.url, 'http://x').searchParams;

	if (req.method === 'GET') {
		const leg = q.get('leg');
		if (leg === 'oauth') return oauthLeg(req, res, q);
		if (leg === 'install') return installLeg(req, res);
		if (leg === 'status') {
			const available = slackOAuthConfigured();
			return json(res, 200, { available, install_url: available ? '/api/gateway/slack?leg=install' : null }, { 'cache-control': 'public, max-age=60' });
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
