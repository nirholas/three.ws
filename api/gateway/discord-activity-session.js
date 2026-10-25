// POST /api/gateway/discord-activity-session: maps a verified Discord identity
// to a three.ws session scoped to one Activity instance. The client sends the
// access_token discordSdk.commands.authenticate() returned plus the instance's
// guild/channel/instance ids (all from discordSdk.instanceId etc., never
// trusted as identity on their own); this handler re-checks the token against
// Discord's own /oauth2/@me before minting anything, so a forged client claim
// can never seat an impostor in someone else's room.

import { cors, json, method, error, readJson, wrap } from '../_lib/http.js';
import { fetchDiscordUser, signActivitySession, discordActivityConfigured, DiscordActivityAuthError } from '../_lib/gateway/discord-activity-auth.js';
import { ensureRoom, upsertParticipant, appendEvent } from '../_lib/gateway/discord-activity-store.js';

const SNOWFLAKE_RE = /^\d{1,24}$/;
const INSTANCE_RE = /^[A-Za-z0-9_-]{1,128}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!discordActivityConfigured()) return error(res, 503, 'not_configured', 'the Discord Activity is not configured');

	const body = (await readJson(req, 4_096)) || {};
	const instanceId = typeof body.instance_id === 'string' ? body.instance_id : '';
	const guildId = typeof body.guild_id === 'string' ? body.guild_id : '';
	const channelId = typeof body.channel_id === 'string' ? body.channel_id : '';
	if (!INSTANCE_RE.test(instanceId)) return error(res, 400, 'bad_instance', 'instance_id is required');
	if (!SNOWFLAKE_RE.test(guildId) || !SNOWFLAKE_RE.test(channelId)) return error(res, 400, 'bad_ids', 'guild_id and channel_id are required');

	let user;
	try {
		user = await fetchDiscordUser(body.access_token);
	} catch (e) {
		if (e instanceof DiscordActivityAuthError) return error(res, e.status, e.code, e.message);
		throw e;
	}

	// An instance id is bound to the guild/channel it was first seen with; a later
	// request claiming the same id under another guild or channel is a squat.
	const room = await ensureRoom({ roomId: instanceId, guildId, channelId });
	if (String(room.guild_id) !== guildId || String(room.channel_id) !== channelId) {
		return error(res, 403, 'room_mismatch', 'this instance belongs to a different guild or channel');
	}
	await upsertParticipant({ roomId: instanceId, discordUserId: user.id, username: user.username, globalName: user.globalName });
	await appendEvent({ roomId: instanceId, kind: 'join', actorDiscordId: user.id, payload: { username: user.username } });

	const sessionToken = signActivitySession({ discordUserId: user.id, username: user.username, globalName: user.globalName, roomId: instanceId, guildId, channelId });
	return json(res, 200, { session_token: sessionToken, user: { id: user.id, username: user.username, global_name: user.globalName, avatar: user.avatar } });
});
