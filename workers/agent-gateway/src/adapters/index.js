// The adapter registry: every chat platform the worker can drain.
//
// An adapter is a plain object:
//
//   platform           the gateway_inbox.platform value it owns
//   normalize(payload) the queued payload -> a GatewayEvent (api/_lib/gateway/core.js),
//                      or null for a delivery nobody needs to answer
//   gateway(event)     the send surface for one event (event is null for
//                      notifications and the preview sweeper): sendText,
//                      sendChoice, editMessage, sendMedia, typing, ackAction,
//                      and sendVoice where the platform plays audio; plus the
//                      capability flags `buttons` and `canEdit`
//   handle(event, gw)  optional: its own turn instead of the shared core, for a
//                      platform whose conversations are not paired chats
//   finish(event, gw)  optional: tidy up after the handler (Discord resolves an
//                      unanswered "thinking...")
//   start({enqueue})   optional: open inbound listeners that queue into the inbox
//   stop()             optional: close them
//   describe()         optional: a small status object for /healthz
//
// Adding a platform is one entry in FACTORIES plus its file; the drain loop
// (src/drain.js) never changes. Each factory also exports a `configured(env)`
// check naming the env vars it needs, so a worker without a platform's
// credentials boots without that adapter and says which variable is missing.

import { createTelegramAdapter, telegramConfigured } from './telegram.js';
import { createDiscordAdapter, discordConfigured } from './discord.js';

export const FACTORIES = {
	telegram: { create: createTelegramAdapter, configured: telegramConfigured },
	discord: { create: createDiscordAdapter, configured: discordConfigured },
};

/**
 * Build every adapter that is both wanted (config.platforms, default all) and
 * configured (its credentials are present).
 * @returns {{ adapters: Map<string, object>, skipped: Array<{ platform:string, missing:string[] }> }}
 */
export function loadAdapters({ env = process.env, config = {}, log = null, factories = FACTORIES, overrides = {} } = {}) {
	const adapters = new Map();
	const skipped = [];
	const wanted = config.platforms || Object.keys(factories);
	for (const platform of wanted) {
		const f = factories[platform];
		if (!f) {
			skipped.push({ platform, missing: [], reason: 'unknown platform' });
			continue;
		}
		const check = f.configured(env);
		if (!check.ok) {
			skipped.push({ platform, missing: check.missing });
			continue;
		}
		adapters.set(platform, f.create({ env, config, log, ...(overrides[platform] || {}) }));
	}
	return { adapters, skipped };
}
