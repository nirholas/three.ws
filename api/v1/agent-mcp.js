// /api/v1/agents/:id/mcp[/...]: external MCP server connections for one agent.
// Route table: api/_lib/mcp-connections/routes.js. vercel.json maps the path here.

import { defineRouter } from '../_lib/agents-v1/http.js';
import { mcpConnectionRoutes } from '../_lib/mcp-connections/routes.js';

export default defineRouter({ base: '/api/v1', routes: mcpConnectionRoutes });
