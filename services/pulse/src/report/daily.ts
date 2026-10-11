// Build, store and deliver one issue. Storing comes first so a Telegram outage
// never loses the issue, and re-running a day replaces its stored copy.
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import { db } from '../db/client.ts';
import type { SolanaStream } from '../collector/solana-stream.ts';
import { buildDailyData } from './data.ts';
import { writeNarrative } from './narrative.ts';
import { renderHtml, renderMarkdown, renderTelegram } from './render.ts';
import { sendTelegram, telegramConfigured } from './telegram.ts';

const log = logger('daily');

export async function publishDailyReport(day: string, opts: { stream?: SolanaStream | null; send?: boolean } = {}): Promise<{ day: string; messages: number; sent: number }> {
  const data = await buildDailyData(day);
  const narrative = await writeNarrative(data);
  const markdown = renderMarkdown(data, narrative);
  const html = renderHtml(data, narrative);
  const messages = renderTelegram(data, narrative, config.publicUrl ? `${config.publicUrl.replace(/\/$/, '')}/#/reports/${day}` : undefined);
  await (await db()).query(
    `insert into daily_reports (day, generated_at, data, markdown, html) values ($1, now(), $2, $3, $4)
     on conflict (day) do update set generated_at = now(), data = excluded.data, markdown = excluded.markdown, html = excluded.html`,
    [day, JSON.stringify({ ...data, narrative }), markdown, html],
  );
  let sent = 0;
  if (opts.send !== false && telegramConfigured()) {
    const res = await sendTelegram(messages);
    sent = res.sent;
    await (await db()).query(`update daily_reports set telegram = $2 where day = $1`, [day, JSON.stringify({ sentAt: new Date().toISOString(), ids: res.ids })]);
  } else if (opts.send !== false) {
    log.warn('Telegram not configured, issue stored only');
  }
  log.info(`issue ${day} stored (${messages.length} telegram messages, ${sent} sent)`);
  return { day, messages: messages.length, sent };
}
