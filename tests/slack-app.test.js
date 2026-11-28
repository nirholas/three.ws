// Cover scripts/slack-app.mjs and keep integrations/slack/manifest.json honest.
//
// The setup script is the one command that turns the manifest into a live Slack
// app wired to production. The cases pin what makes it safe to hand over: the
// token is rejected before anything happens when it is not a configuration
// token, app secrets only ever travel over stdin, the service update is
// --update-secrets (never --set-env-vars), event subscriptions are switched on
// only after the live receiver proves it holds the new signing secret, and the
// install probe tells a stale deploy apart from a missing secret.
//
// The manifest cases fail the moment the manifest drifts from the code that
// serves it: scopes from SLACK_BOT_SCOPES, the OAuth redirect from
// slackRedirectUri(), every subscribed event classified as something other than
// ignore, and the receiver URL pointing at the handler that exists.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	setupSlackApp,
	loadManifest,
	withoutEvents,
	plan,
	probeInstall,
	signSlackBody,
	receiverAccepts,
	remainingSteps,
	SECRETS,
	MANIFEST_PATH,
	RECEIVER_PATH,
} from '../scripts/slack-app.mjs';
import { SLACK_BOT_SCOPES, slackRedirectUri } from '../api/_lib/gateway/slack-installs.js';
import { classifySlackDelivery, verifySlackSignature } from '../api/_lib/gateway/webhooks.js';

const ROOT = join(import.meta.dirname, '..');
const TOKEN = 'xoxe.xox' + 'p-1-fixture-config-token-not-real';
const CREDS = { client_id: '1111111111.2222222222', client_secret: 'fixture-client-secret', signing_secret: 'fixture-signing-secret', verification_token: 'x' };

function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fake slack.com plus a fake production origin. The receiver echoes a
 * url_verification challenge only when the request is signed with the signing
 * secret production "holds", which flips on when updateService runs.
 */
function world({ receiverLive = true, installLocation = null } = {}) {
	const slack = [];
	const prod = [];
	const state = { serviceHasSecret: false };
	const fetchImpl = async (url, init = {}) => {
		const u = new URL(url);
		if (u.origin === 'https://slack.com') {
			const method = u.pathname.replace('/api/', '');
			const params = Object.fromEntries(new URLSearchParams(init.body));
			slack.push({ method, params, auth: init.headers.authorization });
			if (method === 'apps.manifest.create') return json({ ok: true, app_id: 'A0NEWAPP01', credentials: CREDS });
			return json({ ok: true });
		}
		prod.push({ path: u.pathname + u.search, method: init.method || 'GET' });
		if (init.method === 'POST') {
			const raw = init.body;
			const valid = receiverLive && state.serviceHasSecret &&
				verifySlackSignature({ signingSecret: CREDS.signing_secret, timestamp: init.headers['x-slack-request-timestamp'], signature: init.headers['x-slack-signature'], rawBody: raw });
			if (!valid) return new Response('{"error":"bad signature"}', { status: 401 });
			return new Response(JSON.parse(raw).challenge, { status: 200 });
		}
		const location = installLocation ?? `https://slack.com/oauth/v2/authorize?client_id=${CREDS.client_id}&scope=x`;
		return new Response(null, { status: 302, headers: { location } });
	};
	const gcloudCalls = [];
	const gcloud = (args, { input } = {}) => {
		gcloudCalls.push({ args, input });
		if (args[1] === 'describe') throw new Error('NOT_FOUND');
		if (args[0] === 'run') state.serviceHasSecret = true;
		return '';
	};
	return { fetchImpl, gcloud, slack, prod, gcloudCalls };
}

const quiet = { log: () => {}, wait: async () => {} };

