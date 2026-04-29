import { z } from 'zod';
import { json, error, wrap, method, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { sendTelegramSignal } from '../../src/pump/telegram-delivery.js';

const bodySchema = z.object({
	chatId: z.union([z.string(), z.number()]),
	signal: z.object({
		kind: z.enum(['mint', 'whale', 'claim', 'graduation']),
		mint: z.string(),
		summary: z.string(),
		refs: z.array(z.string()).optional(),
		ts: z.number().optional(),
	}),
});

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;

	const botToken = process.env.TELEGRAM_BOT_TOKEN;
	if (!botToken) return error(res, 500, 'misconfigured', 'TELEGRAM_BOT_TOKEN is not set');

	const raw = await readJson(req);
	const { chatId, signal } = parse(bodySchema, raw);

	const result = await sendTelegramSignal({ botToken, chatId, signal });
	return json(res, 200, result);
});
