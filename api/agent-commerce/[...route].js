// /api/agent-commerce/*: invoices, offers, purchases and spending-limit
// proposals for agents. Route table: api/_lib/agent-commerce/routes.js.
// Guide: docs/agent-commerce.md.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { commerceRoutes } from '../_lib/agent-commerce/routes.js';

export default defineRouter({ base: '/api/agent-commerce', routes: commerceRoutes });
