// /api/v1/trading: the trading tool list with input schemas. The tools
// themselves live under /api/v1/trading/* ([...path].js). Route table:
// api/_lib/trading-tools/routes.js. Guide: docs/trading-tools.md.

import { defineRouter } from '../../_lib/agents-v1/http.js';
import { tradingRoutes } from '../../_lib/trading-tools/routes.js';

export default defineRouter({ base: '/api/v1', routes: tradingRoutes });
