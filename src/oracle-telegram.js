// Telegram chat state for the Oracle follow and arm panels.
//
// /api/oracle/follow and /api/oracle/test-alert only accept the chat id of the
// Telegram identity the user linked, so the panels do not offer a free-text
// input. They resolve one of four states from /api/oracle/telegram-chat and
// render accordingly.

export const TELEGRAM_LINK_URL = '/dashboard/settings#sign-in-methods';

export function telegramLoginUrl(next) {
	return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * Turn the transport result of GET /api/oracle/telegram-chat into a state:
 *   { status: 'linked', chatId }  chat verified, panel can act
 *   { status: 'unlinked' }        signed in, no Telegram identity linked
 *   { status: 'signed_out' }      no session
 *   { status: 'error', message }  request failed, retry
 */
export function telegramChatState({ ok, status, data }) {
	if (status === 401) return { status: 'signed_out' };
	if (!ok) {
		const message = !status
			? 'Could not reach three.ws. Check your connection, then retry.'
			: status === 429
				? 'Too many requests. Wait a few seconds, then retry.'
				: `Could not check your Telegram link (HTTP ${status}). Retry in a moment.`;
		return { status: 'error', message };
	}
	if (data?.linked && data.chat_id) return { status: 'linked', chatId: String(data.chat_id) };
	return { status: 'unlinked' };
}

export async function loadTelegramChat(api) {
	return telegramChatState(await api('/api/oracle/telegram-chat'));
}

/** Server error text for a rejected follow or test-alert call, with a fallback. */
export function telegramActionError(result, fallback) {
	if (result?.status === 401) return 'Sign in to use Telegram alerts.';
	if (result?.status === 403 && result?.data?.error_description) return result.data.error_description;
	return result?.data?.error_description || result?.data?.message || fallback;
}
