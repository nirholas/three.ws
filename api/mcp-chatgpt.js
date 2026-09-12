// three.ws 3D Studio for the ChatGPT plugin directory.
//
//   POST /api/mcp-chatgpt  JSON-RPC (initialize, tools/list, tools/call, resources/*)
//
// The eight 3D tools and the model-viewer widget, and nothing that needs
// frameDomains. OpenAI's app guidelines reserve frame domains for embedding an
// essential third-party experience and say those apps "are often not approved
// for broad distribution". The persona widget frames our own embodiment page,
// which is not that case, so this surface leaves the persona tools out rather
// than ask review for an exception; they stay on /api/mcp-studio for every other
// MCP host. Same transport, rate limits and shared generation quota:
// ./_mcp-studio/handler.js.
import { studioHandler } from './_mcp-studio/handler.js';

export default studioHandler({ surface: 'chatgpt' });
