// /api/wallet-whitelist: the destination allowlist for an agent wallet.
//
//   GET  ?agent=<uuid>[&history=1]   The list, settings and counts. Session or bearer.
//   GET  ?cancel=<token>             One-click cancel page for the link in the alert
//                                    (no sign-in; the signed token is the credential).
//   POST { action, agent_id, ... }   Session or bearer unless noted.
//     add        { address, label?, per_tx_cap_usd?, daily_cap_usd?, grant }
//                Owner session + step-up grant: pending, usable after the cooldown.
//                Anything else (API key, OAuth, agent): a PROPOSAL, inert until approved.
//     approve    { id, grant }        Owner session + grant. Starts the cooldown.
//     edit       { id, label?, caps?, grant }  Owner session + grant.
//     remove     { id }               Instant. Any principal that owns the agent.
//     cancel     { id }               Instant. Session, or { token } from the alert link.
//     settings   { cooldown_seconds?, enforced?, cancel_pending_change?, grant }
//     stepup_code { kind, op }        Email a one-time code for a step-up.
//     stepup     { kind, op, method, proof }  Re-authenticate and mint a one-time grant.
//
// Library + semantics: api/_lib/destination-whitelist.js. Doc: docs/destination-whitelist.md.

import { getRequestUser } from '../_lib/auth.js';
import { cors, json, text, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	WhitelistError, getWhitelist, addEntry, approveEntry, editEntry, removeEntry, cancelEntry, updateSettings,
	buildOp, mintStepUp, sendStepUpCode, verifyCancelToken, STEP_UP_METHODS,
} from '../_lib/destination-whitelist.js';

const CANCEL_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

function actorFor(user) {
	if (user.sid) return { kind: 'owner', userId: user.id, sessionId: user.sid };
	return { kind: user.connector ? 'oauth' : 'api_key', userId: user.id, sessionId: null };
}

function cancelPage(token) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Cancel address</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 16px}button{font:inherit;padding:.7rem 1.2rem;border-radius:.5rem;border:0;background:#c0392b;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #6a5cff;outline-offset:2px}button:disabled{opacity:.6;cursor:default}#msg{margin-top:1rem;min-height:1.5rem}</style></head>
<body><h1>Cancel this address?</h1><p>The address will never be able to receive funds from your agent wallet. You can add it again later from the wallet allowlist page.</p>
<button id="go" type="button">Cancel address</button><p id="msg" role="status"></p>
<script>
const btn=document.getElementById('go'),msg=document.getElementById('msg');
btn.addEventListener('click',async()=>{btn.disabled=true;msg.textContent='Cancelling...';
try{const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel',token:${JSON.stringify(token).replace(/</g, '\\u003c')}})});
const j=await r.json().catch(()=>({}));
if(r.ok){msg.textContent=j.already?'Already cancelled.':'Cancelled. That address cannot receive funds.';}
else{msg.textContent=j.error_description||'Could not cancel. Sign in and cancel it from the allowlist page.';btn.disabled=false;}
}catch{msg.textContent='Network error. Try again.';btn.disabled=false;}});
</script></body></html>`;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const params = new URL(req.url, 'http://x').searchParams;

	try {
		if (req.method === 'GET' && params.get('cancel')) {
			const rl = await limits.whitelistCancelIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const claims = verifyCancelToken(params.get('cancel'));
			if (!claims) return text(res, 410, 'This cancel link is invalid or has expired. Sign in to three.ws and cancel the address from the wallet allowlist page.', { 'content-type': 'text/plain; charset=utf-8' });
			res.statusCode = 200;
			res.setHeader('content-type', 'text/html; charset=utf-8');
			res.setHeader('cache-control', 'no-store');
			res.setHeader('referrer-policy', 'no-referrer');
			res.setHeader('content-security-policy', CANCEL_PAGE_CSP);
			return res.end(cancelPage(params.get('cancel')));
		}

		let body = null;
		if (req.method === 'POST') {
			body = (await readJson(req)) || {};
			if (body.action === 'cancel' && body.token) {
				const rl = await limits.whitelistCancelIp(clientIp(req));
				if (!rl.success) return rateLimited(res, rl);
				const claims = verifyCancelToken(body.token);
				if (!claims) return error(res, 410, 'link_expired', 'This cancel link is invalid or has expired. Sign in and cancel the address from the wallet allowlist page.');
				return json(res, 200, await cancelEntry({ entryId: claims.entryId, userId: claims.userId, via: 'link', req }), { 'cache-control': 'no-store' });
			}
		}

		const user = await getRequestUser(req);
		if (!user) return error(res, 401, 'unauthorized', 'sign in required');
		const rl = await limits.whitelistUser(user.id);
		if (!rl.success) return rateLimited(res, rl);
		const actor = actorFor(user);

		if (req.method === 'GET') {
			const out = await getWhitelist(params.get('agent'), user.id, { history: params.get('history') === '1' });
			return json(res, 200, { ...out, step_up_methods: STEP_UP_METHODS }, { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;
		const agentId = body.agent_id;
		const grantId = typeof body.grant === 'string' ? body.grant : null;

		switch (body.action) {
			case 'add':
				return json(res, 201, await addEntry({ agentId, actor, body, grantId, req }));
			case 'approve':
				return json(res, 200, await approveEntry({ agentId, entryId: body.id, actor, grantId, req }));
			case 'edit':
				return json(res, 200, await editEntry({ agentId, entryId: body.id, actor, body, grantId, req }));
			case 'remove':
				return json(res, 200, await removeEntry({ agentId, entryId: body.id, actor, req }));
			case 'cancel':
				return json(res, 200, await cancelEntry({ entryId: body.id, userId: user.id, via: actor.kind, req }));
			case 'settings':
				return json(res, 200, await updateSettings({ agentId, actor, body, grantId, req }));
			case 'stepup_code':
			case 'stepup': {
				const stepRl = await limits.whitelistStepUp(user.id);
				if (!stepRl.success) return rateLimited(res, stepRl);
				const op = buildOp(String(body.kind || ''), agentId, body.op || {});
				if (body.action === 'stepup_code') return json(res, 200, await sendStepUpCode({ actor, agentId, op }));
				return json(res, 200, await mintStepUp({ actor, agentId, op, method: body.method, proof: body.proof || {} }), { 'cache-control': 'no-store' });
			}
			default:
				return error(res, 400, 'invalid_action', 'action must be add, approve, edit, remove, cancel, settings, stepup_code or stepup');
		}
	} catch (e) {
		if (e instanceof WhitelistError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
