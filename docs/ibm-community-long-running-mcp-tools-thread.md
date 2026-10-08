---
title: "Long-running MCP tools: what do you do when the work outlives the tool call?"
venue: IBM Community, Three.ws User Group (discussion thread)
account: nich (nich8)
companion_to: docs/ibm-community-long-running-mcp-tools-post.md (the blog post, not yet posted; replace with its community.ibm.com URL once it is live)
status: draft, not yet posted. Post after the companion blog is live, then link it where the thread says "the full write-up on the group blog"
framing_notes: |
  A self-contained discussion piece, not a link teaser: a reader who never opens the blog
  should still leave with the core pattern, a runnable command, and the main lessons.
  The affiliation line from docs/ibm.md stays in. Nothing here touches payments, tokens,
  wallets or other crypto-cluster content; the server discussed is the free 3D Studio
  MCP endpoint, which has no payment surface. Every number below was measured live on
  2026-10-08. Do not claim a watsonx Orchestrate listing or integration: there is none.
---

# Long-running MCP tools: what do you do when the work outlives the tool call?

Here is a problem I suspect several people in this group have hit, and I would like to compare notes.

An MCP tool call is, in practice, a function call with a timeout. Most tutorials build tools that answer in milliseconds, so the timeout never matters. But plenty of real agent work is slow: batch inference, document processing, a build, a forecast over a long series. Ours is 3D generation, where a text prompt becomes a textured GLB anywhere from about fifteen seconds to several minutes later. ChatGPT ends a tool call still open at 60 seconds. Other hosts wait longer, but none wait forever, and a model mid-turn has a limited budget of tool calls and a user watching.

We shipped the naive version first: submit, poll, return. A fix commit from July records the result. Our generations were taking four to six minutes, our tool waited three, so every call reported "taking longer than expected" while the model quietly finished a few minutes later. We checked twice, and both "failed" jobs were sitting complete in our database after the tool had given up. The user saw a failure, the assistant retried (starting a second job), and we paid for work nobody received.

The reframe that fixed it: **a timeout is a failure of the wait, not of the work.**

## The core pattern

When the wait runs out on work that was accepted, return a **success** result that carries a pollable handle, and publish a second tool that redeems it. You can watch it happen against our free endpoint, no account or key needed:

```bash
curl -s https://three.ws/api/mcp-chatgpt -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a small cast-iron teapot with a bamboo handle","tier":"draft"}}}' \
  | jq '.result.structuredContent'
```

When I ran it this morning, it answered after 40.16 seconds with this (handle trimmed):

```json
{
  "status": "pending",
  "jobId": "f1.eyJwIjoiZ2NwIiwiayI6bnVsbC...",
  "pollUrl": "https://three.ws/api/gpt-forge?job=f1.eyJwIjoiZ2NwIiwiayI6bnVsbC...",
  "stage": "mesh",
  "etaRemainingSeconds": 14,
  "prompt": "a small cast-iron teapot with a bamboo handle"
}
```

Passing that `jobId` to the `check_job` tool on `https://three.ws/api/mcp-studio` returned the finished model: a real 1.5 MB GLB, with viewer and AR links. The first check took 15.9 seconds and the second took 0.136 seconds. That gap is one of the lessons below.

## What we learned, in the order we learned it

**1. The pending result must not be an error.** If it carries `isError`, the model's instinct is to retry the generator, which is the worst possible next move. Pending is a success that says where the work is.

**2. The collector should be a tool, not a URL.** Our first fix returned only a poll URL. A model inside a host cannot browse. `check_job` makes one probe, never loops, and has exactly three outcomes: done (the same envelope the generator would have returned), still pending (with fresh timing), or failed. Only an unrecognized handle is final, and its message says to start a new generation.

