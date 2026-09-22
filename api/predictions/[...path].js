// /api/predictions/* — public prediction-market reads for the /predictions page:
// events, categories, event detail with price history, market detail with the
// order book. Route table: api/_lib/predictions/routes.js. Guide: docs/predictions.md.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { publicRoutes } from '../_lib/predictions/routes.js';

export default defineRouter({ base: '/api', routes: publicRoutes('/predictions') });
