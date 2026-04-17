# CZ Demo Failure Modes

A comprehensive table of conceivable failures during the live CZ demo, their symptoms, recovery paths, and time costs. Use this to rehearse worst-case scenarios before the event.

---

## Failure Mode Reference Table

| #   | Failure Mode                                | Symptom                                                    | Likely Root Cause                                                                              | Recovery Path                                                                                                                     | Time Cost | Severity |
| --- | ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| 1   | Avatar won't render                         | Black screen or loading spinner infinite                   | GLB 404, CORS error, or slow CDN                                                               | Check DevTools Network; if 404, restart server; if CORS, verify origin config; wait 30s or switch to `/cz/offline/`               | 30-90s    | HIGH     |
| 2   | MetaMask popup blocked                      | Click claim button; nothing happens                        | Browser popup blocker enabled                                                                  | Allow popups in browser settings; click MetaMask extension icon                                                                   | 20s       | MEDIUM   |
| 3   | MetaMask not installed                      | No response to claim click; no wallet in toolbar           | Fresh browser profile without MetaMask                                                         | Install MetaMask extension OR switch to `/cz?rehearsal=1`                                                                         | 2m        | MEDIUM   |
| 4   | Base Sepolia RPC congestion                 | Claim modal stuck on "Waiting for confirmation…" for > 45s | Network overload or node sync lag                                                              | Continue narrating feature; check Basescan for tx; if > 2 min, switch to `/cz?rehearsal=1`                                        | 2-3m      | MEDIUM   |
| 5   | Transaction fails (out of gas)              | MetaMask shows "Transaction failed" or modal shows error   | CZ's wallet has < required gas (e.g., < 0.01 ETH)                                              | Acknowledge "we ran out of gas—this is why we fund wallets beforehand"; would auto-refuel on mainnet. Switch to `/cz?rehearsal=1` | 1m        | HIGH     |
| 6   | Agent already claimed                       | Modal says "Already owned by 0x..."                        | Staging state carries over from previous rehearsal or live event                               | This is actually safe—just narrate "this agent is already claimed, but on mainnet this would be transferable." Continue.          | 0s        | LOW      |
| 7   | `/api/cz/identity` returns 404              | Footer shows "Not yet onchain"                             | Agent not yet registered on Base Sepolia (pre-onchain state)                                   | Narrate: "Registration is coming this week. Let me show you the code." Skip Basescan step; focus on local demo                    | 0s        | LOW      |
| 8   | Basescan / block explorer slow or down      | Click to see agent registration; page hangs or 503         | Block explorer RPC congestion or outage                                                        | Close tab; continue narration without showing on-chain proof. Say "We'll check that after." Return to avatar demo.                | 30-60s    | MEDIUM   |
| 9   | Confetti library fails to load              | Claim succeeds but no confetti animation                   | CDN down for confetti.js or bundle load fails                                                  | Visually confirm modal says "Claim successful" without animation; narrate "success confirmed"; not critical for messaging         | 0s        | LOW      |
| 10  | LobeHub iframe blank or unresponsive        | Open LobeHub tab; shows white space or "Loading…" forever  | postMessage origin mismatch, LobeHub build stale, or iframe blocked by CORS                    | Close LobeHub tab; skip step 7 (live chat). Narrate feature conceptually. Move to Q&A.                                            | 1m        | MEDIUM   |
| 11  | Venue wifi drops mid-demo                   | Network tab shows all requests failing; avatar frozen      | WiFi router disconnects or signal lost                                                         | Switch to phone hotspot; wait 5s for DNS. If still down, open `/cz/offline/index.html`                                            | 10-20s    | MEDIUM   |
| 12  | Laptop overheating / GPU throttle           | Avatar animation stutters, drops FPS, or becomes choppy    | Sustained 100% GPU load (avatar morph targets on old hardware)                                 | Reduce avatar animation loop, or show `/cz/offline/` (lighter load) instead                                                       | 30s       | LOW      |
| 13  | MetaMask shows wrong chain                  | Approve signature in MetaMask; modal doesn't respond       | Chain ID mismatch (MetaMask on Mainnet instead of Base Sepolia)                                | Click MetaMask icon; switch network to Base Sepolia. Re-try claim.                                                                | 30s       | MEDIUM   |
| 14  | IPFS gateway timeout (if used for metadata) | Claim confirms but agent metadata never loads              | IPFS node unreachable or rate-limited                                                          | This would affect only post-claim metadata fetch; doesn't block claim itself. Continue; metadata updates eventually.              | 0s        | LOW      |
| 15  | Browser tab crash                           | Demo tab goes white; full reload needed                    | Out-of-memory (large model), JavaScript exception, or OS kill                                  | Force-reload tab (Ctrl+R or Cmd+R). Re-enter from bookmarks or history.                                                           | 20-30s    | MEDIUM   |
| 16  | Console errors visible to audience          | Audience sees red X icon in DevTools or hears beep         | JavaScript error thrown (e.g., undefined variable, failed fetch)                               | Close DevTools before demo starts. If opened during: minimize it or explain "these are debug logs, not errors."                   | 0s        | LOW      |
| 17  | Staging URL is down (502 / 503)             | All requests to staging fail, page never loads             | Vercel build failure, database connection error, or deployment rollback                        | Switch to production URL (if CZ is registered there). Narrate: "We're switching to the live instance."                            | 1-2m      | HIGH     |
| 18  | JWT/session token expired                   | API calls return 401 Unauthorized                          | Session cookie or OAuth token expired (rare in 1-hour window; usually from T-24h to demo time) | Clear cookies: Ctrl+Shift+Delete → Clear site data. Reload. Re-authenticate if prompted.                                          | 30s       | LOW      |
| 19  | Avatar file too large / slow download       | Avatar load time > 20s                                     | GLB file oversized (should be < 5MB), CDN cache miss, or slow network                          | Wait. If > 30s: download pre-cached version from `/cz/offline/index.html` or restart server to clear CDN.                         | 30s       | MEDIUM   |
| 20  | Claim button visually broken                | Button text corrupted, styling off, or not clickable       | CSS injection, missing stylesheet, or browser rendering bug                                    | Reload page. If persists, check DevTools for CSS errors. Try incognito mode.                                                      | 20s       | LOW      |

