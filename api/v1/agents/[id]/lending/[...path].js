// /api/v1/agents/:id/lending/*: supply idle agent funds to a Solana lending market.
// Route table and behavior: api/_lib/lending/routes.js. Guide: docs/agent-lending.md.

import { defineRouter } from '../../../../_lib/agents-v1/http.js';
import { agentRoutes } from '../../../../_lib/lending/routes.js';

export default defineRouter({ base: '/api/v1', routes: agentRoutes });
