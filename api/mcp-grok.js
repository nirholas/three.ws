// three.ws 3D Studio for Grok Bot and the xAI Responses API.
//
//   POST /api/mcp-grok  JSON-RPC (initialize, tools/list, tools/call, resources/*)
//
// Every free studio tool, including the persona tools that give Grok a body.
// Grok calls MCP from xAI's cloud with no published timeout and renders no
// widget, so each call answers inside a budget with the model or a pending job,
// and the instructions tell Grok to collect it and share links. Generation caps
// key on the Mcp-Session-Id this surface issues, since every Grok user shares
// xAI's egress. Transport, quota and breaker: ./_mcp-studio/handler.js.
import { studioHandler } from './_mcp-studio/handler.js';

export default studioHandler({ surface: 'grok' });
