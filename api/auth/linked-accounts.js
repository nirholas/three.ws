// GET /api/auth/linked-accounts: everything attached to the account in one
// read, for the account page and the get_linked_accounts MCP tool.
//
//   sign_in      password, email code, Google and Telegram identities
//   wallets      sign-in wallets (user_wallets)
//   payout       payout wallets with their status (active, cooldown,
//                awaiting_approval) and when a pending one takes effect
//   devices      phones, desktop apps, CLIs and Telegram chats linked with a
//                link code, with last use and a one-click revoke id
//   chats        paired gateway chats (Telegram, Discord)
//
// A session or a bearer with wallet:read or agents:read may read it. Nothing
// here is a secret: addresses, usernames and ids only.

import { getRequestUser, hasScope } from '../_lib/auth.js';
import { cors, method, wrap, error, json } from '../_lib/http.js';
import { listSignInMethods } from '../_lib/identities.js';
import { listLinksForUser } from '../_lib/gateway/store.js';
import { listLinkedDevices } from '../_lib/account-link/link-codes.js';
import { listPayoutWallets, PAYOUT_COOLDOWN_HOURS } from '../_lib/account-link/external-wallets.js';
import { telegramLoginConfigured } from '../_lib/account-link/telegram-login.js';

export async function linkedAccountsFor(userId) {
	const [methods, payout, devices, chats] = await Promise.all([
		listSignInMethods(userId),
		listPayoutWallets(userId),
		listLinkedDevices(userId),
		listLinksForUser(userId),
	]);
	return {
		sign_in: {
			password: methods.password,
			email: methods.email,
			email_code: methods.email_code,
			identities: methods.identities,
			count: methods.count,
			telegram_available: telegramLoginConfigured(),
		},
		wallets: methods.wallets,
		payout: { wallets: payout, cooldown_hours: PAYOUT_COOLDOWN_HOURS },
		devices,
		chats: chats.map((c) => ({
			id: c.id,
			platform: c.platform,
			username: c.platform_username,
			chat_id: c.chat_id,
			chat_type: c.chat_type,
			chat_title: c.chat_title,
			default_agent: c.default_agent_name || null,
			linked_at: c.created_at,
			last_seen_at: c.last_seen_at,
		})),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send an API key with wallet:read');
	if (user.source === 'bearer' && !hasScope(user.scope, 'wallet:read') && !hasScope(user.scope, 'wallet:write') && !hasScope(user.scope, 'agents:read')) {
		return error(res, 403, 'insufficient_scope', 'this key needs wallet:read or agents:read', { required: 'wallet:read' });
	}
	return json(res, 200, await linkedAccountsFor(user.id));
});
