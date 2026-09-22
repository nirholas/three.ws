// /api/v1/agents/:id/predictions/*: prediction markets from the agent wallet.
// Route table and behavior: api/_lib/predictions/routes.js. Guide: docs/predictions.md.

import { defineRouter } from '../../../../_lib/agents-v1/http.js';
import { agentRoutes } from '../../../../_lib/predictions/routes.js';

export default defineRouter({ base: '/api/v1', routes: agentRoutes });
