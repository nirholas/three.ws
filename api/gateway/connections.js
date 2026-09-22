// /api/gateway/connections — the owner's side of the chat gateways, behind
// /settings/connections.
//
//   GET    → { links, agents, bots }           paired chats, the account's agents,
//                                              and how to reach each bot
//   POST   { action:'issue' }                  → { code, expires_at }   a code to send
//                                              the bot as /link <code>
//   POST   { action:'redeem', code }           → { link }   pair the chat that printed it
//   PATCH  { id, notify?, default_agent_id? }  → { link }
//   DELETE ?id=                                → { revoked: true }
//
// Session or bearer auth; writes are CSRF-gated (bearer exempt) and share the
// gatewaySiteWrite budget. docs/chat-gateways.md describes the whole flow.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getRequestUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import {
	listLinksForUser, issueSiteCode, redeemChatCode, revokeLink, setLinkNotify, setLinkDefaultAgent, GatewayError,
} from '../_lib/gateway/store.js';
import { normalizePairCode, formatPairCode } from '../_lib/gateway/codes.js';
import { gatewayBots, sendPlatformText } from '../_lib/gateway/bots.js';

const postBody = z.discriminatedUnion('action', [
	z.object({ action: z.literal('issue') }),
	z.object({ action: z.literal('redeem'), code: z.string().min(8).max(16) }),
]);
const patchBody = z.object({
	id: z.string().uuid(),
	notify: z.boolean().optional(),
	default_agent_id: z.string().uuid().nullable().optional(),
});

function linkOut(l) {
	return {
		id: l.id,
		platform: l.platform,
		chat_title: l.chat_title,
		chat_type: l.chat_type,
		platform_username: l.platform_username,
		default_agent_id: l.default_agent_id,
		default_agent_name: l.default_agent_name ?? null,
		notify: l.notify,
		created_at: l.created_at,
		last_seen_at: l.last_seen_at,
	};
}

async function readLink(userId, id) {
	const rows = await listLinksForUser(userId);
	return rows.find((r) => r.id === id) || null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage chat connections');

	if (req.method === 'GET') {
		const [links, agents, bots] = await Promise.all([
			listLinksForUser(user.id),
			sql`SELECT id, name FROM agent_identities WHERE user_id = ${user.id} AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 50`,
			gatewayBots(),
		]);
		return json(res, 200, { links: links.map(linkOut), agents, bots }, { 'cache-control': 'no-store' });
	}

	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.gatewaySiteWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (req.method === 'POST') {
			const body = parse(postBody, await readJson(req));
			if (body.action === 'issue') {
				const { code, expiresAt } = await issueSiteCode(user.id);
				return json(res, 201, { code: formatPairCode(code), expires_at: expiresAt });
			}
			const code = normalizePairCode(body.code);
			if (!code) return error(res, 400, 'code_invalid', 'Codes are eight characters, like ABCD-EFGH.');
			const link = await redeemChatCode({ code, userId: user.id });
			return json(res, 201, { link: linkOut((await readLink(user.id, link.id)) || link) });
		}

		if (req.method === 'PATCH') {
			const body = parse(patchBody, await readJson(req));
			const current = await readLink(user.id, body.id);
			if (!current) return error(res, 404, 'not_found', 'that connection does not exist');
			if (body.notify !== undefined) await setLinkNotify(body.id, user.id, body.notify);
			if (body.default_agent_id !== undefined) {
				if (body.default_agent_id) {
					const [own] = await sql`SELECT id FROM agent_identities WHERE id = ${body.default_agent_id} AND user_id = ${user.id} AND deleted_at IS NULL`;
					if (!own) return error(res, 404, 'agent_not_found', 'that agent is not yours');
				}
				await setLinkDefaultAgent(body.id, body.default_agent_id);
			}
			return json(res, 200, { link: linkOut(await readLink(user.id, body.id)) });
		}

		const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
		if (!/^[0-9a-f-]{36}$/i.test(id)) return error(res, 400, 'validation_error', 'id is required');
		const revoked = await revokeLink(id, user.id);
		if (!revoked) return error(res, 404, 'not_found', 'that connection does not exist');
		// Tell the chat, so a stale session there does not look like a broken bot.
		await sendPlatformText(revoked.platform, revoked.chat_id, 'This chat was disconnected from your three.ws account on the web. Send /start to pair it again.').catch(() => {});
		return json(res, 200, { revoked: true });
	} catch (e) {
		if (e instanceof GatewayError) return error(res, e.status, e.code, e.message);
		throw e;
	}
});
