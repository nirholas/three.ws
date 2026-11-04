// @ts-check
// Which push channels ops alerts can reach, read from the environment only (no
// network, no key material in the output). Kept apart from alerts.js so the
// health surfaces (/api/healthz, the alerts_push subsystem) can report channel
// state without importing the sender, which many tests replace wholesale.
//
// Channels:
//   dashboard  always on: every alert is upserted into the ops_alerts table.
//   telegram   TELEGRAM_BOT_TOKEN + TELEGRAM_ALERTS_CHAT_ID (a PRIVATE ops chat;
//              alerts carry stack traces, URLs and IPs).
//   email      OPS_ALERT_EMAILS (comma-separated recipients) + RESEND_API_KEY,
//              sent through the platform's existing Resend account.

// Deliberately simple: one @, no whitespace, a dot in the domain. Resend does
// the authoritative validation; this only drops obvious typos before a send.
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Telegram push config, or null when either var is unset. */
export function telegramConfig() {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_ALERTS_CHAT_ID;
	return token && chatId ? { token, chatId } : null;
}

/**
 * Parse a comma-separated recipient list: trimmed, lowercased, de-duplicated,
 * and with anything that is not an address dropped.
 * @param {string | undefined} value
 * @returns {{ valid: string[], invalid: string[] }}
 */
export function parseAlertRecipients(value) {
	const valid = [];
	const invalid = [];
	for (const raw of String(value || '').split(',')) {
		const addr = raw.trim().toLowerCase();
		if (!addr) continue;
		if (!EMAIL_RE.test(addr)) invalid.push(raw.trim());
		else if (!valid.includes(addr)) valid.push(addr);
	}
	return { valid, invalid };
}

/** Email push config, or null unless both a recipient and the Resend key exist. */
export function emailAlertConfig() {
	const { valid } = parseAlertRecipients(process.env.OPS_ALERT_EMAILS);
	if (!valid.length || !process.env.RESEND_API_KEY) return null;
	return { recipients: valid };
}

/**
 * Every channel and whether it is wired. The dashboard is always true.
 * @returns {{ dashboard: true, telegram: boolean, email: boolean }}
 */
export function alertChannels() {
	return { dashboard: true, telegram: telegramConfig() !== null, email: emailAlertConfig() !== null };
}

/**
 * What is missing for each unwired push channel, as env var names an operator
 * can set. Empty for a channel that is configured.
 * @returns {{ telegram: string[], email: string[], invalidEmails: string[] }}
 */
export function alertChannelGaps() {
	const telegram = [];
	if (!process.env.TELEGRAM_BOT_TOKEN) telegram.push('TELEGRAM_BOT_TOKEN');
	if (!process.env.TELEGRAM_ALERTS_CHAT_ID) telegram.push('TELEGRAM_ALERTS_CHAT_ID');
	const { valid, invalid } = parseAlertRecipients(process.env.OPS_ALERT_EMAILS);
	const email = [];
	if (!valid.length) email.push('OPS_ALERT_EMAILS');
	if (!process.env.RESEND_API_KEY) email.push('RESEND_API_KEY');
	return { telegram, email, invalidEmails: invalid };
}