describe('setupSlackApp (create)', () => {
	it('rejects a token that is not an app configuration token before any call', async () => {
		const w = world();
		await expect(setupSlackApp('xoxb-123-bot-token', { ...quiet, gcloud: w.gcloud, fetchImpl: w.fetchImpl })).rejects.toThrow(/configuration token/);
		expect(w.slack).toEqual([]);
		expect(w.gcloudCalls).toEqual([]);
	});

	it('creates without events, stores secrets over stdin, verifies the receiver, then turns events on', async () => {
		const w = world();
		const res = await setupSlackApp(TOKEN, { ...quiet, gcloud: w.gcloud, fetchImpl: w.fetchImpl });
		expect(res).toMatchObject({ appId: 'A0NEWAPP01', created: true, installReady: true });

		expect(w.slack.map((c) => c.method)).toEqual(['apps.manifest.validate', 'apps.manifest.create', 'apps.manifest.update']);
		expect(w.slack.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
		const created = JSON.parse(w.slack[1].params.manifest);
		expect(created.settings.event_subscriptions).toBeUndefined();
		expect(created.settings.interactivity.is_enabled).toBe(true);
		const updated = JSON.parse(w.slack[2].params.manifest);
		expect(updated.settings.event_subscriptions.bot_events).toContain('app_home_opened');
		expect(w.slack[2].params.app_id).toBe('A0NEWAPP01');

		// Every secret value rides on stdin; no argv carries one.
		const argv = w.gcloudCalls.flatMap((c) => c.args).join(' ');
		for (const v of Object.values(CREDS)) expect(argv).not.toContain(v);
		const stored = w.gcloudCalls.filter((c) => c.args[1] === 'versions').map((c) => [c.args[3], c.input]);
		expect(stored).toEqual(SECRETS.map((s) => [s.secret, CREDS[s.field]]));

		const update = w.gcloudCalls.find((c) => c.args[0] === 'run');
		expect(update.args.join(' ')).toContain('--update-secrets=SLACK_CLIENT_ID=slack-client-id:latest,SLACK_CLIENT_SECRET=slack-client-secret:latest,SLACK_SIGNING_SECRET=slack-signing-secret:latest');
		expect(update.args.join(' ')).not.toContain('--set-');

		// The receiver was proven before Slack was asked to verify the events URL.
		expect(w.prod.map((p) => p.method)).toEqual(['POST', 'GET']);
	});

	it('leaves events off and names the resume command when the receiver never accepts the secret', async () => {
		const w = world({ receiverLive: false });
		await expect(setupSlackApp(TOKEN, { ...quiet, gcloud: w.gcloud, fetchImpl: w.fetchImpl })).rejects.toThrow(/--app-id A0NEWAPP01/);
		expect(w.slack.map((c) => c.method)).not.toContain('apps.manifest.update');
		expect(w.prod.filter((p) => p.method === 'POST')).toHaveLength(6);
	});

	it('surfaces Slack manifest errors with their pointers', async () => {
		const fetchImpl = async () => json({ ok: false, error: 'invalid_manifest', errors: [{ message: 'must be a valid url', pointer: '/settings/interactivity/request_url' }] });
		await expect(setupSlackApp(TOKEN, { ...quiet, gcloud: () => '', fetchImpl })).rejects.toThrow(/invalid_manifest.*\/settings\/interactivity\/request_url must be a valid url/);
	});
});

describe('setupSlackApp (--app-id)', () => {
	it('validates and applies the full manifest to the existing app and touches no secrets', async () => {
		const w = world();
		const res = await setupSlackApp(TOKEN, { ...quiet, gcloud: w.gcloud, fetchImpl: w.fetchImpl, appId: 'A0OLDAPP01' });
		expect(res).toMatchObject({ appId: 'A0OLDAPP01', created: false, installReady: true });
		expect(w.slack.map((c) => [c.method, c.params.app_id])).toEqual([['apps.manifest.validate', 'A0OLDAPP01'], ['apps.manifest.update', 'A0OLDAPP01']]);
		expect(w.gcloudCalls).toEqual([]);
	});
});

describe('probeInstall', () => {
	const at = (location) => async () => new Response(null, { status: 302, headers: { location } });

	it('accepts Slack consent carrying the expected client id', async () => {
		const res = await probeInstall('https://three.ws', '11.22', at('https://slack.com/oauth/v2/authorize?client_id=11.22'));
		expect(res.ok).toBe(true);
	});

	it('tells a stale deploy apart from a missing secret and a wrong app', async () => {
		expect((await probeInstall('https://three.ws', null, at('/login?next=x'))).reason).toMatch(/deploy the API/);
		expect((await probeInstall('https://three.ws', null, at('/slack?install=not_configured'))).reason).toMatch(/SLACK_CLIENT_ID/);
		expect((await probeInstall('https://three.ws', '11.22', at('https://slack.com/oauth/v2/authorize?client_id=99.99'))).reason).toMatch(/different client id/);
	});
});

describe('signing helpers', () => {
	it('signs exactly as the receiver verifies', () => {
		const body = '{"type":"url_verification","challenge":"c"}';
		const ts = Math.floor(Date.now() / 1000);
		const h = signSlackBody('s3cret', body, ts);
		expect(verifySlackSignature({ signingSecret: 's3cret', timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body })).toBe(true);
		expect(verifySlackSignature({ signingSecret: 'other', timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body })).toBe(false);
	});

	it('receiverAccepts needs the echoed challenge, not just a 200', async () => {
		const res = await receiverAccepts('https://three.ws', 's', async () => new Response('ok', { status: 200 }));
		expect(res.ok).toBe(false);
	});
});

describe('plan', () => {
	it('grants accessor per secret, never project-wide', () => {
		const p = plan();
		expect(p.secrets).toHaveLength(3);
		for (const s of p.secrets) {
			expect(s.grant.slice(0, 3)).toEqual(['secrets', 'add-iam-policy-binding', s.secret]);
			expect(s.addVersion).toContain('--data-file=-');
		}
	});

	it('lists the manual follow-ups with the direct install URL', () => {
		const steps = remainingSteps('A0NEWAPP01').join('\n');
		expect(steps).toContain('https://api.slack.com/apps/A0NEWAPP01');
		expect(steps).toContain(`https://three.ws${RECEIVER_PATH}?leg=install`);
		expect(steps).toContain('icon-1024.png');
	});
});

describe('integrations/slack/manifest.json', () => {
	const manifest = loadManifest();

	it('requests exactly the scopes the OAuth flow asks for', () => {
		expect([...manifest.oauth_config.scopes.bot].sort()).toEqual([...SLACK_BOT_SCOPES].sort());
	});

	it('redirects OAuth to the URL the install flow sends', () => {
		expect(manifest.oauth_config.redirect_urls).toEqual([slackRedirectUri()]);
	});

	it('points events, interactivity and /three at the receiver that exists', () => {
		const url = `https://three.ws${RECEIVER_PATH}`;
		expect(manifest.settings.event_subscriptions.request_url).toBe(url);
		expect(manifest.settings.interactivity.request_url).toBe(url);
		expect(manifest.features.slash_commands.map((c) => [c.command, c.url])).toEqual([['/three', url]]);
		expect(existsSync(join(ROOT, 'api', 'gateway', 'slack.js'))).toBe(true);
	});

	it('subscribes only to events the receiver acts on', () => {
		const sample = {
			app_home_opened: { type: 'app_home_opened', tab: 'home', user: 'U1', channel: 'D1', event_ts: '1' },
			app_mention: { type: 'app_mention', user: 'U1', channel: 'C1', ts: '1', text: '<@B1> hi' },
			'message.im': { type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '1', text: 'hi' },
			app_uninstalled: { type: 'app_uninstalled' },
			tokens_revoked: { type: 'tokens_revoked', tokens: {} },
		};
		for (const name of manifest.settings.event_subscriptions.bot_events) {
			expect(sample[name], `no sample for subscribed event ${name}`).toBeDefined();
			const verdict = classifySlackDelivery({ contentType: 'application/json', rawBody: JSON.stringify({ type: 'event_callback', team_id: 'T1', event_id: `Ev${name}`, event: sample[name] }) });
			expect(verdict.type, name).not.toBe('ignore');
		}
	});

	it('enables the Home tab the worker publishes and the Messages tab pairing uses', () => {
		expect(manifest.features.app_home).toMatchObject({ home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: false });
	});

	it('fits Slack display limits and moves every URL with --origin', () => {
		expect(manifest.display_information.description.length).toBeLessThanOrEqual(139);
		expect(manifest.display_information.long_description.length).toBeGreaterThanOrEqual(175);
		expect(manifest.display_information.long_description.length).toBeLessThanOrEqual(4000);
		const moved = JSON.stringify(loadManifest({ origin: 'https://staging.example' }));
		expect(moved).not.toContain('https://three.ws');
		expect(withoutEvents(manifest).settings.event_subscriptions).toBeUndefined();
		expect(manifest.settings.event_subscriptions).toBeDefined();
		expect(readFileSync(MANIFEST_PATH, 'utf8')).not.toMatch(/[\u2013\u2014]/);
	});
});
