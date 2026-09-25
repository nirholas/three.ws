// POST /api/v1/agents/:id/stop: the agent lifecycle the strategy loop, automations
// and runs honor. Route table: api/_lib/strategy-loop/routes.js.

import { defineRouter } from '../../../_lib/agents-v1/http.js';
import { lifecycleRoutes } from '../../../_lib/strategy-loop/routes.js';

export default defineRouter({ base: '/api/v1', routes: lifecycleRoutes });
