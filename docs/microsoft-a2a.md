# Call three.ws agents from Copilot Studio and Azure AI Foundry

three.ws speaks the A2A protocol (1.0 and 0.3, JSON-RPC, SSE streaming), so a Microsoft agent can call it as a peer: validate a GLB, search avatars, generate a 3D model and receive it as a file artifact.

| | |
|---|---|
| Endpoint | `https://three.ws/api/agents/a2a-paid` |
| Agent card | `https://three.ws/.well-known/agent-card.json` (also `https://three.ws/api/agents/a2a-paid/.well-known/agent.json`, the endpoint-relative path Copilot Studio probes) |
| Protocol | A2A `1.0` (send `A2A-Version: 1.0`) and `0.3.0` (default) |
| Methods | `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`, `SubscribeToTask` (0.3 names in [a2a-agent.md](./a2a-agent.md)) |
| Auth | None, `X-API-Key` header, or OAuth 2.0 authorization code. The card declares exactly these. |

Questions, model checks and the catalog work anonymously and are rate limited per IP. Generating a 3D model needs a three.ws account (a free one is enough): an anonymous generation is rejected with a message naming the API key page, so connect with an API key or OAuth to generate. Keyed and OAuth callers are limited per account (120 requests per minute).

## Copilot Studio

1. Open your agent, then **Agents** > **Add agent** > **Connect to an external agent** > **Agent2Agent**.
2. Paste the endpoint `https://three.ws/api/agents/a2a-paid`. Copilot Studio reads the card from the endpoint-relative path.
3. Choose authentication:
   - **None** for questions and model checks only. Generation is rejected without an account.
   - **API key**: location **Header**, name `X-API-Key`, value a three.ws API key from `https://three.ws/dashboard/api-keys`.
   - **OAuth 2.0 (manual)**: authorization URL `https://three.ws/oauth/authorize`, token URL and refresh URL `https://three.ws/api/oauth/token`, scope `avatars:read`. Register a client first (see the OAuth section of [mcp.md](./mcp.md)) and use its id and secret.
4. Save, then describe when the agent should use three.ws, for example: "Use three.ws when the user wants a 3D model made or checked."

Sample prompt: *Generate a 3D model of a small ceramic robot figurine.* The orchestrator calls the `generate-3d-model` skill, the task runs `working`, and the GLB arrives as a file part when it completes.

## Azure AI Foundry

1. In your project, add a **Connection** of type **A2A**. Use the endpoint above, with either a custom key connection (header `X-API-Key`) or OAuth 2.0 with the URLs above. Set the protocol version to `V1_0`.
2. Add the **Agent2Agent (A2A)** tool to the agent and select the connection.
3. Prompt the agent as above. Foundry streams status events while the generation runs.

## Microsoft Agent Framework (code)

[`integrations/microsoft/agent-framework/python/a2a_client.py`](../integrations/microsoft/agent-framework/python/a2a_client.py) calls the endpoint with `A2AAgent` from `agent-framework-a2a`: a plain question, a streamed generation, and a cancel.

```bash
pip install -r integrations/microsoft/agent-framework/python/requirements-a2a.txt
export THREE_WS_API_KEY=...
python integrations/microsoft/agent-framework/python/a2a_client.py
```

`THREE_WS_API_KEY` is required, because the sample generates models. Set `THREE_WS_BASE_URL` to aim at another server.

## Conformance

`tests/a2a-conformance.test.js` validates every response and stream frame against the A2A 0.3.0 JSON schema vendored at `tests/fixtures/a2a/a2a-0.3.0.schema.json` (source: `https://raw.githubusercontent.com/a2aproject/A2A/v0.3.0/specification/json/a2a.json`), including SSE streaming, resubscribe, cancel of a working task and the error codes. The card is checked by `npm run validate:a2a-card`.

## Live interop transcript

Recorded 2026-11-16 with Agent Framework `agent-framework-a2a` 1.0.0b261112 and `a2a-sdk` 1.3.0 against a local build of this branch running with the production lane configuration (production gains streaming and the new card when this branch is deployed). `a2a_client.py` exited 0: all three calls behaved.

```
[card] three.ws, streaming=True, skills=['generate-3d-model', 'validate-model', 'search-avatars', 'inspect-glb-a2a', 'x402-service-catalog']
[question] {"discovery": "https://three.ws/.well-known/x402.json", "services": [...]}
[stream] asking for 'a small ceramic robot figurine'
[stream] Generating "Generate a 3D model of a small ceramic robot figurine". Poll this task with GetTask (tasks/get on 0.3) or stream it with SendStreamingMessage (message/stream on 0.3); about 60s left. ...
[stream] Generated "Generate a 3D model of a small ceramic robot figurine". GLB: https://storage.googleapis.com/three-ws-avatar-reconstructions/raw-meshes/trellis/65c8e1d2-8b9d-4ad2-b3e0-eefc495ca831.glb ...
[stream] 3 updates, GLB: https://storage.googleapis.com/three-ws-avatar-reconstructions/raw-meshes/trellis/65c8e1d2-8b9d-4ad2-b3e0-eefc495ca831.glb
[cancel] task cbebc199-aa19-488e-90a7-b4b1d566af03 -> TASK_STATE_CANCELED
[cancel] read back -> TASK_STATE_CANCELED
```

The plain question, the streamed generation (message, `working`, terminal status with the GLB as a file part) and the cancel of a running task all completed. Re-run `a2a_client.py` against `https://three.ws` once this branch is deployed to repeat the proof on production.
