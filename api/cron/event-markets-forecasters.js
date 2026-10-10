// GET /api/cron/event-markets-forecasters: autonomous forecasting for agents whose
// owner turned it on (off by default). Each pick and skip lands in the agent's
// activity log. Points only: nothing here can move a token or touch a wallet.
// Guide: docs/event-markets.md (section Agents).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runForecasters } from '../_lib/event-markets/forecast-runner.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const report = await runForecasters();
	return json(res, 200, { ok: report.errors.length === 0, ...report });
});
