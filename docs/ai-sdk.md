# three.ws tools for the Vercel AI SDK

[`@three-ws/ai-sdk`](https://github.com/nirholas/three.ws/tree/main/packages/ai-sdk) gives any
[AI SDK](https://ai-sdk.dev) agent five tools: forge a 3D model from text, rig it, render it,
animate it, and talk to a three.ws agent. Each one is a standard AI SDK `tool()` with a zod input
schema, so it drops into `generateText`, `streamText` or an `Agent` like any other tool.

Four of the five tools need no API key, no account and no payment.

## Install

```bash
npm install @three-ws/ai-sdk ai zod
```

Works with AI SDK 5, 6 and 7 and zod 3 or 4. Node 18 or newer.

## Quick start

```js
import { generateText, isStepCount } from 'ai';
import { createThreeWsTools } from '@three-ws/ai-sdk';

const { forge, rig, render } = createThreeWsTools();

const { text } = await generateText({
	model: 'openai/gpt-5-mini',
	prompt: 'Forge a low-poly fox, rig it, then render a turntable so I can see it.',
	tools: { forge, rig, render },
	stopWhen: isStepCount(5),
});

console.log(text);
```

The model string goes through the AI Gateway. Any provider works the same way, for example
`createOpenAI(...)('gpt-5-mini')` or an OpenAI-compatible endpoint through `createOpenAI({ baseURL })`.

## The tools

| Tool | Input | What comes back | Cost |
| --- | --- | --- | --- |
| `forge` | `prompt`, optional `tier` (`draft`, `standard`, `high`) | a textured GLB URL and a viewer link | free |
| `rig` | `glbUrl` of a static humanoid mesh | a rigged GLB URL with a humanoid skeleton and skin weights | free |
| `render` | `glbUrl` of any public GLB | turntable images from several angles plus the model's geometry stats | free |
| `animate` | `glbUrl` of a rigged GLB, a motion `prompt` | an animated GLB | paid per call over x402 |
| `agentChat` | `message`, optional `agentId` | the agent's reply | free |

Every tool returns `{ ok: true, text, raw }` on success or `{ ok: false, error }` on failure, so the
model can read the outcome and decide what to do next instead of the loop throwing.

`forge`, `rig` and `render` call the free [3D Studio MCP server](./mcp-studio.md)
(`https://three.ws/api/mcp-studio`). `agentChat` calls the public chat endpoint.

## Paying for `animate`

`animate` is the only paid tool. The package never signs a payment on its own. Without payment it
returns the real x402 challenge:

```js
const tools = createThreeWsTools();
const first = await tools.animate.execute({ glbUrl: riggedGlbUrl, prompt: 'wave hello' });

if (first.paymentRequired) {
	// Pay first.challenge with your own x402 client and wallet, then retry:
	const paid = await tools.animate.execute({ glbUrl: riggedGlbUrl, prompt: 'wave hello', xPayment });
}
```

See [x402 payments](./x402.md) for how a client settles a challenge.

## Configuration

```js
createThreeWsTools({
	baseUrl: 'https://three.ws', // a self-hosted deployment
	apiKey: process.env.THREE_WS_API_KEY, // only used by animate
});
```

Each tool is also exported on its own: `forgeTool`, `rigTool`, `renderTool`, `animateTool`,
`agentChatTool`.

## Verified

On 2026-11-14, `generateText` from `ai` 7.0.166 with `isStepCount` and the `render` tool, driven by
an OpenAI-compatible model, called the live API on the Khronos Duck sample and answered with its
correct triangle count (4,212). The package's own suite (`npm test` in `packages/ai-sdk`) calls
production for every tool.

## Related

- [LangChain JS tools](https://github.com/nirholas/three.ws/tree/main/packages/langchain)
  (`@three-ws/langchain`): the same five tools for LangChain agents.
- [MCP servers](./mcp.md): connect an MCP client directly instead of using a framework package.
