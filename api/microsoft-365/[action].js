// Microsoft 365 Copilot connector: settings API and the tenant admin consent
// round trip. Dispatches on ?action= (routes in vercel.json):
//
//   GET   /api/microsoft-365/status            Connection state for the signed-in account.
//   GET   /api/microsoft-365/connect/start     Sends a tenant admin to Microsoft's admin
//         consent page for the multitenant three.ws app, with a signed state cookie.
//   GET   /api/microsoft-365/connect/callback  Microsoft's redirect after consent. Checks
//         the state, stores the tenant, creates the Graph connection and starts the
//         schema operation, then lands on /settings/microsoft-365.
//   PATCH /api/microsoft-365/settings          { audience, group_id, include_private }
//   POST  /api/microsoft-365/resync            Full re-sync now (bounded run; the cron
//         finishes anything left).
//   POST  /api/microsoft-365/disconnect        Deletes the connection in the tenant, then
//         the stored link.
//
// Library: api/_lib/m365-connector.js. Docs: docs/microsoft-365-copilot-connector.md.

import { randomBytes } from 'node:crypto';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { cors, method, wrap, error, json, redirect, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { logAudit } from '../_lib/audit.js';
import { signIdentityPayload, unsignIdentityPayload, readCookie, cookie, clearCookie } from '../_lib/identities.js';
import {
	ConnectorError, connectorAppConfig, adminConsentUrl, parseConsentCallback, connectorStatus,
	saveConsent, provisionConnection, pollSchema, updateSettings, resetForFullSync, runSync,
	disconnect, getConnection,
} from '../_lib/m365-connector.js';

const SETTINGS_PATH = '/settings/microsoft-365';
const STATE_COOKIE = '__Host-m365consent';
const STATE_TTL_SEC = 900;
const RESYNC_COOLDOWN_MS = 60_000;
const RESYNC_BUDGET_MS = 25_000;

const settingsUrl = (params) => `${SETTINGS_PATH}?${new URLSearchParams(params).toString()}`;

function sendConnectorError(res, err) {
	if (err instanceof ConnectorError) return error(res, err.status || 400, err.code, err.message);
	throw err;
}

async function requireUser(req, res) {
	const user = await getSessionUser(req);
	if (!user) {
		error(res, 401, 'unauthorized', 'Sign in to manage the Microsoft 365 connector.');
		return null;
	}
	return user;
}

async function connectStart(req, res) {
	const user = await getSessionUser(req);
	if (!user) return redirect(res, `/login?next=${encodeURIComponent(SETTINGS_PATH)}`);
	const config = connectorAppConfig();
	if (!config) return redirect(res, settingsUrl({ error: 'not_configured' }));
	const nonce = randomBytes(24).toString('base64url');
	const token = await signIdentityPayload({ u: user.id, n: nonce, e: Math.floor(Date.now() / 1000) + STATE_TTL_SEC });
	res.setHeader('set-cookie', cookie(STATE_COOKIE, token, STATE_TTL_SEC));
	return redirect(res, adminConsentUrl({ clientId: config.clientId, state: nonce }));
}

async function connectCallback(req, res) {
	const url = new URL(req.url, 'http://x');
	const flow = await unsignIdentityPayload(readCookie(req, STATE_COOKIE));
	res.setHeader('set-cookie', clearCookie(STATE_COOKIE));
	const result = parseConsentCallback(url.searchParams);
	if (!flow || !result.state || result.state !== flow.n) return redirect(res, settingsUrl({ error: 'state_mismatch' }));
	const user = await getSessionUser(req);
	if (!user || user.id !== flow.u) return redirect(res, settingsUrl({ error: 'session_changed' }));
	if (!result.ok) return redirect(res, settingsUrl({ error: result.code }));

	await saveConsent(user.id, result.tenantId);
	const provisioned = await provisionConnection(user.id);
	logAudit({ userId: user.id, action: 'm365_connector.connect', meta: { tenant_id: result.tenantId, status: provisioned.status } });
	if (provisioned.status === 'error') return redirect(res, settingsUrl({ error: provisioned.code }));
	return redirect(res, settingsUrl({ connected: '1' }));
}

async function patchSettings(req, res, user) {
	const body = await readJson(req);
	try {
		await updateSettings(user.id, { audience: body.audience, groupId: body.group_id, includePrivate: body.include_private === true });
	} catch (err) {
		return sendConnectorError(res, err);
	}
	return json(res, 200, await connectorStatus(user.id));
}

async function resync(req, res, user) {
	const conn = await getConnection(user.id);
	if (!conn) return error(res, 409, 'not_connected', 'Connect a Microsoft 365 tenant first.');
	if (conn.last_sync_started_at && Date.now() - new Date(conn.last_sync_started_at).getTime() < RESYNC_COOLDOWN_MS) {
		return error(res, 429, 'sync_running', 'A sync started less than a minute ago. Give it a moment, then try again.');
	}
	await resetForFullSync(user.id);
	const fresh = await getConnection(user.id);
	let ran = null;
	if (fresh.status === 'consented') ran = await provisionConnection(user.id);
	else if (fresh.status === 'schema_pending') ran = { status: await pollSchema(user.id) };
	if ((await getConnection(user.id)).status === 'ready') ran = await runSync(user.id, { force: true, deadline: Date.now() + RESYNC_BUDGET_MS });
	return json(res, 200, { run: ran, status: await connectorStatus(user.id) });
}

async function doDisconnect(req, res, user) {
	const result = await disconnect(user.id);
	if (result.removed) logAudit({ userId: user.id, action: 'm365_connector.disconnect', meta: { tenant_id: result.tenantId, remote_deleted: result.remoteDeleted } });
	return json(res, 200, result);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PATCH,OPTIONS', credentials: true })) return;
	const action = new URL(req.url, 'http://x').searchParams.get('action');

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (action === 'connect-start') {
		if (!method(req, res, ['GET'])) return;
		return connectStart(req, res);
	}
	if (action === 'connect-callback') {
		if (!method(req, res, ['GET'])) return;
		return connectCallback(req, res);
	}
	if (action === 'status') {
		if (!method(req, res, ['GET'])) return;
		const user = await requireUser(req, res);
		if (!user) return;
		res.setHeader('cache-control', 'no-store');
		return json(res, 200, await connectorStatus(user.id));
	}

	const writes = { settings: ['PATCH', patchSettings], resync: ['POST', resync], disconnect: ['POST', doDisconnect] };
	const route = writes[action];
	if (!route) return error(res, 404, 'not_found', 'unknown Microsoft 365 connector route');
	if (!method(req, res, [route[0]])) return;
	const user = await requireUser(req, res);
	if (!user) return;
	if (!(await requireCsrf(req, res, user.id))) return;
	return route[1](req, res, user);
});
