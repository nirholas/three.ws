---
title: "Long-running MCP tools: how to design a tool that outlives the tool call, from the three.ws 3D Studio server"
venue: IBM Community, Three.ws User Group (blog post)
account: nich (nich8)
description: "A long technical write-up for IBM developers and agent-framework builders: how an MCP server whose work takes from fifteen seconds to several minutes delivers every result anyway, inside host timeouts and per-turn call budgets. Ten generalizable patterns (job handles, a collector tool, call budgets, submit tickets, polling guidance in tool text, interface-side collection, structured content, honest annotations, tiers and refinement, splitting anonymous from authenticated servers), each shown in the real three.ws implementation with live JSON-RPC requests and responses, plus resources and guided prompts, a runnable build-your-own server, and notes for MCP builders targeting watsonx Orchestrate."
status: draft, not yet posted
meta_title: "Long-running MCP tools: job handles, check_job and call budgets"
meta_description: "How to build MCP tools that outlive a host's tool-call timeout: job handles, a collector tool, call budgets, submit tickets and honest metadata, with live examples."
slug: long-running-mcp-tools-outlive-the-tool-call
featured_image: "https://three.ws/api/page-og?v=carbon&f=group&s=build&t=Long-running%20MCP%20tools%20that%20outlive%20the%20call&d=Job%20handles%2C%20check_job%2C%20call%20budgets%2C%20and%20honest%20metadata%20from%20the%20three.ws%203D%20Studio%20MCP%20server&p=%2Fdocs%2Fmcp-studio"
framing_notes: |
  Every framing rule in docs/ibm.md applies to this draft and must survive any edit:
  three.ws is an IBM Business Partner; the /api/ibm/* surfaces and the open-source
  @three-ws/ibm-watsonx-mcp connector are independent developer tools built on IBM's
  publicly available Granite models, are not IBM products, are not partnership
  deliverables, and are not endorsed by IBM. Nothing here claims a watsonx Orchestrate
  listing or integration: the Agent Catalog listing is a not-yet-done path
  (docs/partners/ibm-partner-plus.md), and section 13 says so plainly. The Orchestrate
  CLI example in section 13 is quoted from IBM's documentation and has not been run
  against an Orchestrate tenant; keep that caveat if the section is edited.
  Per the group's posting rules (docs/ops/seo-keyword-plan.md) there is no
  crypto-cluster content anywhere in this post: the free 3D Studio server it is about
  carries no payment surface, and the account resources and guided prompts in section
  11 are described only through their non-financial members. Keep it that way.
  Every response below was captured live on 2026-10-08 against production and trimmed
  only where marked. Canonical URL blank (original post). The featured image is
  the carbon card with &f=group, whose footer reads "Three.ws User Group" rather than
  "Built on IBM watsonx.ai" (api/page-og.js, CARBON_FOOTERS); confirm the live card shows
  that footer before posting, since an older revision ignores the parameter. The post makes
  no claim that the 3D Studio runs on watsonx.ai (section 9 states the prompt director's
  actual status).
---

# Long-running MCP tools: how to design a tool that outlives the tool call

_Posted in the [Three.ws User Group](https://community.ibm.com/community/user/groups/community-home?communitykey=e71510cc-d953-408f-9a1c-019f5c0a7016) on IBM Community._

Most MCP tutorials build a tool that answers in milliseconds: fetch the weather, read a row. The hard case nobody writes up is a tool whose real work takes longer than the host is willing to wait.

Ours is 3D generation. A text prompt goes in; a textured, downloadable GLB comes out, anywhere from about fifteen seconds to several minutes later, depending on the lane, the quality tier, and whether a GPU worker has to boot first. The MCP hosts calling us have their own clocks. ChatGPT ends any tool call still open at 60 seconds. Other hosts wait longer, but none wait forever, and a model mid-turn has its own patience and its own budget of tool calls.

This post covers the ten design decisions that let the three.ws 3D Studio MCP server finish every model anyway. Each applies to anyone wrapping a slow pipeline (batch inference, document processing, a build) as an MCP tool, and each is shown in the real implementation, with file paths in the [three.ws repository](https://github.com/nirholas/three.ws) and requests you can run against the live endpoint with no account, key, or payment. Most were learned the hard way, so this is also an account of what broke and how it was fixed, dated from our commit history.

**The affiliation, stated exactly.** three.ws is an IBM Business Partner. The `/api/ibm/*` developer surfaces and the open-source `@three-ws/ibm-watsonx-mcp` connector mentioned in section 13 are independent developer tools three.ws built on IBM's publicly available Granite models. They are **not** IBM products, **not** official partnership deliverables, and **not** endorsed by IBM. The 3D Studio server is a three.ws product. Nothing below is an IBM release or IBM guidance.

**Contents**

1. The problem: work that takes minutes, hosts that wait seconds
2. The server, live: initialize and tools/list
3. Pattern 1: never fail work that is still running, return a handle
4. Pattern 2: make the collector a first-class tool
5. Pattern 3: budget every call against the host, not against the work
6. Pattern 4: a handle that exists before the job does
7. Pattern 5: put the polling guidance where the model reads it
8. Pattern 6: let the interface collect, not the model
9. Pattern 7: structured content is the contract, text is the narration
10. Pattern 8: annotations are a safety contract, so verify them
11. Beyond tools: resources and guided prompts
12. Patterns 9 and 10: tiers, refinement, and checking the shelf first
13. Splitting anonymous tools from authenticated ones, and watsonx Orchestrate
14. The pattern checklist
15. Build your own: a long-running MCP tool in 150 lines of Node
16. Honest limits
17. Try it, and three questions for the group

---

## 1. The problem: work that takes minutes, hosts that wait seconds

The protocol has room for progress notifications and server-initiated streams, but the hosts people actually use treat a tool call as a function call with a timeout. When it fires, the host gives up. What happens to the work is up to you.

The naive slow tool accepts the call, submits the job, polls until it finishes, and returns the result. When the poll outlasts the host, three bad things compound:

- **The user sees a failure for work that will succeed.** The job keeps running, a good result lands in storage minutes later, and nobody learns it exists.
- **The model retries.** A failed call invites another, which starts a second job, which also outlives the call.
- **You pay for all of it.** Orphaned work costs exactly as much as delivered work.

We shipped the naive version first. A fix commit on 2026-07-25 records what it did in production: with our self-hosted TRELLIS lane as the primary engine, a generation took four to six minutes, the inline wait was three, so every hosted call to the generation tools answered "taking longer than expected" while the model quietly finished. We verified it twice: both "failed" generations were complete in our creations table one to three minutes after the tool gave up.

Everything that follows answers that observation. **A timeout is not a failure of the work; it is a failure of the wait.** Design for the wait ending early, and keep the work reachable afterwards.

---

## 2. The server, live: initialize and tools/list

The free 3D Studio server is `https://three.ws/api/mcp-studio`: Streamable HTTP (JSON-RPC over `POST`), protocol `2025-06-18`, no authentication. The full reference is the [3D Studio MCP server documentation](https://three.ws/docs/mcp-studio?utm_source=ibm-community).

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "serverInfo": { "name": "three-ws-3d-studio-free", "version": "1.0.0" },
    "capabilities": {
      "tools": { "listChanged": false },
      "resources": { "listChanged": false, "subscribe": false },
      "logging": {}
    },
    "instructions": "three.ws 3D Studio turns a text prompt or an image into an interactive, downloadable 3D model (GLB), free. ... If a result comes back with status \"pending\", the model is still rendering: call check_job(job_id) after the suggested wait to collect it. Before generating a prop, character or animation, search_catalog(q) checks the thousands of ready-made CC0 props, rigged characters and motion clips three.ws already publishes ..."
  }
}
```

(Trimmed: `instructions` is one paragraph covering every tool.) The server teaches the long-running contract before the model has called anything: if you see `pending`, call `check_job` later.

`tools/list` returns fourteen tools, in about 130 ms in our measurements:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '[.result.tools[].name]'
```

```json
[
  "forge_free", "text_to_avatar", "mesh_forge", "rig_mesh", "forge_avatar",
  "refine_model", "check_job", "look_at_model",
  "search_catalog", "get_catalog_item", "get_item_source",
  "create_agent_persona", "get_agent_persona", "persona_say"
]
```

Six generators, a collector (`check_job`), an inspector (`look_at_model`), three catalog reads, and three persona tools. A second front door, `https://three.ws/api/mcp-chatgpt`, serves the same handler with only the eight 3D tools, for the ChatGPT app listing:

```bash
curl -s https://three.ws/api/mcp-chatgpt \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq -c '[.result.tools[].name]'
```

```json
["forge_free","text_to_avatar","mesh_forge","rig_mesh","forge_avatar","refine_model","check_job","look_at_model"]
```

Both doors are rows in one `SURFACES` table in [`api/_mcp-studio/dispatch.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/dispatch.js), each naming its catalog, widgets, model instructions and, for ChatGPT only, a call budget:

```js
const SURFACES = {
	full: {
		server: 'mcp-studio',
		catalog: [...TOOL_CATALOG, ...CATALOG_TOOL_CATALOG, ...PERSONA_TOOL_CATALOG],
		tools: { ...TOOLS, ...CATALOG_TOOLS, ...PERSONA_TOOLS },
		personas: true,
		instructions: [...BASE_INSTRUCTIONS, ...CATALOG_INSTRUCTIONS, ...PERSONA_INSTRUCTIONS].join(' '),
	},
	chatgpt: {
		server: 'mcp-chatgpt',
		catalog: [...TOOL_CATALOG],
		tools: { ...TOOLS },
		personas: false,
		instructions: [...BASE_INSTRUCTIONS, ...CHATGPT_INSTRUCTIONS].join(' '),
		callBudgetMs: CHATGPT_CALL_BUDGET_MS,
	},
};
```

**A host is a deployment target with its own constraints, so model it as data.** Adding a host with a different timeout is a new row, not a fork.

---

## 3. Pattern 1: never fail work that is still running, return a handle

When a generation outlives the inline wait, the tool returns a **success** result carrying a pollable handle, and the job keeps running. Here it is live on the ChatGPT surface, where every call is bounded to 40 seconds (section 5), using the fastest free tier, `draft`:

```bash
curl -s https://three.ws/api/mcp-chatgpt \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a small cast-iron teapot with a bamboo handle","tier":"draft"}}}'
```

HTTP 200 after 40.16 seconds:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "The model is still rendering (heavier scenes take a few minutes) (roughly 14s to go). It keeps running: call the check_job tool with this job_id in ~14s to collect it, or poll https://three.ws/api/gpt-forge?job=f1.eyJwIjoiZ2NwIiwiayI6bnVsbC... until status is \"done\", then use its glb_url (view at https://three.ws/viewer?src=<glb_url>)."
      }
    ],
    "structuredContent": {
      "status": "pending",
      "jobId": "f1.eyJwIjoiZ2NwIiwiayI6bnVsbC...",
      "pollUrl": "https://three.ws/api/gpt-forge?job=f1.eyJwIjoiZ2NwIiwiayI6bnVsbC...",
      "stage": "mesh",
      "etaRemainingSeconds": 14,
      "prompt": "a small cast-iron teapot with a bamboo handle"
    }
  }
}
```

(Trimmed: the handle is a few hundred characters.) Four deliberate details:

- **It is not `isError`.** The call succeeded: it accepted the job and says where it is. An error would invite the model to retry the generator, the worst possible next step.
- **The handle is public, self-contained, and signed.** It is the same auth-free token our public REST lane gives anonymous callers, so any HTTP client can poll `pollUrl` without speaking MCP. It records which backend and task to poll, and it is HMAC-signed ([`api/_lib/forge-job-token.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-job-token.js)), because otherwise a caller could forge a handle and poll arbitrary upstream tasks.
- **`stage` says which half of the pipeline is running,** `mesh` or `rig`, so a client collecting an avatar knows whether it will get a bare mesh or the finished rig.
- **`etaRemainingSeconds` is the running lane's typical duration minus elapsed time,** so the caller waits instead of retrying blind. Section 7 covers what we got wrong about it.

One helper, `pendingResult()` in [`api/_mcp-studio/tools.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/tools.js), builds the envelope, and every generator ends the same way:

```js
if (job._timedOut && job.job_id) return pendingResult({ base, jobId: job.job_id, what: 'model', prompt, ...pendingTiming(job) });
if (job._timedOut || !job.glb_url) return toolError('Generation is taking longer than expected. Please try again.');
return ok({ glbUrl: job.glb_url, base, kind: 'model', prompt, referenceImageUrl: job.preview_image_url });
```

A timed-out job **with** a handle is pending. A timeout with nothing accepted is a genuine error, and only then. The original bug was that the first two lines were one.

The helper's comment adds a rule worth stealing: every timing value comes from the job's own status payload, "nothing here is derived from a local clock, so a job handed back after a client reconnect reports the JOB's age."

---

## 4. Pattern 2: make the collector a first-class tool

A handle is only useful if the model can redeem it. The first fix returned `pollUrl` alone, and as the code comment says, "the only way back to a pending job was browsing the raw poll URL." A model inside a host cannot browse. It can call a tool. So the server publishes `check_job`, built on three rules: **one probe, no loop; three clear outcomes; only an unrecognized handle is final.**

Collecting the teapot right after the pending result:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"check_job","arguments":{"job_id":"f1.eyJwIjoiZ2NwIiwiayI6bnVsbC..."}}}'
```

This first check took 15.9 seconds and returned the finished model (`result.structuredContent`, with the `spatial` block trimmed):

```json
{
  "kind": "model",
  "glbUrl": "https://three.ws/cdn/forge/anon/d0bf4918-36c5-4716-a476-58b4885e6dc2.glb",
  "viewerUrl": "https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fd0bf4918-36c5-4716-a476-58b4885e6dc2.glb",
  "arUrl": "https://three.ws/api/ar?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fd0bf4918-36c5-4716-a476-58b4885e6dc2.glb&title=a%20small%20cast-iron%20teapot%20with%20a%20bamboo%20handle",
  "format": "glb",
  "prompt": "a small cast-iron teapot with a bamboo handle",
  "referenceImageUrl": "https://three.ws/cdn/forge/refs/30921a8f-7b7d-4886-a971-8826d128ff66.jpg",
  "spatial": { "spatialMcpVersion": "0.1", "kind": "model", "...": "..." }
}
```

The GLB is real: 1,530,768 bytes, served as `model/gltf-binary`. A second check of the same job took **0.136 seconds** and returned the identical envelope.

That difference is the most instructive number here. The **first** check that finds a job finished does real work: it copies the mesh into our storage so it outlives the provider's URL, records the creation, and runs an automated quality gate. Later checks are served from a cached finished frame. The cache exists because of a failure measured on 2026-08-27: every poll of a finished job re-ran that work, 13 to 33 seconds **per poll**, timing out a 15-second status tool on roughly every other read. A finished job is terminal, so its first frame is now kept for six hours and returned verbatim.

The lessons:

- **A collector may be slow exactly once.** Do the post-processing on the first collection; cache the terminal frame.
- **Separate "the check failed" from "the job failed."** A check that failed while the job is fine (a timeout, a busy rate bucket, the slow first save-and-score) carries `retryable: true`. We hit this live in a second run the same day: the first `check_job` on a brass desk lamp reached its 30-second bound and returned `isError` with `retryable: true`, and the next check returned the finished model.
- **Make the one final error say what to do.** An unknown handle:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"check_job","arguments":{"job_id":"f1.not-a-real-handle"}}}' \
  | jq -c .result.structuredContent
```

```json
{"error":true,"message":"That job id is not recognized (it may be mistyped or expired). Start a new generation to get a fresh one."}
```

No `retryable`, because retrying cannot succeed, and the message names the one action that will. The handler, from `api/_mcp-studio/tools.js` (lightly condensed: production also normalizes the prompt's type):

```js
async function handleCheckJob(args, _auth, req) {
	const base = originFromReq(req);
	const jobId = String(args.job_id || '').trim();
	if (!jobId) return toolError('Provide the job_id a pending generation returned.');
	let data;
	try {
		data = await pollOnce(base, jobId);
	} catch (err) {
		return toolError(failureMessage(err), err?.code === 'unknown_job' ? {} : { retryable: true });
	}
	if (data.status === 'done' && data.glb_url) {
		const refined = finishRefinement(base, data, args.refine);
		if (refined) return refined;
		return ok({ glbUrl: data.glb_url, base, kind: 'model', prompt: data.prompt || undefined, referenceImageUrl: data.preview_image_url });
	}
	if (data.status === 'failed') {
		return toolError(data.error ? `Generation failed: ${data.error}` : failureMessage({ code: 'generation_failed' }));
	}
	return pendingResult({ base, jobId, what: 'model', prompt: data.prompt || undefined, ...pendingTiming(data) });
}
```

Two decisions sit outside it. **Collection never spends the generation quota:** [`api/_mcp-studio/handler.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/handler.js) excludes `check_job` from the rate-limited set, "or collecting a pending job could be rate-blocked by the very generation that created it." And **a result collected later is the same envelope as a result returned inline,** so every consumer handles one success shape.

---

## 5. Pattern 3: budget every call against the host, not against the work

Pattern 1 makes a timeout survivable. Pattern 3 makes sure the **host's** timeout never fires. If the host kills the call, the response is lost, including the handle you were about to return. So the server needs its own deadline, comfortably inside the host's, flowing into every wait. On the ChatGPT surface, from `dispatch.js`:

```js
// 40 s of work, leaving headroom under the host's 60 s limit for a submit that
// needs its guaranteed floor (gpt-forge-client.js SUBMIT_FLOOR_MS) and the
// response's own trip back through ChatGPT.
export const CHATGPT_CALL_BUDGET_MS = 40_000;
```

The dispatcher turns the budget into an absolute deadline once, when the call arrives:

```js
const ctx = surface.callBudgetMs ? { deadline: started + surface.callBudgetMs } : {};
const result = await tool.handler(args, auth, req, ctx);
```

The prompt director, the submit and the poll loop all shrink to fit it. In [`api/_mcp-studio/gpt-forge-client.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/gpt-forge-client.js) the effective deadline is the earlier of the lane's timeout and the call's, and no probe or sleep may run past it:

```js
const deadline = Math.min(Date.now() + tMs, callDeadline || Infinity);
const left = () => deadline - Date.now();
```

Why 40 and not 59? The remaining twenty seconds must hold a submit that is guaranteed an 8-second floor even near the deadline (without an accepted job there is nothing to hand back), plus the response's trip back through the host. Our teapot call returned at 40.16 seconds measured from our side of the network: the budget plus about 160 ms.

- **Use absolute deadlines, not durations.** "You have 40 seconds" handed to three nested functions gives each of them 40 seconds. "Be done by 12:00:40" gives all of them the same truth.
- **Different hosts, different budgets.** `/api/mcp-studio` keeps a long inline wait (three minutes by default), because other hosts wait and an inline model beats a handle when allowed. `tests/mcp-chatgpt-budget.test.js` pins both: "stays under the 60 s host limit with room for a floored submit" and "leaves the full MCP surface unbounded, where hosts wait minutes."
- **Back off, and never let a blip end the loop.** Polling starts at three seconds and stretches by 1.35x toward ten, about a third of the status calls a fixed cadence would make. A network error, a 429 or a 5xx during a rolling deploy is retried; only a definitive 4xx ends the loop. After twenty consecutive soft failures the loop still returns the pending shape: "a pollable handle, never a dead error."

---

## 6. Pattern 4: a handle that exists before the job does

The budget created a subtler bug. On 2026-09-30 we measured text-to-3D **submits** taking 30 to 42 seconds in production: the server paints a reference image before accepting a job, and that step was falling through a ladder of image providers. With a 40-second budget, the client aborted a 42-second submit. The server, unaware, finished it and created a real job. The tool had already answered "Generation is taking longer than expected," and the job id was never delivered. The fix commit records that two test cases of our OpenAI App Directory resubmission failed exactly this way.

The fix, in [`api/_lib/forge-submit-ticket.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-submit-ticket.js), is a **submit ticket: a job handle that exists before the job does.**

1. The client mints a ticket (a timestamp plus a random UUID) and sends it with the submit in an `x-forge-ticket` header.
2. The server marks it `submitting` before starting work, and records the submit's response under it when done, **whether or not the caller is still listening.**
3. A caller whose submit ran out of time returns the ticket's handle (`t1.<ticket>`) as its pending job id.
4. Polling that handle resolves to the real job once the submit lands.

Client side, inside the submit's timeout handler:

```js
// The submit is still running server-side and will record its job under
// the ticket, so hand back the ticket's handle rather than submit a
// second job or report a timeout.
if (ticket) return { status: 'submitting', job_id: ticketHandle(ticket) };
```

`check_job` and the viewer widget needed no changes: they already poll whatever handle they are given. Three details make it robust:

- **A grace window.** A poll can arrive before the `submitting` mark is visible. A ticket younger than 90 seconds with no record is "still being submitted," not unknown; the mint timestamp inside it makes that decidable.
- **A staleness ceiling.** A ticket silent for five minutes died with its instance and is reported failed rather than spinning forever. The slowest submit we measured was 42 seconds.
- **No raw tickets in key listings.** Records are keyed by a hash of the ticket.

If you take one idea from this post, take this one: **any tool that starts asynchronous work should be able to name that work before it finishes starting it.** It is an idempotency key applied to the start of a long job: the client chooses the identifier, so a lost response never means a lost job, and a retry finds the same work instead of creating a second copy.

The same commit fixed a failure that is easy to miss: provider **billing notices** accepted as output. The prompt director rewrites a short prompt into a fuller brief, and a provider's "raise your key budget at https://..." reply was being forwarded as the brief, which, the code comment records, "is how 22 production generations came out of a billing message." The validator now rejects any rewrite containing a link, any that does not end as a finished sentence, and any no longer than what the user typed, and falls back to the user's own words. **Treat upstream text as untrusted until it passes a shape check, especially text that becomes the input to an expensive job.**

---

## 7. Pattern 5: put the polling guidance where the model reads it

An MCP server can teach a model in three places, and a long-running tool needs all three:

1. **Server `instructions`** at `initialize`: the contract in one paragraph.
2. **Tool descriptions** at `tools/list`: `check_job` says "While it is still rendering you get updated timing; call again after the suggested wait."
3. **The result text:** "call the check_job tool with this job_id in ~14s to collect it."

The third is the one most servers skip, and it works best, because it arrives exactly when the decision is made. Its machine-readable twin, `etaRemainingSeconds`, sits beside it in `structuredContent`.

Guidance is also **per host.** The ChatGPT surface appends:

```js
const CHATGPT_INSTRUCTIONS = [
	'In ChatGPT the inline viewer collects a pending job by itself and shows the model when it lands, so tell the',
	'user it is rendering and do not loop on check_job; call check_job only when the user asks about the job.',
];
```

That is a per-turn call budget expressed as an instruction. Where the interface collects the job (pattern 6), a model looping on a status tool spends the turn's tool calls on work already being done. Elsewhere the model is the collector, and the base instructions tell it to collect.

**Honest numbers are part of the guidance.** On 2026-09-09 we found the remaining-time estimate floored at five seconds, so once a job outran its estimate every poll said "roughly 5s to go" for as long as it ran. Measured that week: a 12.5-minute job claimed five seconds remaining for its final eleven minutes. The fix commit called it "a fabricated reading, not a slow one." Past the estimate the field is now absent, consumers fall back to "it keeps running in the background," and `elapsedSeconds` carries a real number that moves.

**Name the state, not just the time.** A job queued on a scale-to-zero GPU worker is waiting for a boot, not a slow render, and that changes what a sensible client does. Since 2026-09-08 the text says "The GPU worker for this model is waking up (about Ns of boot left)" and `structuredContent` carries `coldStart: true` with the boot budget, every number from the job's own status. The retry hint points at the end of the boot, because "telling a caller to come back in the render ETA when the worker answers sooner wastes the difference." With no reported budget, the server names the state and promises no time.

**Every number you show a model will be acted on, so a wrong number is worse than none.**

---

## 8. Pattern 6: let the interface collect, not the model

The best collector is often the interface the host renders. In ChatGPT each 3D Studio tool links an Apps SDK widget through `_meta["openai/outputTemplate"]` and is marked `openai/widgetAccessible: true`, which lets the widget call tools itself through `window.openai.callTool`. When a result is pending, the widget takes over. From [`api/_mcp-studio/component.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/component.js):

```js
var POLL_FIRST_MS = 5000;
var POLL_MAX_MS = 12000;
var POLL_GIVE_UP_MS = 12 * 60 * 1000;
var MAX_POLL_FAILURES = 6;
```

It polls `check_job` from five seconds, backing off 1.3x toward twelve, shows a live elapsed timer, and drops the model in when it lands. When the envelope says `"next": "rig"` (an avatar mesh whose skeleton is still to come), it calls `rig_mesh` itself, and if rigging fails it keeps the mesh: "The mesh is real and saved; a failed rig must not throw it away." Three failure choices worth copying:

- **Retryable failures retry on cadence;** only six in a row surface, as "Lost contact with the job while it was rendering. It keeps running, so checking again usually finds it," with a resume button.
- **Twelve minutes is a soft limit, not a verdict:** "It is still running, and you can keep waiting for it," with a resume that picks up the same job.
- **The finished model is saved to widget state,** so reopening the conversation shows it instead of restarting the wait.

A host without widget tool calls gets a designed "still rendering" panel, and the model stays the collector. **An interface-side collector is an optimization, never the only path.** This is what the 2026-09-29 changelog entry, "3D Studio in ChatGPT finishes every model, however long it takes," describes from the user's side.

---

## 9. Pattern 7: structured content is the contract, text is the narration

Every result has two channels: `content`, text for the model and for hosts that render nothing, and `structuredContent`, a stable JSON contract for the widget and client code. The contract is deliberately minimal. Compare the raw job status our public REST endpoint returns for the teapot:

```bash
curl -s "https://three.ws/api/gpt-forge?job=f1.eyJwIjoiZ2NwIiwiayI6bnVsbC..." | jq -c '{creation_id, status, durable, score: .quality.score, triangles: .quality.metrics.triangleCount}'
```

```json
{"creation_id":"d0bf4918-36c5-4716-a476-58b4885e6dc2","status":"done","durable":true,"score":0.914,"triangles":7800}
```

The REST frame carries internal identifiers, quality metrics and the storage bucket URL. The MCP envelope carries a GLB link on our own domain, viewer and AR links, the format, the prompt and the concept image. The `tools.js` header states the rule: every internal identifier (creation id, prediction id, backend name, trace) is stripped per the host's data-minimization policy, with one exception, the public poll handle, because "without it the still-running work would be unreachable." Four more choices:

- **Rewrite URLs to your own origin.** Bucket GLB URLs become first-party `/cdn/` paths, because a sandboxed widget needs CORS headers the bucket does not send, and your own URL survives a storage move.
- **Additive, open shapes.** Every result also carries a `spatial` block, an open artifact format for 3D results from the repository's Spatial MCP specification, so other renderers can display it without breaking readers of the older fields.
- **Pictures, when the consumer is a model.** `look_at_model` returns rendered views as MCP `image` content blocks, each preceded by a text block naming the angle, so a multimodal model can judge its own output and regenerate naming the fault. The [3D vision documentation](https://three.ws/docs/3d-vision?utm_source=ibm-community) covers it.
- **Protocol errors and tool errors stay separate.** A malformed request is a JSON-RPC error the host can catch as a bug:

```bash
curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"check_job","arguments":{}}}'
```

```json
{"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"invalid params for check_job: (root) must have required property 'job_id'"}}
```

A tool that ran and failed returns a normal **result** with `isError: true` and a sanitized message the model can act on. Arguments are validated against the published `inputSchema` (with Ajv) before the handler runs, so the schema a client reads is the one the server enforces, and failure text passes through a sanitizer so provider internals never leak.

One note this group should have precisely, since it touches IBM. The prompt director is written to try Granite on watsonx.ai first when watsonx credentials are configured, and to fall through a model chain otherwise, under its own time cap. Production does not carry watsonx credentials today, so the fallback chain does that work. The pattern is the point: a quality step on the critical path must be bounded and must fail soft to the user's own words.

---

## 10. Pattern 8: annotations are a safety contract, so verify them

Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are how a client decides whether a tool may run without asking the user. A read-only tool runs silently. That makes them a security contract.

`check_job` reads like a status probe, and for a while we annotated it as one: read-only and idempotent. Both were wrong. The 2026-09-12 fix:

```js
annotations: {
	readOnlyHint: false, // polling can persist a model and submit recovery jobs
	destructiveHint: false,
	idempotentHint: false, // later checks can advance recovery to another provider
	openWorldHint: true,
},
```

The first check of a finished job copies the mesh into storage, records the creation, fills the result cache and runs the quality gate, and it can route failed work to another provider; later checks hit the cache. So it writes, and repeating it is not the same as making it once. A client using the old hints to decide what was safe to repeat was told the wrong thing, and the same claim had gone to the OpenAI app directory twice. Our own submission-review tooling caught it; the fix landed in the code, the docs, and a golden fixture of the public tool contract.

The generators are honest the other way: not read-only (they create an asset), not destructive (they never modify or delete), not idempotent ("same prompt, a fresh, different mesh each call"), open-world (work runs against external model services). `look_at_model` is genuinely read-only and idempotent.

What keeps this true is mechanical verification. `npm run audit:mcp-safety` parses every tool definition in the repository and checks its annotations against what its handler does, and `audit:mcp-golden` fails when a tool's public contract changes without a deliberate fixture update. The contract is written up in the [MCP tool safety documentation](https://three.ws/docs/mcp-safety?utm_source=ibm-community), and every tool on every three.ws server, with its safety class, is in the [searchable MCP tool catalog](https://three.ws/mcp-tools?utm_source=ibm-community), generated from the tool source on every build.

**If a tool that sounds like a read writes on any path, it is not read-only.**

---

## 11. Beyond tools: resources and guided prompts

MCP servers have two more primitives, **resources** and **prompts**, and both are underused. Resources let a client read state without a tool call; prompts let a server ship a whole workflow as a menu item.

The free studio uses resources only for its widgets and lists no prompts. The four account-facing three.ws servers (the main server at `/api/mcp` and three siblings) use both since 2026-09-22, in the changelog's words: "Claude and other AI clients can now read your three.ws account and follow guided flows." The design, in [`api/_mcp/resources.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp/resources.js) and [`api/_mcp/prompts.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp/prompts.js), has decisions worth copying.

**Resources are live, read-only views under a URI scheme:** `three://me` (your account and quota), `three://agents` (the agents you own), `three://models` (every model an agent can think on). Each declares one access rule (public, any signed-in user, or a list of scopes) and reads the same tables as the REST route behind the dashboard, "so a resource can never disagree with the dashboard." An anonymous `resources/list` returns only the public ones, three today.

**Two refusals, two codes:**

```bash
curl -s https://three.ws/api/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"three://me"}}'
```

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"three://me is account data: sign in with three.ws OAuth or an API key to read it","data":{"uri":"three://me","hint":"Connect this server with OAuth, or send Authorization: Bearer sk_live_... from /dashboard/api."}}}
```

`-32001` means "authenticate or grant a scope first"; `-32002` is MCP's "resource not found." Someone else's resource answers exactly like a missing one, "so a URI cannot be used to probe which ids exist."

**A fallback for clients without a resource reader:** every resource is also reachable through a `read_resource` tool on the same server. Host support for resources is uneven; the data should not be.

**Prompts are rendered against the live tool catalog,** never a hand-kept list. A prompt is listed only where every tool it needs exists; each tool name passes through a function that throws if the server does not publish it; a test renders every prompt on every server against `tools/list`; confirmation flags are read from each tool's own `inputSchema`. The main server lists fourteen, among them `get-started`, `create-agent`, `hire-agent`, `review-costs` and `embed-avatar`.

**Prices in metadata must be real.** `three://models` is what an assistant reads to compare model costs. On 2026-09-25 we fixed it so free models read `[0, 0]` rather than `null`, and a key that routes to another model is priced at the model that answers. The concrete case was IBM's: our `ibm-granite` key names no priced model itself, so it read `null`. Live today:

```bash
curl -s https://three.ws/api/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"three://models"}}' \
  | jq '.result.contents[0].text | fromjson | .agent_models[] | select(.id == "ibm-granite")'
```

```json
{
  "id": "ibm-granite",
  "label": "IBM Granite 3.8B",
  "network": "IBM watsonx.ai",
  "tier": "balanced",
  "max_output_tokens": 4096,
  "available": true,
  "free": false,
  "price_usd_per_mtok": [0.05, 0.1],
  "description": "IBM’s open, enterprise-governed foundation model on watsonx.ai."
}
```

Four days later the same resource needed a second fix: it imported a function the catalog module no longer exported, so every read answered "Could not read right now." **A resource is code and needs a test that reads it end to end.**

Discovery follows the same thinking. The 2026-09-29 entry "One link teaches any AI agent to use three.ws" is the [connect page](https://three.ws/connect?utm_source=ibm-community), with one-click setup for Claude, ChatGPT, Cursor and VS Code, plus a single Agent Skill file at `three.ws/skill.md` that tells an assistant how to reach the platform, starting with the free server for clients with no account. Every hosted server is also listed with its auth model in `https://three.ws/.well-known/mcp.json`; the 3D Studio entry reads `"auth": "none"`. A model cannot use a server it cannot find, or connect correctly to one whose auth it must guess.

---

## 12. Patterns 9 and 10: tiers, refinement, and checking the shelf first

### Pattern 9: tiers that degrade honestly, refinement that survives the wait

`forge_free` takes `tier`: `draft`, `standard` (the default) or `high`. Tiers let a caller trade time for quality, and the rule is that **a tier may degrade only in the direction its description promises, and only when nobody paid for the difference.** Free `high` runs on a scale-to-zero self-hosted GPU worker; if that lane refuses or cannot accept the job within the submit window, the call degrades to `standard` rather than failing the conversation, and the description says so ("high is slower and may fall back to standard under load"). The submit client has a `strictTier` mode that throws instead, for any surface where the caller paid for the higher tier, because silently serving less than was bought is a correctness bug. That is also why `standard`, not `high`, is the default: a default that sometimes quietly becomes something else is a broken promise.

`refine_model` iterates in plain language ("make it metallic", "add wings"). It is a real anchored regeneration, not a fake diff: the prior prompt is folded together with the change, optionally anchored by a reference image. Each refinement is appended to an immutable **version lineage** in `structuredContent.lineage`, and the lineage lives **with the client**: it passes the array back as `parent_lineage` on the next call, or targets `parent_index` to branch. Reverting is a pointer move, with no server session to expire.

A refinement can outlive the budget, so its pending result carries a `refine` object, the history the new model will join. Passed back to `check_job` unchanged, it makes the collector append the finished model exactly as `refine_model` would have inline; if it is malformed, the plain model comes back instead ("the model itself is never lost"). **When a long job continues a conversation, the continuation state must ride with the handle,** or the result arrives without its context. Related, from 2026-09-03: refine used to replay the prompt without pinning randomness, so "you asked for this model, better, and got another model, better." A seed now rides along on refine, retry and automatic engine switches.

### Pattern 10: check the shelf before you build

The cheapest long-running job is the one you never start. Before generating, search the catalog of ready-made CC0 props, rigged characters and motion clips:

```bash
curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_catalog","arguments":{"q":"wooden chair","limit":3}}}' \
  | jq -r '.result.content[0].text'
```

Under half a second:

```text
10 matches for "wooden chair" (showing 3 from offset 0):

- `object:painted_wooden_chair_01` | Painted Wooden Chair 01 | CC0 | chair, wood, painted, farmhouse
- `object:painted_wooden_chair_02` | Painted Wooden Chair 02 | CC0 | old, wooden, vintage, antique
- `object:WoodenChair_01` | Wooden Chair 01 | CC0 | wood, prop, vintage, furniture

Kinds: object 10
Categories: furniture (10), seating (10), office (1)
More: call again with offset 3.

Next: get_item_source with an id above returns code you can paste.
```

`structuredContent` carries the items with license, size and thumbnail, plus facets, `next_offset` and the catalog `total` (3,961 items at the time of writing). `get_item_source` returns paste-ready code: a `<model-viewer>` tag pinned with its integrity hash, three.js, React, or the `<agent-3d>` web component. The result's last lines tell the model its next step, and the server instructions add: "Say whether you used an existing asset or generated a new one." A half-second search that saves a three-minute generation is this server's best latency optimization.

---

## 13. Splitting anonymous tools from authenticated ones, and watsonx Orchestrate

The catalog tools taught us the most transferable lesson here, and it is about authentication, not time.

Our main server, `https://three.ws/api/mcp`, has always listed `search_catalog`. Most of its tools act on an account, so it uses OAuth 2.1, and the 401 that starts sign-in arrives on **`initialize`**, before any tool is chosen:

```bash
curl -s -o /dev/null -D - https://three.ws/api/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  | grep -iE '^HTTP|www-authenticate'
```

```text
HTTP/2 401
www-authenticate: Bearer resource_metadata="https://three.ws/.well-known/oauth-protected-resource", resource="https://three.ws/api/mcp"
```

That is correct MCP authorization, and Claude clients follow it automatically. But it means **a keyless tool on a server that challenges at `initialize` is not keyless for any real MCP client.** Our docs told people to add `/api/mcp` to search the catalog with no account; a real client that did was sent to sign-in. Only plain JSON-RPC calls (curl, a script that does not speak the MCP transport) were served anonymously.

The 2026-10-01 fix ("Search the 3D asset catalog from any AI client without an account") moved nothing and duplicated nothing: the keyless studio now serves the same three catalog tools from the main server's own definitions. One implementation, two transports. From [`api/_mcp-studio/catalog-tools.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp-studio/catalog-tools.js):

```js
function libraryTool(name) {
	const def = libraryTools.find((d) => d.name === name);
	if (!def) throw new Error(`api/_mcp/tools/library.js no longer defines ${name}`);
	return { ...def, description: def.description.replace(MAIN_SERVER_LEAD, 'Free, no account needed. ') };
}
```

If the main server renames a tool, the keyless server refuses to load rather than silently serving a stale copy. **Auth is a property of a server, not of a tool.** Put keyless tools on a server that never challenges, and declare each server's auth in a discovery manifest.

### Applying these patterns in watsonx Orchestrate

Many in this group build for watsonx Orchestrate, so here is what IBM documents that is relevant. Our own position first: three.ws is **not** listed in the watsonx Orchestrate Agent Catalog and has **no** Orchestrate integration today. Nothing below has been run by us against an Orchestrate tenant.

IBM's watsonx Orchestrate ADK documentation describes importing a remote MCP server as a toolkit with `orchestrate toolkits add`, using `--kind mcp`, a `--url`, and a `--transport` of `sse` or `streamable_http`. For this server that would be (flags as IBM documents them, untested by us):

```bash
orchestrate toolkits add --kind mcp \
  --name three-ws-3d-studio \
  --description "Free text-to-3D and 3D asset search" \
  --url https://three.ws/api/mcp-studio \
  --transport streamable_http \
  --tools "*"
```

Three statements on that IBM page connect directly to this post:

- At import the ADK "connects to the remote MCP server to retrieve and validate available tools," and "watsonx Orchestrate waits up to 30 seconds for the server to respond with the tool list." **Keep `tools/list` cheap.** Ours is a static catalog answering in about 130 ms.
- The ADK "checks only the tool schemas for structural correctness" and does not run tools at import. **Your timeout behavior is untested until a real call hits it,** which is why patterns 1 to 4 matter.
- At execution, end-of-file errors "usually happen when the server times out or doesn't respond in time." That is the failure pattern 3 prevents: **return your own pending envelope before the caller's clock runs out,** so what arrives is a handle, not a dropped connection.

The page also lists several authentication methods for remote MCP, including OAuth2 without dynamic client registration, API keys and bearer tokens; a keyless server for anonymous tools sidesteps that configuration entirely.

Separately, IBM's own tutorial on IBM Developer, "Building AI applications with Model Context Protocol (MCP)," builds a watsonx.ai-backed MCP server with Granite models and uses Claude Desktop as its host. If you wrap a slow watsonx.ai workload the same way (a long batch generation, a large embedding job, a forecast over a long series), these patterns apply unchanged.

To reach watsonx.ai itself from any MCP client, three.ws publishes an open-source connector, `@three-ws/ibm-watsonx-mcp` (0.2.2 on npm), that calls the watsonx.ai REST API with **your own** IBM Cloud credentials: six tools (`watsonx_chat`, `watsonx_generate`, `watsonx_embed`, `watsonx_tokenize`, `watsonx_forecast`, `watsonx_list_models`), no intermediary backend, no telemetry. It is community-built, not an IBM product, and not operated or endorsed by IBM.

---

## 14. The pattern checklist

| # | Pattern | The rule | In three.ws |
|---|---|---|---|
| 1 | Job handles | A timed-out wait on accepted work returns success with a signed, pollable handle | `pendingResult()`, `api/_mcp-studio/tools.js` |
| 2 | First-class collector | `check_job`: one probe; done, pending or failed; `retryable` on a failed check; only an unknown handle is final | `handleCheckJob()` |
| 2a | Slow once | First collection post-processes; later reads hit a cached terminal frame | done-frame cache |
| 2b | Free collection | Collecting never spends the generation quota | `GEN_TOOLS`, `handler.js` |
| 3 | Host budgets | One absolute deadline per call, well inside the host's limit, flowing into every wait | `CHATGPT_CALL_BUDGET_MS`, `ctx.deadline` |
| 3a | Backoff | Polling stretches its interval; transient errors never end the loop | `pollJob()` |
| 4 | Submit tickets | The client names the work before it starts, so a lost response never orphans a job | `forge-submit-ticket.js` |
| 5 | Guidance in text | Instructions, descriptions and result text all say when and how to collect | pending narration |
| 5a | Honest numbers | Omit an estimate you no longer have; name a boot as a boot | `pendingTiming()` |
| 6 | Interface collects | Where allowed, the widget polls, rigs and persists; the model does not loop | `component.js` |
| 7 | Two channels | Minimal, identifier-free `structuredContent`; narrating `content`; protocol and tool errors kept apart | `ok()`, `toolError()` |
| 8 | Honest annotations | A tool that writes on any path is not read-only, and a check proves it | `audit:mcp-safety` |
| 9 | Tiers, continuations | Tiers degrade only as described; continuation state rides with the handle | `tier`, `refine` |
| 10 | Shelf first | A fast search before a slow generation | `search_catalog` |
| 11 | Auth per server | Keyless tools on a server that never challenges; auth declared in a manifest | `/api/mcp-studio`, `mcp.json` |
| 12 | Beyond tools | Resources filtered by access; prompts rendered against live tools; real prices | `resources.js`, `prompts.js` |

---

## 15. Build your own: a long-running MCP tool in 150 lines of Node

Here is a complete MCP server, with no dependencies, implementing patterns 1 to 5 around a real, slow computation: counting the primes below a limit with a sieve, in time-sliced chunks so the server can answer status checks while the job runs. Nothing is simulated; a large limit simply takes a while. Save it as `server.mjs` and run it with Node 18 or later.

```js
// A minimal MCP server (Streamable HTTP, JSON-RPC over POST) whose one slow
// tool never fails work that is still running. Node 18+, no dependencies.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const CALL_BUDGET_MS = Number(process.env.CALL_BUDGET_MS || 5_000);
const jobs = new Map(); // jobId -> { status, startedAt, limit, result }
const byRequest = new Map(); // caller's request_id + limit -> jobId

// Real work: count the primes below `limit` with a sieve, in slices of at
// most ~15 ms, so the event loop stays free to answer check_job meanwhile.
function countPrimes(limit, onDone) {
	const sieve = new Uint8Array(limit + 1);
	let p = 2;
	let m = 0; // next multiple of p to strike out; 0 means p is not started
	let count = 0;
	const slice = () => {
		const until = Date.now() + 15;
		while (p <= limit) {
			if (m === 0 && !sieve[p]) {
				count++;
				m = p * p;
			}
			while (m !== 0 && m <= limit) {
				const stop = Math.min(limit, m + p * 50_000);
				for (; m <= stop; m += p) sieve[m] = 1;
				if (Date.now() >= until) return setImmediate(slice);
			}
			m = 0;
			p++;
			if ((p & 0xffff) === 0 && Date.now() >= until) return setImmediate(slice);
		}
		onDone(count);
	};
	setImmediate(slice);
}

function startJob(limit) {
	const jobId = `job_${randomUUID()}`;
	const job = { status: 'running', startedAt: Date.now(), limit };
	jobs.set(jobId, job);
	countPrimes(limit, (primes) => Object.assign(job, { status: 'done', result: { limit, primes } }));
	return jobId;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for a job, but never past the caller's deadline.
async function waitFor(jobId, deadline) {
	while (Date.now() < deadline && jobs.get(jobId).status === 'running') {
		await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
	}
	return jobs.get(jobId).status !== 'running';
}

function done(job) {
	return {
		content: [{ type: 'text', text: `There are ${job.result.primes} primes below ${job.result.limit}.` }],
		structuredContent: { status: 'done', ...job.result },
	};
}

function pending(jobId) {
	const elapsed = Math.round((Date.now() - jobs.get(jobId).startedAt) / 1000);
	return {
		content: [{ type: 'text', text: `Still running (${elapsed}s so far). Call check_job with job_id ${jobId} in ~5s to collect it.` }],
		structuredContent: { status: 'pending', jobId, elapsedSeconds: elapsed, retryInSeconds: 5 },
	};
}

function toolError(message, extra = {}) {
	return { content: [{ type: 'text', text: message }], structuredContent: { error: true, message, ...extra }, isError: true };
}

const TOOLS = [
	{
		name: 'count_primes',
		description:
			'Count the primes below a limit. Large limits take longer than one call: the result is then ' +
			'status "pending" with a jobId. Call check_job with that jobId after retryInSeconds to collect it.',
		inputSchema: {
			type: 'object',
			required: ['limit'],
			properties: {
				limit: { type: 'integer', minimum: 2, maximum: 200_000_000 },
				request_id: { type: 'string', description: 'Optional. Reuse it on a retry to get the same job back instead of a second one.' },
			},
		},
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
	{
		name: 'check_job',
		description: 'Collect a pending count_primes job. One check, no waiting: returns the result, or a fresh pending state.',
		inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } },
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	},
];

async function callTool(name, args, started) {
	if (name === 'count_primes') {
		const limit = Number(args.limit);
		if (!Number.isInteger(limit) || limit < 2 || limit > 200_000_000) return toolError('limit must be an integer from 2 to 200000000.');
		const key = typeof args.request_id === 'string' && args.request_id ? `${args.request_id}:${limit}` : null;
		const jobId = (key && byRequest.get(key)) || startJob(limit);
		if (key) byRequest.set(key, jobId);
		const finished = await waitFor(jobId, started + CALL_BUDGET_MS);
		return finished ? done(jobs.get(jobId)) : pending(jobId);
	}
	if (name === 'check_job') {
		const job = jobs.get(String(args.job_id || ''));
		if (!job) return toolError('Unknown job_id. Start a new count_primes call.');
		return job.status === 'done' ? done(job) : pending(args.job_id);
	}
	return null;
}

async function rpc(msg) {
	const started = Date.now();
	const { id, method, params = {} } = msg;
	const ok = (result) => ({ jsonrpc: '2.0', id, result });
	const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
	if (method === 'initialize') {
		return ok({
			protocolVersion: '2025-06-18',
			serverInfo: { name: 'primes-demo', version: '1.0.0' },
			capabilities: { tools: { listChanged: false } },
			instructions: 'If a result is status "pending", call check_job after retryInSeconds. Do not call count_primes again for the same request.',
		});
	}
	if (method === 'notifications/initialized') return null;
	if (method === 'tools/list') return ok({ tools: TOOLS });
	if (method === 'tools/call') {
		const result = await callTool(params.name, params.arguments || {}, started);
		return result ? ok(result) : fail(-32602, `unknown tool: ${params.name}`);
	}
	return fail(-32601, `method not found: ${method}`);
}

http
	.createServer(async (req, res) => {
		if (req.method !== 'POST') {
			res.writeHead(405, { allow: 'POST' }).end();
			return;
		}
		let body = '';
		for await (const chunk of req) body += chunk;
		let out;
		try {
			out = await rpc(JSON.parse(body));
		} catch {
			out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
		}
		if (out === null) {
			res.writeHead(202).end();
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
	})
	.listen(Number(process.env.PORT || 8787), () => console.log(`primes-demo MCP server on :${process.env.PORT || 8787}`));
```

Run it and exercise both paths:

```bash
node server.mjs &

# A small job finishes inside the 5 s budget and returns inline.
curl -s localhost:8787 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"count_primes","arguments":{"limit":1000000}}}'

# A large one outlives the budget and comes back pending, with a handle.
curl -s localhost:8787 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"count_primes","arguments":{"limit":200000000,"request_id":"demo-1"}}}'
```

On our machine the first call returned `{"status":"done","limit":1000000,"primes":78498}` and the second returned pending after five seconds:

```json
{"status":"pending","jobId":"job_fd42dd59-ed96-4def-936e-937faee491a2","elapsedSeconds":5,"retryInSeconds":5}
```

A `check_job` a few seconds later returned `{"status":"done","limit":200000000,"primes":11078937}`; repeating the original call with the same `request_id` returned that same job instead of starting a second sieve; an unknown handle returned an `isError` result telling the caller to start over.

What the toy leaves out, and production needs:

- **A shared job store.** The `Map` lives in one process; behind a load balancer the collect request lands elsewhere. three.ws keeps job state in a shared cache, with per-instance memory only as a degraded fallback.
- **Signed handles.** Ours carry HMAC-signed routing information, so any instance can resolve them and nobody can forge one.
- **Expiry.** Our submit tickets and cached finished frames are kept for six hours, longer than any client's collection loop.
- **Truthful annotations.** This toy only computes, so read-only is honest. The moment your collector persists anything, it is not (section 10).
- **Abuse limits that never block collection** (section 4).

---

## 16. Honest limits

- **ChatGPT's 60-second limit is our observed, designed-for behavior,** documented by us as not configurable from the server. Other hosts' limits vary and change; measure the hosts you target.
- **The interface-side collector only exists where the host lets a widget call tools.** Elsewhere the model collects, and that depends on how well it follows the text.
- **Polling is not push.** The 3D Studio answers every request synchronously over `POST`, with no server-initiated stream. Polling with honest ETAs is the lowest common denominator that works on every host we target today.
- **Free capacity is finite.** The studio allows 4 generations a minute and 30 an hour per caller (on ChatGPT keyed on the anonymized per-user id it sends, with 300 an hour per source IP in total), plus a platform-wide hourly breaker. The caps fail open if the limiter itself is down, by design, because the lanes behind them are free to run.
- **Quality varies by lane and prompt.** The automated gate scored our teapot 0.914, and `look_at_model` lets a model inspect results, but neither replaces a human looking.
- **The watsonx Orchestrate notes in section 13 are untested by us,** and three.ws has no Orchestrate listing or integration.

---

## 17. Try it, and three questions for the group

All of this runs with no account, key, or payment:

```bash
# discover the server and its fourteen tools
curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'

# check the shelf first
curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_catalog","arguments":{"q":"desk lamp","limit":3}}}' \
  | jq -r '.result.content[0].text'

# start a draft generation; on the ChatGPT surface it answers within the 40 s budget
curl -s https://three.ws/api/mcp-chatgpt -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a ceramic coffee mug with a chipped rim","tier":"draft"}}}' \
  | jq '.result.structuredContent'

# if it came back pending, collect it with the jobId it returned
curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"check_job","arguments":{"job_id":"PASTE_THE_jobId_HERE"}}}' \
  | jq '.result.structuredContent'
```

To use the tools from Claude, ChatGPT, Cursor or VS Code, add `https://three.ws/api/mcp-studio` as a remote MCP server with no authentication, or follow the [connect page](https://three.ws/connect?utm_source=ibm-community). Source is Apache-2.0 at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), with the files cited here under `api/_mcp-studio/` and `api/_lib/`.

Three questions I would like this group to argue about:

1. **Should the collector be a tool at all?** We publish `check_job` because hosts render tools. MCP also has progress notifications and resource subscriptions. If you have shipped a long-running tool on a host that honors those, did they replace polling, or did you keep a collector tool as the fallback anyway?
2. **Where should the call budget live?** We hardcode 40 seconds for one host because we measured it. Should hosts advertise their tool-call timeout to servers, in `initialize` say, so every server can budget without guessing? If you build on watsonx Orchestrate, what limits have you observed at tool execution time?
3. **How honest should annotations be about bookkeeping writes?** `check_job` is marked not read-only because its first call persists the model. Strictly true, but a cautious client may then ask the user before checking on a job. Would you want a finer-grained hint in the spec, such as "writes only the server's own state"?

Reply in the comments or start a thread. If you build long-running tools on watsonx.ai or anywhere else, post what broke; this post exists because we wrote ours down.

_three.ws is an IBM Business Partner. The `/api/ibm/*` surfaces and the `@three-ws/ibm-watsonx-mcp` connector are independent developer tools built on IBM's publicly available Granite models; they are not IBM products and not endorsed by IBM. The 3D Studio MCP server described here is a three.ws product._