**3. A check that fails is not a job that fails.** Our first collection of a finished job does real work (it copies the model into durable storage and runs a quality gate), so it can be slow. In a second run today, the first check of a brass desk lamp hit its 30-second bound and came back with `retryable: true`; the next check returned the model. Later checks are served from a cached finished frame, which is where the 0.136 seconds comes from. Before that cache existed, every poll of a finished job re-ran the post-processing, 13 to 33 seconds per poll.

**4. Budget against the host, not against the work.** If the host kills the call, you lose the response, including the handle you were about to return. Our ChatGPT surface converts a 40-second budget into one absolute deadline when the call arrives, and every wait inside the call (prompt rewriting, submit, polling) reads that deadline. Why 40 and not 59: a submit is guaranteed an 8-second floor even near the deadline, and the response still has to travel back through the host.

**5. Name the work before you start it.** This was our subtlest bug. Submits themselves were taking up to 42 seconds in production. The client aborted at its deadline, the server finished anyway and created a real job, and nobody ever received its id. The fix is a submit ticket: the client mints an identifier and sends it with the submit, the server records the job under it whether or not anyone is still listening, and a timed-out caller returns the ticket as its handle. It is an idempotency key applied to the start of a long job, and the collector needed no changes.

**6. Put the polling guidance where the model reads it.** The server instructions, the tool descriptions, and above all the result text itself ("call check_job with this job_id in ~14s") all say when to collect. Every number you show a model gets acted on, so we removed one that lied: our remaining-time estimate had been floored at five seconds, and one 12.5-minute job showed "roughly 5s to go" for its final eleven minutes. Past the estimate we now omit it and show real elapsed time.

**7. Annotations are a contract.** We had marked `check_job` read-only and idempotent. It is neither: its first call persists the model. A client deciding what is safe to repeat without asking the user was being told the wrong thing. It is fixed, and a check in our build now compares every tool's annotations with what its handler actually does.

**8. Auth is a property of a server, not a tool.** Our free catalog search lived on a server whose other tools need an account, and that server answers `initialize` with a 401 so clients start sign-in. That is correct MCP authorization, and it also meant our "free, no account" tool was not reachable without an account from any real client. We now serve keyless tools from a server that never challenges.

The full write-up on the group blog walks through all ten patterns with the real code, request and response pairs for every step, the resources and guided-prompt side of MCP, a 150-line Node server you can run to try the pattern yourself, and a section on what IBM documents about remote MCP toolkits in watsonx Orchestrate. Two points from that section belong here too, because they apply to anyone building for Orchestrate: IBM's ADK docs say Orchestrate waits up to 30 seconds for your server's tool list at import, so keep `tools/list` cheap, and that end-of-file errors at execution "usually happen when the server times out or doesn't respond in time," which is exactly the failure a self-imposed budget prevents. We have not tested against an Orchestrate tenant ourselves, and three.ws has no Orchestrate listing or integration.

## Questions for the group

1. **Has anyone replaced polling with push in production?** MCP has progress notifications and resource subscriptions. If you have shipped a long-running tool on a host that honors them, did they let you drop the collector tool, or did you keep it as the fallback for hosts that do not?
2. **What tool-call limits have you measured?** We designed to ChatGPT's 60 seconds because we observed it. If you build on watsonx Orchestrate, Claude, or another host, what have you seen at execution time, and do you think hosts should advertise their timeout to servers so nobody has to guess?
3. **How strict should annotations be about bookkeeping writes?** Marking a status check as not read-only is accurate for us, but it may make a careful client ask the user before every check. Would a finer-grained hint help, or is "it writes, so say so" the right rule?

If you are wrapping slow watsonx.ai workloads, or anything else, as MCP tools, I would especially like to hear what broke for you.

_three.ws is an IBM Business Partner. The `/api/ibm/*` surfaces and the open-source `@three-ws/ibm-watsonx-mcp` connector are independent developer tools built on IBM's publicly available Granite models; they are not IBM products and not endorsed by IBM. The 3D Studio MCP server discussed here is a three.ws product._