---

## Mitigation Strategy by Severity

### HIGH (5 failures)

**Plan B required.** These block the demo or lose audience attention > 1 minute.

- **#1 Avatar won't render:** Pre-load `/cz/offline/index.html` in a second browser window as a hot-swap.
- **#5 Out of gas:** Fund CZ's wallet with 0.1 ETH the day before. Verify with `eth_getBalance`.
- **#17 Staging down:** Know the production URL as a backup (if agent is onchain there).

### MEDIUM (10 failures)

**Workarounds exist.** These cost 10–90 seconds but don't kill the demo.

- **#2, #3 MetaMask issues:** Have `/cz?rehearsal=1` bookmarked. Rehearsal mode fakes the claim.
- **#4 RPC slow:** Practice narrating the feature without the UI (talk about wallets, transactions, on-chain identity).
- **#8 Block explorer down:** Skip the Basescan screenshot; show the code instead.
- **#10 LobeHub blank:** Focus the demo on the avatar and claiming, not the plugin.
- **#11 Wifi drops:** Hotspot ready; offline fallback preloaded.
- **#12 GPU throttle:** Laptop at idle before demo; close Chrome tabs.
- **#13 Wrong chain:** One MetaMask click to fix.
- **#15 Browser crash:** Reload tab from history.
- **#19 Avatar slow:** Pre-cache by loading `/cz` 30 minutes before.

### LOW (5 failures)

**Audience won't notice.** These are transparent or don't affect the demo flow.

- **#6, #7 Pre-onchain state:** Expected. Narrate accordingly.
- **#9 Confetti fails:** Still a successful claim; visual polish, not essential.
- **#14 IPFS slow:** Metadata loads eventually; doesn't block core flow.
- **#18 Token expired:** Rare. Quick reload fixes.
- **#20 CSS broken:** Reload or incognito; not architectural.

---

## Pre-Demo Verification Checklist

Run this 1 hour before the demo to catch failures **before** the event:

```bash
# 1. Staging is up
curl -I https://staging-url/cz | grep "200 OK" || echo "FAIL: staging down"

# 2. API is responding
curl -s https://staging-url/api/cz/identity | jq .agentId || echo "FAIL: API 404 or error"

# 3. Avatar file exists and is reasonable size
curl -I https://staging-url/avatars/cz.glb | grep "Content-Length" | awk '{print $2}' | \
  awk '{if ($1 > 1000000 && $1 < 20000000) print "OK"; else print "FAIL: size out of range"}' || echo "FAIL: size check"

# 4. CZ wallet has enough gas
# (requires ethers.js or web3.py; manual check in MetaMask is fine)
echo "Check MetaMask balance: 0x<CZ_ADDRESS> on Base Sepolia > 0.05 ETH"

# 5. Offline fallback loads (no network calls)
echo "Open http://localhost:3000/cz/offline/index.html with network throttled to offline"

# 6. Browser is fresh
echo "Close all browser windows; open incognito/private window; install MetaMask"

# 7. Check console for errors
echo "DevTools on /cz: Ctrl+Shift+J, look for red errors"
```

---

## Incident Log Template

If something fails during the actual demo, fill this out immediately after (for post-mortem):

```markdown
**Failure:** #[X] — [Name]
**Time in demo:** [HH:MM:SS or "step X"]
**Exact symptom:** [What the operator observed]
**Recovery used:** [Which fallback or workaround]
**Audience reaction:** [Noticed? Lost interest? Recovered?]
**Root cause (investigation):** [After-the-fact diagnosis]
**Action item:** [Fix for next time]
```

Example:

```markdown
**Failure:** #4 — RPC Congestion
**Time in demo:** Step 5 (claim confirmation)
**Exact symptom:** Modal hung on "Waiting for confirmation…" for 2m 30s
**Recovery used:** Switched to /cz?rehearsal=1 after 90s narration
**Audience reaction:** Didn't seem to notice; thought it was intentional
**Root cause:** Base Sepolia RPC had 12-block backlog at demo time
**Action item:** Use secondary RPC fallback endpoint for next event
```

---

## Rehearsal Script

**Run this the day before the event** to catch + fix failures before they're live:

1. **Load staging 10 times** — warm cache, observe timing
2. **Claim with throwaway wallet** — succeed or fail intentionally
3. **Simulate each of failures #1–5** (highest severity):
    - Unplug wifi → open `/cz/offline/`
    - Clear MetaMask → observe what happens
    - Set gas to 0 in MetaMask → watch transaction fail
    - Stop the dev server → see 502 and fallback to production
    - Disable JavaScript in DevTools → avatar still renders (graceful degradation)
4. **Time the full demo** with stopwatch; hit < 5 minutes
5. **Record the run on your phone** — watch it back for UX gotchas
6. **Reset state** — delete cookies, seed phrases, etc. before handing off to the live operator

---
