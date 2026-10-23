// /api/revenue/*: the revenue ledger, reconciliation status, the public
// earnings toggle and the reinvest rules. Route table: api/_lib/revenue-routes.js.
// Guide: docs/revenue-ledger.md.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { revenueRoutes } from '../_lib/revenue-routes.js';

export default defineRouter({ base: '/api/revenue', routes: revenueRoutes });
