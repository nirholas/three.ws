# The three.ws A2A agent

three.ws is an [A2A](https://a2a-protocol.org/) agent. Any A2A client can read
its Agent Card, see the skills, and call them over JSON-RPC: generate a 3D model
from text, validate and inspect a glTF/GLB file, search the public avatar
gallery, and read the paid service catalog. The free skills need no account,
no key and no extension.

> Source: the endpoint [`api/agents/a2a-paid.js`](../api/agents/a2a-paid.js),
> the dispatcher [`api/_lib/a2a/service.js`](../api/_lib/a2a/service.js), the
> wire dialects [`api/_lib/a2a/protocol.js`](../api/_lib/a2a/protocol.js), the
> task store [`api/_lib/a2a/task-store.js`](../api/_lib/a2a/task-store.js), the
> skill registry [`api/_lib/a2a/skills.js`](../api/_lib/a2a/skills.js), the card
> generator [`scripts/build-discovery-cards.mjs`](../scripts/build-discovery-cards.mjs)
> and the card rules [`scripts/lib/a2a-card-rules.mjs`](../scripts/lib/a2a-card-rules.mjs).
> Tests: [`tests/a2a-service.test.js`](../tests/a2a-service.test.js),
> [`tests/a2a-agent-card.test.js`](../tests/a2a-agent-card.test.js),
> [`tests/a2a-paid-endpoint.test.js`](../tests/a2a-paid-endpoint.test.js).

Related: [autonomous agent-to-agent payments](./a2a-payments.md) for how a
three.ws agent pays another agent, and the owner-run
[Marketplace card runbook](./ops/google-marketplace-agent-card.md) for the
Google Cloud Marketplace copy of the card.

---

## The Agent Card

`GET https://three.ws/.well-known/agent-card.json`

| Field | Value | Why |
|---|---|---|
| `url` | `https://three.ws/api/agents/a2a-paid` | The JSON-RPC endpoint, not the website |
| `preferredTransport` | `JSONRPC` | The only binding served |
| `protocolVersion` | `0.3.0` | Read by 0.3 clients |
| `supportedInterfaces` | JSON-RPC at `1.0` and at `0.3.0`, both on `url` | Read by 1.0 clients |
| `documentationUrl` | `https://three.ws/docs/a2a-agent` | This page |
| `version` | `package.json` version | Written by the generator on every build |
| `securitySchemes` | `bearer` (HTTP bearer), optional | See [Auth](#auth) |
| `security` / `securityRequirements` | anonymous, or bearer | The 0.3 and 1.0 spellings of the same rule |
| `capabilities.extensions` | the a2a-x402 extension, `required: false` | Only the paid skill uses it |
| `skills` | the registry in `api/_lib/a2a/skills.js` | Every listed skill routes |

The legacy `authentication` block is gone; no consumer in this repository read
it. The card is generated, never hand-edited: `npm run build:discovery` (part
of `prebuild`) rebuilds it whole and refuses to write a card that fails the A2A
rules. `npm run validate:a2a-card` runs the same rules on the committed card and
on the Marketplace copy, and `tests/a2a-agent-card.test.js` runs them under
`npm test`, so a change that reverts `url`, `securitySchemes`, `version` or the
optional extension fails locally.

## Skills

| Skill id | What it does | Cost |
|---|---|---|
| `generate-3d-model` | Text (3 to 1000 characters) to a textured GLB. The task starts `working` and completes with the GLB, a viewer link and an AR link; poll it with `GetTask`. Optional `tier`: `draft`, `standard` (default) or `high`. | Free, rate-limited per caller |
| `validate-model` | Fetches a public glTF/GLB URL, runs the Khronos glTF-Validator, and returns the error, warning, info and hint counts, structural stats and optimization advice. | Free |
| `search-avatars` | Keyword or tag search over the public avatar gallery. Up to 10 results anonymously, 50 with a bearer key. | Free |
| `x402-service-catalog` | The live paid service catalog by category, with the discovery document URL. | Free |
| `inspect-glb-a2a` | The glTF-Transform inspection report, paid per call over the a2a-x402 extension. | Paid per call |

### How a message picks a skill

1. A follow-up on an existing `taskId` goes back to that task's skill.
2. `metadata.skillId` (or `skill`) on the message, or a `skillId` in a data
   part, picks the skill explicitly. An unknown id is `-32602`.
3. An activated a2a-x402 extension, or a payment payload in the metadata, picks
   the paid inspector.
4. Otherwise the text decides: a model URL validates it, "search/find avatars"
   searches, "catalog" or "x402 services" lists the catalog, and a description
   of something to make generates it.
5. A message that matches nothing is answered with a message listing the skills.

## Methods

Both dialects run on the same URL. Send `A2A-Version: 1.0` for 1.0; without the
header the endpoint speaks 0.3. A version it does not serve is `-32009`.

| 1.0 | 0.3 | Result |
|---|---|---|
| `SendMessage` | `message/send` | 1.0: `{ "task": … }` or `{ "message": … }`. 0.3: the bare task or message |
| `GetTask` | `tasks/get` | The task; `historyLength` trims the history |
| `CancelTask` | `tasks/cancel` | Only `submitted` and `input-required` tasks cancel; a running generation cannot be recalled |

1.0 uses `ROLE_USER`/`ROLE_AGENT`, `TASK_STATE_*` states and untagged parts;
0.3 uses lowercase roles and states and `kind`-tagged parts. Streaming, push
notifications, the extended card and task listing are not offered, and answer
with the spec errors below rather than a generic failure.

Tasks are kept for 24 hours (`A2A_TASK_TTL_SECONDS`) in Redis, so `GetTask`
works whichever instance answers. A task id is a random UUID minted by the
server; knowing it is the capability to read that task.

## Errors

| Code | Meaning |
|---|---|
| `-32700` | The body is not JSON (HTTP 400; 413 when too large) |
| `-32600` | Not a single JSON-RPC 2.0 request object (batches are not supported) |
| `-32601` | Unknown method |
| `-32602` | Missing or malformed params, or an unknown `skillId` |
| `-32603` | Internal error; retry shortly |
| `-32001` | Task not found (unknown or expired id) |
| `-32002` | Task not cancelable in its current state |
| `-32003` | Push notifications not supported |
| `-32004` | Unsupported operation (streaming, task listing, a new message on a finished task) |
| `-32007` | No extended card |
| `-32009` | Unsupported `A2A-Version` |
| `-32029` | Rate limited (HTTP 429 with `Retry-After`) |

## Auth

Anonymous calls work. `Authorization: Bearer <three.ws API key or session
token>` is optional. Every caller gets 120 requests per minute; an anonymous
caller is counted per IP, a keyed caller per account, so a key moves you off a
shared IP's bucket and raises the avatar search cap from 10 to 50. Generation
has its own tighter per-caller bucket on top. An invalid, expired or revoked key
is rejected with HTTP 401 and `WWW-Authenticate: Bearer error="invalid_token"`
instead of being silently treated as anonymous; if the key cannot be checked
right now the answer is HTTP 503 with `Retry-After: 5`.

## The paid skill

Send `A2A-Extensions: https://github.com/google-a2a/a2a-x402/v0.1` (0.3
clients may send `X-A2A-Extensions`). The first call answers with an
`input-required` task carrying `x402.payment.required`; the retry on the same
`taskId` with a signed `x402.payment.payload` settles and completes with the
report as an artifact. The endpoint echoes the activated extension in both
headers. Without the extension a model URL goes to the free validator instead.

## Try it

```bash
curl -s https://three.ws/.well-known/agent-card.json | jq '{url, version, protocolVersion, preferredTransport, securitySchemes, security}'

# 1.0: validate a model
curl -s https://three.ws/api/agents/a2a-paid \
  -H 'content-type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"Validate https://three.ws/avatars/default.glb"}]}}}'
# → {"jsonrpc":"2.0","id":1,"result":{"task":{"id":"…","status":{"state":"TASK_STATE_COMPLETED",
#     "message":{"parts":[{"text":"Valid glTF: … Validator: 0 errors, 15 warnings, 2 infos, 0 hints. …"}]}},
#     "artifacts":[{"name":"gltf-validation.json", …}]}}}

# 0.3: search the gallery, then read the task back
curl -s https://three.ws/api/agents/a2a-paid -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"message/send","params":{"message":{"kind":"message","messageId":"m2","role":"user","parts":[{"kind":"text","text":"search avatars matching robot"}]}}}'
curl -s https://three.ws/api/agents/a2a-paid -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tasks/get","params":{"id":"<task id from the send>"}}'

# 1.0: generate, then poll until TASK_STATE_COMPLETED
curl -s https://three.ws/api/agents/a2a-paid \
  -H 'content-type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":4,"method":"SendMessage","params":{"message":{"messageId":"m4","role":"ROLE_USER","parts":[{"text":"Generate a 3D model of a small ceramic robot figurine"}]}}}'
```

## Changing a skill

Edit the entry in `api/_lib/a2a/skills.js` (the card fields, plus `pricing`
and `marketplace`), add its runner to `api/_lib/a2a/service.js`, then run
`npm run build:discovery` and `npm run validate:a2a-card`. The skills rule fails
any card entry the endpoint does not route.
