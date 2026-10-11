// Telegram delivery. One bot token, one chat or channel id; messages go out in
// order with a short pause so Telegram's per-chat rate limit is never hit.
import { config } from '../lib/env.ts';
import { sleep } from '../lib/http.ts';
import { logger } from '../lib/log.ts';

const log = logger('telegram');

export function telegramConfigured(): boolean {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}

export async function sendTelegram(messages: string[]): Promise<{ sent: number; ids: number[] }> {
  if (!telegramConfigured()) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required to send');
  const ids: number[] = [];
  for (const text of messages) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(20_000),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        ids.push(j.result.message_id);
        break;
      }
      if (res.status === 429) {
        await sleep(((j?.parameters?.retry_after as number) ?? 5) * 1000 + 250);
        continue;
      }
      throw new Error(`telegram ${res.status}: ${j?.description ?? 'send failed'}`);
    }
    await sleep(1_100);
  }
  log.info(`sent ${ids.length}/${messages.length} messages`);
  return { sent: ids.length, ids };
}
