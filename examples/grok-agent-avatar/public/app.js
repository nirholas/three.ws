// The page side: chat with the server, then show each reply's mood on the
// avatar through the documented <agent-3d> API (setMood, playClip, speak).

// mood -> sustained expression (valence -1..1, arousal 0..1) and a one-shot emote
// from https://three.ws/animations/manifest.json.
const MOOD_MAP = {
	happy: { valence: 0.7, arousal: 0.4, clip: 'nod', label: 'Happy' },
	excited: { valence: 0.9, arousal: 0.85, clip: 'celebrate', label: 'Excited' },
	thoughtful: { valence: 0.1, arousal: 0.3, clip: 'think', label: 'Thoughtful' },
	sad: { valence: -0.6, arousal: 0.2, clip: 'defeated', label: 'Sad' },
	surprised: { valence: 0.3, arousal: 0.9, clip: 'reaction', label: 'Surprised' },
	neutral: { valence: 0, arousal: 0.3, clip: null, label: 'Calm' },
};

const $ = (id) => document.getElementById(id);
const avatar = $('avatar');
const log = $('log');
const input = $('input');
const send = $('send');
const banner = $('banner');
const history = [];
let avatarReady = false;

avatar.addEventListener('agent:load-progress', (e) => {
	const pct = Math.round(Number(e.detail?.pct) || 0);
	$('load-pct').textContent = pct ? `${pct}%` : '';
});
avatar.addEventListener('agent:ready', () => {
	avatarReady = true;
	$('stage-loading').hidden = true;
	avatar.wave?.();
});
avatar.addEventListener('agent:error', (e) => {
	$('stage-loading').hidden = true;
	$('stage-error-text').textContent = e.detail?.message || e.detail?.error?.message || 'Check your connection and reload.';
	$('stage-error').hidden = false;
});
$('reload').addEventListener('click', () => location.reload());

function showMood(mood, reply) {
	const m = MOOD_MAP[mood] || MOOD_MAP.neutral;
	const tag = $('mood');
	tag.textContent = m.label;
	tag.dataset.mood = mood;
	tag.hidden = false;
	if (!avatarReady) return;
	avatar.setMood(m.valence, m.arousal);
	// The visitor just sent a message, so the emote answers a user action.
	if (m.clip) avatar.playClip(m.clip, { fade_ms: 300, userInitiated: true });
	else avatar.speak(reply);
}

function bubble(role, text, extra = '') {
	$('empty')?.remove();
	const li = document.createElement('li');
	li.className = `msg ${role} ${extra}`.trim();
	li.textContent = text;
	log.append(li);
	li.scrollIntoView({ block: 'end', behavior: 'smooth' });
	return li;
}

function typing() {
	const li = bubble('assistant', '', 'typing');
	li.setAttribute('aria-label', 'Nova is typing');
	li.innerHTML = '<span></span><span></span><span></span>';
	return li;
}

function errorBubble(message, retry) {
	const li = bubble('error', message);
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.textContent = 'Try again';
	btn.addEventListener('click', () => {
		li.remove();
		retry();
	});
	li.append(' ', btn);
}

async function ask() {
	send.disabled = true;
	input.disabled = true;
	const dots = typing();
	try {
		const res = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: history.slice(-24) }),
		});
		const data = await res.json().catch(() => ({ message: `The server answered ${res.status} without JSON.` }));
		dots.remove();
		if (!res.ok) {
			errorBubble(data.message || `The server answered ${res.status}.`, ask);
			return;
		}
		history.push({ role: 'assistant', content: data.reply });
		bubble('assistant', data.reply);
		showMood(data.mood, data.reply);
	} catch (err) {
		dots.remove();
		errorBubble(`Could not reach the server (${err.message}). Is node server.mjs still running?`, ask);
	} finally {
		send.disabled = false;
		input.disabled = false;
		input.focus();
	}
}

function submit(text) {
	const content = text.trim();
	if (!content || send.disabled) return;
	history.push({ role: 'user', content });
	bubble('user', content);
	input.value = '';
	ask();
}

$('composer').addEventListener('submit', (e) => {
	e.preventDefault();
	submit(input.value);
});
log.addEventListener('click', (e) => {
	if (e.target.classList?.contains('chip')) submit(e.target.textContent);
});

fetch('/api/health')
	.then((r) => r.json())
	.then((h) => {
		if (h.key) return;
		banner.textContent = 'This server has no xAI key yet, so Nova cannot answer. Stop it and start it again with XAI_API_KEY=... node server.mjs';
		banner.hidden = false;
	})
	.catch(() => {
		banner.textContent = 'The server is not answering. Start it with node server.mjs and reload.';
		banner.hidden = false;
	});
