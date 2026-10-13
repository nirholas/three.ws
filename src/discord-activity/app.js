// Discord Activity: a shared Forge room. Everyone in the voice channel who
// opens the Activity sees the same prompt, the same generated model, and the
// same vote tally, because all of it lives server-side in one event-sourced
// room (api/_lib/gateway/discord-activity-store.js) keyed by the Activity
// instance id. This module only does three things: authenticate the Discord
// user into a room-scoped session, submit/poll the real /api/forge pipeline,
// and render whatever the room's SSE stream says changed. No coin, wallet, or
// purchase path: this room is free, by design (see the order's scope note).

import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

const READY_TIMEOUT_MS = 8_000;
const FORGE_POLL_MS = 3_000;
const FORGE_TIMEOUT_MS = 180_000;

const CLIENT_ID = (() => {
	const KEY = 'discordActivity:cid';
	try {
		let id = sessionStorage.getItem(KEY);
		if (!id) {
			id = crypto?.randomUUID?.() || `da-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			sessionStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return `da-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
})();
const FORGE_HEADERS = { 'content-type': 'application/json', 'x-forge-client': CLIENT_ID, 'x-witness': 'handled' };

const els = {
	boot: document.getElementById('da-boot'),
	bootMsg: document.getElementById('da-boot-msg'),
	error: document.getElementById('da-error'),
	errorMsg: document.getElementById('da-error-msg'),
	retry: document.getElementById('da-retry'),
	room: document.getElementById('da-room'),
	participants: document.getElementById('da-participants'),
	feed: document.getElementById('da-feed'),
	promptForm: document.getElementById('da-prompt-form'),
	promptInput: document.getElementById('da-prompt-input'),
	promptSubmit: document.getElementById('da-prompt-submit'),
	status: document.getElementById('da-status'),
	creation: document.getElementById('da-creation'),
	creationImg: document.getElementById('da-creation-img'),
	creationPrompt: document.getElementById('da-creation-prompt'),
	voteCount: document.getElementById('da-vote-count'),
	voteUp: document.getElementById('da-vote-up'),
	open3d: document.getElementById('da-open-3d'),
};

const state = {
	discordSdk: null,
	sessionToken: null,
	user: null,
	roomId: null,
	snapshot: null,
	voted: false,
	generating: false,
	seenEventIds: new Set(),
};

function show(el) {
	for (const key of ['boot', 'error', 'room']) els[key].hidden = els[key] !== el;
}

function withTimeout(promise, ms, message) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchConfig() {
	const res = await fetch('/api/gateway/discord-activity-config');
	if (res.status === 503) return null;
	if (!res.ok) throw new Error('Could not load the Activity configuration.');
	return res.json();
}

async function exchangeCode(clientId, code) {
	const res = await fetch('/api/gateway/discord-activity-token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ client_id: clientId, code }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error_description || 'Discord could not sign you in.');
	return data.access_token;
}

async function openSession(accessToken) {
	const res = await fetch('/api/gateway/discord-activity-session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			access_token: accessToken,
			instance_id: state.discordSdk.instanceId,
			guild_id: state.discordSdk.guildId,
			channel_id: state.discordSdk.channelId,
		}),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error_description || 'Could not open the room.');
	return data;
}

function roomUrl(sub = '') {
	return `/api/gateway/discord-activity-room/${encodeURIComponent(state.roomId)}${sub}`;
}

async function roomPost(sub, body) {
	const res = await fetch(roomUrl(sub), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${state.sessionToken}` },
		body: JSON.stringify(body || {}),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error_description || 'That did not go through.');
	return data.data;
}

async function loadSnapshot() {
	const res = await fetch(roomUrl(), { headers: { authorization: `Bearer ${state.sessionToken}` } });
	const data = await res.json().catch(() => ({}));
	if (res.ok) renderSnapshot(data.data);
}

function connectStream() {
	const es = new EventSource(roomUrl(`/stream?token=${encodeURIComponent(state.sessionToken)}&after=${state.snapshot?.lastEventId || 0}`));
	es.onmessage = (ev) => {
		let payload;
		try { payload = JSON.parse(ev.data); } catch { return; }
		if (state.seenEventIds.has(payload.id)) return;
		state.seenEventIds.add(payload.id);
		appendFeedLine(payload);
		loadSnapshot();
	};
	es.onerror = () => {
		es.close();
		setTimeout(connectStream, 4_000);
	};
}

function displayName(discordUserId) {
	const p = state.snapshot?.participants?.find((x) => x.discordUserId === discordUserId);
	return p?.globalName || p?.username || (discordUserId === state.user?.id ? 'You' : 'Someone');
}

function appendFeedLine({ kind, actor_discord_id, payload }) {
	const line = document.createElement('p');
	line.className = 'da-feed-line';
	const who = displayName(actor_discord_id);
	if (kind === 'join') line.textContent = `${who} joined the room.`;
	else if (kind === 'prompt') line.textContent = `${who} prompted: "${payload.text}"`;
	else if (kind === 'creation') line.textContent = `${who} shared a finished model.`;
	else if (kind === 'vote') line.textContent = `${who} ${payload.voted ? 'liked' : 'un-liked'} the model (${payload.vote_count} total).`;
	else if (kind === 'agent_say') { line.textContent = payload.text; line.className += ' da-feed-line--agent'; }
	else return;
	els.feed.appendChild(line);
	els.feed.scrollTop = els.feed.scrollHeight;
}

function renderSnapshot(snapshot) {
	state.snapshot = snapshot;
	els.participants.innerHTML = '';
	for (const p of snapshot.participants) {
		const chip = document.createElement('span');
		chip.className = 'da-chip';
		chip.textContent = p.globalName || p.username;
		els.participants.appendChild(chip);
	}
	els.voteCount.textContent = String(snapshot.voteCount || 0);
	if (snapshot.creation) {
		els.creation.hidden = false;
		els.creationImg.src = snapshot.creation.previewImageUrl || '';
		els.creationImg.alt = snapshot.creation.prompt || 'Generated model';
		els.creationPrompt.textContent = snapshot.creation.prompt || '';
		els.open3d.onclick = () => openExternal(`https://three.ws/forge/share/${snapshot.creation.id}`);
	} else {
		els.creation.hidden = true;
	}
}

function openExternal(url) {
	if (state.discordSdk?.commands?.openExternalLink) state.discordSdk.commands.openExternalLink({ url });
	else window.open(url, '_blank', 'noopener');
}

function setStatus(text) {
	els.status.textContent = text;
}

async function submitPrompt(text) {
	state.generating = true;
	els.promptSubmit.disabled = true;
	setStatus('Submitting to Forge...');
	try {
		await roomPost('/prompt', { text });
		const res = await fetch('/api/forge', { method: 'POST', headers: FORGE_HEADERS, body: JSON.stringify({ prompt: text, director: true }) });
		const job = await res.json().catch(() => ({}));
		if (!res.ok || job.error) throw new Error(job.message || 'The generator could not start.');

		let result = job;
		if (job.job_id && !(job.status === 'done' && job.glb_url)) {
			setStatus('Generating a 3D model for the room...');
			result = await pollForge(job.job_id);
		}
		if (!result.creation_id) throw new Error('The generator finished without a shareable model.');
		await roomPost('/creation', { creation_id: result.creation_id });
		setStatus('Done. Everyone in the room can see it now.');
	} catch (err) {
		setStatus(err.message || 'That generation failed.');
	} finally {
		state.generating = false;
		els.promptSubmit.disabled = false;
	}
}

async function pollForge(jobId) {
	const deadline = Date.now() + FORGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, FORGE_POLL_MS));
		const res = await fetch(`/api/forge?job=${encodeURIComponent(jobId)}`, { headers: FORGE_HEADERS });
		const data = await res.json().catch(() => ({}));
		if (data.status === 'done' && data.glb_url) return data;
		if (data.status === 'failed') throw new Error(data.message || 'The generator failed on this prompt.');
		if (data.message) setStatus(data.message);
	}
	throw new Error('The generator is taking longer than expected. Try again in a bit.');
}

