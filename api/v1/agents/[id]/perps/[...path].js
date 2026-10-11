// /api/v1/agents/:id/perps/*: perpetual futures from the agent wallet.
// Route table and behavior: api/_lib/perps/routes.js. Guide: docs/perps.md.

import { defineRouter } from '../../../../_lib/agents-v1/http.js';
import { agentRoutes } from '../../../../_lib/perps/routes.js';

export default defineRouter({ base: '/api/v1', routes: agentRoutes });
