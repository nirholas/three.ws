/**
 * GET /api/tts/eleven/voices
 *
 * Returns the ElevenLabs voice list (filtered to safe public fields).
 * Returns { enabled: false, voices: [] } when ELEVENLABS_API_KEY is not set
 * so the client can gate the UI without a separate config check.
 */

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { env } from '../../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer  = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');

	const apiKey = env.ELEVENLABS_API_KEY;
	if (!apiKey) return json(res, 200, { enabled: false, voices: [] });

	let data;
	try {
		const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
			headers: { 'xi-api-key': apiKey },
		});
		if (!resp.ok) {
			console.error('[tts/eleven/voices] ElevenLabs error', resp.status);
			return error(res, 502, 'upstream_error', `ElevenLabs returned ${resp.status}`);
		}
		data = await resp.json();
	} catch (e) {
		console.error('[tts/eleven/voices] fetch failed', e);
		return error(res, 502, 'upstream_error', 'Could not reach ElevenLabs');
	}

	const voices = (data.voices || []).map((v) => ({
		voice_id:    v.voice_id,
		name:        v.name,
		category:    v.category,
		labels:      v.labels || {},
		preview_url: v.preview_url || null,
	}));

	return json(res, 200, { enabled: true, voices });
});
