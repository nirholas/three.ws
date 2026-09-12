// three.ws 3D Studio (free): remote MCP server, full surface.
//
//   POST /api/mcp-studio  JSON-RPC (initialize, tools/list, tools/call, resources/*)
//
// Every studio tool and both Apps SDK widgets, including the living-body persona
// tools. Transport, rate limits and the shared generation quota live in
// ./_mcp-studio/handler.js, which also backs /api/mcp-chatgpt (the ChatGPT plugin
// listing, without the persona tools; SURFACES in ./_mcp-studio/dispatch.js
// explains why).
import { studioHandler } from './_mcp-studio/handler.js';

export default studioHandler({ surface: 'full' });
