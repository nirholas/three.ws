// /api/coin-control/*: a creator's control room for the coin they launched
// through three.ws. Route table: api/_lib/coin-control/routes.js.
// Guide: docs/coin-control.md.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { coinControlRoutes } from '../_lib/coin-control/routes.js';

export default defineRouter({ base: '/api/coin-control', routes: coinControlRoutes });
