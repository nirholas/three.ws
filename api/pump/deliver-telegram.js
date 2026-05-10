import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';

function formatSignal(signal) {
	const time = signal.ts ? new Date(signal.ts).toUTCString() : '';
	return `*${signal.kind?.toUpperCase() || 'SIGNAL'}* — \`${signal.mint || ''}\`\n${signal.summary || ''}\n${time}`;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token) return error(res, 500, 'misconfigured', 'TELEGRAM_BOT_TOKEN is not set');

	const body = await readJson(req).catch(() => null);
	if (!body?.chatId) return error(res, 400, 'validation_error', 'chatId required');

	const text = formatSignal(body.signal || {});
	const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chat_id: body.chatId, parse_mode: 'Markdown', text }),
	});

	const data = await r.json().catch(() => ({}));
	if (!r.ok) return error(res, 502, 'telegram_error', data.description || `HTTP ${r.status}`);

	return json(res, 200, { ok: true, messageId: data.result?.message_id });
});