function wireRoomUi() {
	els.promptForm.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = els.promptInput.value.trim();
		if (!text || state.generating) return;
		els.promptInput.value = '';
		submitPrompt(text);
	});
	els.voteUp.addEventListener('click', async () => {
		if (!state.snapshot?.creation) return;
		try {
			await roomPost('/vote', { vote: !state.voted });
			state.voted = !state.voted;
			els.voteUp.setAttribute('aria-pressed', String(state.voted));
		} catch (err) {
			setStatus(err.message);
		}
	});
	els.retry.addEventListener('click', () => boot());
}

async function boot() {
	show(els.boot);
	els.bootMsg.textContent = 'Connecting to Discord...';
	try {
		const config = await fetchConfig();
		if (!config) {
			els.errorMsg.textContent = 'This Activity has not been turned on yet. Ask the three.ws team to finish Discord setup.';
			show(els.error);
			return;
		}

		state.discordSdk = new DiscordSDK(config.client_id);
		await withTimeout(state.discordSdk.ready(), READY_TIMEOUT_MS, 'not_in_discord');

		if (config.cdn_host) {
			patchUrlMappings([{ prefix: 'cdn', target: config.cdn_host }], { patchFetch: true, patchXhr: true, patchSrcAttributes: true });
		}

		els.bootMsg.textContent = 'Signing you in...';
		const { code } = await state.discordSdk.commands.authorize({
			client_id: config.client_id,
			response_type: 'code',
			state: '',
			prompt: 'none',
			scope: ['identify'],
		});
		const accessToken = await exchangeCode(config.client_id, code);
		await state.discordSdk.commands.authenticate({ access_token: accessToken });

		els.bootMsg.textContent = 'Opening the room...';
		const session = await openSession(accessToken);
		state.sessionToken = session.session_token;
		state.user = session.user;
		state.roomId = state.discordSdk.instanceId;

		await loadSnapshot();
		connectStream();
		show(els.room);
		setStatus('Ready. Type a prompt and everyone in the room will see what comes out.');
	} catch (err) {
		els.errorMsg.textContent = err?.message === 'not_in_discord'
			? 'Open this from inside a Discord voice channel. It only works embedded in the Discord client.'
			: err?.message || 'Something went wrong connecting to Discord.';
		show(els.error);
	}
}

wireRoomUi();
boot();
