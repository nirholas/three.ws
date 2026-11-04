// @ts-check
// GET/POST /api/cron/payout-anomaly: hourly watch on outbound payouts.
//
// Raises the operator alert channel when the last 24 hours of withdrawals move
// more than PAYOUT_ANOMALY_MULTIPLIER (default 3) times the trailing 14 day
// median, or when more than 20 percent of them failed. It only alerts: pausing
// is the operator's call, through POST /api/admin-payouts-pause. The alert
// names that endpoint so the response is one step.
//
// Response: { ok, paused, findings[], failed24h, total24h }.
// Auth: CRON_SECRET Bearer, like every cron.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { scanPayouts, DEFAULT_MULTIPLIER } from '../_lib/payout-anomaly.js';
import { payoutsPaused } from '../_lib/payout-kill-switch.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const multiplier = Number(process.env.PAYOUT_ANOMALY_MULTIPLIER) > 0
		? Number(process.env.PAYOUT_ANOMALY_MULTIPLIER)
		: DEFAULT_MULTIPLIER;
	const scan = await scanPayouts({ multiplier });
	const paused = await payoutsPaused();
	if (scan.findings.length) {
		await sendOpsAlert(
			`Payout anomaly: ${scan.findings.map((f) => f.kind).join(' + ')}`,
			scan.findings.map((f) => `• ${f.detail}`).join('\n') +
				`\nPayouts are ${paused ? 'already paused' : 'running'}. To stop them: POST /api/admin-payouts-pause {"paused":true,"reason":"..."} (docs/financial-controls.md).`,
			{ signature: 'payout-anomaly' },
		);
	}
	return json(res, 200, { ok: true, paused, ...scan });
});
