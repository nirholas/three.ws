// /api/v1/agents/:id/portfolio[/history|/pnl]: an agent's valued portfolio,
// net-worth history and P&L. Route table: api/_lib/portfolio-routes.js.
// Guide: docs/api-reference.md.

import { defineRouter } from '../../../../_lib/agents-v1/http.js';
import { portfolioRoutes } from '../../../../_lib/portfolio-routes.js';

export default defineRouter({ base: '/api/v1', routes: portfolioRoutes });
