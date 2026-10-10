// /api/event-markets/*: Event Markets reads and picks. Route table:
// api/_lib/event-markets/routes.js. Guide: docs/event-markets.md.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { publicRoutes } from '../_lib/event-markets/routes.js';

export default defineRouter({ base: '/api', routes: publicRoutes('/event-markets') });
