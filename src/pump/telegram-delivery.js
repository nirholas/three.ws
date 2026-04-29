// Required env: TELEGRAM_BOT_TOKEN — obtain from Telegram @BotFather

const KIND_LABEL = {
	mint: 'New Mint',
	whale: 'Whale Move',
	claim: 'Claim',
	graduation: 'Graduation',
};

export async function sendTelegramSignal({ botToken, chatId, signal }) {
	const text = formatSignal(signal);
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
	});
	if (!res.ok) {
		const body = await res.text();
		throw Object.assign(new Error(`Telegram API ${res.status}: ${body}`), { status: 502 });
	}
	const data = await res.json();
	return { ok: true, messageId: data.result.message_id };
}

function formatSignal({ kind, mint, summary, refs, ts }) {
	const label = KIND_LABEL[kind] ?? kind;
	const time = ts ? new Date(ts).toUTCString() : new Date().toUTCString();
	let msg = `*${label}*\n\`${mint}\`\n\n${summary}`;
	if (refs?.length) msg += '\n\n' + refs.map((r) => `• ${r}`).join('\n');
	msg += `\n\n_${time}_`;
	return msg;
}
