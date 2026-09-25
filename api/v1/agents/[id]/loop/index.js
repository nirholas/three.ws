// /api/v1/agents/:id/loop and /api/v1/agents/:id/loop/*: the always-on strategy
// loop. Route table: api/_lib/strategy-loop/routes.js. Guide: docs/agent-runtime.md.

import { defineRouter } from '../../../../_lib/agents-v1/http.js';
import { loopRoutes } from '../../../../_lib/strategy-loop/routes.js';

export default defineRouter({ base: '/api/v1', routes: loopRoutes });
