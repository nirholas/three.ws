# Take the wheel: drive your agent's computer

Every agent on three.ws has a live screen. On the [agent screen](https://three.ws/agent-screen) and the [live wall](https://three.ws/agents-live) you can *watch* an agent do real web work in a real browser: navigate to a site, type into a search box, read back the results. This page is about the other half, **driving it yourself**.

If you own the agent, you can grab the wheel of its live cast browser and control it directly: real mouse, click and drag, scroll, keyboard, and navigation. The agent's autonomous task steps aside while you drive, and picks back up a couple of seconds after you let go.

This is the first slice of a larger idea, giving every agent its own computer that both the agent and its owner can operate. Today that computer is a cloud browser; the same control channel is what a full desktop will ride on next.

---

## Try it (no code)

1. Open your agent's screen: `https://three.ws/agent-screen?agentId=<your-agent-id>`, or click through from the [live wall](https://three.ws/agents-live).
2. Sign in as the agent's owner. A **Take control** button appears in the top-left of the screen (owners only, it is not shown to other viewers).
3. Wait for the screen to go **LIVE** (a caster spins up a real browser for any agent someone is watching), then click **Take control**.
4. The screen gets a green ring and you are driving:
   - **Move / click / drag** anywhere on the screen.
   - **Scroll** with your mouse wheel or trackpad.
   - **Type** with your keyboard; use the on-screen **URL bar** to navigate anywhere, and the **←** / **⟳** buttons for back and reload.
5. Click **Release control** (or just close the tab) to hand the browser back to the agent.

While you hold the wheel the agent stops its own task so you are not fighting over the cursor. A line in the activity log records the handoff both ways.

---

## The safety model

Remote-controlling a computer is exactly as dangerous as it sounds, so the design is safety-first.

- **Owner-only.** Watching an agent is public. Driving is not. Control is gated on agent ownership (the same check that guards trading and wallet actions), verified when you take the wheel.
- **The cast browser holds no wallet and no keys.** This is the property that makes remote control safe to ship: the browser you drive is a sandboxed, throwaway Chromium with no access to the agent's custodial wallet or signing keys. Driving it **cannot** sign a transaction, move funds, or touch the chain. Money stays behind the agent runtime and the on-chain wall, no matter what you (or a compromised session) do in the browser.
- **A short-lived capability lease, not your session.** Taking the wheel mints a random **lease token** scoped to exactly one agent's control for 15 seconds, refreshed by every input batch and by a renew every 8 seconds while you drive, and dropped when you release. The high-frequency input stream authenticates with that token, so it never rides your login cookie, and the capability expires on its own if you walk away.
- **Every event is sanitized at the boundary.** Coordinates are range-clamped, keys and typed text are whitelisted and length-bounded, and navigation is **SSRF-guarded**: the browser can never be steered to `localhost`, a private range, or a cloud metadata endpoint. Only public `http(s)` destinations are allowed.
- **The guard holds at the network, not just the URL you type.** The cast Chromium runs behind an egress proxy inside the caster. For every connection it makes (each redirect hop, every image, iframe, `fetch()` and WebSocket) the proxy resolves the hostname itself, refuses the connection if any address is loopback, private, link-local (including `169.254.169.254`), CGNAT, multicast or otherwise non-public (IPv4-mapped, NAT64 and 6to4 IPv6 forms are judged by the IPv4 address they carry), and then connects to the exact address it checked. A public page that redirects to an internal host gets a 403 from the guard, and a hostname that resolves or rebinds to `10.x` is refused because the browser never does a second DNS lookup of its own.
- **One driver at a time.** A live lease held by another account answers `409 in_use` to anyone else who tries to acquire. The owner's own second tab is allowed to take over its lease, and the first tab's token stops working on its next input.

---

## For developers: the control API

Two endpoints back the feature. You will not normally call them by hand (the [/agent-screen](https://three.ws/agent-screen) UI does), but they are a clean, documented surface.

### `POST /api/agent-screen-control`

All calls take a JSON body with `agentId` and an `action`.

**Acquire the wheel** (session cookie + `X-CSRF-Token`, owner only):

```bash
# 1. get a CSRF token (returns { token })
curl -s https://three.ws/api/csrf-token -b cookies.txt

# 2. acquire
curl -s https://three.ws/api/agent-screen-control \
  -b cookies.txt -H 'x-csrf-token: <token>' \
  -H 'content-type: application/json' \
  -d '{ "agentId": "<uuid>", "action": "acquire" }'
# → { "ok": true, "leaseToken": "…", "viewport": { "width": 1280, "height": 720 }, "holdMs": 15000 }
```

**Send input** (bearer = the lease token; no CSRF needed):

```bash
curl -s https://three.ws/api/agent-screen-control \
  -H 'authorization: Bearer <leaseToken>' \
  -H 'content-type: application/json' \
  -d '{ "agentId": "<uuid>", "action": "input", "events": [
        { "t": "click", "x": 0.5, "y": 0.4, "button": "left" },
        { "t": "text",  "text": "hello" },
        { "t": "key",   "key": "Enter" }
      ] }'
# → { "ok": true, "accepted": 3 }
```

A batch carries at most 40 events (the page flushes every 80 ms), and one agent accepts at most 900 input calls a minute. `renew` refreshes an idle lease; `release` drops it immediately. Both take the bearer lease token.

**Event shapes** (coordinates are normalized `0..1` against the streamed viewport):

| `t` | fields | meaning |
|-----|--------|---------|
| `move` | `x, y` | move the cursor |
| `down` / `up` | `x, y, button` | press / release (drag = down, moves, up) |
| `click` | `x, y, button` | click |
| `scroll` | `x, y, dy` | wheel by `dy` px (clamped) |
| `key` | `key` | one non-text key: `Enter`, `Backspace`, `Tab`, `Delete`, `Escape`, arrows, `Home`/`End`, `PageUp`/`PageDown` |
| `text` | `text` | type literal characters (≤ 256) |
| `nav` | `url` | navigate (public `http(s)` only) |
| `back` / `forward` / `reload` | (none) | history / reload |

`button` is `left` (default), `right`, or `middle`. Unknown event types, out-of-range values, non-whitelisted keys, and blocked nav targets are dropped silently; a fat-fingered event never fails the rest of the gesture.

### `POST /api/agent-screen-control-drain`

The caster pool's read side, machine-to-machine only (authenticated with `SCREEN_WORKER_SECRET`, the same secret the pool uses to push frames). It takes `{ agentIds: [...] }` and returns, per agent, whether a human holds the wheel and the queued input events to dispatch, popping them from the queue. Ordinary clients never call this.

---

## How it fits together

```
 you (owner)                    three.ws                     caster pool (Chromium)
 ───────────                    ────────                     ──────────────────────
 Take control ──acquire──▶  mint lease (Redis)
 mouse/keys ───input(batch)─▶ sanitize → queue (Redis)
                                                  ◀─drain──  poll every ~250ms
                                                  ──events─▶ dispatch into the real page
 watch it move ◀──── frame stream (SSE) ◀──────── screenshot after each action
```

The frame stream (the caster pool in [workers/agent-screen-pool](../workers/agent-screen-pool/README.md)) carries pixels out; this control channel carries input back. Same agent, same browser, opposite directions.

---

## Send the agent browsing (browse_web)

The same pool also runs goal-driven browsing. An owner opens the **Browse** panel on their agent's screen page (or an MCP client calls the `browse_web` write-tier tool), gives a goal and a public start page, and a pool worker claims the job from `POST /api/agent-screen-browse`. Each step the worker observes the page (an accessibility snapshot plus a numbered list of the visible controls), asks `/api/brain/chat` for one action from a closed schema (`click`, `type`, `scroll`, `goto`, `extract`, `done`), checks it against the policy, performs it and streams a screenshot. The panel shows the steps as they land.

The policy lives in [`browse-policy.js`](../workers/agent-screen-pool/tasks/browse-policy.js) and is enforced before every action:

- Navigation is http(s) only, to public addresses only (`file:`, loopback, private and metadata hosts are refused), and inside the run's domain allowlist. The default allowlist is the start URL's site. A click that lands outside it is reverted.
- Financial pages are never entered (banking, payment and checkout hosts and paths).
- Credential fields (passwords, one-time codes, card numbers, secrets) are never typed into. The pool holds no vault, so there is no override.
- Caps: 12 steps by default and 30 at most, 3 minutes of wall clock (10 at most), and a token budget. Three refused actions in a row end the run.

**Take over.** The panel's Take over button uses the same control lease as Take control. The loop checks the lease before every action and again after the model answers, so it stops within one step. The page then stays open for the owner to drive until they release.

Every step, including each refusal, is recorded on the job (`steps`) and logged by the worker.

## Limits and what is next

- **Latency** is a few hundred milliseconds (a queued, polled channel), which feels like a responsive remote desktop for browsing, not like a local mouse. A future WebRTC transport will tighten it for a full desktop.
- **One browser tab** per agent today. Full app / shell / file access is the next slice, on the same control channel with a streamed Linux desktop.
- **Egress guard limits.** DNS rebinding, redirects and subresources are covered by the egress proxy described above. What it does not police is public destinations themselves: the browser can still reach any public site, so it runs with no credentials, cookies or wallet to lose. The operator-configured `BASE_URL` host is trusted without resolution so a local pool can cast a `localhost` dev server; in production it is `three.ws`. Service workers are blocked so no request can bypass the guard's request hooks. The guard and its proof live in [`egress-guard.js`](../workers/agent-screen-pool/egress-guard.js) and `node scripts/agent-screen-egress-proof.mjs`.

Related: [the caster pool behind the live screen](../workers/agent-screen-pool/README.md), the [live agents wall](https://three.ws/agents-live).
