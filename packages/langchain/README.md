<p align="center">
  <a href="https://three.ws"><img src="https://three.ws/three-ws-mcp-icon.svg" width="72" height="72" alt="three.ws" /></a>
</p>

<h1 align="center">@three-ws/langchain</h1>

<p align="center"><strong>Give any LangChain JS agent the ability to forge, rig, animate, and render 3D models, and talk to a three.ws agent.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@three-ws/langchain"><img alt="npm" src="https://img.shields.io/npm/v/@three-ws/langchain?logo=npm&color=cb3837"></a>
  <img alt="license" src="https://img.shields.io/npm/l/@three-ws/langchain?color=3b82f6">
  <img alt="node" src="https://img.shields.io/node/v/@three-ws/langchain?color=339933&logo=node.js">
  <a href="https://three.ws"><img alt="three.ws" src="https://img.shields.io/badge/built%20by-three.ws-000"></a>
</p>

---

Five [`tool()`](https://js.langchain.com/docs/how_to/custom_tools/) definitions that wrap three.ws's generative 3D pipeline, ready to bind onto any LangChain model or agent:

| Tool | What it does | Auth |
| --- | --- | --- |
| `three_ws_forge` | Text prompt → textured GLB | Free |
| `three_ws_rig` | Static GLB → humanoid-rigged GLB | Free |
| `three_ws_render` | Any public GLB → turntable preview + geometry stats | Free |
| `three_ws_animate` | Text prompt → retargeted motion on a rigged GLB | Paid (x402) |
| `three_ws_agent_chat` | Message → a three.ws agent's reply | Free |

`three_ws_forge`, `three_ws_rig`, and `three_ws_render` call three.ws's free, no-key `/api/mcp-studio` server. `three_ws_agent_chat` calls the public `/api/chat` endpoint. `three_ws_animate` calls the paid, [x402](https://x402.org)-gated `/api/mcp` server: this package never signs a payment for you, it surfaces the real `PaymentRequired` challenge in the tool's artifact so your own x402 client (e.g. [`x402-fetch`](https://www.npmjs.com/package/x402-fetch)) can pay from your own wallet.

Each tool uses `responseFormat: "content_and_artifact"`: the string `content` is what the model reads back, and `artifact` carries the structured result (`{ ok, raw }` or `{ ok: false, error }` / `{ ok: false, paymentRequired: true, challenge }`) for your application code.

## Install

```bash
npm install @three-ws/langchain @langchain/core zod
```

## Quick start

```js
import { ChatOpenAI } from '@langchain/openai';
import { createThreeWsTools } from '@three-ws/langchain';

const tools = createThreeWsTools();
const model = new ChatOpenAI({ model: 'gpt-5.5' }).bindTools(tools);

const response = await model.invoke('Forge a low-poly fox, then render a turntable of it so I can see it.');
console.log(response.tool_calls);
```

Run a tool directly (no model needed) to see it call the live API:

```js
import { createThreeWsTools } from '@three-ws/langchain';

const [forge, rig, render] = createThreeWsTools();

const forged = await forge.invoke({ name: 'three_ws_forge', args: { prompt: 'a friendly round robot mascot', tier: 'draft' }, id: '1', type: 'tool_call' });
console.log(forged.content, forged.artifact);

const rendered = await render.invoke({
	name: 'three_ws_render',
	args: { glbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb' },
	id: '2',
	type: 'tool_call',
});
console.log(rendered.content);
```

## Paying for `three_ws_animate`

```js
import { createThreeWsTools } from '@three-ws/langchain';

// Resolve the x402 challenge with your own wallet, then pass the resulting
// X-PAYMENT header value straight through. This package never spends for you.
const [, , , animate] = createThreeWsTools();
const msg = await animate.invoke({ name: 'three_ws_animate', args: { glbUrl: myRiggedGlbUrl, prompt: 'wave hello' }, id: '3', type: 'tool_call' });
if (msg.artifact.paymentRequired) {
	// use your x402 client + wallet against msg.artifact.challenge, then retry with args.xPayment set
}
```

## Configuration

```js
createThreeWsTools({
	baseUrl: 'https://three.ws', // override for a self-hosted deployment
	apiKey: process.env.THREE_WS_API_KEY, // only needed for three_ws_animate
});
```

Each tool is also exported individually via a factory: `createForgeTool`, `createRigTool`, `createRenderTool`, `createAnimateTool`, `createAgentChatTool`.

## License

Apache-2.0
