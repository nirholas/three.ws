// GET /api/cron/nvidia-lane-probes: probe every NVIDIA lane that is due and
// record the result in nvidia_lane_probes, which /api/nvidia/stats and the
// "Live right now" grid on /nvidia read.
//
// Runs hourly; each lane carries its own cadence (api/_lib/nvidia-lanes.js), so
// a tick only spends requests on lanes whose last probe is older than that.
// ?force=1 probes every lane now, ?lane=a,b limits the run to named lanes
// (both still require the cron secret).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { NVIDIA_LANES, runLaneProbes } from '../_lib/nvidia-lanes.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const url = new URL(req.url, 'http://localhost');
	const force = url.searchParams.get('force') === '1';
	const known = new Set(NVIDIA_LANES.map((l) => l.id));
	const only = url.searchParams.get('lane')
		? url.searchParams.get('lane').split(',').map((s) => s.trim()).filter((s) => known.has(s))
		: null;

	const results = await runLaneProbes({ force, only });
	const down = results.filter((r) => r.status === 'down');
	if (down.length) {
		console.warn(`[nvidia-lane-probes] down: ${down.map((r) => `${r.lane}(${r.detail || 'no detail'})`).join(', ')}`);
	}
	return json(res, 200, { ok: true, probed: results.length, results });
}, { maxDurationMs: 280_000 });
