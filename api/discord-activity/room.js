// GET/POST /api/discord-activity/room: the shared state every participant in
// a Discord Activity voice-channel instance polls and writes into. See
// api/_lib/discord-activity/store.js for the propose -> vote -> generating ->
// reveal loop. Identity here is whatever discordSdk.commands.authenticate()
// returned client-side (Discord's own user id/username/avatar) — there is no
// three.ws account, wallet or coin anywhere in this surface by design.
//
//   GET  ?instance_id=                                     -> { room }
//   POST { instance_id, guild_id?, channel_id?, action:'join',
//          discord_user_id, username?, global_name?, avatar? }
//   POST { instance_id, action:'propose', discord_user_id, prompt }
//   POST { instance_id, action:'vote', discord_user_id, prompt_id }
//   POST { instance_id, action:'generation', discord_user_id, prompt_id,
//          job_id, status, glb_url?, error? }

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	getOrCreateRoom,
	getRoomState,
	touchParticipant,
	addPrompt,
	castVote,
	reportGeneration,
	RoomError,
} from '../_lib/discord-activity/store.js';

function roomOut(state) {
	return { room: state };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	try {
		if (req.method === 'GET') {
			const rl = await limits.discordActivityReadIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const url = new URL(req.url, 'http://localhost');
			const instanceId = url.searchParams.get('instance_id') || '';
			const state = await getRoomState(instanceId);
			return json(res, 200, roomOut(state), { 'cache-control': 'no-store' });
		}

		const rl = await limits.discordActivityWriteIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const body = (await readJson(req)) || {};
		const action = String(body.action || '').trim();
		const instanceId = String(body.instance_id || '').trim();
		const discordUserId = String(body.discord_user_id || '').trim();
		if (!discordUserId) return error(res, 400, 'missing_user', 'discord_user_id is required.');

		if (action === 'join') {
			await getOrCreateRoom({ instanceId, guildId: body.guild_id || null, channelId: body.channel_id || null });
			await touchParticipant({
				instanceId,
				discordUserId,
				username: body.username || null,
				globalName: body.global_name || null,
				avatar: body.avatar || null,
			});
			return json(res, 200, roomOut(await getRoomState(instanceId)));
		}

		if (action === 'propose') {
			await touchParticipant({ instanceId, discordUserId, username: body.username, globalName: body.global_name, avatar: body.avatar });
			await addPrompt({ instanceId, discordUserId, prompt: body.prompt });
			return json(res, 200, roomOut(await getRoomState(instanceId)));
		}

		if (action === 'vote') {
			await castVote({ instanceId, discordUserId, promptId: body.prompt_id });
			return json(res, 200, roomOut(await getRoomState(instanceId)));
		}

		if (action === 'generation') {
			await reportGeneration({
				instanceId,
				promptId: body.prompt_id,
				jobId: body.job_id,
				status: body.status,
				glbUrl: body.glb_url || null,
				error: body.error || null,
			});
			return json(res, 200, roomOut(await getRoomState(instanceId)));
		}

		return error(res, 400, 'unknown_action', 'action must be one of join, propose, vote, generation.');
	} catch (e) {
		if (e instanceof RoomError) return error(res, e.status, e.code, e.message);
		throw e;
	}
});
